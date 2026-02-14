import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { createServer, type Server } from "net";
import { fetchUnreadMessages, fetchUnreadCounts } from "../src/services/daemon-client";

const TEST_DIR = join(import.meta.dir, ".test-inbox");
const origHubDir = process.env.AGENTCTL_DIR;

beforeEach(() => {
  process.env.AGENTCTL_DIR = TEST_DIR;
  mkdirSync(TEST_DIR, { recursive: true });
  mkdirSync(join(TEST_DIR, "tokens"), { recursive: true });
});

afterEach(() => {
  process.env.AGENTCTL_DIR = origHubDir;
  rmSync(TEST_DIR, { recursive: true, force: true });
});

function writeToken(account: string, token: string) {
  writeFileSync(join(TEST_DIR, "tokens", `${account}.token`), token);
}

function createMockDaemon(messages: any[]): Promise<{ server: Server; sockPath: string }> {
  return new Promise((resolve) => {
    const sockPath = join(TEST_DIR, "hub.sock");
    const server = createServer((socket) => {
      let buffer = "";
      socket.on("data", (data) => {
        buffer += data.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop()!;
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const msg = JSON.parse(trimmed);
            const rid = msg.requestId ? { requestId: msg.requestId } : {};
            if (msg.type === "auth") {
              socket.write(JSON.stringify({ type: "auth_ok", ...rid }) + "\n");
            } else if (msg.type === "read_messages") {
              socket.write(JSON.stringify({ type: "result", messages, ...rid }) + "\n");
            } else if (msg.type === "count_unread") {
              socket.write(JSON.stringify({ type: "result", count: messages.length, ...rid }) + "\n");
            }
          } catch {}
        }
      });
    });
    server.listen(sockPath, () => resolve({ server, sockPath }));
  });
}

describe("fetchUnreadMessages", () => {
  test("returns empty array when no token exists", async () => {
    const msgs = await fetchUnreadMessages("nonexistent");
    expect(msgs).toEqual([]);
  });

  test("returns empty array when daemon is not running", async () => {
    writeToken("test", "abc123");
    const msgs = await fetchUnreadMessages("test");
    expect(msgs).toEqual([]);
  });

  test("fetches messages from running daemon", async () => {
    writeToken("work", "tok123");
    const testMessages = [
      { id: "1", from: "admin", to: "work", type: "message", content: "Hello", timestamp: "2026-02-13T12:00:00Z", read: false },
      { id: "2", from: "admin", to: "work", type: "handoff", content: "Task for you", timestamp: "2026-02-13T12:01:00Z", read: false },
    ];

    const { server } = await createMockDaemon(testMessages);

    try {
      const msgs = await fetchUnreadMessages("work");
      expect(msgs).toHaveLength(2);
      expect(msgs[0].from).toBe("admin");
      expect(msgs[0].content).toBe("Hello");
      expect(msgs[1].type).toBe("handoff");
    } finally {
      server.close();
    }
  });
});

describe("fetchUnreadCounts", () => {
  test("returns counts for multiple accounts", async () => {
    writeToken("a", "tok-a");
    writeToken("b", "tok-b");

    const msgs = [
      { id: "1", from: "x", to: "a", type: "message", content: "hi", timestamp: "2026-02-13T12:00:00Z", read: false },
    ];
    const { server } = await createMockDaemon(msgs);

    try {
      const counts = await fetchUnreadCounts(["a", "b"]);
      expect(counts.get("a")).toBe(1);
      expect(counts.get("b")).toBe(1); // Mock daemon returns same messages for all
    } finally {
      server.close();
    }
  });

  test("returns 0 for accounts without daemon", async () => {
    const counts = await fetchUnreadCounts(["notoken"]);
    expect(counts.get("notoken")).toBe(0);
  });
});
