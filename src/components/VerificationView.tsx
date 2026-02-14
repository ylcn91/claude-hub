import { useState, useEffect, useContext } from "react";
import { Box, Text, useInput } from "ink";
import { NavContext } from "../app.js";
import { atomicRead } from "../services/file-store.js";
import { getHubDir } from "../paths.js";
import type { VerificationVerdict, VerificationResult } from "../services/verification-council.js";

interface Props {
  onNavigate: (view: string) => void;
}

const VERDICT_COLORS: Record<VerificationVerdict, string> = {
  ACCEPT: "green",
  REJECT: "red",
  ACCEPT_WITH_NOTES: "yellow",
};

const VERDICT_LABELS: Record<VerificationVerdict, string> = {
  ACCEPT: "PASS",
  REJECT: "FAIL",
  ACCEPT_WITH_NOTES: "WARN",
};

function confidenceColor(c: number): string {
  if (c >= 0.8) return "green";
  if (c >= 0.5) return "yellow";
  return "red";
}

function getVerificationCachePath(): string {
  return `${getHubDir()}/verification-results.json`;
}

interface VerificationCache {
  results: VerificationResult[];
}

export function VerificationView({ onNavigate }: Props) {
  const [results, setResults] = useState<VerificationResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [detailView, setDetailView] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const { refreshTick: globalRefresh } = useContext(NavContext);

  useEffect(() => {
    if (globalRefresh > 0) setRefreshTick((prev) => prev + 1);
  }, [globalRefresh]);

  useEffect(() => {
    async function load() {
      try {
        const cache = await atomicRead<VerificationCache>(getVerificationCachePath());
        if (cache && Array.isArray(cache.results)) {
          setResults(cache.results);
        }
      } catch (e: any) {
        console.error("[verification-view]", e.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [refreshTick]);

  useInput((input, key) => {
    if (key.upArrow || input === "k") {
      setSelectedIndex((i) => Math.max(0, i - 1));
    } else if (key.downArrow || input === "j") {
      const max = detailView
        ? (results[selectedIndex]?.individualReviews.length ?? 1) - 1
        : results.length - 1;
      setSelectedIndex((i) => Math.min(max, i + 1));
    } else if (key.return) {
      if (!detailView && results.length > 0) {
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

  if (loading) return <Text color="gray">Loading verification results...</Text>;

  if (results.length === 0) {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Box marginBottom={1}>
          <Text bold>Verification View</Text>
          <Text color="gray">  [r]efresh [Esc]back</Text>
        </Box>
        <Text color="gray">No verification results found.</Text>
        <Text color="gray" dimColor>
          Verified tasks will appear here after council review.
        </Text>
      </Box>
    );
  }

  if (detailView) {
    const result = results[selectedIndex] ?? results[0];
    return <VerificationDetail result={result} selectedIndex={selectedIndex} />;
  }

  return (
    <Box flexDirection="column" paddingY={1}>
      <Box marginBottom={1}>
        <Text bold>Verification View</Text>
        <Text color="gray">  [Enter]detail [r]efresh [Esc]back</Text>
      </Box>

      {results.map((result, idx) => {
        const isSelected = idx === selectedIndex;
        return (
          <Box key={idx} marginLeft={1}>
            <Text color={isSelected ? "white" : "gray"}>
              {isSelected ? "> " : "  "}
            </Text>
            <Text color={VERDICT_COLORS[result.verdict]} bold>
              [{VERDICT_LABELS[result.verdict]}]
            </Text>
            <Text> </Text>
            <Text color={isSelected ? "white" : undefined}>
              {result.receipt.taskId}
            </Text>
            <Text color="gray"> | </Text>
            <Text color={confidenceColor(result.confidence)}>
              {(result.confidence * 100).toFixed(0)}%
            </Text>
            <Text color="gray">
              {" "}| {result.individualReviews.length} reviews
            </Text>
            <Text color="gray" dimColor>
              {" "}| {result.receipt.timestamp.slice(0, 16).replace("T", " ")}
            </Text>
          </Box>
        );
      })}

      {/* Summary stats */}
      <Box marginTop={1} flexDirection="column">
        <Text bold color="gray">Summary</Text>
        <Box marginLeft={2}>
          <Text color="green">
            {results.filter((r) => r.verdict === "ACCEPT").length} accepted
          </Text>
          <Text color="gray"> | </Text>
          <Text color="yellow">
            {results.filter((r) => r.verdict === "ACCEPT_WITH_NOTES").length} with notes
          </Text>
          <Text color="gray"> | </Text>
          <Text color="red">
            {results.filter((r) => r.verdict === "REJECT").length} rejected
          </Text>
        </Box>
      </Box>
    </Box>
  );
}

function VerificationDetail({
  result,
  selectedIndex,
}: {
  result: VerificationResult;
  selectedIndex: number;
}) {
  return (
    <Box flexDirection="column" paddingY={1}>
      <Box marginBottom={1}>
        <Text bold>Verification Detail</Text>
        <Text color="gray">  [Esc]back</Text>
      </Box>

      {/* Verdict header */}
      <Box marginBottom={1}>
        <Text bold>Verdict: </Text>
        <Text color={VERDICT_COLORS[result.verdict]} bold>
          {result.verdict}
        </Text>
        <Text color="gray"> | Confidence: </Text>
        <Text color={confidenceColor(result.confidence)}>
          {(result.confidence * 100).toFixed(0)}%
        </Text>
      </Box>

      {/* Chairman reasoning */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold>Chairman Reasoning</Text>
        <Box marginLeft={2}>
          <Text>{result.chairmanReasoning}</Text>
        </Box>
      </Box>

      {/* Notes */}
      {result.notes.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold>Notes</Text>
          {result.notes.map((note, i) => (
            <Box key={i} marginLeft={2}>
              <Text color="yellow">- {note}</Text>
            </Box>
          ))}
        </Box>
      )}

      {/* Individual reviews */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold>Individual Reviews ({result.individualReviews.length})</Text>
        {result.individualReviews.map((review, idx) => {
          const isSelected = idx === selectedIndex;
          return (
            <Box key={idx} marginLeft={2} flexDirection="column">
              <Box>
                <Text color={isSelected ? "white" : "gray"}>
                  {isSelected ? "> " : "  "}
                </Text>
                <Text color={VERDICT_COLORS[review.verdict]} bold>
                  [{VERDICT_LABELS[review.verdict]}]
                </Text>
                <Text> </Text>
                <Text color={isSelected ? "white" : undefined} bold={isSelected}>
                  {review.model}
                </Text>
                <Text color="gray"> | </Text>
                <Text color={confidenceColor(review.confidence)}>
                  {(review.confidence * 100).toFixed(0)}%
                </Text>
              </Box>
              {isSelected && (
                <Box marginLeft={4} flexDirection="column">
                  <Text>{review.reasoning}</Text>
                  {review.strengths.length > 0 && (
                    <Box flexDirection="column">
                      <Text color="green">Strengths:</Text>
                      {review.strengths.map((s, i) => (
                        <Text key={i} color="green" dimColor>  + {s}</Text>
                      ))}
                    </Box>
                  )}
                  {review.issues.length > 0 && (
                    <Box flexDirection="column">
                      <Text color="red">Issues:</Text>
                      {review.issues.map((s, i) => (
                        <Text key={i} color="red" dimColor>  - {s}</Text>
                      ))}
                    </Box>
                  )}
                </Box>
              )}
            </Box>
          );
        })}
      </Box>

      {/* Peer evaluations */}
      {result.peerEvaluations.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold>Peer Evaluations ({result.peerEvaluations.length})</Text>
          {result.peerEvaluations.map((pe, idx) => (
            <Box key={idx} marginLeft={2} flexDirection="column">
              <Box>
                <Text color="gray">  </Text>
                <Text>{pe.reviewer}</Text>
                <Text color="gray"> ranked: [{pe.ranking.join(", ")}]</Text>
              </Box>
              <Box marginLeft={4}>
                <Text color="gray" dimColor>{pe.reasoning}</Text>
              </Box>
            </Box>
          ))}
        </Box>
      )}

      {/* Receipt */}
      <Box flexDirection="column">
        <Text bold>Receipt</Text>
        <Box marginLeft={2} flexDirection="column">
          <Box>
            <Text color="gray">Task ID:      </Text>
            <Text>{result.receipt.taskId}</Text>
          </Box>
          <Box>
            <Text color="gray">Spec Hash:    </Text>
            <Text color="cyan">{result.receipt.specHash.slice(0, 16)}...</Text>
          </Box>
          <Box>
            <Text color="gray">Evidence Hash: </Text>
            <Text color="cyan">{result.receipt.evidenceHash.slice(0, 16)}...</Text>
          </Box>
          <Box>
            <Text color="gray">Timestamp:    </Text>
            <Text>{result.receipt.timestamp}</Text>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
