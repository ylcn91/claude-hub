import { BaseStore } from "./base-store";

export interface Session {
  id: string;
  name: string;
  account: string;
  startedAt: string;
  endedAt?: string;
  tags: string[];
  notes?: string;
}

interface SessionRow {
  id: string;
  name: string;
  account: string;
  started_at: string;
  ended_at: string | null;
  tags: string;
  notes: string | null;
}

interface SearchRow extends SessionRow {
  snippet: string;
  rank: number;
}

export class SessionStore extends BaseStore {
  constructor(dbPath: string) {
    super(dbPath);
  }

  protected createTables(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        account TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        tags TEXT DEFAULT '[]',
        notes TEXT
      )
    `);

    this.db.run(`
      CREATE VIRTUAL TABLE IF NOT EXISTS sessions_fts USING fts5(
        name, account, tags, notes, content=sessions, content_rowid=rowid
      )
    `);

    this.db.run(`
      CREATE TRIGGER IF NOT EXISTS sessions_ai AFTER INSERT ON sessions BEGIN
        INSERT INTO sessions_fts(rowid, name, account, tags, notes) VALUES (new.rowid, new.name, new.account, new.tags, new.notes);
      END
    `);
    this.db.run(`
      CREATE TRIGGER IF NOT EXISTS sessions_ad AFTER DELETE ON sessions BEGIN
        INSERT INTO sessions_fts(sessions_fts, rowid, name, account, tags, notes) VALUES('delete', old.rowid, old.name, old.account, old.tags, old.notes);
      END
    `);
    this.db.run(`
      CREATE TRIGGER IF NOT EXISTS sessions_au AFTER UPDATE ON sessions BEGIN
        INSERT INTO sessions_fts(sessions_fts, rowid, name, account, tags, notes) VALUES('delete', old.rowid, old.name, old.account, old.tags, old.notes);
        INSERT INTO sessions_fts(rowid, name, account, tags, notes) VALUES (new.rowid, new.name, new.account, new.tags, new.notes);
      END
    `);
  }

  nameSession(sessionId: string, name: string, opts?: { account?: string; tags?: string[]; notes?: string }): Session {
    // C3: Input length validation
    if (!name || name.length === 0) {
      throw new Error("Session name must not be empty");
    }
    if (name.length > 500) {
      throw new Error("Session name must not exceed 500 characters");
    }
    if (opts?.notes !== undefined && opts.notes !== null && opts.notes.length > 10000) {
      throw new Error("Session notes must not exceed 10000 characters");
    }
    if (opts?.tags !== undefined) {
      if (opts.tags.length > 50) {
        throw new Error("Session tags must not exceed 50 entries");
      }
      for (const tag of opts.tags) {
        if (tag.length > 100) {
          throw new Error("Each session tag must not exceed 100 characters");
        }
      }
    }

    const existing = this.getById(sessionId);
    if (existing) {
      this.db.run(
        `UPDATE sessions SET name = ?, tags = ?, notes = ? WHERE id = ?`,
        [name, JSON.stringify(opts?.tags ?? existing.tags), opts?.notes ?? existing.notes ?? null, sessionId]
      );
      return { ...existing, name, tags: opts?.tags ?? existing.tags, notes: opts?.notes ?? existing.notes };
    }

    // M4: Validate account is non-empty when creating a new session
    const account = opts?.account ?? "";
    if (!account) {
      throw new Error("Account is required when creating a new session");
    }

    const startedAt = new Date().toISOString();
    this.db.run(
      `INSERT INTO sessions (id, name, account, started_at, tags, notes) VALUES (?, ?, ?, ?, ?, ?)`,
      [sessionId, name, account, startedAt, JSON.stringify(opts?.tags ?? []), opts?.notes ?? null]
    );
    return { id: sessionId, name, account, startedAt, tags: opts?.tags ?? [], notes: opts?.notes };
  }

  getById(id: string): Session | null {
    const row = this.db.query(`SELECT * FROM sessions WHERE id = ?`).get(id) as SessionRow | null;
    if (!row) return null;
    return this.deserializeRow(row);
  }

  list(opts?: { account?: string; limit?: number; offset?: number }): Session[] {
    const limit = opts?.limit ?? 50;
    const offset = opts?.offset ?? 0;

    if (opts?.account) {
      const rows = this.db.query(
        `SELECT * FROM sessions WHERE account = ? ORDER BY started_at DESC LIMIT ? OFFSET ?`
      ).all(opts.account, limit, offset) as SessionRow[];
      return rows.map(r => this.deserializeRow(r));
    }

    const rows = this.db.query(
      `SELECT * FROM sessions ORDER BY started_at DESC LIMIT ? OFFSET ?`
    ).all(limit, offset) as SessionRow[];
    return rows.map(r => this.deserializeRow(r));
  }

  private sanitizeQuery(query: string): string {
    const terms = query
      .split(/\s+/)
      .filter(Boolean)
      .map(term => {
        // Strip FTS5 operators and special characters
        const cleaned = term.replace(/"/g, '""');
        return cleaned;
      })
      .filter(term => {
        // Guard against degenerate inputs: only-quotes or empty after cleaning
        const stripped = term.replace(/""/g, '');
        return stripped.length > 0;
      })
      .map(term => `"${term}"`);
    return terms.join(' ');
  }

  search(query: string, limit: number = 20): { session: Session; rank: number; snippet: string }[] {
    const sanitized = this.sanitizeQuery(query);
    if (!sanitized) return [];

    const rows = this.db.query(`
      SELECT s.*, snippet(sessions_fts, 0, '<b>', '</b>', '...', 32) as snippet, rank
      FROM sessions s
      JOIN sessions_fts fts ON s.rowid = fts.rowid
      WHERE sessions_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(sanitized, limit) as SearchRow[];

    return rows.map(row => ({
      session: this.deserializeRow(row),
      rank: row.rank,
      snippet: row.snippet,
    }));
  }

  endSession(sessionId: string): boolean {
    const result = this.db.run(
      `UPDATE sessions SET ended_at = ? WHERE id = ?`,
      [new Date().toISOString(), sessionId]
    );
    return result.changes > 0;
  }

  deleteSession(id: string): boolean {
    const result = this.db.run(`DELETE FROM sessions WHERE id = ?`, [id]);
    return result.changes > 0;
  }

  private deserializeRow(row: SessionRow): Session {
    let tags: string[];
    try {
      tags = JSON.parse(row.tags);
    } catch {
      tags = [];
    }
    return {
      id: row.id,
      name: row.name,
      account: row.account,
      startedAt: row.started_at,
      endedAt: row.ended_at ?? undefined,
      tags,
      notes: row.notes ?? undefined,
    };
  }
}
