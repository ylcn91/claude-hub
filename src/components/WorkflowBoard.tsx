import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { getHubDir } from "../paths.js";
import { join } from "path";

interface WorkflowDef {
  name: string;
  description?: string;
  version: number;
  retro: boolean;
  steps: Array<{ id: string; title: string }>;
}

interface WorkflowRun {
  id: string;
  workflow_name: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
}

interface Props {
  onNavigate: (view: string, detail?: any) => void;
}

const STATUS_COLORS: Record<string, string> = {
  pending: "yellow",
  running: "cyan",
  completed: "green",
  failed: "red",
  cancelled: "gray",
  retro_in_progress: "magenta",
};

export function WorkflowBoard({ onNavigate }: Props) {
  const [definitions, setDefinitions] = useState<WorkflowDef[]>([]);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"definitions" | "runs">("definitions");

  useEffect(() => {
    (async () => {
      try {
        const { scanWorkflowDir } = await import("../services/workflow-parser.js");
        const dir = join(getHubDir(), "workflows");
        const defs = await scanWorkflowDir(dir);
        setDefinitions(defs);
      } catch {
        // No workflows directory
      }

      try {
        const { WorkflowStore } = await import("../services/workflow-store.js");
        const { getWorkflowDbPath } = await import("../paths.js");
        const store = new WorkflowStore(getWorkflowDbPath());
        const allRuns = store.listRuns();
        setRuns(allRuns.slice(0, 20));
        store.close();
      } catch {
        // No workflow DB
      }

      setLoading(false);
    })();
  }, []);

  const items = tab === "definitions" ? definitions : runs;

  useInput((input, key) => {
    if (key.upArrow || input === "k") {
      setSelectedIndex((i) => Math.max(0, i - 1));
    } else if (key.downArrow || input === "j") {
      setSelectedIndex((i) => Math.min(items.length - 1, i + 1));
    } else if (input === "1") {
      setTab("definitions");
      setSelectedIndex(0);
    } else if (input === "2") {
      setTab("runs");
      setSelectedIndex(0);
    } else if (key.return && tab === "runs" && runs[selectedIndex]) {
      onNavigate("workflow_detail", { runId: runs[selectedIndex].id });
    } else if (key.escape) {
      onNavigate("dashboard");
    }
  });

  if (loading) return <Text color="gray">Loading workflows...</Text>;

  return (
    <Box flexDirection="column" paddingY={1}>
      <Box marginBottom={1}>
        <Text bold>Workflows</Text>
        <Text color="gray">  [1]Definitions [2]Runs [Enter]detail [Esc]back</Text>
      </Box>

      <Box marginBottom={1}>
        <Text color={tab === "definitions" ? "cyan" : "gray"} bold={tab === "definitions"}>
          Definitions ({definitions.length})
        </Text>
        <Text>  </Text>
        <Text color={tab === "runs" ? "cyan" : "gray"} bold={tab === "runs"}>
          Runs ({runs.length})
        </Text>
      </Box>

      {tab === "definitions" && (
        <Box flexDirection="column">
          {definitions.length === 0 && (
            <Text color="gray" dimColor>  No workflow definitions found</Text>
          )}
          {definitions.map((def, i) => {
            const isSelected = i === selectedIndex;
            return (
              <Box key={def.name} marginLeft={1}>
                <Text color={isSelected ? "white" : "gray"}>{isSelected ? "> " : "  "}</Text>
                <Text color={isSelected ? "white" : undefined} bold={isSelected}>
                  {def.name}
                </Text>
                <Text color="gray"> v{def.version} ({def.steps.length} steps)</Text>
                {def.retro && <Text color="magenta"> [retro]</Text>}
                {def.description && <Text color="gray"> - {def.description}</Text>}
              </Box>
            );
          })}
        </Box>
      )}

      {tab === "runs" && (
        <Box flexDirection="column">
          {runs.length === 0 && (
            <Text color="gray" dimColor>  No workflow runs</Text>
          )}
          {runs.map((run, i) => {
            const isSelected = i === selectedIndex;
            const statusColor = STATUS_COLORS[run.status] ?? "gray";
            return (
              <Box key={run.id} marginLeft={1}>
                <Text color={isSelected ? "white" : "gray"}>{isSelected ? "> " : "  "}</Text>
                <Text color={isSelected ? "white" : undefined}>{run.workflow_name}</Text>
                <Text color={statusColor}> [{run.status}]</Text>
                <Text color="gray"> {run.id.slice(0, 8)}</Text>
                {run.started_at && <Text color="gray"> {run.started_at.slice(0, 16)}</Text>}
              </Box>
            );
          })}
        </Box>
      )}
    </Box>
  );
}
