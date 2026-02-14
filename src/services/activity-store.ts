import { BaseStore } from "../daemon/base-store";

export type ActivityEventType =
  | "task_created" | "task_transitioned" | "task_accepted" | "task_rejected"
  | "handoff_sent" | "handoff_accepted"
  | "message_sent" | "message_read"
  | "workspace_created" | "workspace_cleaned"
  | "workflow_started" | "workflow_step_completed" | "workflow_completed"
  | "retro_started" | "retro_completed"
  | "github_issue_created" | "github_comment_added"
  | "acceptance_passed" | "acceptance_failed"
  // F-02: Delegation lifecycle events (Paper §4.5)
  | "task_assigned" | "task_started" | "task_completed"
  | "checkpoint_reached" | "progress_update"
  | "sla_warning" | "sla_breach"
  | "task_verified" | "reassignment"
  | "trust_update" | "delegation_chain"
  | "delegation_reauthorized" | "cognitive_friction_triggered"
  | "agent_quarantined" | "agent_reinstated";

export interface ActivityEvent {
  id: string;
  type: ActivityEventType;
  timestamp: string;
  account: string;
  workflowRunId?: string;
  taskId?: string;
  metadata: Record<string, unknown>;
}

export class ActivityStore extends BaseStore {
  protected createTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS activity (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        account TEXT NOT NULL,
        workflow_run_id TEXT,
        task_id TEXT,
        metadata TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_activity_type ON activity(type);
      CREATE INDEX IF NOT EXISTS idx_activity_account ON activity(account);
      CREATE INDEX IF NOT EXISTS idx_activity_workflow ON activity(workflow_run_id);
      CREATE INDEX IF NOT EXISTS idx_activity_timestamp ON activity(timestamp);

      CREATE VIRTUAL TABLE IF NOT EXISTS activity_fts USING fts5(
        type, account, metadata, content=activity, content_rowid=rowid
      );

      CREATE TRIGGER IF NOT EXISTS activity_ai AFTER INSERT ON activity BEGIN
        INSERT INTO activity_fts(rowid, type, account, metadata)
        VALUES (new.rowid, new.type, new.account, new.metadata);
      END;
    `);
  }

  emit(event: Omit<ActivityEvent, "id">): ActivityEvent {
    const id = crypto.randomUUID();
    this.db.prepare(
      `INSERT INTO activity (id, type, timestamp, account, workflow_run_id, task_id, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, event.type, event.timestamp, event.account, event.workflowRunId ?? null, event.taskId ?? null, JSON.stringify(event.metadata));
    return { id, ...event };
  }

  query(opts: { type?: string; account?: string; workflowRunId?: string; since?: string; limit?: number }): ActivityEvent[] {
    let sql = "SELECT * FROM activity WHERE 1=1";
    const params: (string | number | null)[] = [];
    if (opts.type) { sql += " AND type = ?"; params.push(opts.type); }
    if (opts.account) { sql += " AND account = ?"; params.push(opts.account); }
    if (opts.workflowRunId) { sql += " AND workflow_run_id = ?"; params.push(opts.workflowRunId); }
    if (opts.since) { sql += " AND timestamp >= ?"; params.push(opts.since); }
    sql += " ORDER BY timestamp DESC";
    if (opts.limit) { sql += " LIMIT ?"; params.push(opts.limit); }
    return this.db.prepare(sql).all(...params).map((row: any) => ({
      id: row.id, type: row.type as ActivityEventType, timestamp: row.timestamp,
      account: row.account, workflowRunId: row.workflow_run_id ?? undefined,
      taskId: row.task_id ?? undefined, metadata: JSON.parse(row.metadata),
    }));
  }

  getByWorkflow(runId: string): ActivityEvent[] {
    return this.query({ workflowRunId: runId });
  }

  search(queryText: string, limit = 20): ActivityEvent[] {
    return this.db.prepare(
      `SELECT a.* FROM activity a JOIN activity_fts f ON a.rowid = f.rowid
       WHERE activity_fts MATCH ? ORDER BY rank LIMIT ?`
    ).all(queryText, limit).map((row: any) => ({
      id: row.id, type: row.type as ActivityEventType, timestamp: row.timestamp,
      account: row.account, workflowRunId: row.workflow_run_id ?? undefined,
      taskId: row.task_id ?? undefined, metadata: JSON.parse(row.metadata),
    }));
  }

  cleanup(olderThanDays: number): number {
    const cutoff = new Date(Date.now() - olderThanDays * 86400000).toISOString();
    return this.db.prepare("DELETE FROM activity WHERE timestamp < ?").run(cutoff).changes;
  }
}
