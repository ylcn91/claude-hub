import { useState, useEffect, useContext } from "react";
import { Box, Text, useInput } from "ink";
import { NavContext } from "../app.js";
import {
  loadTasks,
  saveTasks,
  addTask,
  updateTaskStatus,
  assignTask,
  removeTask,
  sortByPriority,
  rejectTask,
  acceptTask,
  VALID_TRANSITIONS,
  type TaskBoard as TaskBoardData,
  type TaskStatus,
} from "../services/tasks.js";
import { getGatedAcceptanceAction } from "../services/cognitive-friction.js";
import { calculateProviderFit } from "../services/provider-profiles.js";
import type { HandoffPayload } from "../services/handoff.js";

interface Props {
  onNavigate: (view: string) => void;
  accounts?: string[];
}

type Mode = "browse" | "add" | "assign" | "reject" | "justify" | "search";

const STATUS_ORDER: TaskStatus[] = ["todo", "in_progress", "ready_for_review", "accepted", "rejected"];
const STATUS_COLORS: Record<TaskStatus, string> = {
  todo: "yellow",
  in_progress: "cyan",
  ready_for_review: "magenta",
  accepted: "green",
  rejected: "red",
};
const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "To Do",
  in_progress: "In Progress",
  ready_for_review: "Ready for Review",
  accepted: "Accepted",
  rejected: "Rejected",
};

export function TaskBoard({ onNavigate, accounts = [] }: Props) {
  const [board, setBoard] = useState<TaskBoardData>({ tasks: [] });
  const [loading, setLoading] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mode, setMode] = useState<Mode>("browse");
  const [inputBuffer, setInputBuffer] = useState("");
  const [assignIndex, setAssignIndex] = useState(0);
  const [sortByPrio, setSortByPrio] = useState(false);
  const [frictionMessage, setFrictionMessage] = useState<{ text: string; color: string } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const { setGlobalNavEnabled } = useContext(NavContext);

  useEffect(() => {
    setGlobalNavEnabled(false);
    return () => setGlobalNavEnabled(true);
  }, []);

  useEffect(() => {
    loadTasks().then((b) => {
      setBoard(b);
      setLoading(false);
    });
  }, []);

  const allTasks = board.tasks;
  const tasksByStatus = (status: TaskStatus) =>
    allTasks.filter((t) => t.status === status);

  // Flat list for navigation: pending, then in-progress, then done
  const rawTasks = STATUS_ORDER.flatMap((s) => tasksByStatus(s));
  const searchedTasks = searchQuery
    ? rawTasks.filter((t) => {
        const q = searchQuery.toLowerCase();
        return (
          t.title.toLowerCase().includes(q) ||
          (t.assignee ?? "").toLowerCase().includes(q) ||
          (t.tags ?? []).some((tag) => tag.toLowerCase().includes(q))
        );
      })
    : rawTasks;
  const flatTasks = sortByPrio ? sortByPriority(searchedTasks) : searchedTasks;

  async function persist(newBoard: TaskBoardData) {
    setBoard(newBoard);
    await saveTasks(newBoard);
  }

  function commitInput(currentMode: Mode, value: string) {
    if (currentMode === "add") {
      const newBoard = addTask(board, value);
      persist(newBoard);
    } else if (currentMode === "reject") {
      const task = flatTasks[selectedIndex];
      if (task) {
        const newBoard = rejectTask(board, task.id, value);
        persist(newBoard);
      }
    } else if (currentMode === "justify") {
      const task = flatTasks[selectedIndex];
      if (task) {
        try {
          const newBoard = acceptTask(board, task.id, value);
          persist(newBoard);
          setFrictionMessage({ text: "Accepted with justification", color: "green" });
        } catch (e: any) {
          console.error("[taskboard]", e.message);
        }
      }
    }
  }

  useInput((input, key) => {
    // Search mode
    if (mode === "search") {
      if (key.return || key.escape) {
        if (key.escape) setSearchQuery("");
        setMode("browse");
        setSelectedIndex(0);
      } else if (key.backspace || key.delete) {
        setSearchQuery((q) => q.slice(0, -1));
      } else if (input && !key.ctrl && !key.meta) {
        setSearchQuery((q) => q + input);
      }
      return;
    }

    // All text-input modes share identical key handling
    if (mode === "add" || mode === "reject" || mode === "justify") {
      if (key.return) {
        if (inputBuffer.trim()) {
          commitInput(mode, inputBuffer.trim());
        }
        setInputBuffer("");
        setMode("browse");
      } else if (key.escape) {
        setInputBuffer("");
        setMode("browse");
      } else if (key.backspace || key.delete) {
        setInputBuffer((b) => b.slice(0, -1));
      } else if (input && !key.ctrl && !key.meta) {
        setInputBuffer((b) => b + input);
      }
      return;
    }

    if (mode === "assign") {
      if (key.return && accounts.length > 0) {
        const task = flatTasks[selectedIndex];
        if (task) {
          const newBoard = assignTask(board, task.id, accounts[assignIndex]);
          persist(newBoard);
        }
        setMode("browse");
      } else if (key.escape) {
        setMode("browse");
      } else if (key.upArrow) {
        setAssignIndex((i) => Math.max(0, i - 1));
      } else if (key.downArrow) {
        setAssignIndex((i) => Math.min(accounts.length - 1, i + 1));
      }
      return;
    }

    // Browse mode
    if (key.upArrow || input === "k") {
      setSelectedIndex((i) => Math.max(0, i - 1));
    } else if (key.downArrow || input === "j") {
      setSelectedIndex((i) => Math.min(flatTasks.length - 1, i + 1));
    } else if (input === "/") {
      setMode("search");
    } else if (input === "a") {
      setMode("add");
    } else if (key.return && flatTasks[selectedIndex]) {
      if (accounts.length > 0) {
        setAssignIndex(0);
        setMode("assign");
      }
    } else if (input === "d" && flatTasks[selectedIndex]) {
      const task = flatTasks[selectedIndex];
      const newBoard = removeTask(board, task.id);
      persist(newBoard);
      setSelectedIndex((i) => Math.min(i, newBoard.tasks.length - 1));
    } else if (input === "s" && flatTasks[selectedIndex]) {
      // Advance through valid transitions only
      const task = flatTasks[selectedIndex];
      const allowed = VALID_TRANSITIONS[task.status];
      if (allowed.length > 0) {
        try {
          const newBoard = updateTaskStatus(board, task.id, allowed[0]);
          persist(newBoard);
        } catch(e: any) { console.error("[taskboard]", e.message) }
      }
    } else if (input === "v" && flatTasks[selectedIndex]) {
      // Accept task with friction gate check (only valid on ready_for_review)
      const task = flatTasks[selectedIndex];
      if (task.status === "ready_for_review") {
        // Build a minimal HandoffPayload from task tags for gate check
        const taskTags = task.tags ?? [];
        const payload: Partial<HandoffPayload> = {
          goal: task.title,
          acceptance_criteria: [],
          run_commands: [],
          blocked_by: [],
        };
        for (const tag of taskTags) {
          if (tag.startsWith("criticality:")) payload.criticality = tag.split(":")[1] as any;
          if (tag.startsWith("reversibility:")) payload.reversibility = tag.split(":")[1] as any;
          if (tag.startsWith("verifiability:")) payload.verifiability = tag.split(":")[1] as any;
        }

        const gateResult = getGatedAcceptanceAction(payload as HandoffPayload);

        if (gateResult.action === "auto-accept") {
          try {
            const newBoard = acceptTask(board, task.id);
            persist(newBoard);
            setFrictionMessage({ text: "Auto-accepted", color: "green" });
            setTimeout(() => setFrictionMessage(null), 3000);
          } catch (e: any) { console.error("[taskboard]", e.message); }
        } else if (gateResult.action === "require-acceptance") {
          try {
            const newBoard = acceptTask(board, task.id);
            persist(newBoard);
          } catch (e: any) { console.error("[taskboard]", e.message); }
        } else if (gateResult.action === "require-justification") {
          setInputBuffer("");
          setMode("justify");
        } else if (gateResult.action === "require-elevated-review") {
          setFrictionMessage({ text: `BLOCKED: ${gateResult.reason}`, color: "red" });
          setTimeout(() => setFrictionMessage(null), 5000);
        }
      }
    } else if (input === "x" && flatTasks[selectedIndex]) {
      // Reject task (only valid on ready_for_review)
      const task = flatTasks[selectedIndex];
      if (task.status === "ready_for_review") {
        setMode("reject");
      }
    } else if (input === "p") {
      setSortByPrio((prev) => !prev);
    } else if (input === "s" && key.ctrl) {
      // Ctrl+s: explicit save
      persist(board);
      setFrictionMessage({ text: "Saved", color: "green" });
      setTimeout(() => setFrictionMessage(null), 2000);
    } else if (input === "r" && key.ctrl) {
      // Ctrl+r: reload tasks
      loadTasks().then((b) => {
        setBoard(b);
        setFrictionMessage({ text: "Refreshed", color: "cyan" });
        setTimeout(() => setFrictionMessage(null), 2000);
      });
    } else if (key.escape) {
      onNavigate("dashboard");
    }
  });

  if (loading) return <Text color="gray">Loading tasks...</Text>;

  return (
    <Box flexDirection="column" paddingY={1}>
      <Box marginBottom={1}>
        <Text bold>Task Board</Text>
        {sortByPrio && <Text color="yellow"> (sorted by priority)</Text>}
        {searchQuery && <Text color="cyan"> filter: "{searchQuery}"</Text>}
        <Text color="gray">  [/]search [a]dd [s]tatus [v]accept [x]reject [p]riority [Enter]assign [d]elete [Esc]back</Text>
      </Box>

      {mode === "search" && (
        <Box marginBottom={1}>
          <Text color="cyan">Search: </Text>
          <Text>{searchQuery}</Text>
          <Text color="gray">_</Text>
        </Box>
      )}

      {mode === "add" && (
        <Box marginBottom={1}>
          <Text color="cyan">New task: </Text>
          <Text>{inputBuffer}</Text>
          <Text color="gray">_</Text>
        </Box>
      )}

      {mode === "reject" && (
        <Box marginBottom={1}>
          <Text color="red">Rejection reason: </Text>
          <Text>{inputBuffer}</Text>
          <Text color="gray">_</Text>
        </Box>
      )}

      {mode === "justify" && (
        <Box marginBottom={1}>
          <Text color="yellow">Justification required: </Text>
          <Text>{inputBuffer}</Text>
          <Text color="gray">_</Text>
        </Box>
      )}

      {frictionMessage && (
        <Box marginBottom={1}>
          <Text color={frictionMessage.color}>{frictionMessage.text}</Text>
        </Box>
      )}

      {STATUS_ORDER.map((status) => {
        const tasks = tasksByStatus(status);
        return (
          <Box key={status} flexDirection="column" marginBottom={1}>
            <Text bold color={STATUS_COLORS[status]}>
              {STATUS_LABELS[status]} ({tasks.length})
            </Text>
            {tasks.map((task) => {
              const globalIdx = flatTasks.indexOf(task);
              const isSelected = globalIdx === selectedIndex && mode === "browse";
              return (
                <Box key={task.id} marginLeft={2}>
                  <Text color={isSelected ? "white" : "gray"}>
                    {isSelected ? "> " : "  "}
                  </Text>
                  <Text color={isSelected ? "white" : undefined}>
                    {task.priority && <Text color="red">[{task.priority}] </Text>}
                    {task.title}
                  </Text>
                  {task.dueDate && (
                    <Text color="gray"> due:{task.dueDate.slice(0, 10)}</Text>
                  )}
                  {task.tags && task.tags.length > 0 && (
                    <Text color="blue"> #{task.tags.join(" #")}</Text>
                  )}
                  {task.assignee && (
                    <Text color="magenta"> @{task.assignee}</Text>
                  )}
                </Box>
              );
            })}
            {tasks.length === 0 && (
              <Box marginLeft={2}>
                <Text color="gray" dimColor>  (empty)</Text>
              </Box>
            )}
          </Box>
        );
      })}

      {mode === "assign" && flatTasks[selectedIndex] && (() => {
        const task = flatTasks[selectedIndex];
        const requiredSkills = (task.tags ?? [])
          .filter((t) => t.startsWith("skill:"))
          .map((t) => t.split(":")[1]);
        return (
          <Box flexDirection="column" marginTop={1}>
            <Text bold color="cyan">Assign to:</Text>
            {accounts.map((acct, i) => {
              const fitScore = calculateProviderFit(acct, requiredSkills);
              const scoreColor = fitScore > 70 ? "green" : fitScore >= 40 ? "yellow" : "red";
              return (
                <Box key={acct} marginLeft={2}>
                  <Text color={i === assignIndex ? "white" : "gray"}>
                    {i === assignIndex ? "> " : "  "}{acct}
                  </Text>
                  {requiredSkills.length > 0 && (
                    <Text color={scoreColor}> ({fitScore}%)</Text>
                  )}
                </Box>
              );
            })}
          </Box>
        );
      })()}
    </Box>
  );
}
