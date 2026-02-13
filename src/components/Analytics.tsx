import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { loadTasks } from "../services/tasks.js";
import { computeAnalytics, formatMs, type AnalyticsSnapshot } from "../services/analytics.js";

interface Props {
  onNavigate: (view: string) => void;
}

export default function Analytics({ onNavigate }: Props) {
  const [snapshot, setSnapshot] = useState<AnalyticsSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadTasks()
      .then((board) => {
        setSnapshot(computeAnalytics(board));
      })
      .catch((err: any) => {
        setError(err.message);
      });
  }, []);

  useInput((_input, key) => {
    if (key.escape) onNavigate("dashboard");
  });

  if (error) return <Box><Text color="red">Error: {error}</Text></Box>;
  if (!snapshot) return <Box><Text>Loading...</Text></Box>;

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">Analytics Dashboard</Text>
      <Box marginTop={1}><Text>Generated: {snapshot.generatedAt}</Text></Box>

      {/* Summary */}
      <Box flexDirection="column" marginTop={1}>
        <Text bold>Summary</Text>
        <Text>  Total Tasks: {snapshot.totalTasks}</Text>
        <Text>  Accepted: {snapshot.totalAccepted}  Rejected: {snapshot.totalRejected}</Text>
        <Text>  Accept Rate: {(snapshot.overallAcceptRate * 100).toFixed(1)}%</Text>
        <Text>  Avg Cycle Time: {formatMs(snapshot.avgCycleTimeMs)}</Text>
      </Box>

      {/* Per-Account Table */}
      <Box flexDirection="column" marginTop={1}>
        <Text bold>Per Account</Text>
        <Text>  {"Account".padEnd(20)} {"Assigned".padEnd(10)} {"Accepted".padEnd(10)} {"Rejected".padEnd(10)} {"Rate".padEnd(8)} {"Avg Cycle".padEnd(12)} {"WIP".padEnd(5)}</Text>
        <Text>  {"─".repeat(75)}</Text>
        {snapshot.perAccount.map((m) => (
          <Text key={m.accountName}>
            {"  "}{m.accountName.padEnd(20)} {String(m.assigned).padEnd(10)} {String(m.accepted).padEnd(10)} {String(m.rejected).padEnd(10)} {(m.acceptRate * 100).toFixed(0).padStart(3)}%{"    "} {formatMs(m.avgCycleTimeMs).padEnd(12)} {String(m.currentWip).padEnd(5)}
          </Text>
        ))}
      </Box>

      {/* SLA */}
      {snapshot.slaViolations.total > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color="yellow">SLA Violations: {snapshot.slaViolations.total}</Text>
          {Object.entries(snapshot.slaViolations.byAction).map(([action, count]) => (
            <Text key={action}>  {action}: {count}</Text>
          ))}
        </Box>
      )}

      <Box marginTop={1}><Text dimColor>[Esc] Back to Dashboard</Text></Box>
    </Box>
  );
}

