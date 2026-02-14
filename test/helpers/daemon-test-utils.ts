// Integration test helpers for daemon lifecycle
// Provides utilities for starting a test daemon, authenticating, and sending messages
// over the Unix socket protocol (newline-delimited JSON).

import { createConnection, type Socket } from "net";
import { join } from "path";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { startDaemon, stopDaemon, type DaemonOpts } from "../../src/daemon/server";
import { createLineParser, frameSend } from "../../src/daemon/framing";
import type { DaemonState } from "../../src/daemon/state";
import type { Server } from "net";

let dbCounter = 0;
function uniqueDbPath(dir: string): string {
  return join(dir, `test-${++dbCounter}-${Date.now()}.db`);
}

export interface TestDaemon {
  server: Server;
  state: DaemonState;
  sockPath: string;
  testDir: string;
  watchdog?: { stop: () => void };
  sessionCleanupTimer?: ReturnType<typeof setInterval>;
  cleanup: () => void;
}

export interface StartTestDaemonOpts {
  features?: DaemonOpts["features"];
  accounts?: Array<{ name: string; token: string }>;
}

/**
 * Start a test daemon with AGENTCTL_DIR pointing to testDir.
 * Creates required subdirectories (tokens/, messages/).
 * Returns a handle with server, state, sockPath, and a cleanup function.
 *
 * Call `cleanup()` in afterEach to tear down the daemon and remove testDir.
 */
export async function startTestDaemon(testDir: string, opts?: StartTestDaemonOpts): Promise<TestDaemon> {
  const originalDir = process.env.AGENTCTL_DIR;
  process.env.AGENTCTL_DIR = testDir;

  mkdirSync(join(testDir, "tokens"), { recursive: true });
  mkdirSync(join(testDir, "messages"), { recursive: true });

  // Create token files for any pre-configured accounts
  if (opts?.accounts) {
    for (const acct of opts.accounts) {
      writeFileSync(join(testDir, "tokens", `${acct.name}.token`), acct.token);
    }
  }

  const result = await startDaemon({
    dbPath: uniqueDbPath(testDir),
    features: opts?.features,
  });

  const cleanup = () => {
    process.env.AGENTCTL_DIR = originalDir;
    try { result.state.close(); } catch {}
    try { stopDaemon(result.server, result.sockPath, result.watchdog, result.sessionCleanupTimer); } catch {}
    rmSync(testDir, { recursive: true, force: true });
  };

  return {
    server: result.server,
    state: result.state,
    sockPath: result.sockPath,
    testDir,
    watchdog: result.watchdog,
    sessionCleanupTimer: result.sessionCleanupTimer,
    cleanup,
  };
}

/**
 * Create a token file for an account in the test directory.
 * Use this to add accounts after the daemon has started.
 */
export function createTestToken(testDir: string, account: string, token?: string): string {
  const tok = token ?? `${account}-secret-${Date.now()}`;
  mkdirSync(join(testDir, "tokens"), { recursive: true });
  writeFileSync(join(testDir, "tokens", `${account}.token`), tok);
  return tok;
}

/**
 * Connect to the daemon Unix socket and authenticate.
 * Returns the connected + authenticated socket.
 * Rejects if auth fails or connection errors.
 */
export function connectAndAuth(
  sockPath: string,
  account: string,
  token: string,
): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const client = createConnection(sockPath, () => {
      client.write(frameSend({ type: "auth", account, token }));
    });

    const timeout = setTimeout(() => {
      client.destroy();
      reject(new Error("connectAndAuth timed out after 5s"));
    }, 5000);

    client.once("data", (data) => {
      clearTimeout(timeout);
      try {
        const msg = JSON.parse(data.toString().trim());
        if (msg.type === "auth_ok") {
          resolve(client);
        } else {
          client.destroy();
          reject(new Error(`Auth failed: ${msg.error ?? msg.type}`));
        }
      } catch (e: any) {
        client.destroy();
        reject(new Error(`Failed to parse auth response: ${e.message}`));
      }
    });

    client.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

/**
 * Send a JSON message over the socket and wait for the response.
 * Uses the NDJSON framing protocol. Optionally attaches a requestId
 * for correlation (recommended when multiple messages are in flight).
 *
 * Returns the parsed response object.
 */
export function sendAndWait(socket: Socket, message: Record<string, unknown>): Promise<any> {
  return new Promise((resolve, reject) => {
    const requestId = message.requestId ?? crypto.randomUUID();
    const framedMsg = { ...message, requestId };

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`sendAndWait timed out after 5s for message type: ${message.type}`));
    }, 5000);

    let buffer = "";

    const onData = (data: Buffer) => {
      buffer += data.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop()!;

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed);
          // Match by requestId if present, otherwise accept any response
          if (parsed.requestId === requestId || !message.requestId) {
            cleanup();
            resolve(parsed);
            return;
          }
        } catch {
          // skip invalid JSON
        }
      }
    };

    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };

    const cleanup = () => {
      clearTimeout(timeout);
      socket.removeListener("data", onData);
      socket.removeListener("error", onError);
    };

    socket.on("data", onData);
    socket.on("error", onError);
    socket.write(frameSend(framedMsg));
  });
}

/**
 * Convenience: connect, auth, send a single message, get response, disconnect.
 * Useful for one-shot requests in tests.
 */
export async function sendOneShot(
  sockPath: string,
  account: string,
  token: string,
  message: Record<string, unknown>,
): Promise<any> {
  const socket = await connectAndAuth(sockPath, account, token);
  try {
    return await sendAndWait(socket, message);
  } finally {
    socket.destroy();
  }
}

/**
 * Wait for the daemon socket to be ready for connections.
 * Useful right after startTestDaemon to avoid race conditions.
 */
export async function waitForSocket(sockPath: string, maxMs = 2000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const ok = await new Promise<boolean>((resolve) => {
      const client = createConnection(sockPath, () => {
        client.destroy();
        resolve(true);
      });
      client.on("error", () => resolve(false));
    });
    if (ok) return;
    await Bun.sleep(20);
  }
  throw new Error(`Socket ${sockPath} not ready after ${maxMs}ms`);
}
