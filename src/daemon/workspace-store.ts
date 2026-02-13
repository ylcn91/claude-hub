import { BaseStore } from "./base-store";
import type { Workspace, WorkspaceEvent, WorkspaceStatus } from "../services/workspace";
import { getWorkspacesDbPath } from "../paths";

const DB_PATH = getWorkspacesDbPath();

interface WorkspaceRow {
  id: string;
  handoff_id: string;
  owner_account: string;
  repo_path: string;
  branch: string;
  worktree_path: string;
  status: string;
  created_at: string;
  updated_at: string;
}

interface WorkspaceEventRow {
  id: number;
  workspace_id: string;
  type: string;
  timestamp: string;
  from_status: string | null;
  to_status: string | null;
  error: string | null;
  git_output: string | null;
}

export class WorkspaceStore extends BaseStore {
  constructor(dbPath?: string) {
    super(dbPath ?? DB_PATH);
  }

  protected createTables(): void {
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
    const row = this.db.query("SELECT * FROM workspaces WHERE id = ?").get(id) as WorkspaceRow | null;
    if (!row) return null;
    return this.assembleWorkspace(row);
  }

  getActiveByKey(repoPath: string, branch: string): Workspace | null {
    const row = this.db
      .query("SELECT * FROM workspaces WHERE repo_path = ? AND branch = ? AND status IN ('preparing','ready','cleaning') LIMIT 1")
      .get(repoPath, branch) as WorkspaceRow | null;
    if (!row) return null;
    return this.assembleWorkspace(row);
  }

  getByStatus(status: WorkspaceStatus): Workspace[] {
    const rows = this.db
      .query("SELECT * FROM workspaces WHERE status = ? ORDER BY created_at ASC")
      .all(status) as WorkspaceRow[];
    return rows.map((row) => this.assembleWorkspace(row));
  }

  delete(id: string): void {
    this.db.run("DELETE FROM workspace_events WHERE workspace_id = ?", [id]);
    this.db.run("DELETE FROM workspaces WHERE id = ?", [id]);
  }

  private assembleWorkspace(row: WorkspaceRow): Workspace {
    const events = this.db
      .query("SELECT * FROM workspace_events WHERE workspace_id = ? ORDER BY timestamp ASC")
      .all(row.id) as WorkspaceEventRow[];
    return {
      id: row.id,
      handoffId: row.handoff_id,
      ownerAccount: row.owner_account,
      repoPath: row.repo_path,
      branch: row.branch,
      worktreePath: row.worktree_path,
      status: row.status as WorkspaceStatus,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      events: events.map((e) => ({
        type: e.type,
        timestamp: e.timestamp,
        from: e.from_status ?? undefined,
        to: e.to_status ?? undefined,
        error: e.error ?? undefined,
        gitOutput: e.git_output ?? undefined,
      })) as WorkspaceEvent[],
    };
  }
}
