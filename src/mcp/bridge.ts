import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createConnection, type Socket } from "net";
import { readFileSync } from "fs";
import { registerTools, type DaemonSender } from "./tools";

const HUB_DIR = process.env.CLAUDE_HUB_DIR ?? `${process.env.HOME}/.claude-hub`;
const DAEMON_SOCK_PATH = `${HUB_DIR}/hub.sock`;
const TOKENS_DIR = `${HUB_DIR}/tokens`;

function getToken(account: string): string {
  return readFileSync(`${TOKENS_DIR}/${account}.token`, "utf-8").trim();
}

function createDaemonSender(socket: Socket): DaemonSender {
  return (msg: object) =>
    new Promise((resolve) => {
      socket.once("data", (data) => {
        resolve(JSON.parse(data.toString().trim()));
      });
      socket.write(JSON.stringify(msg) + "\n");
    });
}

export async function startBridge(account: string): Promise<void> {
  // Connect to daemon
  const daemonSocket = createConnection(DAEMON_SOCK_PATH);

  await new Promise<void>((resolve, reject) => {
    daemonSocket.once("connect", () => {
      // Authenticate
      const token = getToken(account);
      daemonSocket.write(JSON.stringify({ type: "auth", account, token }) + "\n");
    });

    daemonSocket.once("data", (data) => {
      const resp = JSON.parse(data.toString().trim());
      if (resp.type === "auth_ok") resolve();
      else reject(new Error(resp.error ?? "Auth failed"));
    });

    daemonSocket.once("error", reject);
  });

  // Start MCP server on stdio
  const mcpServer = new McpServer(
    { name: "claude-hub", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  const sendToDaemon = createDaemonSender(daemonSocket);
  registerTools(mcpServer, sendToDaemon, account);

  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
}
