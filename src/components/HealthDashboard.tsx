import { useState, useEffect, useContext, memo } from "react";
import { Box, Text, useInput } from "ink";
import { NavContext } from "../app.js";
import { useTheme } from "../themes/index.js";
import type { AccountHealth } from "../daemon/health-monitor.js";
import { fetchHealthStatus } from "../services/health-loader.js";

const REFRESH_INTERVAL_MS = 10_000;

interface Props {
  onNavigate: (view: string) => void;
}

const STATUS_DOTS: Record<string, string> = {
  healthy: "\u25CF",
  degraded: "\u25CF",
  critical: "\u25CF",
};

export const HealthDashboard = memo(function HealthDashboard({ onNavigate }: Props) {
  const { colors } = useTheme();
  const [statuses, setStatuses] = useState<AccountHealth[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [refreshTick, setRefreshTick] = useState(0);
  const { refreshTick: globalRefresh } = useContext(NavContext);

  const statusColors: Record<string, string> = {
    healthy: colors.success,
    degraded: colors.warning,
    critical: colors.error,
  };

  useEffect(() => {
    if (globalRefresh > 0) setRefreshTick((prev) => prev + 1);
  }, [globalRefresh]);

  useEffect(() => {
    const interval = setInterval(() => {
      setRefreshTick((prev) => prev + 1);
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    async function load() {
      try {
        const accounts = await fetchHealthStatus();
        setStatuses(accounts);
      } catch (e: any) {
        console.error("[health]", e.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [refreshTick]);

  useInput((input, key) => {
    if (key.upArrow || input === "k") {
      setSelectedIndex((i) => Math.max(0, i - 1));
    } else if (key.downArrow || input === "j") {
      setSelectedIndex((i) => Math.min(statuses.length - 1, i + 1));
    } else if (input === "r") {
      setRefreshTick((prev) => prev + 1);
    } else if (key.escape) {
      onNavigate("dashboard");
    }
  });

  if (loading) return <Text color={colors.textMuted}>Loading health data...</Text>;

  const healthyCt = statuses.filter((s) => s.status === "healthy").length;
  const degradedCt = statuses.filter((s) => s.status === "degraded").length;
  const criticalCt = statuses.filter((s) => s.status === "critical").length;

  return (
    <Box flexDirection="column" paddingY={1}>
      <Box marginBottom={1}>
        <Text bold>Account Health</Text>
        <Text color={colors.textMuted}>  [r]efresh [Esc]back  </Text>
        <Text color={colors.success}>{healthyCt} ok</Text>
        <Text color={colors.textMuted}> | </Text>
        <Text color={colors.warning}>{degradedCt} warn</Text>
        <Text color={colors.textMuted}> | </Text>
        <Text color={colors.error}>{criticalCt} crit</Text>
      </Box>

      {statuses.length === 0 ? (
        <Text color={colors.textMuted}>No accounts configured.</Text>
      ) : (
        statuses.map((s, idx) => (
          <Box key={s.account} marginLeft={1}>
            <Text color={idx === selectedIndex ? colors.text : colors.textMuted}>
              {idx === selectedIndex ? "> " : "  "}
            </Text>
            <Text color={statusColors[s.status]}>
              {STATUS_DOTS[s.status]}
            </Text>
            <Text> </Text>
            <Text bold={idx === selectedIndex}>{s.account.padEnd(20)}</Text>
            <Text color={statusColors[s.status]}>
              {s.status.padEnd(10)}
            </Text>
            <Text color={colors.textMuted}>
              {s.connected ? "connected" : "offline"}
              {s.errorCount > 0 ? `  errors: ${s.errorCount}` : ""}
              {s.rateLimited ? "  RATE-LIMITED" : ""}
              {s.slaViolations > 0 ? `  sla: ${s.slaViolations}` : ""}
            </Text>
          </Box>
        ))
      )}
    </Box>
  );
});
