import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { AccountCard } from "./AccountCard.js";
import { ClaudeCodeProvider } from "../providers/claude-code.js";
import { loadConfig } from "../config.js";
import type { AccountConfig } from "../types.js";
import type { AgentStats, QuotaEstimate } from "../providers/types.js";

const provider = new ClaudeCodeProvider();

const VISIBLE_WINDOW = 8;

interface AccountData {
  account: AccountConfig;
  stats: AgentStats;
  quota: QuotaEstimate;
}

interface Props {
  onNavigate: (view: string) => void;
}

export function Dashboard({ onNavigate }: Props) {
  const [accounts, setAccounts] = useState<AccountData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    async function load() {
      try {
        const config = await loadConfig();
        const data: AccountData[] = [];

        for (const account of config.accounts) {
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
          data.push({ account, stats, quota });
        }

        setAccounts(data);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  useInput((input, key) => {
    if (key.upArrow) {
      setSelectedIndex((prev) => Math.max(0, prev - 1));
      return;
    }
    if (key.downArrow) {
      setSelectedIndex((prev) => Math.min(accounts.length - 1, prev + 1));
      return;
    }
    if (input === "d") onNavigate("dashboard");
    if (input === "l") onNavigate("launcher");
    if (input === "u") onNavigate("usage");
    if (input === "t") onNavigate("tasks");
    if (input === "a") onNavigate("add");
    if (input === "m") onNavigate("inbox");
    if (input === "q") process.exit(0);
  });

  if (loading) return <Text color="gray">Loading accounts...</Text>;

  if (error) {
    return (
      <Box flexDirection="column">
        <Text color="red">Error loading config: {error}</Text>
      </Box>
    );
  }

  if (accounts.length === 0) {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Text color="gray">No accounts configured.</Text>
        <Text color="gray">
          Press [a] to add an account, or run: ch add {"<name>"}
        </Text>
      </Box>
    );
  }

  // Calculate visible window based on selectedIndex
  const scrollOffset = Math.max(
    0,
    Math.min(selectedIndex - Math.floor(VISIBLE_WINDOW / 2), accounts.length - VISIBLE_WINDOW)
  );
  const startIndex = Math.max(0, scrollOffset);
  const endIndex = Math.min(accounts.length, startIndex + VISIBLE_WINDOW);
  const visibleAccounts = accounts.slice(startIndex, endIndex);
  const aboveCount = startIndex;
  const belowCount = accounts.length - endIndex;

  return (
    <Box flexDirection="column" paddingY={1}>
      {aboveCount > 0 && (
        <Text color="gray">{`▲ ${aboveCount} more`}</Text>
      )}
      {visibleAccounts.map((a, i) => (
        <AccountCard
          key={a.account.name}
          account={a.account}
          stats={a.stats}
          quota={a.quota}
          unreadMessages={0}
        />
      ))}
      {belowCount > 0 && (
        <Text color="gray">{`▼ ${belowCount} more`}</Text>
      )}
    </Box>
  );
}
