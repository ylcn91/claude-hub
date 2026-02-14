import { useState, useEffect, useContext } from "react";
import { Box, Text, useInput } from "ink";
import { NavContext } from "../app.js";
import { useTheme } from "../themes/index.js";
import { TddEngine } from "../services/tdd-engine.js";
import type { TddState, TddPhase } from "../types.js";

interface Props {
  testFile: string;
  watchMode?: boolean;
  onNavigate: (view: string) => void;
}

const PHASE_LABELS: Record<TddPhase, string> = {
  idle: "IDLE",
  red: "RED",
  green: "GREEN",
  refactor: "REFACTOR",
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function TddView({ testFile, watchMode, onNavigate }: Props) {
  const { colors } = useTheme();
  const { setGlobalNavEnabled } = useContext(NavContext);
  const [engine] = useState(() => new TddEngine({ testFile, watchMode }));
  const [state, setState] = useState<TddState>(engine.getState());
  const [running, setRunning] = useState(false);
  const [outputScroll, setOutputScroll] = useState(0);

  function phaseColor(phase: TddPhase): string {
    switch (phase) {
      case "red": return colors.error;
      case "green": return colors.success;
      case "refactor": return colors.warning;
      default: return colors.textMuted;
    }
  }

  useEffect(() => {
    setGlobalNavEnabled(false);
    const originalOnStateChange = engine["options"].onStateChange;
    engine["options"].onStateChange = (s: TddState) => {
      setState({ ...s, cycles: [...s.cycles] });
      originalOnStateChange?.(s);
    };
    engine.start();
    return () => {
      engine.stop();
      setGlobalNavEnabled(true);
    };
  }, [engine, setGlobalNavEnabled]);

  useInput((input, key) => {
    if (key.escape) {
      engine.stop();
      onNavigate("dashboard");
      return;
    }

    if (input === "r" && !running) {
      setRunning(true);
      engine.runTests().then((result) => {
        engine.advanceAfterTests(result.passed);
        setRunning(false);
        setOutputScroll(0);
      });
      return;
    }

    if (input === "n" && !running) {
      const phase = engine.getPhase();
      if (phase === "green") engine.transition("refactor");
      else if (phase === "refactor") engine.transition("red");
      return;
    }

    if (key.upArrow) {
      setOutputScroll((prev) => Math.max(0, prev - 1));
    }
    if (key.downArrow) {
      setOutputScroll((prev) => prev + 1);
    }
  });

  const outputLines = state.lastTestOutput.split("\n");
  const visibleLines = outputLines.slice(outputScroll, outputScroll + 15);
  const completedCycles = Math.floor(state.cycles.filter((c) => c.phase === "red").length);

  return (
    <Box flexDirection="column" paddingY={1}>
      <Box marginBottom={1}>
        <Text bold>TDD </Text>
        <Text color={phaseColor(state.phase)} bold>
          [{PHASE_LABELS[state.phase]}]
        </Text>
        <Text color={colors.textMuted}>  {testFile}  </Text>
        <Text color={colors.textMuted}>cycles: {completedCycles}  </Text>
        {watchMode && <Text color={colors.primary}>WATCH</Text>}
      </Box>

      <Box marginBottom={1}>
        <Text color={colors.textMuted}>
          [r]un tests  [n]ext phase  [Esc]back  [up/down]scroll output
        </Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text bold>Cycle: </Text>
        <Box>
          {(["red", "green", "refactor"] as TddPhase[]).map((p) => (
            <Box key={p} marginRight={1}>
              <Text
                color={state.phase === p ? phaseColor(p) : colors.textMuted}
                bold={state.phase === p}
              >
                {state.phase === p ? `[${PHASE_LABELS[p]}]` : PHASE_LABELS[p]}
              </Text>
              {p !== "refactor" && <Text color={colors.textMuted}> {"->"} </Text>}
            </Box>
          ))}
        </Box>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Box>
          <Text bold>Last run: </Text>
          {running ? (
            <Text color={colors.warning}>Running...</Text>
          ) : state.lastTestOutput ? (
            <Text color={state.lastTestPassed ? colors.success : colors.error}>
              {state.lastTestPassed ? "PASS" : "FAIL"}
            </Text>
          ) : (
            <Text color={colors.textMuted}>no runs yet</Text>
          )}
        </Box>
      </Box>

      {state.lastTestOutput && (
        <Box flexDirection="column" borderStyle="single" borderColor={colors.textMuted} paddingX={1}>
          <Text bold color={colors.textMuted}>Output:</Text>
          {visibleLines.map((line, i) => (
            <Text key={i} color={colors.text} wrap="truncate">
              {line}
            </Text>
          ))}
          {outputLines.length > 15 && (
            <Text color={colors.textMuted}>
              [{outputScroll + 1}-{Math.min(outputScroll + 15, outputLines.length)}/{outputLines.length} lines]
            </Text>
          )}
        </Box>
      )}

      {state.cycles.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>History:</Text>
          {state.cycles.slice(-8).map((c, i) => (
            <Box key={i} marginLeft={1}>
              <Text color={phaseColor(c.phase)}>
                {PHASE_LABELS[c.phase].padEnd(10)}
              </Text>
              <Text color={colors.textMuted}>
                {c.passed !== undefined ? (c.passed ? "pass" : "fail") : ""}
                {c.duration !== undefined ? `  ${formatDuration(c.duration)}` : ""}
                {c.passCount !== undefined ? `  ${c.passCount}ok` : ""}
                {c.failCount ? `  ${c.failCount}fail` : ""}
              </Text>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
