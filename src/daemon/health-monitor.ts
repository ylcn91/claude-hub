export type HealthLevel = "healthy" | "degraded" | "critical";

export interface AccountHealth {
  account: string;
  status: HealthLevel;
  connected: boolean;
  lastActivity: string | null;
  errorCount: number;
  rateLimited: boolean;
  slaViolations: number;
  updatedAt: string;
}

/** Input data for health updates (excludes computed fields). */
export type HealthUpdateData = Partial<Omit<AccountHealth, "account" | "status" | "updatedAt">>;

/** Aggregate health summary across all accounts. */
export interface AggregateHealthStatus {
  overall: HealthLevel;
  healthy: number;
  degraded: number;
  critical: number;
  total: number;
  accounts: AccountHealth[];
}

const STALE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

export class HealthMonitor {
  private healthMap = new Map<string, AccountHealth>();

  /**
   * Update the health status for an account.
   */
  update(account: string, data: HealthUpdateData): AccountHealth {
    const existing = this.healthMap.get(account);
    const now = new Date().toISOString();

    const entry: AccountHealth = {
      account,
      status: "healthy",
      connected: data.connected ?? existing?.connected ?? false,
      lastActivity: data.lastActivity ?? existing?.lastActivity ?? null,
      errorCount: data.errorCount ?? existing?.errorCount ?? 0,
      rateLimited: data.rateLimited ?? existing?.rateLimited ?? false,
      slaViolations: data.slaViolations ?? existing?.slaViolations ?? 0,
      updatedAt: now,
    };

    entry.status = this.computeStatus(entry);
    this.healthMap.set(account, entry);
    return entry;
  }

  /**
   * Record an error for an account.
   */
  recordError(account: string): void {
    const existing = this.healthMap.get(account);
    const errorCount = (existing?.errorCount ?? 0) + 1;
    this.update(account, { errorCount });
  }

  /**
   * Record a rate limit event for an account.
   */
  recordRateLimit(account: string): void {
    this.update(account, { rateLimited: true });
  }

  /**
   * Clear the rate limit flag for an account.
   */
  clearRateLimit(account: string): void {
    this.update(account, { rateLimited: false });
  }

  /**
   * Record an SLA violation for an account.
   */
  recordSlaViolation(account: string): void {
    const existing = this.healthMap.get(account);
    const slaViolations = (existing?.slaViolations ?? 0) + 1;
    this.update(account, { slaViolations });
  }

  /**
   * Mark an account as connected with activity timestamp.
   */
  markActive(account: string): void {
    this.update(account, {
      connected: true,
      lastActivity: new Date().toISOString(),
    });
  }

  /**
   * Mark an account as disconnected.
   */
  markDisconnected(account: string): void {
    this.update(account, { connected: false });
  }

  /**
   * Get the health status for a specific account.
   */
  getHealth(account: string): AccountHealth | null {
    return this.healthMap.get(account) ?? null;
  }

  /**
   * Get statuses for all known accounts or a specific list.
   */
  getStatuses(accountNames?: string[]): AccountHealth[] {
    const names = accountNames ?? Array.from(this.healthMap.keys());
    return names.map((name) => {
      const existing = this.healthMap.get(name);
      if (existing) {
        // Recompute status (staleness may have changed)
        existing.status = this.computeStatus(existing);
        return existing;
      }
      // Unknown account defaults to critical/disconnected
      return {
        account: name,
        status: "critical" as HealthLevel,
        connected: false,
        lastActivity: null,
        errorCount: 0,
        rateLimited: false,
        slaViolations: 0,
        updatedAt: new Date().toISOString(),
      };
    });
  }

  /**
   * Get aggregate health status across all accounts.
   */
  getAggregateStatus(accountNames?: string[]): AggregateHealthStatus {
    const accounts = this.getStatuses(accountNames);
    const healthy = accounts.filter((a) => a.status === "healthy").length;
    const degraded = accounts.filter((a) => a.status === "degraded").length;
    const critical = accounts.filter((a) => a.status === "critical").length;

    let overall: HealthLevel = "healthy";
    if (critical > 0) overall = "critical";
    else if (degraded > 0) overall = "degraded";

    return { overall, healthy, degraded, critical, total: accounts.length, accounts };
  }

  /**
   * Compute the health status level for an account.
   *
   * Critical (red): offline, rate-limited, or high error count (>= 5)
   * Degraded (yellow): stale (>10 min since last activity) or warnings (errors 1-4)
   * Healthy (green): connected, recent activity, no errors
   */
  private computeStatus(entry: AccountHealth): HealthLevel {
    // Critical conditions
    if (!entry.connected) return "critical";
    if (entry.rateLimited) return "critical";
    if (entry.errorCount >= 5) return "critical";

    // Degraded conditions
    if (entry.errorCount > 0) return "degraded";
    if (entry.slaViolations > 0) return "degraded";
    if (entry.lastActivity) {
      const elapsed = Date.now() - new Date(entry.lastActivity).getTime();
      if (elapsed > STALE_THRESHOLD_MS) return "degraded";
    }

    return "healthy";
  }
}
