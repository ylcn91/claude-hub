import { loadConfig } from "../../config.js";
import { registry } from "../../providers/index.js";
import { assertHomeDir } from "../../paths.js";
import type { AccountConfig } from "../../types.js";
import type { AgentStats } from "../../providers/types.js";

export interface AccountUsageData {
  account: AccountConfig;
  stats: AgentStats;
  weeklyTotal: number;
}

export async function loadUsageData(configPath?: string): Promise<AccountUsageData[]> {
  const config = await loadConfig(configPath);
  const data: AccountUsageData[] = [];

  for (const account of config.accounts) {
    const provider = registry.getOrDefault(account.provider);
    const configDir = account.configDir.replace("~", assertHomeDir());
    const statsPath = `${configDir}/stats-cache.json`;
    const stats = await provider.parseStatsFromFile(statsPath);
    const weeklyTotal = stats.weeklyActivity.reduce(
      (sum: number, d: { messageCount: number }) => sum + d.messageCount,
      0
    );
    data.push({ account, stats, weeklyTotal });
  }

  return data;
}
