import React from "react";
import { Box, Text } from "ink";

export function Header({ view }: { view: string }) {
  return (
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
  );
}
