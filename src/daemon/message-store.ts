import { BaseStore } from "./base-store";
import { getMessagesDbPath } from "../paths";

const DB_PATH = getMessagesDbPath();

interface MessageRow {
  id: string;
  from: string;
  to: string;
  type: string;
  content: string;
  timestamp: string;
  read: number;
  context: string | null;
}

interface CountRow {
  count: number;
}

export interface Message {
  id: string;
  from: string;
  to: string;
  type: "message" | "handoff";
  content: string;
  timestamp: string;
  read: boolean;
  context?: Record<string, string>;
}

export class MessageStore extends BaseStore {
  constructor(dbPath?: string) {
    super(dbPath ?? DB_PATH);
  }

  protected createTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        "from" TEXT NOT NULL,
        "to" TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('message', 'handoff')),
        content TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        read INTEGER NOT NULL DEFAULT 0,
        context TEXT
      )
    `);
  }

  addMessage(msg: {
    id?: string;
    from: string;
    to: string;
    type: "message" | "handoff";
    content: string;
    timestamp: string;
    context?: Record<string, string>;
  }): string {
    const id = msg.id ?? crypto.randomUUID();
    this.db.run(
      `INSERT INTO messages (id, "from", "to", type, content, timestamp, read, context) VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
      [id, msg.from, msg.to, msg.type, msg.content, msg.timestamp, msg.context ? JSON.stringify(msg.context) : null]
    );
    return id;
  }

  getUnreadMessages(to: string): Message[] {
    const rows = this.db
      .query(`SELECT * FROM messages WHERE "to" = ? AND read = 0 ORDER BY timestamp ASC`)
      .all(to) as MessageRow[];
    return rows.map(this.deserialize);
  }

  getMessages(to: string, opts?: { limit?: number; offset?: number }): Message[] {
    const limit = opts?.limit ?? 50;
    const offset = opts?.offset ?? 0;
    const rows = this.db
      .query(`SELECT * FROM messages WHERE "to" = ? ORDER BY timestamp DESC LIMIT ? OFFSET ?`)
      .all(to, limit, offset) as MessageRow[];
    return rows.map(this.deserialize);
  }

  markRead(to: string, id: string): void {
    this.db.run(`UPDATE messages SET read = 1 WHERE id = ? AND "to" = ?`, [id, to]);
  }

  markAllRead(to: string): void {
    this.db.run(`UPDATE messages SET read = 1 WHERE "to" = ?`, [to]);
  }

  archiveOld(daysOld: number = 7): number {
    const cutoff = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000).toISOString();
    const result = this.db.run(`DELETE FROM messages WHERE timestamp < ? AND read = 1`, [cutoff]);
    return result.changes;
  }

  countUnread(to: string): number {
    const row = this.db.query(`SELECT COUNT(*) as count FROM messages WHERE "to" = ? AND read = 0`).get(to) as CountRow;
    return row.count;
  }

  getHandoffs(to: string): Message[] {
    const rows = this.db
      .query(`SELECT * FROM messages WHERE "to" = ? AND type = 'handoff' ORDER BY timestamp DESC`)
      .all(to) as MessageRow[];
    return rows.map(this.deserialize);
  }

  private deserialize(row: MessageRow): Message {
    return {
      id: row.id,
      from: row.from,
      to: row.to,
      type: row.type as "message" | "handoff",
      content: row.content,
      timestamp: row.timestamp,
      read: row.read === 1,
      context: row.context ? JSON.parse(row.context) : undefined,
    };
  }
}
