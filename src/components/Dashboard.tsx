import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { AccountCard } from "./AccountCard.js";
import { loadDashboardData, type DashboardAccountData } from "../application/use-cases/load-dashboard-data.js";

const VISIBLE_WINDOW = 8;
const REFRESH_INTERVAL_MS = 30_000;

interface Props {
  onNavigate: (view: string) => void;
}

export function Dashboard({ onNavigate }: Props) {
  const [accounts, setAccounts] = useState<DashboardAccountData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [entireStatuses, setEntireStatuses] = useState<Map<string, string>>(new Map());
  const [unreadCounts, setUnreadCounts] = useState<Map<string, number>>(new Map());
  const [pairedSessions, setPairedSessions] = useState<Map<string, string>>(new Map());
  const [refreshTick, setRefreshTick] = useState(0);

  // Auto-refresh polling
  useEffect(() => {
    const interval = setInterval(() => {
      setRefreshTick((prev) => prev + 1);
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    async function load() {
      try {
        const data = await loadDashboardData();
        setAccounts(data.accounts);
        setEntireStatuses(data.entireStatuses);
        setUnreadCounts(data.unreadCounts);
        setPairedSessions(data.pairedSessions);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [refreshTick]);

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
        <Text color="gray">{`\u25B2 ${aboveCount} more`}</Text>
      )}
      {visibleAccounts.map((a) => (
        <AccountCard
          key={a.account.name}
          account={a.account}
          stats={a.stats}
          quota={a.quota}
          entireStatus={entireStatuses.get(a.account.name)}
          unreadMessages={unreadCounts.get(a.account.name) ?? 0}
          pairedWith={pairedSessions.get(a.account.name)}
        />
      ))}
      {belowCount > 0 && (
        <Text color="gray">{`\u25BC ${belowCount} more`}</Text>
      )}
    </Box>
  );
}
