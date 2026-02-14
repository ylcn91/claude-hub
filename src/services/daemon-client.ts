import { connect } from "net";
import { readFileSync, existsSync } from "fs";
import { createLineParser, generateRequestId, frameSend } from "../daemon/framing";

import { getHubDir, getSockPath } from "../paths";


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

    const pending = new Map<string, { resolve: Function }>();

    const socket = connect(sockPath, () => {
      const authId = generateRequestId();
      pending.set(authId, {
        resolve: (msg: any) => {
          if (msg.type === "auth_ok") {
            const readId = generateRequestId();
            pending.set(readId, {
              resolve: (readMsg: any) => {
                clearTimeout(timeout);
                socket.end();
                resolve(readMsg.messages ?? []);
              },
            });
            socket.write(frameSend({ type: "read_messages", requestId: readId }));
          } else {
            clearTimeout(timeout);
            socket.end();
            resolve([]);
          }
        },
      });
      socket.write(frameSend({ type: "auth", account, token, requestId: authId }));
    });

    const parser = createLineParser((msg) => {
      if (msg.requestId && pending.has(msg.requestId)) {
        const entry = pending.get(msg.requestId)!;
        pending.delete(msg.requestId);
        entry.resolve(msg);
      }
    });

    socket.on("data", (data) => parser.feed(data));

    socket.on("error", () => {
      clearTimeout(timeout);
      resolve([]);
    });
  });
}

export async function fetchUnreadCount(account: string): Promise<number> {
  const token = getToken(account);
  if (!token) return 0;

  const sockPath = getSockPath();
  if (!existsSync(sockPath)) return 0;

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      try { socket.destroy(); } catch {}
      resolve(0);
    }, 2000);

    const pending = new Map<string, { resolve: Function }>();

    const socket = connect(sockPath, () => {
      const authId = generateRequestId();
      pending.set(authId, {
        resolve: (msg: any) => {
          if (msg.type === "auth_ok") {
            const countId = generateRequestId();
            pending.set(countId, {
              resolve: (countMsg: any) => {
                clearTimeout(timeout);
                socket.end();
                resolve(countMsg.count ?? 0);
              },
            });
            socket.write(frameSend({ type: "count_unread", requestId: countId }));
          } else {
            clearTimeout(timeout);
            socket.end();
            resolve(0);
          }
        },
      });
      socket.write(frameSend({ type: "auth", account, token, requestId: authId }));
    });

    const parser = createLineParser((msg) => {
      if (msg.requestId && pending.has(msg.requestId)) {
        const entry = pending.get(msg.requestId)!;
        pending.delete(msg.requestId);
        entry.resolve(msg);
      }
    });

    socket.on("data", (data) => parser.feed(data));

    socket.on("error", () => {
      clearTimeout(timeout);
      resolve(0);
    });
  });
}

export async function fetchUnreadCounts(accounts: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const results = await Promise.all(
    accounts.map(async (name) => {
      const count = await fetchUnreadCount(name);
      return { name, count };
    })
  );
  for (const { name, count } of results) {
    counts.set(name, count);
  }
  return counts;
}

export async function fetchActiveSession(account: string): Promise<{ initiator: string; participant: string } | null> {
  const token = getToken(account);
  if (!token) return null;

  const sockPath = getSockPath();
  if (!existsSync(sockPath)) return null;

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      try { socket.destroy(); } catch {}
      resolve(null);
    }, 2000);

    const pending = new Map<string, { resolve: Function }>();

    const socket = connect(sockPath, () => {
      const authId = generateRequestId();
      pending.set(authId, {
        resolve: (msg: any) => {
          if (msg.type === "auth_ok") {
            const statusId = generateRequestId();
            pending.set(statusId, {
              resolve: (statusMsg: any) => {
                clearTimeout(timeout);
                socket.end();
                resolve(statusMsg.session ?? null);
              },
            });
            socket.write(frameSend({ type: "session_status", requestId: statusId }));
          } else {
            clearTimeout(timeout);
            socket.end();
            resolve(null);
          }
        },
      });
      socket.write(frameSend({ type: "auth", account, token, requestId: authId }));
    });

    const parser = createLineParser((msg) => {
      if (msg.requestId && pending.has(msg.requestId)) {
        const entry = pending.get(msg.requestId)!;
        pending.delete(msg.requestId);
        entry.resolve(msg);
      }
    });

    socket.on("data", (data) => parser.feed(data));

    socket.on("error", () => {
      clearTimeout(timeout);
      resolve(null);
    });
  });
}

export async function fetchPairedSessions(accounts: string[]): Promise<Map<string, string>> {
  const paired = new Map<string, string>();
  const results = await Promise.all(
    accounts.map(async (name) => {
      const session = await fetchActiveSession(name);
      return { name, session };
    })
  );
  for (const { name, session } of results) {
    if (session) {
      const partner = session.initiator === name ? session.participant : session.initiator;
      paired.set(name, partner);
    }
  }
  return paired;
}
