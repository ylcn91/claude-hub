import { Box, Text } from "ink";

interface ShortcutGroup {
  title: string;
  shortcuts: { key: string; description: string }[];
}

const GLOBAL_SHORTCUTS: ShortcutGroup = {
  title: "Global",
  shortcuts: [
    { key: "Esc", description: "Back to dashboard / enable nav" },
    { key: "q", description: "Quit" },
    { key: "?", description: "Toggle this help" },
    { key: "Ctrl+r", description: "Refresh current view" },
  ],
};

const NAV_SHORTCUTS: ShortcutGroup = {
  title: "Navigation (when nav active)",
  shortcuts: [
    { key: "d", description: "Dashboard" },
    { key: "l", description: "Launch agent" },
    { key: "u", description: "Usage detail" },
    { key: "t", description: "Task board" },
    { key: "m", description: "Messages" },
    { key: "a", description: "Add account" },
    { key: "e", description: "SLA board" },
    { key: "r", description: "Prompt library" },
    { key: "n", description: "Analytics" },
    { key: "w", description: "Workflows" },
    { key: "h", description: "Health" },
    { key: "c", description: "Council" },
    { key: "v", description: "Verification" },
    { key: "i", description: "Entire sessions" },
    { key: "g", description: "Delegation chains" },
  ],
};

const VIEW_SHORTCUTS: Record<string, ShortcutGroup> = {
  dashboard: {
    title: "Dashboard",
    shortcuts: [
      { key: "j/k", description: "Navigate accounts" },
      { key: "Up/Down", description: "Navigate accounts" },
    ],
  },
  tasks: {
    title: "Task Board",
    shortcuts: [
      { key: "j/k", description: "Navigate tasks" },
      { key: "Up/Down", description: "Navigate tasks" },
      { key: "/", description: "Search/filter tasks" },
      { key: "a", description: "Add new task" },
      { key: "s", description: "Advance status" },
      { key: "v", description: "Accept task" },
      { key: "x", description: "Reject task" },
      { key: "p", description: "Toggle priority sort" },
      { key: "Enter", description: "Assign to account" },
      { key: "d", description: "Delete task" },
    ],
  },
  launcher: {
    title: "Launcher",
    shortcuts: [
      { key: "Up/Down", description: "Navigate options" },
      { key: "Space", description: "Toggle option" },
      { key: "Enter", description: "Confirm / Launch" },
      { key: "Esc", description: "Back to previous step" },
    ],
  },
  inbox: {
    title: "Message Inbox",
    shortcuts: [
      { key: "j/k", description: "Navigate accounts" },
      { key: "Up/Down", description: "Navigate accounts" },
      { key: "/", description: "Search/filter messages" },
    ],
  },
  sla: {
    title: "SLA Board",
    shortcuts: [
      { key: "j/k", description: "Navigate escalations" },
      { key: "Up/Down", description: "Navigate escalations" },
      { key: "r", description: "Refresh" },
    ],
  },
  usage: {
    title: "Usage Detail",
    shortcuts: [
      { key: "Left/Right", description: "Page between accounts" },
      { key: "Esc", description: "Back to dashboard" },
    ],
  },
  prompts: {
    title: "Prompt Library",
    shortcuts: [
      { key: "j/k", description: "Navigate prompts" },
      { key: "Up/Down", description: "Navigate prompts" },
      { key: "/", description: "Search prompts" },
      { key: "a", description: "Add new prompt" },
      { key: "d", description: "Delete prompt" },
      { key: "Enter", description: "View prompt" },
    ],
  },
  analytics: {
    title: "Analytics",
    shortcuts: [
      { key: "Esc", description: "Back to dashboard" },
    ],
  },
  workflows: {
    title: "Workflows",
    shortcuts: [
      { key: "j/k", description: "Navigate items" },
      { key: "Up/Down", description: "Navigate items" },
      { key: "1", description: "Show definitions" },
      { key: "2", description: "Show runs" },
      { key: "Enter", description: "View run detail" },
    ],
  },
  health: {
    title: "Health Dashboard",
    shortcuts: [
      { key: "j/k", description: "Navigate accounts" },
      { key: "Up/Down", description: "Navigate accounts" },
      { key: "r", description: "Refresh" },
    ],
  },
  council: {
    title: "Council Panel",
    shortcuts: [
      { key: "j/k", description: "Navigate analyses" },
      { key: "Up/Down", description: "Navigate analyses" },
      { key: "Enter", description: "View detail" },
      { key: "r", description: "Refresh" },
    ],
  },
  verify: {
    title: "Verification View",
    shortcuts: [
      { key: "j/k", description: "Navigate results" },
      { key: "Up/Down", description: "Navigate results" },
      { key: "Enter", description: "View detail" },
      { key: "r", description: "Refresh" },
    ],
  },
  entire: {
    title: "Entire Sessions",
    shortcuts: [
      { key: "j/k", description: "Navigate sessions" },
      { key: "Up/Down", description: "Navigate sessions" },
      { key: "r", description: "Refresh" },
    ],
  },
  chains: {
    title: "Delegation Chains",
    shortcuts: [
      { key: "j/k", description: "Navigate chains" },
      { key: "Up/Down", description: "Navigate chains" },
      { key: "r", description: "Refresh" },
    ],
  },
};

interface Props {
  view: string;
  visible: boolean;
}

export function HelpOverlay({ view, visible }: Props) {
  if (!visible) return null;

  const viewGroup = VIEW_SHORTCUTS[view];
  const groups = [GLOBAL_SHORTCUTS, NAV_SHORTCUTS];
  if (viewGroup) groups.push(viewGroup);

  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      borderColor="yellow"
      paddingX={2}
      paddingY={1}
      marginY={1}
    >
      <Text bold color="yellow">Keyboard Shortcuts</Text>
      <Text color="gray">Press ? or Esc to close</Text>
      <Text> </Text>
      {groups.map((group) => (
        <Box key={group.title} flexDirection="column" marginBottom={1}>
          <Text bold color="cyan">{group.title}</Text>
          {group.shortcuts.map((s) => (
            <Box key={s.key} marginLeft={2}>
              <Box width={12}>
                <Text color="white" bold>{s.key}</Text>
              </Box>
              <Text color="gray">{s.description}</Text>
            </Box>
          ))}
        </Box>
      ))}
    </Box>
  );
}
