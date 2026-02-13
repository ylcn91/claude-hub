import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createConnection, type Socket } from "net";
import { readFileSync, existsSync } from "fs";
import { spawn } from "child_process";
import { registerTools, type DaemonSender } from "./tools";
import { createLineParser, generateRequestId, frameSend } from "../daemon/framing";

const HUB_DIR = process.env.CLAUDE_HUB_DIR ?? `${process.env.HOME}/.claude-hub`;
const DAEMON_SOCK_PATH = `${HUB_DIR}/hub.sock`;
const DAEMON_PID_PATH = `${HUB_DIR}/daemon.pid`;
const TOKENS_DIR = `${HUB_DIR}/tokens`;

function getToken(account: string): string {
  return readFileSync(`${TOKENS_DIR}/${account}.token`, "utf-8").trim();
}

function createDaemonSender(socket: Socket): DaemonSender {
  const pending = new Map<string, { resolve: Function; reject: Function; timer: ReturnType<typeof setTimeout> }>();

  const parser = createLineParser((msg) => {
    if (msg.requestId && pending.has(msg.requestId)) {
      const entry = pending.get(msg.requestId)!;
      clearTimeout(entry.timer);
      pending.delete(msg.requestId);
      entry.resolve(msg);
    }
  });

  socket.on("data", (data) => parser.feed(data));

  return (msg: object) =>
    new Promise((resolve, reject) => {
      const requestId = generateRequestId();
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error("Request timed out (5s)"));
      }, 5000);
      pending.set(requestId, { resolve, reject, timer });
      socket.write(frameSend({ ...msg, requestId }));
    });
}

function isDaemonRunning(): boolean {
  if (!existsSync(DAEMON_PID_PATH)) return false;
  try {
    const pid = parseInt(readFileSync(DAEMON_PID_PATH, "utf-8").trim(), 10);
    // process.kill with signal 0 checks if process exists without killing it
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDaemonRunning(): Promise<void> {
  if (isDaemonRunning() && existsSync(DAEMON_SOCK_PATH)) return;

  // Spawn daemon as a detached background process
  const daemonScript = new URL("../daemon/index.ts", import.meta.url).pathname;
  const child = spawn("bun", [daemonScript], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env },
  });
  child.unref();

  // Wait up to 3 seconds for hub.sock to appear
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (existsSync(DAEMON_SOCK_PATH)) return;
    await new Promise((r) => setTimeout(r, 100));
  }

  throw new Error("Daemon failed to start within 3 seconds");
}

export async function startBridge(account: string): Promise<void> {
  // Auto-start daemon if not running
  await ensureDaemonRunning();

  // Connect to daemon
  const daemonSocket = createConnection(DAEMON_SOCK_PATH);

  // Mutable sender reference so reconnection can swap in a new socket
  let currentSender = createDaemonSender(daemonSocket);
  const sendToDaemon: DaemonSender = (msg) => currentSender(msg);

  await new Promise<void>((resolve, reject) => {
    daemonSocket.once("connect", async () => {
      try {
        const token = getToken(account);
        const resp = await sendToDaemon({ type: "auth", account, token });
        if (resp.type === "auth_ok") resolve();
        else reject(new Error(resp.error ?? "Auth failed"));
      } catch (err) {
        reject(err);
      }
    });

    daemonSocket.once("error", reject);
  });

  // Reconnection logic for daemon socket
  let reconnectAttempts = 0;
  const MAX_RECONNECT = 5;

  daemonSocket.on("close", () => {
    if (reconnectAttempts >= MAX_RECONNECT) {
      console.error("[bridge] Max reconnection attempts reached");
      return;
    }
    const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
    reconnectAttempts++;
    console.error(`[bridge] Connection lost, reconnecting in ${delay}ms (attempt ${reconnectAttempts}/${MAX_RECONNECT})`);
    setTimeout(async () => {
      try {
        await ensureDaemonRunning();
        const newSocket = createConnection(DAEMON_SOCK_PATH);
        newSocket.once("connect", async () => {
          try {
            const newSender = createDaemonSender(newSocket);
            const token = getToken(account);
            const resp = await newSender({ type: "auth", account, token });
            if (resp.type === "auth_ok") {
              currentSender = newSender;
              reconnectAttempts = 0;
              console.error("[bridge] Reconnected successfully");
            }
          } catch (err: any) {
            console.error("[bridge] Re-auth failed:", err.message);
          }
        });
      } catch (err: any) {
        console.error("[bridge] Reconnection failed:", err.message);
      }
    }, delay);
  });

  daemonSocket.on("error", (err) => {
    console.error("[bridge] Socket error:", err.message);
  });

  // Start MCP server on stdio
  const mcpServer = new McpServer(
    { name: "claude-hub", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  registerTools(mcpServer, sendToDaemon, account);

  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
}
