import { BaseStore } from "../daemon/base-store";

export interface WorkflowRun {
  id: string;
  workflow_name: string;
  status: string;
  trigger_context: string | null;
  started_at: string | null;
  completed_at: string | null;
  retro_id: string | null;
}

export interface WorkflowStepRun {
  id: string;
  run_id: string;
  step_id: string;
  status: string;
  assigned_to: string | null;
  task_id: string | null;
  handoff_id: string | null;
  started_at: string | null;
  completed_at: string | null;
  attempt: number;
  result: string | null;
}

export interface WorkflowEvent {
  id: string;
  run_id: string;
  step_id: string | null;
  type: string;
  detail: string | null;
  timestamp: string;
}

export class WorkflowStore extends BaseStore {
  protected createTables(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS workflow_runs (
        id TEXT PRIMARY KEY,
        workflow_name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        trigger_context TEXT,
        started_at TEXT,
        completed_at TEXT,
        retro_id TEXT
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS workflow_step_runs (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES workflow_runs(id),
        step_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        assigned_to TEXT,
        task_id TEXT,
        handoff_id TEXT,
        started_at TEXT,
        completed_at TEXT,
        attempt INTEGER DEFAULT 1,
        result TEXT
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS workflow_events (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES workflow_runs(id),
        step_id TEXT,
        type TEXT NOT NULL,
        detail TEXT,
        timestamp TEXT NOT NULL
      )
    `);

    this.db.run("CREATE INDEX IF NOT EXISTS idx_step_runs_run_id ON workflow_step_runs(run_id)");
    this.db.run("CREATE INDEX IF NOT EXISTS idx_events_run_id ON workflow_events(run_id)");
  }

  createRun(run: Omit<WorkflowRun, "id">): WorkflowRun {
    const id = crypto.randomUUID();
    this.db.prepare(
      `INSERT INTO workflow_runs (id, workflow_name, status, trigger_context, started_at, completed_at, retro_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, run.workflow_name, run.status, run.trigger_context, run.started_at, run.completed_at, run.retro_id);
    return { id, ...run };
  }

  getRun(id: string): WorkflowRun | null {
    const row = this.db.prepare("SELECT * FROM workflow_runs WHERE id = ?").get(id) as WorkflowRun | null;
    return row ?? null;
  }

  updateRunStatus(id: string, status: string, completedAt?: string): void {
    if (completedAt) {
      this.db.prepare("UPDATE workflow_runs SET status = ?, completed_at = ? WHERE id = ?").run(status, completedAt, id);
    } else {
      this.db.prepare("UPDATE workflow_runs SET status = ? WHERE id = ?").run(status, id);
    }
  }

  listRuns(workflowName?: string): WorkflowRun[] {
    if (workflowName) {
      return this.db.prepare("SELECT * FROM workflow_runs WHERE workflow_name = ? ORDER BY started_at DESC").all(workflowName) as WorkflowRun[];
    }
    return this.db.prepare("SELECT * FROM workflow_runs ORDER BY started_at DESC").all() as WorkflowRun[];
  }

  createStepRun(stepRun: Omit<WorkflowStepRun, "id">): WorkflowStepRun {
    const id = crypto.randomUUID();
    this.db.prepare(
      `INSERT INTO workflow_step_runs (id, run_id, step_id, status, assigned_to, task_id, handoff_id, started_at, completed_at, attempt, result)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, stepRun.run_id, stepRun.step_id, stepRun.status, stepRun.assigned_to, stepRun.task_id, stepRun.handoff_id, stepRun.started_at, stepRun.completed_at, stepRun.attempt, stepRun.result);
    return { id, ...stepRun };
  }

  getStepRun(id: string): WorkflowStepRun | null {
    const row = this.db.prepare("SELECT * FROM workflow_step_runs WHERE id = ?").get(id) as WorkflowStepRun | null;
    return row ?? null;
  }

  getStepRunByStepId(runId: string, stepId: string): WorkflowStepRun | null {
    const row = this.db.prepare("SELECT * FROM workflow_step_runs WHERE run_id = ? AND step_id = ?").get(runId, stepId) as WorkflowStepRun | null;
    return row ?? null;
  }

  updateStepRun(id: string, updates: Partial<Pick<WorkflowStepRun, "status" | "assigned_to" | "task_id" | "handoff_id" | "started_at" | "completed_at" | "attempt" | "result">>): void {
    const fields: string[] = [];
    const values: (string | number | null)[] = [];
    for (const [key, value] of Object.entries(updates)) {
      fields.push(`${key} = ?`);
      values.push(value as string | number | null);
    }
    if (fields.length === 0) return;
    values.push(id);
    this.db.prepare(`UPDATE workflow_step_runs SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  }

  getStepRunsForRun(runId: string): WorkflowStepRun[] {
    return this.db.prepare("SELECT * FROM workflow_step_runs WHERE run_id = ?").all(runId) as WorkflowStepRun[];
  }

  addEvent(event: Omit<WorkflowEvent, "id">): WorkflowEvent {
    const id = crypto.randomUUID();
    this.db.prepare(
      `INSERT INTO workflow_events (id, run_id, step_id, type, detail, timestamp)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, event.run_id, event.step_id, event.type, event.detail, event.timestamp);
    return { id, ...event };
  }

  getEvents(runId: string): WorkflowEvent[] {
    return this.db.prepare("SELECT * FROM workflow_events WHERE run_id = ? ORDER BY timestamp ASC").all(runId) as WorkflowEvent[];
  }
}
