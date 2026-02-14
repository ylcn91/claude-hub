import { useState, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import { useTheme } from "../themes/index.js";

interface Command {
  id: string;
  label: string;
  shortcut?: string;
  action: string;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  onExecute: (action: string) => void;
}

export const COMMANDS: Command[] = [
  { id: "dashboard", label: "Dashboard", shortcut: "d", action: "dashboard" },
  { id: "launcher", label: "Launch Account", shortcut: "l", action: "launcher" },
  { id: "usage", label: "Usage Detail", shortcut: "u", action: "usage" },
  { id: "tasks", label: "Task Board", shortcut: "t", action: "tasks" },
  { id: "inbox", label: "Message Inbox", shortcut: "m", action: "inbox" },
  { id: "add", label: "Add Account", shortcut: "a", action: "add" },
  { id: "sla", label: "SLA Board", shortcut: "e", action: "sla" },
  { id: "prompts", label: "Prompt Library", shortcut: "r", action: "prompts" },
  { id: "analytics", label: "Analytics", shortcut: "n", action: "analytics" },
  { id: "workflows", label: "Workflows", shortcut: "w", action: "workflows" },
  { id: "health", label: "Health Dashboard", shortcut: "h", action: "health" },
  { id: "council", label: "Council Panel", shortcut: "c", action: "council" },
  { id: "verify", label: "Verification View", shortcut: "v", action: "verify" },
  { id: "entire", label: "Entire Sessions", shortcut: "i", action: "entire" },
  { id: "chains", label: "Delegation Chains", shortcut: "g", action: "chains" },
  { id: "tdd", label: "TDD Workflow", action: "tdd" },
  { id: "theme", label: "Theme", shortcut: "Ctrl+X t", action: "theme" },
  { id: "help", label: "Help", shortcut: "?", action: "help" },
  { id: "quit", label: "Quit", shortcut: "q", action: "quit" },
];

export function fuzzyMatch(query: string, text: string): { matches: boolean; indices: number[] } {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  const indices: number[] = [];
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      indices.push(ti);
      qi++;
    }
  }
  return { matches: qi === q.length, indices };
}

const MAX_RESULTS = 12;

export function CommandPalette({ visible, onClose, onExecute }: Props) {
  const { colors } = useTheme();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);

  const filtered = useMemo(() => {
    if (!query) return COMMANDS;
    return COMMANDS.filter((cmd) => fuzzyMatch(query, cmd.label).matches);
  }, [query]);

  const visibleItems = filtered.slice(0, MAX_RESULTS);

  useInput((input, key) => {
    if (!visible) return;

    if (key.escape) {
      setQuery("");
      setSelected(0);
      onClose();
      return;
    }

    if (key.return) {
      if (visibleItems[selected]) {
        setQuery("");
        setSelected(0);
        onExecute(visibleItems[selected].action);
      }
      return;
    }

    if (key.upArrow) {
      setSelected((prev) => Math.max(0, prev - 1));
      return;
    }

    if (key.downArrow) {
      setSelected((prev) => Math.min(visibleItems.length - 1, prev + 1));
      return;
    }

    if (key.backspace || key.delete) {
      setQuery((prev) => prev.slice(0, -1));
      setSelected(0);
      return;
    }

    if (input && !key.ctrl && !key.meta) {
      setQuery((prev) => prev + input);
      setSelected(0);
    }
  });

  if (!visible) return null;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={colors.primary}
      paddingX={2}
      paddingY={1}
      marginY={1}
    >
      <Text bold color={colors.primary}>Command Palette</Text>
      <Box marginTop={1}>
        <Text color={colors.primary}>{"> "}</Text>
        <Text>{query}</Text>
        <Text color={colors.textMuted}>|</Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {visibleItems.map((cmd, idx) => {
          const isSelected = idx === selected;
          const matchResult = query ? fuzzyMatch(query, cmd.label) : { matches: true, indices: [] as number[] };
          const matchSet = new Set(matchResult.indices);

          return (
            <Box key={cmd.id}>
              <Text color={isSelected ? colors.primary : colors.text}>
                {isSelected ? "> " : "  "}
              </Text>
              <Box width={24}>
                {cmd.label.split("").map((char, ci) => (
                  <Text
                    key={ci}
                    color={matchSet.has(ci) ? colors.warning : isSelected ? colors.text : colors.textMuted}
                    bold={matchSet.has(ci)}
                  >
                    {char}
                  </Text>
                ))}
              </Box>
              {cmd.shortcut && (
                <Text color={colors.textMuted} dimColor>
                  {cmd.shortcut}
                </Text>
              )}
            </Box>
          );
        })}
        {visibleItems.length === 0 && (
          <Text color={colors.textMuted} italic>No matching commands</Text>
        )}
      </Box>
      <Box marginTop={1}>
        <Text color={colors.textMuted} dimColor>Up/Down to navigate, Enter to select, Esc to close</Text>
      </Box>
    </Box>
  );
}
