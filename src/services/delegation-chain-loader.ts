import { existsSync } from "fs";
import { readdir } from "node:fs/promises";
import { createConnection } from "net";
import { createLineParser, generateRequestId, frameSend } from "../daemon/framing.js";
import { getSockPath, getTokensDir } from "../paths.js";
import { DEFAULT_DELEGATION_DEPTH_CONFIG } from "./delegation-depth.js";

export interface DelegationChainData {
  id: string;
  taskId: string;
  chain: string[];
  timestamp: string;
  maxDepth: number;
  blocked: boolean;
  blockReason?: string;
}

/**
 * Read the first .token file from the tokens directory (async).
 * Returns { account, token } or null if none found.
 */
async function readFirstToken(
  tokensDir: string,
): Promise<{ account: string; token: string } | null> {
  try {
    const files = await readdir(tokensDir);
    const tokenFile = files.find((f) => f.endsWith(".token"));
    if (!tokenFile) return null;
    const account = tokenFile.replace(".token", "");
    const token = await Bun.file(`${tokensDir}/${tokenFile}`).text();
    return { account, token: token.trim() };
  } catch {
    return null;
  }
}

/**
 * Query the daemon's activity store for DELEGATION_CHAIN events.
 * Falls back to empty if no daemon is running.
 */
export async function fetchDelegationChains(): Promise<DelegationChainData[]> {
  const sockPath = getSockPath();
  if (!existsSync(sockPath)) return [];

  const tokensDir = getTokensDir();
  const creds = await readFirstToken(tokensDir);
  if (!creds) return [];

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
      const authId = generateRequestId();
      socket.write(
        frameSend({
          type: "auth",
          account: creds.account,
          token: creds.token,
          requestId: authId,
        }),
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
    });
  });
}
