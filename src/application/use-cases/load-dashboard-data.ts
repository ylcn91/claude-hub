import { loadConfig } from "../../config.js";
import { registry } from "../../providers/index.js";
import { getEntireCheckpoints } from "../../services/entire.js";
import { fetchUnreadCounts } from "../../services/daemon-client.js";
import { notifyRateLimit } from "../../services/notifications.js";
import type { AccountConfig } from "../../types.js";
import type { AgentStats, QuotaEstimate } from "../../providers/types.js";

export interface DashboardAccountData {
  account: AccountConfig;
  stats: AgentStats;
  quota: QuotaEstimate;
}

export interface DashboardData {
  accounts: DashboardAccountData[];
  entireStatuses: Map<string, string>;
  unreadCounts: Map<string, number>;
}

function formatTimeSince(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "<1m";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export async function loadDashboardData(configPath?: string): Promise<DashboardData> {
  const config = await loadConfig(configPath);
  const accounts: DashboardAccountData[] = [];

  for (const account of config.accounts) {
    const provider = registry.getOrDefault(account.provider);
    const configDir = account.configDir.replace("~", process.env.HOME!);
    const statsPath = `${configDir}/stats-cache.json`;
    const stats = await provider.parseStatsFromFile(statsPath);
    const quotaPolicy = {
      ...config.defaults.quotaPolicy,
      ...(account.quotaPolicy ?? {}),
    };
    const quota = provider.estimateQuota(
      stats.todayActivity?.messageCount ?? 0,
      quotaPolicy
    );
    accounts.push({ account, stats, quota });
  }

  // Rate limit notifications
  for (const item of accounts) {
    if (item.quota.percent >= 80) {
      notifyRateLimit(item.account.name).catch(e => console.error("[dash]", e.message));
    }
  }

  // Entire checkpoints
  const repoDir = process.cwd();
  const entireStatuses = new Map<string, string>();
  try {
    const checkpoints = await getEntireCheckpoints(repoDir);
    if (checkpoints.length > 0) {
      const last = checkpoints[checkpoints.length - 1];
      const lastTime = last.createdAt ? formatTimeSince(last.createdAt) : "?";
      const branchLabel = last.branch || "unknown";
      const status = `\u2713 ${checkpoints.length} checkpoint${checkpoints.length !== 1 ? "s" : ""} | last: ${lastTime} | ${branchLabel}`;
      for (const acct of config.accounts) {
        entireStatuses.set(acct.name, status);
      }
    } else {
      for (const acct of config.accounts) {
        entireStatuses.set(acct.name, "no checkpoints");
      }
    }
  } catch {
    for (const acct of config.accounts) {
      entireStatuses.set(acct.name, "no checkpoints");
    }
  }

  // Unread message counts
  let unreadCounts = new Map<string, number>();
  try {
    unreadCounts = await fetchUnreadCounts(config.accounts.map((a) => a.name));
  } catch(e: any) { console.error("[dash]", e.message) }

  return { accounts, entireStatuses, unreadCounts };
}
