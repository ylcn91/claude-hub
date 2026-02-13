// --- Provider-agnostic account reference ---

export interface Account {
  name: string;
  configDir: string;
  provider: string;
}

export interface LaunchOpts {
  dir?: string;
  resume?: boolean;
  bypassPermissions?: boolean;
}

// --- Raw usage data (provider-specific shape, read by UsageSource) ---

export interface RawUsageData {
  totalSessions: number;
  totalMessages: number;
  dailyActivity: Array<{ date: string; messageCount: number; sessionCount: number; toolCallCount: number }>;
  dailyModelTokens: Array<{ date: string; tokensByModel: Record<string, number> }>;
  modelUsage: Record<string, { inputTokens: number; outputTokens: number }>;
}

// --- Usage source abstraction ---

export interface UsageSource {
  type: "filesystem" | "api" | "process-output";
  read(): Promise<RawUsageData>;
}

// --- Quota policy abstraction ---

export interface QuotaEstimate {
  percent: number;
  confidence: "high" | "medium" | "low" | "none";
  label: string;
  details?: string;
}

export interface QuotaPolicyOpts {
  recentMessageCount: number;
  estimatedLimit: number;
}

export interface QuotaPolicy {
  type: "rolling-window" | "fixed-reset" | "unlimited" | "unknown";
  windowMs?: number;
  estimateRemaining(usage: RawUsageData, opts: QuotaPolicyOpts): QuotaEstimate;
}

// --- Computed stats for display (derived from RawUsageData) ---

export interface AgentStats {
  totalSessions: number;
  totalMessages: number;
  todayActivity: { messageCount: number; sessionCount: number; toolCallCount: number } | null;
  todayTokens: Record<string, number> | null;
  weeklyActivity: Array<{ date: string; messageCount: number }>;
  modelUsage: Record<string, { inputTokens: number; outputTokens: number }>;
}

// --- Provider interface ---

export interface AgentProvider {
  id: string;
  displayName: string;
  supportsEntire: boolean;

  // Lifecycle
  buildLaunchCommand(account: Account, opts: LaunchOpts): string[];

  // Usage - provider decides its own source
  getUsageSource(account: Account): UsageSource;

  // Quota - provider defines its default policy; callers can override
  getQuotaPolicy(overrides?: { plan?: string; estimatedLimit?: number }): QuotaPolicy;

  // Convenience: parse raw usage into display stats (uses getUsageSource internally)
  parseStatsFromFile(statsPath: string, referenceDate?: string): Promise<AgentStats>;

  // Legacy: direct quota estimation (delegates to getQuotaPolicy internally)
  estimateQuota(
    recentMessageCount: number,
    policy: { plan: string; estimatedLimit: number; windowMs: number; source: string }
  ): QuotaEstimate;
}
