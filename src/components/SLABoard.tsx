import { useState, useEffect, useContext } from "react";
import { Box, Text, useInput } from "ink";
import { NavContext } from "../app.js";
import { loadTasks } from "../services/tasks.js";
import { checkStaleTasks, humanTime, formatEscalationMessage, DEFAULT_SLA_CONFIG, type Escalation, type AdaptiveEscalation, type EntireTriggerType } from "../services/sla-engine.js";
import { useListNavigation } from "../hooks/useListNavigation.js";

const REFRESH_INTERVAL_MS = 30_000;

interface Props {
  onNavigate: (view: string) => void;
}

const ACTION_COLORS: Record<string, string> = {
  escalate: "red",
  reassign_suggestion: "yellow",
  ping: "cyan",
  suggest_reassign: "yellow",
  auto_reassign: "redBright",
  escalate_human: "red",
  terminate: "red",
};

const ACTION_LABELS: Record<string, string> = {
  escalate: "🚨 ESCALATE",
  reassign_suggestion: "⚠️  REASSIGN",
  ping: "⏰ PING",
  suggest_reassign: "⚠️  SUGGEST REASSIGN",
  auto_reassign: "🔄 AUTO REASSIGN",
  escalate_human: "🆘 ESCALATE HUMAN",
  terminate: "⛔ TERMINATE",
};

const TRIGGER_LABELS: Record<EntireTriggerType, string> = {
  token_burn_rate: "[token-burn]",
  no_checkpoint: "[no-checkpoint]",
  context_saturation: "[saturation]",
  session_ended_incomplete: "[session-ended]",
};

export function SLABoard({ onNavigate }: Props) {
  const [escalations, setEscalations] = useState<Escalation[]>([]);
  const [adaptiveEscalations, setAdaptiveEscalations] = useState<AdaptiveEscalation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshTick, setRefreshTick] = useState(0);

  const totalItems = escalations.length + adaptiveEscalations.length;

  const { selectedIndex } = useListNavigation({
    itemCount: totalItems,
    enabled: true,
  });

  const { setGlobalNavEnabled } = useContext(NavContext);

  useEffect(() => {
    setGlobalNavEnabled(false);
    return () => setGlobalNavEnabled(true);
  }, []);

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
        const board = await loadTasks();
        const escs = checkStaleTasks(board.tasks, DEFAULT_SLA_CONFIG);
        setEscalations(escs);
      } catch (e: any) {
        console.error("[sla-board]", e.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [refreshTick]);

  useInput((input, key) => {
    if (input === "r") {
      setRefreshTick((prev) => prev + 1);
    } else if (key.escape) {
      onNavigate("dashboard");
    }
  });

  if (loading) return <Text color="gray">Loading SLA data...</Text>;

  return (
    <Box flexDirection="column" paddingY={1}>
      <Box marginBottom={1}>
        <Text bold>SLA Board</Text>
        <Text color="gray">  [r]efresh [Esc]back</Text>
      </Box>

      {totalItems === 0 ? (
        <Text color="green">No stale tasks — all within SLA thresholds.</Text>
      ) : (
        <>
          {escalations.map((esc, idx) => (
            <Box key={esc.taskId} marginLeft={1}>
              <Text color={idx === selectedIndex ? "white" : "gray"}>
                {idx === selectedIndex ? "> " : "  "}
              </Text>
              <Text color={ACTION_COLORS[esc.action] ?? "white"}>
                {ACTION_LABELS[esc.action] ?? esc.action}
              </Text>
              <Text> </Text>
              <Text color="gray">[time-sla] </Text>
              <Text color={idx === selectedIndex ? "white" : undefined}>
                {esc.taskTitle}
              </Text>
              <Text color="gray"> | {humanTime(esc.staleForMs)} stale</Text>
              {esc.assignee && <Text color="magenta"> @{esc.assignee}</Text>}
            </Box>
          ))}
          {adaptiveEscalations.map((esc, idx) => {
            const globalIdx = escalations.length + idx;
            return (
              <Box key={`${esc.taskId}-${esc.trigger.type}`} marginLeft={1}>
                <Text color={globalIdx === selectedIndex ? "white" : "gray"}>
                  {globalIdx === selectedIndex ? "> " : "  "}
                </Text>
                <Text color={ACTION_COLORS[esc.action] ?? "white"}>
                  {ACTION_LABELS[esc.action] ?? esc.action}
                </Text>
                <Text> </Text>
                <Text color="gray">{TRIGGER_LABELS[esc.trigger.type] ?? `[${esc.trigger.type}]`} </Text>
                <Text color={globalIdx === selectedIndex ? "white" : undefined}>
                  {esc.taskTitle}
                </Text>
                <Text color="gray"> | {esc.trigger.detail}</Text>
                {esc.assignee && <Text color="magenta"> @{esc.assignee}</Text>}
              </Box>
            );
          })}
        </>
      )}
    </Box>
  );
}
