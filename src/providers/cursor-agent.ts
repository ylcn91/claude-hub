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

export class CursorAgentProvider implements AgentProvider {
  id = "cursor-agent";
  displayName = "Cursor Agent";
  icon = "🎯";
  supportsEntire = false;

  async detectRunning(account: Account): Promise<ProcessInfo | null> {
    try {
      const result = await Bun.$`ps aux`.quiet();
      const lines = result.stdout.toString().split("\n");
      for (const line of lines) {
        if (
          line.includes("agent") &&
          (line.includes("CURSOR_API_KEY") || line.includes("cursor")) &&
          line.includes(account.configDir)
        ) {
          const parts = line.trim().split(/\s+/);
          const pid = parseInt(parts[1], 10);
          if (!isNaN(pid)) {
            return { pid, configDir: account.configDir };
          }
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  buildLaunchCommand(_account: Account, _opts: LaunchOpts): string[] {
    const args = ["agent"];
    const apiKey = process.env.CURSOR_API_KEY;
    if (apiKey) args.push("--api-key", apiKey);
    return args;
  }

  getUsageSource(_account: Account): UsageSource {
    return {
      type: "filesystem",
      async read(): Promise<RawUsageData> {
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
          label: "quota: varies by LLM provider",
        };
      },
    };
  }

  async parseStatsFromFile(
    _statsPath: string,
    _referenceDate?: string
  ): Promise<AgentStats> {
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
      label: "quota: varies by LLM provider",
    };
  }
}
