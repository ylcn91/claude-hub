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
      { key: "Up/Down", description: "Navigate accounts" },
    ],
  },
  tasks: {
    title: "Task Board",
    shortcuts: [
      { key: "Up/Down", description: "Navigate tasks" },
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
      { key: "Up/Down", description: "Navigate accounts" },
    ],
  },
  sla: {
    title: "SLA Board",
    shortcuts: [
      { key: "Up/Down", description: "Navigate escalations" },
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
