import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
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

const COMPLEXITY_COLORS: Record<string, string> = {
  low: "green",
  medium: "yellow",
  high: "red",
  critical: "magenta",
};

function confidenceColor(c: number): string {
  if (c >= 0.8) return "green";
  if (c >= 0.5) return "yellow";
  return "red";
}

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

export function CouncilPanel({ onNavigate }: Props) {
  const [analyses, setAnalyses] = useState<CouncilAnalysis[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [detailView, setDetailView] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

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
    if (key.upArrow) {
      if (detailView) {
        // scroll within detail — handled by selectedIndex on sub-items
        setSelectedIndex((i) => Math.max(0, i - 1));
      } else {
        setSelectedIndex((i) => Math.max(0, i - 1));
      }
    } else if (key.downArrow) {
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

  if (loading) return <Text color="gray">Loading council analyses...</Text>;

  if (analyses.length === 0) {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Box marginBottom={1}>
          <Text bold>Council Panel</Text>
          <Text color="gray">  [r]efresh [Esc]back</Text>
        </Box>
        <Text color="gray">No council analyses found.</Text>
        <Text color="gray" dimColor>
          Run a council analysis via the daemon or CLI to see results here.
        </Text>
      </Box>
    );
  }

  // Detail view: show a single analysis in depth
  if (detailView) {
    const analysis = analyses[selectedIndex] ?? analyses[0];
    return <AnalysisDetail analysis={analysis} selectedIndex={selectedIndex} />;
  }

  // List view: show all cached analyses
  return (
    <Box flexDirection="column" paddingY={1}>
      <Box marginBottom={1}>
        <Text bold>Council Panel</Text>
        <Text color="gray">  [Enter]detail [r]efresh [Esc]back</Text>
      </Box>

      {analyses.map((a, idx) => {
        const isSelected = idx === selectedIndex;
        const synth = a.synthesis;
        return (
          <Box key={idx} marginLeft={1} flexDirection="column">
            <Box>
              <Text color={isSelected ? "white" : "gray"}>
                {isSelected ? "> " : "  "}
              </Text>
              <Text color={isSelected ? "white" : undefined} bold={isSelected}>
                {a.taskGoal.length > 60
                  ? a.taskGoal.slice(0, 57) + "..."
                  : a.taskGoal}
              </Text>
              <Text color="gray"> | </Text>
              <Text color={COMPLEXITY_COLORS[synth.consensusComplexity] ?? "white"}>
                {synth.consensusComplexity.toUpperCase()}
              </Text>
              <Text color="gray"> | </Text>
              <Text color={confidenceColor(synth.confidence)}>
                {(synth.confidence * 100).toFixed(0)}%
              </Text>
              {synth.recommendedProvider && (
                <Text color="cyan"> @{synth.recommendedProvider}</Text>
              )}
            </Box>
            <Box marginLeft={4}>
              <Text color="gray" dimColor>
                {a.timestamp.slice(0, 16).replace("T", " ")} | {a.individualAnalyses.length} models | {a.peerRankings.length} reviews
              </Text>
            </Box>
          </Box>
        );
      })}

      {/* Pipeline overview */}
      <Box marginTop={1} flexDirection="column">
        <Text bold color="gray">Pipeline Stages</Text>
        {STAGE_LABELS.map((label, idx) => {
          const latest = analyses[0];
          let done = false;
          if (idx === 0) done = latest.individualAnalyses.length > 0;
          if (idx === 1) done = latest.peerRankings.length > 0;
          if (idx === 2) done = latest.synthesis.confidence > 0;
          return (
            <Box key={idx} marginLeft={2}>
              <Text color={done ? "green" : "gray"}>
                {done ? "[x]" : "[ ]"} {label}
              </Text>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

function AnalysisDetail({
  analysis,
  selectedIndex,
}: {
  analysis: CouncilAnalysis;
  selectedIndex: number;
}) {
  const synth = analysis.synthesis;

  return (
    <Box flexDirection="column" paddingY={1}>
      <Box marginBottom={1}>
        <Text bold>Council Analysis Detail</Text>
        <Text color="gray">  [Esc]back</Text>
      </Box>

      {/* Task goal */}
      <Box marginBottom={1}>
        <Text bold color="cyan">Goal: </Text>
        <Text>{analysis.taskGoal}</Text>
      </Box>

      {/* Synthesis summary */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold>Synthesis</Text>
        <Box marginLeft={2} flexDirection="column">
          <Box>
            <Text>Complexity: </Text>
            <Text color={COMPLEXITY_COLORS[synth.consensusComplexity] ?? "white"} bold>
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
              <Text color="cyan">{synth.recommendedProvider}</Text>
            </Box>
          )}
          {synth.consensusSkills.length > 0 && (
            <Box>
              <Text>Skills: </Text>
              <Text color="gray">{synth.consensusSkills.join(", ")}</Text>
            </Box>
          )}
          <Box>
            <Text>Approach: </Text>
            <Text>{synth.recommendedApproach}</Text>
          </Box>
          {synth.dissenting_views && synth.dissenting_views.length > 0 && (
            <Box flexDirection="column">
              <Text color="yellow">Dissenting Views:</Text>
              {synth.dissenting_views.map((v, i) => (
                <Text key={i} color="yellow" dimColor>  - {v}</Text>
              ))}
            </Box>
          )}
        </Box>
      </Box>

      {/* Individual model responses */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold>Model Responses ({analysis.individualAnalyses.length})</Text>
        {analysis.individualAnalyses.map((resp, idx) => {
          const isSelected = idx === selectedIndex;
          return (
            <Box key={idx} marginLeft={2} flexDirection="column">
              <Box>
                <Text color={isSelected ? "white" : "gray"}>
                  {isSelected ? "> " : "  "}
                </Text>
                <Text color={isSelected ? "white" : undefined} bold={isSelected}>
                  {resp.model}
                </Text>
                <Text color="gray"> | </Text>
                <Text color={COMPLEXITY_COLORS[resp.complexity] ?? "white"}>
                  {resp.complexity}
                </Text>
                <Text color="gray"> | {resp.estimatedDurationMinutes}min</Text>
                {resp.suggestedProvider && (
                  <Text color="cyan"> @{resp.suggestedProvider}</Text>
                )}
              </Box>
              {isSelected && (
                <Box marginLeft={4} flexDirection="column">
                  <Text>Approach: {resp.recommendedApproach}</Text>
                  <Text color="gray">Skills: {resp.requiredSkills.join(", ")}</Text>
                  {resp.risks.length > 0 && (
                    <Text color="yellow">Risks: {resp.risks.join("; ")}</Text>
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
                <Text color="gray">{(idx + 1).toString().padStart(2)}. </Text>
                <Text>{rank.model.padEnd(40)}</Text>
                <Text color="cyan">{"\u2588".repeat(barWidth)}</Text>
                <Text color="gray"> avg:{rank.averageRank.toFixed(2)} ({rank.rankCount} votes)</Text>
              </Box>
            );
          })}
        </Box>
      )}
    </Box>
  );
}
