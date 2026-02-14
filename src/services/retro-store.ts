import { BaseStore } from "../daemon/base-store";

export interface RetroSession {
  id: string;
  workflowRunId: string;
  status: "collecting" | "aggregating" | "synthesizing" | "complete" | "failed";
  participants: string[];
  chairman: string;
  startedAt: string;
  completedAt?: string;
}

export interface RetroReviewRow {
  id: string;
  retroId: string;
  author: string;
  whatWentWell: string[];
  whatDidntWork: string[];
  suggestions: string[];
  agentPerformanceNotes: Record<string, string>;
  submittedAt: string;
}

export interface RetroDocumentRow {
  id: string;
  retroId: string;
  content: string;
  generatedAt: string;
  generatedBy: string;
}

interface SessionRow {
  id: string;
  workflow_run_id: string;
  status: string;
  participants: string;
  chairman: string;
  started_at: string;
  completed_at: string | null;
}

interface ReviewRow {
  id: string;
  retro_id: string;
  author: string;
  what_went_well: string;
  what_didnt_work: string;
  suggestions: string;
  agent_performance_notes: string;
  submitted_at: string;
}

interface DocRow {
  id: string;
  retro_id: string;
  content: string;
  generated_at: string;
  generated_by: string;
}

export class RetroStore extends BaseStore {
  protected createTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS retro_sessions (
        id TEXT PRIMARY KEY,
        workflow_run_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'collecting',
        participants TEXT NOT NULL DEFAULT '[]',
        chairman TEXT,
        started_at TEXT NOT NULL,
        completed_at TEXT
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS retro_reviews (
        id TEXT PRIMARY KEY,
        retro_id TEXT NOT NULL REFERENCES retro_sessions(id),
        author TEXT NOT NULL,
        what_went_well TEXT NOT NULL DEFAULT '[]',
        what_didnt_work TEXT NOT NULL DEFAULT '[]',
        suggestions TEXT NOT NULL DEFAULT '[]',
        agent_performance_notes TEXT NOT NULL DEFAULT '{}',
        submitted_at TEXT NOT NULL
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS retro_documents (
        id TEXT PRIMARY KEY,
        retro_id TEXT NOT NULL REFERENCES retro_sessions(id),
        content TEXT NOT NULL,
        generated_at TEXT NOT NULL,
        generated_by TEXT NOT NULL
      )
    `);

    this.db.exec("CREATE INDEX IF NOT EXISTS idx_retro_reviews_retro_id ON retro_reviews(retro_id)");
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_retro_docs_retro_id ON retro_documents(retro_id)");
  }

  createSession(workflowRunId: string, participants: string[], chairman: string): RetroSession {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.db.prepare(
      `INSERT INTO retro_sessions (id, workflow_run_id, status, participants, chairman, started_at)
       VALUES (?, ?, 'collecting', ?, ?, ?)`
    ).run(id, workflowRunId, JSON.stringify(participants), chairman, now);
    return { id, workflowRunId, status: "collecting", participants, chairman, startedAt: now };
  }

  getSession(id: string): RetroSession | null {
    const row = this.db.prepare("SELECT * FROM retro_sessions WHERE id = ?").get(id) as SessionRow | null;
    if (!row) return null;
    return this.deserializeSession(row);
  }

  updateSessionStatus(id: string, status: string, completedAt?: string): void {
    if (completedAt) {
      this.db.prepare("UPDATE retro_sessions SET status = ?, completed_at = ? WHERE id = ?").run(status, completedAt, id);
    } else {
      this.db.prepare("UPDATE retro_sessions SET status = ? WHERE id = ?").run(status, id);
    }
  }

  addReview(retroId: string, review: Omit<RetroReviewRow, "id">): RetroReviewRow {
    const id = crypto.randomUUID();
    this.db.prepare(
      `INSERT INTO retro_reviews (id, retro_id, author, what_went_well, what_didnt_work, suggestions, agent_performance_notes, submitted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id, retroId, review.author,
      JSON.stringify(review.whatWentWell),
      JSON.stringify(review.whatDidntWork),
      JSON.stringify(review.suggestions),
      JSON.stringify(review.agentPerformanceNotes),
      review.submittedAt,
    );
    return { id, ...review };
  }

  getReviews(retroId: string): RetroReviewRow[] {
    const rows = this.db.prepare("SELECT * FROM retro_reviews WHERE retro_id = ?").all(retroId) as ReviewRow[];
    return rows.map((row) => this.deserializeReview(row));
  }

  getReviewCount(retroId: string): number {
    const row = this.db.prepare("SELECT COUNT(*) as cnt FROM retro_reviews WHERE retro_id = ?").get(retroId) as { cnt: number };
    return row.cnt;
  }

  storeDocument(retroId: string, content: string, generatedBy: string): RetroDocumentRow {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.db.prepare(
      `INSERT INTO retro_documents (id, retro_id, content, generated_at, generated_by)
       VALUES (?, ?, ?, ?, ?)`
    ).run(id, retroId, content, now, generatedBy);
    return { id, retroId, content, generatedAt: now, generatedBy };
  }

  getDocument(retroId: string): RetroDocumentRow | null {
    const row = this.db.prepare("SELECT * FROM retro_documents WHERE retro_id = ? ORDER BY generated_at DESC LIMIT 1").get(retroId) as DocRow | null;
    if (!row) return null;
    return {
      id: row.id,
      retroId: row.retro_id,
      content: row.content,
      generatedAt: row.generated_at,
      generatedBy: row.generated_by,
    };
  }

  listSessions(opts?: { limit?: number; workflowRunId?: string }): RetroSession[] {
    let sql = "SELECT * FROM retro_sessions WHERE 1=1";
    const params: (string | number | null)[] = [];
    if (opts?.workflowRunId) {
      sql += " AND workflow_run_id = ?";
      params.push(opts.workflowRunId);
    }
    sql += " ORDER BY started_at DESC";
    if (opts?.limit) {
      sql += " LIMIT ?";
      params.push(opts.limit);
    }
    const rows = this.db.prepare(sql).all(...params) as SessionRow[];
    return rows.map((row) => this.deserializeSession(row));
  }

  private deserializeSession(row: SessionRow): RetroSession {
    return {
      id: row.id,
      workflowRunId: row.workflow_run_id,
      status: row.status as RetroSession["status"],
      participants: JSON.parse(row.participants),
      chairman: row.chairman,
      startedAt: row.started_at,
      completedAt: row.completed_at ?? undefined,
    };
  }

  private deserializeReview(row: ReviewRow): RetroReviewRow {
    return {
      id: row.id,
      retroId: row.retro_id,
      author: row.author,
      whatWentWell: JSON.parse(row.what_went_well),
      whatDidntWork: JSON.parse(row.what_didnt_work),
      suggestions: JSON.parse(row.suggestions),
      agentPerformanceNotes: JSON.parse(row.agent_performance_notes),
      submittedAt: row.submitted_at,
    };
  }
}
