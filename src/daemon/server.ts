import { createServer, type Server } from "net";
import { existsSync, unlinkSync, writeFileSync, readFileSync, mkdirSync } from "fs";
import { DaemonState } from "./state";

function getHubDir(): string {
  return process.env.CLAUDE_HUB_DIR ?? `${process.env.HOME}/.claude-hub`;
}

function getSockPath(): string {
  return `${getHubDir()}/hub.sock`;
}

function getPidPath(): string {
  return `${getHubDir()}/daemon.pid`;
}

function getTokensDir(): string {
  return `${getHubDir()}/tokens`;
}

function getMessagesDir(): string {
  return `${getHubDir()}/messages`;
}

export function verifyAccountToken(account: string, token: string): boolean {
  const tokenPath = `${getTokensDir()}/${account}.token`;
  try {
    const stored = readFileSync(tokenPath, "utf-8").trim();
    return stored === token;
  } catch {
    return false;
  }
}

export function startDaemon(): { server: Server; state: DaemonState } {
  const state = new DaemonState();
  const sockPath = getSockPath();
  const messagesDir = getMessagesDir();

  // Ensure messages dir exists for persistence
  mkdirSync(messagesDir, { recursive: true });

  // Persist handoff messages to disk
  state.onMessagePersist = async (msg) => {
    if (msg.type === "handoff" && msg.id) {
      await Bun.write(
        `${messagesDir}/${msg.id}.json`,
        JSON.stringify(msg, null, 2)
      );
    }
  };

  // Cleanup orphaned socket
  if (existsSync(sockPath)) unlinkSync(sockPath);

  const server = createServer((socket) => {
    let authenticated = false;
    let accountName = "";

    socket.on("data", (data) => {
      try {
        const msg = JSON.parse(data.toString());

        // First message must be auth handshake
        if (!authenticated) {
          if (msg.type === "auth" && msg.account && msg.token) {
            if (verifyAccountToken(msg.account, msg.token)) {
              authenticated = true;
              accountName = msg.account;
              state.connectAccount(accountName, msg.token);
              socket.write(JSON.stringify({ type: "auth_ok" }) + "\n");
            } else {
              socket.write(JSON.stringify({ type: "auth_fail", error: "Invalid token" }) + "\n");
              socket.end();
            }
          }
          return;
        }

        // Handle message types
        if (msg.type === "send_message") {
          state.addMessage({
            from: accountName,
            to: msg.to,
            type: "message",
            content: msg.content,
            timestamp: new Date().toISOString(),
          });
          socket.write(JSON.stringify({ type: "result", delivered: state.isConnected(msg.to), queued: true }) + "\n");
        }

        if (msg.type === "read_messages") {
          const messages = state.getUnreadMessages(accountName);
          state.markAllRead(accountName);
          socket.write(JSON.stringify({ type: "result", messages }) + "\n");
        }

        if (msg.type === "list_accounts") {
          const accounts = state.getConnectedAccounts().map((name) => ({
            name,
            status: "active" as const,
          }));
          socket.write(JSON.stringify({ type: "result", accounts }) + "\n");
        }

        if (msg.type === "handoff_task") {
          const handoffMsg = {
            from: accountName,
            to: msg.to,
            type: "handoff" as const,
            content: msg.task,
            timestamp: new Date().toISOString(),
            context: msg.context ?? {},
          };
          state.addMessage(handoffMsg);
          const lastMsg = state.getMessages(msg.to).at(-1);
          socket.write(JSON.stringify({
            type: "result",
            delivered: state.isConnected(msg.to),
            queued: true,
            handoffId: lastMsg?.id ?? "",
          }) + "\n");
        }
      } catch { /* ignore malformed messages */ }
    });

    socket.on("close", () => {
      if (accountName) state.disconnectAccount(accountName);
    });
  });

  server.listen(sockPath, () => {
    writeFileSync(getPidPath(), String(process.pid));
  });

  return { server, state };
}

export function stopDaemon(server: Server): void {
  server.close();
  try { unlinkSync(getSockPath()); } catch {}
  try { unlinkSync(getPidPath()); } catch {}
}

export function stopDaemonByPid(): void {
  const pidPath = getPidPath();
  try {
    const pid = parseInt(readFileSync(pidPath, "utf-8").trim(), 10);
    process.kill(pid, "SIGTERM");
    console.log(`Sent SIGTERM to daemon (pid ${pid})`);
  } catch {
    console.log("No running daemon found");
  }
}
