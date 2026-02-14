import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { existsSync, readFileSync } from "fs";
import { createConnection } from "net";
import { createLineParser, generateRequestId, frameSend } from "../daemon/framing.js";
import { getSockPath, getTokensDir } from "../paths.js";
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

interface DelegationChainData {
  id: string;
  taskId: string;
  chain: string[];
  timestamp: string;
  maxDepth: number;
  blocked: boolean;
  blockReason?: string;
}

/**
 * Query the daemon's activity store for DELEGATION_CHAIN events.
 * Falls back to empty if no daemon is running.
 */
async function queryDelegationChains(): Promise<DelegationChainData[]> {
  const sockPath = getSockPath();
  if (!existsSync(sockPath)) return [];

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      socket.destroy();
      resolve([]);
    }, 3000);

    const socket = createConnection(sockPath);

    socket.on("error", () => {
      clearTimeout(timeout);
      resolve([]);
    });

    const parser = createLineParser((msg: any) => {
      if (msg.type === "result" && msg.events) {
        clearTimeout(timeout);
        socket.destroy();
        const maxDepth = DEFAULT_DELEGATION_DEPTH_CONFIG.maxDepth;
        const chains: DelegationChainData[] = msg.events.map((e: any) => {
          const chain: string[] = e.metadata?.chain ?? [];
          const depth = Math.max(0, chain.length - 1);
          return {
            id: e.id,
            taskId: e.taskId ?? e.metadata?.taskId ?? "unknown",
            chain,
            timestamp: e.timestamp,
            maxDepth,
            blocked: depth >= maxDepth,
            blockReason:
              depth >= maxDepth
                ? `Depth ${depth} exceeds max ${maxDepth}`
                : undefined,
          };
        });
        resolve(chains);
      }
    });

    socket.on("data", (data) => parser.feed(data));

    socket.on("connect", () => {
      const tokensDir = getTokensDir();
      try {
        const files = require("fs").readdirSync(tokensDir);
        const tokenFile = files.find((f: string) => f.endsWith(".token"));
        if (!tokenFile) {
          clearTimeout(timeout);
          socket.destroy();
          resolve([]);
          return;
        }
        const account = tokenFile.replace(".token", "");
        const token = readFileSync(`${tokensDir}/${tokenFile}`, "utf-8").trim();
        const authId = generateRequestId();
        socket.write(
          frameSend({ type: "auth", account, token, requestId: authId }),
        );

        const authParser = createLineParser((authMsg: any) => {
          if (authMsg.type === "auth_ok") {
            const reqId = generateRequestId();
            socket.write(
              frameSend({
                type: "query_activity",
                activityType: "delegation_chain",
                limit: 50,
                requestId: reqId,
              }),
            );
          }
        });
        socket.removeAllListeners("data");
        socket.on("data", (data) => {
          authParser.feed(data);
          parser.feed(data);
        });
      } catch {
        clearTimeout(timeout);
        socket.destroy();
        resolve([]);
      }
    });
  });
}

function depthColor(
  depth: number,
  maxDepth: number,
  blocked: boolean,
): string {
  if (blocked) return "red";
  if (depth >= maxDepth - 1) return "yellow";
  return "green";
}

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

export function DelegationChain({ onNavigate }: Props) {
  const [chains, setChains] = useState<DelegationChainData[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setRefreshTick((prev) => prev + 1);
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    async function load() {
      try {
        const data = await queryDelegationChains();
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
    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1));
    } else if (key.downArrow) {
      setSelectedIndex((i) => Math.min(chains.length - 1, i + 1));
    } else if (input === "r") {
      setRefreshTick((prev) => prev + 1);
    } else if (key.escape) {
      onNavigate("dashboard");
    }
  });

  if (loading) return <Text color="gray">Loading delegation chains...</Text>;

  const maxDepth = DEFAULT_DELEGATION_DEPTH_CONFIG.maxDepth;
  const blockedCount = chains.filter((c) => c.blocked).length;

  return (
    <Box flexDirection="column" paddingY={1}>
      <Box marginBottom={1}>
        <Text bold>Delegation Chains</Text>
        <Text color="gray">  [r]efresh [up/down]navigate [Esc]back  </Text>
        <Text>{chains.length} chains</Text>
        <Text color="gray"> | </Text>
        <Text>max depth: {maxDepth}</Text>
        {blockedCount > 0 && (
          <>
            <Text color="gray"> | </Text>
            <Text color="red">{blockedCount} blocked</Text>
          </>
        )}
      </Box>

      {chains.length === 0 ? (
        <Text color="gray">
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
                <Text color={idx === selectedIndex ? "white" : "gray"}>
                  {idx === selectedIndex ? "> " : "  "}
                </Text>
                <Text bold={idx === selectedIndex}>
                  task: {c.taskId.slice(0, 12)}
                </Text>
                {c.blocked && <Text color="red"> BLOCKED</Text>}
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
                    <Text color="gray">
                      {ni === 0 ? "" : padding}
                      {prefix}
                    </Text>
                    <Text color={color}>
                      {node.agent}
                    </Text>
                    <Text color="gray">
                      {" "}(depth {node.depth}/{c.maxDepth})
                    </Text>
                    {node.blocked && node.blockReason && (
                      <Text color="red"> - {node.blockReason}</Text>
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
}
