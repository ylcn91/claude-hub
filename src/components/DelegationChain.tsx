import { useState, useEffect, useContext, memo } from "react";
import { Box, Text, useInput } from "ink";
import { NavContext } from "../app.js";
import { useTheme } from "../themes/index.js";
import { fetchDelegationChains, type DelegationChainData } from "../services/delegation-chain-loader.js";
import { DEFAULT_DELEGATION_DEPTH_CONFIG } from "../services/delegation-depth.js";

const REFRESH_INTERVAL_MS = 10_000;

interface Props {
  onNavigate: (view: string) => void;
}

interface DelegationNode {
  agent: string;
  depth: number;
  taskId?: string;
  blocked?: boolean;
  blockReason?: string;
}

// depthColor moved inside component to use theme

function renderTree(chain: string[], maxDepth: number, blocked: boolean): DelegationNode[] {
  return chain.map((agent, i) => ({
    agent,
    depth: i,
    blocked: blocked && i === chain.length - 1,
    blockReason:
      blocked && i === chain.length - 1
        ? `Depth ${i} at limit (max ${maxDepth})`
        : undefined,
  }));
}

export const DelegationChain = memo(function DelegationChain({ onNavigate }: Props) {
  const { colors } = useTheme();
  const [chains, setChains] = useState<DelegationChainData[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [refreshTick, setRefreshTick] = useState(0);
  const { refreshTick: globalRefresh } = useContext(NavContext);

  function depthColor(depth: number, maxDepth: number, blocked: boolean): string {
    if (blocked) return colors.error;
    if (depth >= maxDepth - 1) return colors.warning;
    return colors.success;
  }

  useEffect(() => {
    if (globalRefresh > 0) setRefreshTick((prev) => prev + 1);
  }, [globalRefresh]);

  useEffect(() => {
    const interval = setInterval(() => {
      setRefreshTick((prev) => prev + 1);
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    async function load() {
      try {
        const data = await fetchDelegationChains();
        setChains(data);
      } catch (e: any) {
        console.error("[delegation-chain]", e.message);
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
      setSelectedIndex((i) => Math.min(chains.length - 1, i + 1));
    } else if (input === "r") {
      setRefreshTick((prev) => prev + 1);
    } else if (key.escape) {
      onNavigate("dashboard");
    }
  });

  if (loading) return <Text color={colors.textMuted}>Loading delegation chains...</Text>;

  const maxDepth = DEFAULT_DELEGATION_DEPTH_CONFIG.maxDepth;
  const blockedCount = chains.filter((c) => c.blocked).length;

  return (
    <Box flexDirection="column" paddingY={1}>
      <Box marginBottom={1}>
        <Text bold>Delegation Chains</Text>
        <Text color={colors.textMuted}>  [r]efresh [up/down]navigate [Esc]back  </Text>
        <Text>{chains.length} chains</Text>
        <Text color={colors.textMuted}> | </Text>
        <Text>max depth: {maxDepth}</Text>
        {blockedCount > 0 && (
          <>
            <Text color={colors.textMuted}> | </Text>
            <Text color={colors.error}>{blockedCount} blocked</Text>
          </>
        )}
      </Box>

      {chains.length === 0 ? (
        <Text color={colors.textMuted}>
          No delegation chains recorded. Delegation events appear when agents
          hand off tasks to sub-agents.
        </Text>
      ) : (
        chains.map((c, idx) => {
          const nodes = renderTree(c.chain, c.maxDepth, c.blocked);
          return (
            <Box
              key={c.id}
              flexDirection="column"
              marginLeft={1}
              marginBottom={idx < chains.length - 1 ? 1 : 0}
            >
              <Box>
                <Text color={idx === selectedIndex ? colors.text : colors.textMuted}>
                  {idx === selectedIndex ? "> " : "  "}
                </Text>
                <Text bold={idx === selectedIndex}>
                  task: {c.taskId.slice(0, 12)}
                </Text>
                {c.blocked && <Text color={colors.error}> BLOCKED</Text>}
              </Box>
              {nodes.map((node, ni) => {
                const prefix = ni === 0 ? "" : "\u2514\u2500 ";
                const padding = ni === 0 ? "    " : "   ".repeat(node.depth - 1) + "    ";
                const color = depthColor(
                  node.depth,
                  c.maxDepth,
                  node.blocked ?? false,
                );
                return (
                  <Box key={ni} marginLeft={4}>
                    <Text color={colors.textMuted}>
                      {ni === 0 ? "" : padding}
                      {prefix}
                    </Text>
                    <Text color={color}>
                      {node.agent}
                    </Text>
                    <Text color={colors.textMuted}>
                      {" "}(depth {node.depth}/{c.maxDepth})
                    </Text>
                    {node.blocked && node.blockReason && (
                      <Text color={colors.error}> - {node.blockReason}</Text>
                    )}
                  </Box>
                );
              })}
            </Box>
          );
        })
      )}
    </Box>
  );
});
