import type {
  AgentProvider,
  AgentStats,
  QuotaEstimate,
  UsageSource,
  QuotaPolicy,
  RawUsageData,
  Account,
  LaunchOpts,
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

export class OpenHandsProvider implements AgentProvider {
  id = "openhands";
  displayName = "OpenHands";
  supportsEntire = false;

  buildLaunchCommand(account: Account, opts: LaunchOpts): string[] {
    const configHome = account.configDir;
    const env = `OPENHANDS_HOME=${configHome}`;
    const args = ["openhands"];
    if (opts.dir) args.push("--dir", opts.dir);
    return [env, ...args];
  }

  getUsageSource(_account: Account): UsageSource {
    return {
      type: "filesystem",
      async read(): Promise<RawUsageData> {
        // OpenHands has no standard stats file; return empty stub
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
          details: "OpenHands quota policy is not publicly documented",
        };
      },
    };
  }

  async parseStatsFromFile(
    _statsPath: string,
    _referenceDate?: string
  ): Promise<AgentStats> {
    // OpenHands has no standard stats file format
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
      details: "OpenHands quota policy is not publicly documented",
    };
  }
}
