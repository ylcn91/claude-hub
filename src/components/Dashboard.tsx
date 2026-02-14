import { useState, useEffect, useContext } from "react";
import { Box, Text } from "ink";
import { AccountCard } from "./AccountCard.js";
import { loadDashboardData, type DashboardAccountData } from "../application/use-cases/load-dashboard-data.js";
import { useListNavigation } from "../hooks/useListNavigation.js";
import { NavContext } from "../app.js";

const REFRESH_INTERVAL_MS = 30_000;

export function Dashboard() {
  const [accounts, setAccounts] = useState<DashboardAccountData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [entireStatuses, setEntireStatuses] = useState<Map<string, string>>(new Map());
  const [unreadCounts, setUnreadCounts] = useState<Map<string, number>>(new Map());
  const [pairedSessions, setPairedSessions] = useState<Map<string, string>>(new Map());
  const [refreshTick, setRefreshTick] = useState(0);

  const { refreshTick: globalRefresh } = useContext(NavContext);

  const { selectedIndex, visibleRange, aboveCount, belowCount } = useListNavigation({
    itemCount: accounts.length,
    windowSize: 8,
  });

  // Respond to global Ctrl+r refresh
  useEffect(() => {
    if (globalRefresh > 0) setRefreshTick((prev) => prev + 1);
  }, [globalRefresh]);

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
          Press [a] to add an account, or run: actl add {"<name>"}
        </Text>
      </Box>
    );
  }

  const visibleAccounts = accounts.slice(visibleRange.start, visibleRange.end);

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
