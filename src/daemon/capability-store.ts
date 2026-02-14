import { BaseStore } from "./base-store";
import type { AccountCapability } from "../services/account-capabilities";
import { getCapabilitiesDbPath } from "../paths";

const DB_PATH = getCapabilitiesDbPath();

interface CapabilityRow {
  account_name: string;
  skills: string;
  total_tasks: number;
  accepted_tasks: number;
  rejected_tasks: number;
  avg_delivery_ms: number;
  last_active_at: string;
  provider_type: string | null;
}

export class CapabilityStore extends BaseStore {
  constructor(dbPath?: string) {
    super(dbPath ?? DB_PATH);
  }

  protected createTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS account_capabilities (
        account_name TEXT PRIMARY KEY,
        skills TEXT NOT NULL DEFAULT '[]',
        total_tasks INTEGER NOT NULL DEFAULT 0,
        accepted_tasks INTEGER NOT NULL DEFAULT 0,
        rejected_tasks INTEGER NOT NULL DEFAULT 0,
        avg_delivery_ms REAL NOT NULL DEFAULT 0,
        last_active_at TEXT NOT NULL,
        provider_type TEXT
      )
    `);
  }

  upsert(cap: AccountCapability): void {
    this.db.prepare(
      `INSERT OR REPLACE INTO account_capabilities (account_name, skills, total_tasks, accepted_tasks, rejected_tasks, avg_delivery_ms, last_active_at, provider_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      cap.accountName,
      JSON.stringify(cap.skills),
      cap.totalTasks,
      cap.acceptedTasks,
      cap.rejectedTasks,
      cap.avgDeliveryMs,
      cap.lastActiveAt,
      cap.providerType ?? null,
    );
  }

  get(accountName: string): AccountCapability | null {
    const row = this.db
      .query(`SELECT * FROM account_capabilities WHERE account_name = ?`)
      .get(accountName) as CapabilityRow | null;
    if (!row) return null;
    return this.deserialize(row);
  }

  getAll(): AccountCapability[] {
    const rows = this.db
      .query(`SELECT * FROM account_capabilities ORDER BY account_name`)
      .all() as CapabilityRow[];
    return rows.map(this.deserialize);
  }

  recordTaskCompletion(
    accountName: string,
    accepted: boolean,
    deliveryMs: number
  ): void {
    const existing = this.get(accountName);
    if (!existing) return;

    const newTotal = existing.totalTasks + 1;
    const newAccepted = existing.acceptedTasks + (accepted ? 1 : 0);
    const newRejected = existing.rejectedTasks + (accepted ? 0 : 1);
    const newAvg =
      (existing.avgDeliveryMs * existing.totalTasks + deliveryMs) / newTotal;

    this.db.prepare(
      `UPDATE account_capabilities SET total_tasks = ?, accepted_tasks = ?, rejected_tasks = ?, avg_delivery_ms = ?, last_active_at = ? WHERE account_name = ?`
    ).run(
      newTotal,
      newAccepted,
      newRejected,
      newAvg,
      new Date().toISOString(),
      accountName,
    );
  }

  updateSkills(accountName: string, skills: string[]): void {
    this.db.prepare(
      `UPDATE account_capabilities SET skills = ? WHERE account_name = ?`
    ).run(JSON.stringify(skills), accountName);
  }

  touchActive(accountName: string): void {
    this.db.prepare(
      `UPDATE account_capabilities SET last_active_at = ? WHERE account_name = ?`
    ).run(new Date().toISOString(), accountName);
  }

  private deserialize(row: CapabilityRow): AccountCapability {
    return {
      accountName: row.account_name,
      skills: JSON.parse(row.skills),
      totalTasks: row.total_tasks,
      acceptedTasks: row.accepted_tasks,
      rejectedTasks: row.rejected_tasks,
      avgDeliveryMs: row.avg_delivery_ms,
      lastActiveAt: row.last_active_at,
      providerType: row.provider_type ?? undefined,
    };
  }
}
