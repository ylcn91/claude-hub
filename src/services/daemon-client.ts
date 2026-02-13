import { connect } from "net";
import { readFileSync, existsSync } from "fs";

function getHubDir(): string {
  return process.env.CLAUDE_HUB_DIR ?? `${process.env.HOME}/.claude-hub`;
}

function getSockPath(): string {
  return `${getHubDir()}/hub.sock`;
}

function getToken(account: string): string | null {
  try {
    return readFileSync(`${getHubDir()}/tokens/${account}.token`, "utf-8").trim();
  } catch {
    return null;
  }
}

interface DaemonMessage {
  id: string;
  from: string;
  to: string;
  type: "message" | "handoff";
  content: string;
  timestamp: string;
  read: boolean;
  context?: Record<string, string>;
}

export async function fetchUnreadMessages(account: string): Promise<DaemonMessage[]> {
  const token = getToken(account);
  if (!token) return [];

  const sockPath = getSockPath();
  if (!existsSync(sockPath)) return [];

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      try { socket.destroy(); } catch {}
      resolve([]);
    }, 2000);

    const socket = connect(sockPath, () => {
      socket.write(JSON.stringify({ type: "auth", account, token }) + "\n");
    });

    let step: "auth" | "read" = "auth";

    socket.on("data", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (step === "auth" && msg.type === "auth_ok") {
          step = "read";
          socket.write(JSON.stringify({ type: "read_messages" }) + "\n");
        } else if (step === "read" && msg.type === "result") {
          clearTimeout(timeout);
          socket.end();
          resolve(msg.messages ?? []);
        }
      } catch {}
    });

    socket.on("error", () => {
      clearTimeout(timeout);
      resolve([]);
    });
  });
}

export async function fetchUnreadCounts(accounts: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  // Fetch in parallel
  const results = await Promise.all(
    accounts.map(async (name) => {
      const msgs = await fetchUnreadMessages(name);
      return { name, count: msgs.length };
    })
  );
  for (const { name, count } of results) {
    counts.set(name, count);
  }
  return counts;
}
