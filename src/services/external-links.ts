import { Database } from "bun:sqlite";
import { join } from "node:path";
import { mkdirSync } from "node:fs";

export interface ExternalLink {
  id: string;
  provider: "github";
  type: "issue" | "pr";
  url: string;
  externalId: string; // "owner/repo#123"
  taskId: string;
  createdAt: string;
}

function getDefaultDbPath(): string {
  const hubDir = process.env.CLAUDE_HUB_DIR ?? `${process.env.HOME}/.claude-hub`;
  mkdirSync(hubDir, { recursive: true });
  return join(hubDir, "external-links.db");
}

export class ExternalLinkStore {
  private db: Database;

  constructor(dbPath?: string) {
    this.db = new Database(dbPath ?? getDefaultDbPath());
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS external_links (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        type TEXT NOT NULL,
        url TEXT NOT NULL,
        external_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_links_task_id ON external_links(task_id)`);
  }

  addLink(link: Omit<ExternalLink, "id" | "createdAt">): ExternalLink {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    this.db.run(
      `INSERT INTO external_links (id, provider, type, url, external_id, task_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, link.provider, link.type, link.url, link.externalId, link.taskId, createdAt],
    );
    return { ...link, id, createdAt };
  }

  getLinksForTask(taskId: string): ExternalLink[] {
    const rows = this.db.query(
      `SELECT * FROM external_links WHERE task_id = ? ORDER BY created_at`,
    ).all(taskId) as any[];
    return rows.map(rowToLink);
  }

  getAllLinks(): ExternalLink[] {
    const rows = this.db.query(
      `SELECT * FROM external_links ORDER BY created_at`,
    ).all() as any[];
    return rows.map(rowToLink);
  }

  removeLink(id: string): boolean {
    const result = this.db.run(`DELETE FROM external_links WHERE id = ?`, [id]);
    return result.changes > 0;
  }

  close(): void {
    this.db.close();
  }
}

function rowToLink(row: any): ExternalLink {
  return {
    id: row.id,
    provider: row.provider,
    type: row.type,
    url: row.url,
    externalId: row.external_id,
    taskId: row.task_id,
    createdAt: row.created_at,
  };
}

// ── Module-level convenience API (backwards-compatible) ──
let _store: ExternalLinkStore | undefined;

function getStore(): ExternalLinkStore {
  if (!_store) _store = new ExternalLinkStore();
  return _store;
}

export function addLink(link: Omit<ExternalLink, "id" | "createdAt">): ExternalLink {
  return getStore().addLink(link);
}

export function getLinksForTask(taskId: string): ExternalLink[] {
  return getStore().getLinksForTask(taskId);
}

export function getAllLinks(): ExternalLink[] {
  return getStore().getAllLinks();
}

export function removeLink(id: string): boolean {
  return getStore().removeLink(id);
}

/** Reset singleton — for testing */
export function _resetStore(): void {
  _store?.close();
  _store = undefined;
}
