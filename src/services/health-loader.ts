import { existsSync } from "fs";
import { readdir } from "node:fs/promises";
import { createConnection } from "net";
import { createLineParser, generateRequestId, frameSend } from "../daemon/framing.js";
import { getSockPath, getTokensDir } from "../paths.js";
import type { AccountHealth } from "../daemon/health-monitor.js";

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
 * Query the daemon for health status.
 * Falls back to empty if no daemon is running.
 */
export async function fetchHealthStatus(): Promise<AccountHealth[]> {
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
      if (msg.type === "result" && msg.accounts) {
        clearTimeout(timeout);
        socket.destroy();
        const accounts: AccountHealth[] = msg.accounts.map((a: any) => ({
          account: a.name,
          status: a.status,
          connected: a.connected,
          lastActivity: a.lastActivity,
          errorCount: a.errorCount ?? 0,
          rateLimited: a.rateLimited ?? false,
          slaViolations: a.slaViolations ?? 0,
          updatedAt: new Date().toISOString(),
        }));
        resolve(accounts);
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
            frameSend({ type: "health_status", requestId: reqId }),
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
