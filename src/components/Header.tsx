import React from "react";
import { Box, Text } from "ink";
import { MASCOT_LINES } from "../services/help.js";

const SHADOW_CHARS = "╔╗╚╝═║";

function MascotLine({ line }: { line: string }) {
  // Split line into segments of consecutive same-type characters (block vs shadow)
  const segments: { text: string; shadow: boolean }[] = [];
  for (const ch of line) {
    const isShadow = SHADOW_CHARS.includes(ch);
    const isSpace = ch === " ";
    const last = segments[segments.length - 1];
    if (isSpace && last) {
      last.text += ch;
    } else if (last && last.shadow === isShadow) {
      last.text += ch;
    } else {
      segments.push({ text: ch, shadow: isShadow });
    }
  }
  return (
    <Text>
      {segments.map((seg, j) => (
        <Text key={j} color={seg.shadow ? "#585b70" : "#89b4fa"}>{seg.text}</Text>
      ))}
    </Text>
  );
}

export function Header({ view, showMascot }: { view: string; showMascot?: boolean }) {
  return (
    <Box flexDirection="column">
      {showMascot && (
        <Box flexDirection="row" marginBottom={1}>
          <Box flexDirection="column" marginRight={2}>
            {MASCOT_LINES.map((line, i) => (
              <MascotLine key={i} line={line} />
            ))}
          </Box>
          <Box flexDirection="column" justifyContent="center">
            <Text bold color="#cba6f7">agentctl</Text>
            <Text color="gray">Multi-account AI agent manager</Text>
          </Box>
        </Box>
      )}
      <Box borderStyle="round" borderColor="magenta" paddingX={1}>
        <Text bold color="magenta">agentctl</Text>
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
        <Text color={view === "council" ? "cyan" : "gray"}>[c]ouncil</Text>
        <Text> </Text>
        <Text color={view === "verify" ? "cyan" : "gray"}>[v]erify</Text>
        <Text> </Text>
        <Text color={view === "entire" ? "cyan" : "gray"}>[i]entire</Text>
        <Text> </Text>
        <Text color={view === "chains" ? "cyan" : "gray"}>[g]chains</Text>
        <Text> </Text>
        <Text color="gray">[a]dd [q]uit</Text>
      </Box>
    </Box>
  );
}
