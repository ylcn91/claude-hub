import { useState, useEffect, useContext } from "react";
import { Box, Text, useInput } from "ink";
import { NavContext } from "../app.js";
import { useTheme } from "../themes/index.js";
import { existsSync } from "fs";
import { readdir } from "node:fs/promises";
import { join } from "path";
import type { EntireSessionMetrics, EntirePhase, EntireTokenUsage } from "../services/entire-adapter.js";

const REFRESH_INTERVAL_MS = 10_000;

interface Props {
  onNavigate: (view: string) => void;
}

// PHASE_COLORS moved inside component to use theme

const CONTEXT_WINDOWS: Record<string, number> = {
  "Claude Code": 200_000,
  "Gemini CLI": 1_000_000,
  Cursor: 128_000,
  Copilot: 128_000,
};
const DEFAULT_CONTEXT_WINDOW = 200_000;

function totalTokens(usage: EntireTokenUsage | undefined): number {
  if (!usage) return 0;
  let total =
    usage.input_tokens +
    usage.cache_creation_tokens +
    usage.cache_read_tokens +
    usage.output_tokens;
  if (usage.subagent_tokens) {
    total += totalTokens(usage.subagent_tokens);
  }
  return total;
}

function formatElapsed(minutes: number): string {
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

function saturationBar(ratio: number): string {
  const width = 10;
  const filled = Math.min(width, Math.round(ratio * width));
  const empty = width - filled;
  return `[${"█".repeat(filled)}${"░".repeat(empty)}] ${Math.round(ratio * 100)}%`;
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return String(tokens);
}

function findSessionsDir(): string | null {
  // Look for .git/entire-sessions in cwd and parent dirs
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, ".git", "entire-sessions");
    if (existsSync(candidate)) return candidate;
    const parent = join(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

async function loadAllSessionMetrics(): Promise<EntireSessionMetrics[]> {
  const sessionsDir = findSessionsDir();
  if (!sessionsDir) return [];

  const metrics: EntireSessionMetrics[] = [];
  try {
    const files = await readdir(sessionsDir);
    for (const file of files) {
      if (!file.endsWith(".json") || file.endsWith(".tmp")) continue;
      try {
        const data = await Bun.file(join(sessionsDir, file)).text();
        const state = JSON.parse(data);
        if (!state.session_id) continue;
        const phase: EntirePhase = state.phase || "idle";
        const tokens = totalTokens(state.token_usage);
        const startedAt = new Date(state.started_at).getTime();
        const elapsed = isNaN(startedAt)
          ? 0
          : Math.max(
              0,
              ((state.ended_at ? new Date(state.ended_at).getTime() : Date.now()) - startedAt) / 60_000,
            );
        const contextWindow =
          CONTEXT_WINDOWS[state.agent_type ?? ""] ?? DEFAULT_CONTEXT_WINDOW;
        metrics.push({
          sessionId: state.session_id,
          phase,
          stepCount: state.checkpoint_count ?? 0,
          filesTouched: state.files_touched ?? [],
          totalTokens: tokens,
          tokenBurnRate: elapsed > 0 ? tokens / elapsed : 0,
          contextSaturation: tokens / contextWindow,
          progressEstimate: Math.min(
            95,
            (state.files_touched?.length ?? 0) * 10,
          ),
          elapsedMinutes: elapsed,
          agentType: state.agent_type ?? "unknown",
        });
      } catch {
        // Skip corrupted files
      }
    }
  } catch {
    // Directory read failed
  }
  return metrics;
}

export function EntireSessions({ onNavigate }: Props) {
  const { colors } = useTheme();
  const [sessions, setSessions] = useState<EntireSessionMetrics[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [refreshTick, setRefreshTick] = useState(0);
  const { refreshTick: globalRefresh } = useContext(NavContext);

  const PHASE_COLORS: Record<string, string> = {
    active: colors.primary,
    active_committed: colors.primary,
    idle: colors.warning,
    ended: colors.textMuted,
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
        const metrics = await loadAllSessionMetrics();
        setSessions(metrics);
      } catch (e: any) {
        console.error("[entire-sessions]", e.message);
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
      setSelectedIndex((i) => Math.min(sessions.length - 1, i + 1));
    } else if (input === "r") {
      setRefreshTick((prev) => prev + 1);
    } else if (key.escape) {
      onNavigate("dashboard");
    }
  });

  if (loading) return <Text color={colors.textMuted}>Loading entire.io session data...</Text>;

  const activeCount = sessions.filter(
    (s) => s.phase === "active" || s.phase === "active_committed",
  ).length;
  const avgBurnRate =
    sessions.length > 0
      ? sessions.reduce((sum, s) => sum + s.tokenBurnRate, 0) / sessions.length
      : 0;

  return (
    <Box flexDirection="column" paddingY={1}>
      <Box marginBottom={1}>
        <Text bold>Entire Sessions</Text>
        <Text color={colors.textMuted}>  [r]efresh [up/down]navigate [Esc]back  </Text>
        <Text>{sessions.length} total</Text>
        <Text color={colors.textMuted}> | </Text>
        <Text color={colors.primary}>{activeCount} active</Text>
        <Text color={colors.textMuted}> | </Text>
        <Text color={colors.warning}>~{Math.round(avgBurnRate)} tok/min avg</Text>
      </Box>

      {sessions.length === 0 ? (
        <Text color={colors.textMuted}>
          No entire.io sessions detected. Start an AI coding session to see live
          metrics.
        </Text>
      ) : (
        sessions.map((s, idx) => {
          const phaseLabel =
            s.phase === "active" || s.phase === "active_committed"
              ? "ACTIVE"
              : s.phase === "ended"
                ? "ENDED"
                : "IDLE";
          return (
            <Box key={s.sessionId} flexDirection="column" marginLeft={1} marginBottom={idx < sessions.length - 1 ? 1 : 0}>
              <Box>
                <Text color={idx === selectedIndex ? colors.text : colors.textMuted}>
                  {idx === selectedIndex ? "> " : "  "}
                </Text>
                <Text bold={idx === selectedIndex}>
                  {s.sessionId.slice(0, 8)}
                </Text>
                <Text> </Text>
                <Text color={PHASE_COLORS[s.phase] ?? colors.textMuted}>
                  [{phaseLabel}]
                </Text>
                <Text> </Text>
                <Text color={colors.primaryMuted}>{s.agentType}</Text>
                <Text color={colors.textMuted}>
                  {" "}steps:{s.stepCount} files:{s.filesTouched.length}
                </Text>
              </Box>
              {idx === selectedIndex && (
                <Box marginLeft={4} flexDirection="column">
                  <Box>
                    <Text color={colors.textMuted}>tokens: </Text>
                    <Text>{formatTokens(s.totalTokens)}</Text>
                    <Text color={colors.textMuted}> burn: </Text>
                    <Text color={colors.warning}>{Math.round(s.tokenBurnRate)}/min</Text>
                    <Text color={colors.textMuted}>  elapsed: </Text>
                    <Text>{formatElapsed(s.elapsedMinutes)}</Text>
                  </Box>
                  <Box>
                    <Text color={colors.textMuted}>context: </Text>
                    <Text
                      color={
                        s.contextSaturation > 0.8
                          ? colors.error
                          : s.contextSaturation > 0.5
                            ? colors.warning
                            : colors.success
                      }
                    >
                      {saturationBar(s.contextSaturation)}
                    </Text>
                  </Box>
                </Box>
              )}
            </Box>
          );
        })
      )}
    </Box>
  );
}
