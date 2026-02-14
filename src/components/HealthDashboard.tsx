import { useState, useEffect, useContext } from "react";
import { Box, Text, useInput } from "ink";
import { NavContext } from "../app.js";
import type { AccountHealth } from "../daemon/health-monitor.js";
import { createConnection } from "net";
import { readFileSync, existsSync } from "fs";
import { createLineParser, generateRequestId, frameSend } from "../daemon/framing.js";
import { getSockPath, getTokensDir } from "../paths.js";

const REFRESH_INTERVAL_MS = 10_000;

interface Props {
  onNavigate: (view: string) => void;
}

const STATUS_COLORS: Record<string, string> = {
  healthy: "green",
  degraded: "yellow",
  critical: "red",
};

const STATUS_DOTS: Record<string, string> = {
  healthy: "\u25CF",
  degraded: "\u25CF",
  critical: "\u25CF",
};

/**
 * Query the daemon for health status instead of creating a local HealthMonitor.
 * This ensures the TUI displays the same health data tracked by the daemon.
 */
async function queryDaemonHealth(): Promise<AccountHealth[]> {
  const sockPath = getSockPath();
  if (!existsSync(sockPath)) return [];

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      socket.destroy();
      resolve([]);
    }, 3000);

    const socket = createConnection(sockPath);

    socket.on("error", () => {
      clearTimeout(timeout);
      resolve([]);
    });

    const parser = createLineParser((msg: any) => {
      if (msg.type === "result" && msg.accounts) {
        clearTimeout(timeout);
        socket.destroy();
        const accounts: AccountHealth[] = msg.accounts.map((a: any) => ({
          account: a.name,
          status: a.status,
          connected: a.connected,
          lastActivity: a.lastActivity,
          errorCount: a.errorCount ?? 0,
          rateLimited: a.rateLimited ?? false,
          slaViolations: a.slaViolations ?? 0,
          updatedAt: new Date().toISOString(),
        }));
        resolve(accounts);
      }
    });

    socket.on("data", (data) => parser.feed(data));

    socket.on("connect", () => {
      // health_status via ping (unauthenticated) won't work — we send
      // a simple ping then a health_status. The daemon allows ping without auth,
      // but health_status requires auth. For TUI we just use ping-based approach
      // and fall back to listing config accounts as critical if no daemon.
      // Actually, the simplest approach: send a health_status request.
      // The TUI user should have an active token. Try first account token.
      const tokensDir = getTokensDir();
      try {
        const files = require("fs").readdirSync(tokensDir);
        const tokenFile = files.find((f: string) => f.endsWith(".token"));
        if (!tokenFile) { clearTimeout(timeout); socket.destroy(); resolve([]); return; }
        const account = tokenFile.replace(".token", "");
        const token = readFileSync(`${tokensDir}/${tokenFile}`, "utf-8").trim();
        const authId = generateRequestId();
        socket.write(frameSend({ type: "auth", account, token, requestId: authId }));

        // Wait for auth_ok then send health_status
        const origHandler = parser;
        const authParser = createLineParser((authMsg: any) => {
          if (authMsg.type === "auth_ok") {
            const reqId = generateRequestId();
            socket.write(frameSend({ type: "health_status", requestId: reqId }));
          } else if (authMsg.type === "result") {
            origHandler.feed(Buffer.from(JSON.stringify(authMsg) + "\n"));
          }
        });
        // Replace the data handler
        socket.removeAllListeners("data");
        socket.on("data", (data) => {
          authParser.feed(data);
          parser.feed(data);
        });
      } catch {
        clearTimeout(timeout);
        socket.destroy();
        resolve([]);
      }
    });
  });
}

export function HealthDashboard({ onNavigate }: Props) {
  const [statuses, setStatuses] = useState<AccountHealth[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [refreshTick, setRefreshTick] = useState(0);
  const { refreshTick: globalRefresh } = useContext(NavContext);

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
        const accounts = await queryDaemonHealth();
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

  if (loading) return <Text color="gray">Loading health data...</Text>;

  const healthyCt = statuses.filter((s) => s.status === "healthy").length;
  const degradedCt = statuses.filter((s) => s.status === "degraded").length;
  const criticalCt = statuses.filter((s) => s.status === "critical").length;

  return (
    <Box flexDirection="column" paddingY={1}>
      <Box marginBottom={1}>
        <Text bold>Account Health</Text>
        <Text color="gray">  [r]efresh [Esc]back  </Text>
        <Text color="green">{healthyCt} ok</Text>
        <Text color="gray"> | </Text>
        <Text color="yellow">{degradedCt} warn</Text>
        <Text color="gray"> | </Text>
        <Text color="red">{criticalCt} crit</Text>
      </Box>

      {statuses.length === 0 ? (
        <Text color="gray">No accounts configured.</Text>
      ) : (
        statuses.map((s, idx) => (
          <Box key={s.account} marginLeft={1}>
            <Text color={idx === selectedIndex ? "white" : "gray"}>
              {idx === selectedIndex ? "> " : "  "}
            </Text>
            <Text color={STATUS_COLORS[s.status]}>
              {STATUS_DOTS[s.status]}
            </Text>
            <Text> </Text>
            <Text bold={idx === selectedIndex}>{s.account.padEnd(20)}</Text>
            <Text color={STATUS_COLORS[s.status]}>
              {s.status.padEnd(10)}
            </Text>
            <Text color="gray">
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
}
