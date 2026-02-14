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

function makeRollingWindowPolicy(
  windowMs: number,
  plan: string,
  estimatedLimit: number
): QuotaPolicy {
  if (plan === "unknown" || !estimatedLimit) {
    return {
      type: "unknown",
      estimateRemaining() {
        return {
          percent: -1,
          confidence: "none",
          label: "quota: unknown plan",
          details: "Set plan in config",
        };
      },
    };
  }

  return {
    type: "rolling-window",
    windowMs,
    estimateRemaining(_usage, opts) {
      const limit = opts.estimatedLimit || estimatedLimit;
      const percent = Math.min((opts.recentMessageCount / limit) * 100, 100);
      const windowHours = windowMs / (60 * 60 * 1000);
      return {
        percent,
        confidence: opts.recentMessageCount > 0 ? "medium" : "low",
        label: `~${Math.round(percent)}% (est.)`,
        details: `${opts.recentMessageCount}/${limit} msgs in ${windowHours}h window`,
      };
    },
  };
}

export class ClaudeCodeProvider implements AgentProvider {
  id = "claude-code";
  displayName = "Claude Code";
  icon = "✦";
  supportsEntire = true;

  async detectRunning(account: Account): Promise<ProcessInfo | null> {
    try {
      const result = await Bun.$`ps aux`.quiet();
      const lines = result.stdout.toString().split("\n");
      for (const line of lines) {
        if (line.includes("claude") && line.includes(account.configDir)) {
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

  buildLaunchCommand(account: Account, opts: LaunchOpts): string[] {
    const env = `CLAUDE_CONFIG_DIR=${account.configDir}`;
    const args = ["claude"];
    if (opts.bypassPermissions) args.push("--dangerously-skip-permissions");
    if (opts.resume) args.push("--resume");
    if (opts.dir) args.push("--dir", opts.dir);
    return [env, ...args];
  }

  getUsageSource(account: Account): UsageSource {
    const statsPath = `${account.configDir}/stats-cache-sample.json`;
    return {
      type: "filesystem",
      async read(): Promise<RawUsageData> {
        try {
          const file = Bun.file(statsPath);
          if (!(await file.exists())) {
            // Also try the standard name
            const altFile = Bun.file(`${account.configDir}/stats-cache.json`);
            if (!(await altFile.exists())) return EMPTY_RAW;
            const raw = (await altFile.json()) as any;
            return parseRawUsage(raw);
          }
          const raw = (await file.json()) as any;
          return parseRawUsage(raw);
        } catch {
          return EMPTY_RAW;
        }
      },
    };
  }

  getQuotaPolicy(
    overrides?: { plan?: string; estimatedLimit?: number }
  ): QuotaPolicy {
    const plan = overrides?.plan ?? "max-5x";
    const limit = overrides?.estimatedLimit ?? 225;
    const windowMs = 5 * 60 * 60 * 1000; // 5 hours
    return makeRollingWindowPolicy(windowMs, plan, limit);
  }

  async parseStatsFromFile(
    statsPath: string,
    referenceDate?: string
  ): Promise<AgentStats> {
    const empty: AgentStats = {
      totalSessions: 0,
      totalMessages: 0,
      todayActivity: null,
      todayTokens: null,
      weeklyActivity: [],
      modelUsage: {},
    };

    try {
      const file = Bun.file(statsPath);
      if (!(await file.exists())) return empty;
      const raw = (await file.json()) as any;

      const today = referenceDate ?? new Date().toISOString().split("T")[0];
      const todayActivity =
        raw.dailyActivity?.find((d: any) => d.date === today) ?? null;
      const todayTokenEntry = raw.dailyModelTokens?.find(
        (d: any) => d.date === today
      );
      const todayTokens = todayTokenEntry?.tokensByModel ?? null;

      const weeklyActivity = (raw.dailyActivity ?? [])
        .slice(-7)
        .map((d: any) => ({
          date: d.date,
          messageCount: d.messageCount ?? 0,
        }));

      const modelUsage: Record<
        string,
        { inputTokens: number; outputTokens: number }
      > = {};
      for (const [model, usage] of Object.entries(raw.modelUsage ?? {})) {
        const u = usage as any;
        modelUsage[model] = {
          inputTokens: u.inputTokens ?? 0,
          outputTokens: u.outputTokens ?? 0,
        };
      }

      return {
        totalSessions: raw.totalSessions ?? 0,
        totalMessages: raw.totalMessages ?? 0,
        todayActivity,
        todayTokens,
        weeklyActivity,
        modelUsage,
      };
    } catch {
      return empty;
    }
  }

  estimateQuota(
    recentMessageCount: number,
    policy: {
      plan: string;
      estimatedLimit: number;
      windowMs: number;
      source: string;
    }
  ): QuotaEstimate {
    const quotaPolicy = makeRollingWindowPolicy(
      policy.windowMs,
      policy.plan,
      policy.estimatedLimit
    );
    return quotaPolicy.estimateRemaining(EMPTY_RAW, {
      recentMessageCount,
      estimatedLimit: policy.estimatedLimit,
    });
  }
}

function parseRawUsage(raw: any): RawUsageData {
  const modelUsage: Record<
    string,
    { inputTokens: number; outputTokens: number }
  > = {};
  for (const [model, usage] of Object.entries(raw.modelUsage ?? {})) {
    const u = usage as any;
    modelUsage[model] = {
      inputTokens: u.inputTokens ?? 0,
      outputTokens: u.outputTokens ?? 0,
    };
  }

  return {
    totalSessions: raw.totalSessions ?? 0,
    totalMessages: raw.totalMessages ?? 0,
    dailyActivity: (raw.dailyActivity ?? []).map((d: any) => ({
      date: d.date ?? "",
      messageCount: d.messageCount ?? 0,
      sessionCount: d.sessionCount ?? 0,
      toolCallCount: d.toolCallCount ?? 0,
    })),
    dailyModelTokens: (raw.dailyModelTokens ?? []).map((d: any) => ({
      date: d.date ?? "",
      tokensByModel: d.tokensByModel ?? {},
    })),
    modelUsage,
  };
}
