import { useState, useEffect, useContext, memo } from "react";
import { Box, Text, useInput } from "ink";
import { NavContext } from "../app.js";
import { useTheme } from "../themes/index.js";
import { atomicRead } from "../services/file-store.js";
import { getHubDir } from "../paths.js";
import type { CouncilAnalysis } from "../services/council.js";

interface Props {
  onNavigate: (view: string) => void;
}

const STAGE_LABELS = [
  "Stage 1: Individual Analysis",
  "Stage 2: Peer Review",
  "Stage 3: Chairman Synthesis",
];

// COMPLEXITY_COLORS and confidenceColor moved inside components to use theme

function confidenceBar(c: number, width = 20): string {
  const filled = Math.round(c * width);
  return "\u2588".repeat(filled) + "\u2591".repeat(width - filled);
}

function getCouncilCachePath(): string {
  return `${getHubDir()}/council-analyses.json`;
}

interface CouncilCache {
  analyses: CouncilAnalysis[];
}

export const CouncilPanel = memo(function CouncilPanel({ onNavigate }: Props) {
  const { colors } = useTheme();
  const [analyses, setAnalyses] = useState<CouncilAnalysis[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [detailView, setDetailView] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const { refreshTick: globalRefresh } = useContext(NavContext);

  const COMPLEXITY_COLORS: Record<string, string> = {
    low: colors.success,
    medium: colors.warning,
    high: colors.error,
    critical: colors.primaryMuted,
  };

  function confidenceColor(c: number): string {
    if (c >= 0.8) return colors.success;
    if (c >= 0.5) return colors.warning;
    return colors.error;
  }

  useEffect(() => {
    if (globalRefresh > 0) setRefreshTick((prev) => prev + 1);
  }, [globalRefresh]);

  useEffect(() => {
    async function load() {
      try {
        const cache = await atomicRead<CouncilCache>(getCouncilCachePath());
        if (cache && Array.isArray(cache.analyses)) {
          setAnalyses(cache.analyses);
        }
      } catch (e: any) {
        console.error("[council-panel]", e.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [refreshTick]);

  useInput((input, key) => {
    if (key.upArrow || input === "k") {
      if (detailView) {
        // scroll within detail — handled by selectedIndex on sub-items
        setSelectedIndex((i) => Math.max(0, i - 1));
      } else {
        setSelectedIndex((i) => Math.max(0, i - 1));
      }
    } else if (key.downArrow || input === "j") {
      const max = detailView
        ? (analyses[selectedIndex]?.individualAnalyses.length ?? 1) - 1
        : analyses.length - 1;
      setSelectedIndex((i) => Math.min(max, i + 1));
    } else if (key.return) {
      if (!detailView && analyses.length > 0) {
        setDetailView(true);
        setSelectedIndex(0);
      }
    } else if (input === "r") {
      setRefreshTick((prev) => prev + 1);
      setLoading(true);
    } else if (key.escape) {
      if (detailView) {
        setDetailView(false);
        setSelectedIndex(0);
      } else {
        onNavigate("dashboard");
      }
    }
  });

  if (loading) return <Text color={colors.textMuted}>Loading council analyses...</Text>;

  if (analyses.length === 0) {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Box marginBottom={1}>
          <Text bold>Council Panel</Text>
          <Text color={colors.textMuted}>  [r]efresh [Esc]back</Text>
        </Box>
        <Text color={colors.textMuted}>No council analyses found.</Text>
        <Text color={colors.textMuted} dimColor>
          Run a council analysis via the daemon or CLI to see results here.
        </Text>
      </Box>
    );
  }

  // Detail view: show a single analysis in depth
  if (detailView) {
    const analysis = analyses[selectedIndex] ?? analyses[0];
    return <AnalysisDetail analysis={analysis} selectedIndex={selectedIndex} colors={colors} />;
  }

  // List view: show all cached analyses
  return (
    <Box flexDirection="column" paddingY={1}>
      <Box marginBottom={1}>
        <Text bold>Council Panel</Text>
        <Text color={colors.textMuted}>  [Enter]detail [r]efresh [Esc]back</Text>
      </Box>

      {analyses.map((a, idx) => {
        const isSelected = idx === selectedIndex;
        const synth = a.synthesis;
        return (
          <Box key={idx} marginLeft={1} flexDirection="column">
            <Box>
              <Text color={isSelected ? colors.text : colors.textMuted}>
                {isSelected ? "> " : "  "}
              </Text>
              <Text color={isSelected ? colors.text : undefined} bold={isSelected}>
                {a.taskGoal.length > 60
                  ? a.taskGoal.slice(0, 57) + "..."
                  : a.taskGoal}
              </Text>
              <Text color={colors.textMuted}> | </Text>
              <Text color={COMPLEXITY_COLORS[synth.consensusComplexity] ?? colors.text}>
                {synth.consensusComplexity.toUpperCase()}
              </Text>
              <Text color={colors.textMuted}> | </Text>
              <Text color={confidenceColor(synth.confidence)}>
                {(synth.confidence * 100).toFixed(0)}%
              </Text>
              {synth.recommendedProvider && (
                <Text color={colors.primary}> @{synth.recommendedProvider}</Text>
              )}
            </Box>
            <Box marginLeft={4}>
              <Text color={colors.textMuted} dimColor>
                {a.timestamp.slice(0, 16).replace("T", " ")} | {a.individualAnalyses.length} accounts | {a.peerRankings.length} reviews
              </Text>
            </Box>
          </Box>
        );
      })}

      {/* Pipeline overview */}
      <Box marginTop={1} flexDirection="column">
        <Text bold color={colors.textMuted}>Pipeline Stages</Text>
        {STAGE_LABELS.map((label, idx) => {
          const latest = analyses[0];
          let done = false;
          if (idx === 0) done = latest.individualAnalyses.length > 0;
          if (idx === 1) done = latest.peerRankings.length > 0;
          if (idx === 2) done = latest.synthesis.confidence > 0;
          return (
            <Box key={idx} marginLeft={2}>
              <Text color={done ? colors.success : colors.textMuted}>
                {done ? "[x]" : "[ ]"} {label}
              </Text>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
});

function AnalysisDetail({
  analysis,
  selectedIndex,
  colors,
}: {
  analysis: CouncilAnalysis;
  selectedIndex: number;
  colors: Record<string, string>;
}) {
  const synth = analysis.synthesis;

  const COMPLEXITY_COLORS: Record<string, string> = {
    low: colors.success,
    medium: colors.warning,
    high: colors.error,
    critical: colors.primaryMuted,
  };

  function confidenceColor(c: number): string {
    if (c >= 0.8) return colors.success;
    if (c >= 0.5) return colors.warning;
    return colors.error;
  }

  return (
    <Box flexDirection="column" paddingY={1}>
      <Box marginBottom={1}>
        <Text bold>Council Analysis Detail</Text>
        <Text color={colors.textMuted}>  [Esc]back</Text>
      </Box>

      {/* Task goal */}
      <Box marginBottom={1}>
        <Text bold color={colors.primary}>Goal: </Text>
        <Text>{analysis.taskGoal}</Text>
      </Box>

      {/* Synthesis summary */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold>Synthesis</Text>
        <Box marginLeft={2} flexDirection="column">
          <Box>
            <Text>Complexity: </Text>
            <Text color={COMPLEXITY_COLORS[synth.consensusComplexity] ?? colors.text} bold>
              {synth.consensusComplexity.toUpperCase()}
            </Text>
          </Box>
          <Box>
            <Text>Duration: </Text>
            <Text>{synth.consensusDurationMinutes} min</Text>
          </Box>
          <Box>
            <Text>Confidence: </Text>
            <Text color={confidenceColor(synth.confidence)}>
              {confidenceBar(synth.confidence)} {(synth.confidence * 100).toFixed(0)}%
            </Text>
          </Box>
          {synth.recommendedProvider && (
            <Box>
              <Text>Provider: </Text>
              <Text color={colors.primary}>{synth.recommendedProvider}</Text>
            </Box>
          )}
          {synth.consensusSkills.length > 0 && (
            <Box>
              <Text>Skills: </Text>
              <Text color={colors.textMuted}>{synth.consensusSkills.join(", ")}</Text>
            </Box>
          )}
          <Box>
            <Text>Approach: </Text>
            <Text>{synth.recommendedApproach}</Text>
          </Box>
          {synth.dissenting_views && synth.dissenting_views.length > 0 && (
            <Box flexDirection="column">
              <Text color={colors.warning}>Dissenting Views:</Text>
              {synth.dissenting_views.map((v, i) => (
                <Text key={i} color={colors.warning} dimColor>  - {v}</Text>
              ))}
            </Box>
          )}
        </Box>
      </Box>

      {/* Individual account responses */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold>Account Responses ({analysis.individualAnalyses.length})</Text>
        {analysis.individualAnalyses.map((resp, idx) => {
          const isSelected = idx === selectedIndex;
          return (
            <Box key={idx} marginLeft={2} flexDirection="column">
              <Box>
                <Text color={isSelected ? colors.text : colors.textMuted}>
                  {isSelected ? "> " : "  "}
                </Text>
                <Text color={isSelected ? colors.text : undefined} bold={isSelected}>
                  {resp.account}
                </Text>
                <Text color={colors.textMuted}> | </Text>
                <Text color={COMPLEXITY_COLORS[resp.complexity] ?? colors.text}>
                  {resp.complexity}
                </Text>
                <Text color={colors.textMuted}> | {resp.estimatedDurationMinutes}min</Text>
                {resp.suggestedProvider && (
                  <Text color={colors.primary}> @{resp.suggestedProvider}</Text>
                )}
              </Box>
              {isSelected && (
                <Box marginLeft={4} flexDirection="column">
                  <Text>Approach: {resp.recommendedApproach}</Text>
                  <Text color={colors.textMuted}>Skills: {resp.requiredSkills.join(", ")}</Text>
                  {resp.risks.length > 0 && (
                    <Text color={colors.warning}>Risks: {resp.risks.join("; ")}</Text>
                  )}
                </Box>
              )}
            </Box>
          );
        })}
      </Box>

      {/* Aggregate rankings */}
      {analysis.aggregateRankings.length > 0 && (
        <Box flexDirection="column">
          <Text bold>Aggregate Rankings</Text>
          {analysis.aggregateRankings.map((rank, idx) => {
            const barWidth = Math.max(1, Math.round((1 / rank.averageRank) * 20));
            return (
              <Box key={idx} marginLeft={2}>
                <Text color={colors.textMuted}>{(idx + 1).toString().padStart(2)}. </Text>
                <Text>{rank.account.padEnd(40)}</Text>
                <Text color={colors.primary}>{"\u2588".repeat(barWidth)}</Text>
                <Text color={colors.textMuted}> avg:{rank.averageRank.toFixed(2)} ({rank.rankCount} votes)</Text>
              </Box>
            );
          })}
        </Box>
      )}
    </Box>
  );
}
