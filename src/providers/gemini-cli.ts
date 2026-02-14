import type {
  AgentProvider,
  AgentStats,
  QuotaEstimate,
  UsageSource,
  QuotaPolicy,
  RawUsageData,
  Account,
  LaunchOpts,
  ProcessInfo,
} from "./types";

const EMPTY_RAW: RawUsageData = {
  totalSessions: 0,
  totalMessages: 0,
  dailyActivity: [],
  dailyModelTokens: [],
  modelUsage: {},
};

const EMPTY_STATS: AgentStats = {
  totalSessions: 0,
  totalMessages: 0,
  todayActivity: null,
  todayTokens: null,
  weeklyActivity: [],
  modelUsage: {},
};

export class GeminiCliProvider implements AgentProvider {
  id = "gemini-cli";
  displayName = "Gemini CLI";
  icon = "♊";
  supportsEntire = false;

  async detectRunning(_account: Account): Promise<ProcessInfo | null> {
    return null; // Not implemented for stub providers
  }

  buildLaunchCommand(account: Account, opts: LaunchOpts): string[] {
    const configHome = account.configDir;
    const env = `GEMINI_HOME=${configHome}`;
    const args = ["gemini"];
    if (opts.dir) args.push("--dir", opts.dir);
    return [env, ...args];
  }

  getUsageSource(_account: Account): UsageSource {
    return {
      type: "filesystem",
      async read(): Promise<RawUsageData> {
        // Gemini CLI has no standard stats file; return empty stub
        return EMPTY_RAW;
      },
    };
  }

  getQuotaPolicy(_overrides?: { plan?: string; estimatedLimit?: number }): QuotaPolicy {
    return {
      type: "unknown",
      estimateRemaining() {
        return {
          percent: -1,
          confidence: "none",
          label: "quota: unknown",
          details: "Gemini CLI quota policy is not publicly documented",
        };
      },
    };
  }

  async parseStatsFromFile(
    _statsPath: string,
    _referenceDate?: string
  ): Promise<AgentStats> {
    // Gemini CLI has no standard stats file format
    return EMPTY_STATS;
  }

  estimateQuota(
    _recentMessageCount: number,
    _policy: {
      plan: string;
      estimatedLimit: number;
      windowMs: number;
      source: string;
    }
  ): QuotaEstimate {
    return {
      percent: -1,
      confidence: "none",
      label: "quota: unknown",
      details: "Gemini CLI quota policy is not publicly documented",
    };
  }
}
