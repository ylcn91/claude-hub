import React from "react";
import { Box, Text } from "ink";
import { MASCOT_LINES } from "../services/help.js";

export function Header({ view, showMascot }: { view: string; showMascot?: boolean }) {
  return (
    <Box flexDirection="column">
      {showMascot && (
        <Box flexDirection="row" marginBottom={1}>
          <Box flexDirection="column" marginRight={2}>
            {MASCOT_LINES.map((line, i) => (
              <Text key={i} color="#89b4fa">{line}</Text>
            ))}
          </Box>
          <Box flexDirection="column" justifyContent="center">
            <Text bold color="#cba6f7">Claude Hub</Text>
            <Text color="gray">Multi-account AI agent manager</Text>
          </Box>
        </Box>
      )}
      <Box borderStyle="round" borderColor="magenta" paddingX={1}>
        <Text bold color="magenta">Claude Hub</Text>
        <Text> | </Text>
        <Text color={view === "dashboard" ? "cyan" : "gray"}>[d]ash</Text>
        <Text> </Text>
        <Text color={view === "launcher" ? "cyan" : "gray"}>[l]aunch</Text>
        <Text> </Text>
        <Text color={view === "usage" ? "cyan" : "gray"}>[u]sage</Text>
        <Text> </Text>
        <Text color={view === "tasks" ? "cyan" : "gray"}>[t]asks</Text>
        <Text> </Text>
        <Text color={view === "inbox" ? "cyan" : "gray"}>[m]sg</Text>
        <Text> </Text>
        <Text color={view === "sla" ? "cyan" : "gray"}>[e]sla</Text>
        <Text> </Text>
        <Text color={view === "prompts" ? "cyan" : "gray"}>[r]prompts</Text>
        <Text> </Text>
        <Text color="gray">[a]dd [q]uit</Text>
      </Box>
    </Box>
  );
}
