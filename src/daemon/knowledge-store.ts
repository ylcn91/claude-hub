import { Database } from "bun:sqlite";

export type KnowledgeCategory = "prompt" | "handoff" | "task_event" | "decision_note" | "message";

export interface KnowledgeEntry {
  id: string;
  category: KnowledgeCategory;
  title: string;
  content: string;
  tags: string[];
  sourceId?: string;
  accountName?: string;
  indexedAt: string;
}

export interface SearchResult {
  entry: KnowledgeEntry;
  rank: number;
  snippet: string;
}

export class KnowledgeStore {
  private db: Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.createTables();
  }

  private createTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS knowledge (
        id TEXT PRIMARY KEY,
        category TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        tags TEXT DEFAULT '[]',
        source_id TEXT,
        account_name TEXT,
        indexed_at TEXT NOT NULL
      )
    `);

    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
        title, content, tags, content=knowledge, content_rowid=rowid
      )
    `);

    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS knowledge_ai AFTER INSERT ON knowledge BEGIN
        INSERT INTO knowledge_fts(rowid, title, content, tags) VALUES (new.rowid, new.title, new.content, new.tags);
      END
    `);
    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS knowledge_ad AFTER DELETE ON knowledge BEGIN
        INSERT INTO knowledge_fts(knowledge_fts, rowid, title, content, tags) VALUES('delete', old.rowid, old.title, old.content, old.tags);
      END
    `);
    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS knowledge_au AFTER UPDATE ON knowledge BEGIN
        INSERT INTO knowledge_fts(knowledge_fts, rowid, title, content, tags) VALUES('delete', old.rowid, old.title, old.content, old.tags);
        INSERT INTO knowledge_fts(rowid, title, content, tags) VALUES (new.rowid, new.title, new.content, new.tags);
      END
    `);
  }

  index(entry: Omit<KnowledgeEntry, "id" | "indexedAt">): KnowledgeEntry {
    const id = crypto.randomUUID();
    const indexedAt = new Date().toISOString();
    this.db.run(
      `INSERT INTO knowledge (id, category, title, content, tags, source_id, account_name, indexed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        entry.category,
        entry.title,
        entry.content,
        JSON.stringify(entry.tags),
        entry.sourceId ?? null,
        entry.accountName ?? null,
        indexedAt,
      ]
    );
    return { ...entry, id, indexedAt };
  }

  private sanitizeQuery(query: string): string {
    return query
      .split(/\s+/)
      .filter(Boolean)
      .map(term => `"${term.replace(/"/g, '""')}"`)
      .join(' ');
  }

  search(query: string, category?: KnowledgeCategory, limit: number = 20): SearchResult[] {
    const sanitized = this.sanitizeQuery(query);
    if (!sanitized) return [];

    let sql: string;
    let params: any[];

    if (category) {
      sql = `
        SELECT k.*, snippet(knowledge_fts, 1, '<b>', '</b>', '...', 32) as snippet, rank
        FROM knowledge k
        JOIN knowledge_fts fts ON k.rowid = fts.rowid
        WHERE knowledge_fts MATCH ?
          AND k.category = ?
        ORDER BY rank
        LIMIT ?
      `;
      params = [sanitized, category, limit];
    } else {
      sql = `
        SELECT k.*, snippet(knowledge_fts, 1, '<b>', '</b>', '...', 32) as snippet, rank
        FROM knowledge k
        JOIN knowledge_fts fts ON k.rowid = fts.rowid
        WHERE knowledge_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `;
      params = [sanitized, limit];
    }

    const rows = this.db.query(sql).all(...params) as any[];
    return rows.map((row) => ({
      entry: {
        id: row.id,
        category: row.category as KnowledgeCategory,
        title: row.title,
        content: row.content,
        tags: JSON.parse(row.tags),
        sourceId: row.source_id ?? undefined,
        accountName: row.account_name ?? undefined,
        indexedAt: row.indexed_at,
      },
      rank: row.rank,
      snippet: row.snippet,
    }));
  }

  getById(id: string): KnowledgeEntry | null {
    const row = this.db.query(`SELECT * FROM knowledge WHERE id = ?`).get(id) as any;
    if (!row) return null;
    return {
      id: row.id,
      category: row.category as KnowledgeCategory,
      title: row.title,
      content: row.content,
      tags: JSON.parse(row.tags),
      sourceId: row.source_id ?? undefined,
      accountName: row.account_name ?? undefined,
      indexedAt: row.indexed_at,
    };
  }

  delete(id: string): boolean {
    const result = this.db.run(`DELETE FROM knowledge WHERE id = ?`, [id]);
    return result.changes > 0;
  }

  close(): void {
    this.db.close();
  }
}
