import { Database } from "bun:sqlite";

export abstract class BaseStore {
  protected db: Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.exec("PRAGMA journal_mode=WAL");
    this.createTables();
  }

  protected abstract createTables(): void;

  close(): void {
    this.db.close();
  }
}
