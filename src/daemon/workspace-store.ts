import { Database } from "bun:sqlite";
import type { Workspace, WorkspaceEvent, WorkspaceStatus } from "../services/workspace";

const DB_PATH = `${process.env.CLAUDE_HUB_DIR ?? process.env.HOME + "/.claude-hub"}/workspaces.db`;

export class WorkspaceStore {
  private db: Database;

  constructor(dbPath?: string) {
    this.db = new Database(dbPath ?? DB_PATH);
    this.db.exec("PRAGMA journal_mode=WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        handoff_id TEXT NOT NULL DEFAULT '',
        owner_account TEXT NOT NULL,
        repo_path TEXT NOT NULL,
        branch TEXT NOT NULL,
        worktree_path TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('preparing','ready','failed','cleaning')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_ws_key ON workspaces(repo_path, branch)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_ws_status ON workspaces(status)`);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workspace_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        type TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        from_status TEXT,
        to_status TEXT,
        error TEXT,
        git_output TEXT
      )
    `);
  }

  create(ws: Omit<Workspace, "events">): void {
    this.db.run(
      `INSERT INTO workspaces (id, handoff_id, owner_account, repo_path, branch, worktree_path, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [ws.id, ws.handoffId, ws.ownerAccount, ws.repoPath, ws.branch, ws.worktreePath, ws.status, ws.createdAt, ws.updatedAt]
    );
  }

  updateStatus(id: string, status: WorkspaceStatus): void {
    this.db.run(
      `UPDATE workspaces SET status = ?, updated_at = ? WHERE id = ?`,
      [status, new Date().toISOString(), id]
    );
  }

  addEvent(workspaceId: string, event: WorkspaceEvent): void {
    this.db.run(
      `INSERT INTO workspace_events (workspace_id, type, timestamp, from_status, to_status, error, git_output)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [workspaceId, event.type, event.timestamp, event.from ?? null, event.to ?? null, event.error ?? null, event.gitOutput ?? null]
    );
  }

  getById(id: string): Workspace | null {
    const row = this.db.query("SELECT * FROM workspaces WHERE id = ?").get(id) as any;
    if (!row) return null;
    return this.assembleWorkspace(row);
  }

  getActiveByKey(repoPath: string, branch: string): Workspace | null {
    const row = this.db
      .query("SELECT * FROM workspaces WHERE repo_path = ? AND branch = ? AND status IN ('preparing','ready','cleaning') LIMIT 1")
      .get(repoPath, branch) as any;
    if (!row) return null;
    return this.assembleWorkspace(row);
  }

  getByStatus(status: WorkspaceStatus): Workspace[] {
    const rows = this.db
      .query("SELECT * FROM workspaces WHERE status = ? ORDER BY created_at ASC")
      .all(status) as any[];
    return rows.map((row) => this.assembleWorkspace(row));
  }

  delete(id: string): void {
    this.db.run("DELETE FROM workspace_events WHERE workspace_id = ?", [id]);
    this.db.run("DELETE FROM workspaces WHERE id = ?", [id]);
  }

  close(): void {
    this.db.close();
  }

  private assembleWorkspace(row: any): Workspace {
    const events = this.db
      .query("SELECT * FROM workspace_events WHERE workspace_id = ? ORDER BY timestamp ASC")
      .all(row.id)
      .map((e: any) => ({
        type: e.type,
        timestamp: e.timestamp,
        from: e.from_status ?? undefined,
        to: e.to_status ?? undefined,
        error: e.error ?? undefined,
        gitOutput: e.git_output ?? undefined,
      }));
    return {
      id: row.id,
      handoffId: row.handoff_id,
      ownerAccount: row.owner_account,
      repoPath: row.repo_path,
      branch: row.branch,
      worktreePath: row.worktree_path,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      events,
    };
  }
}
