import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { DaemonState } from "../src/daemon/state";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";

const TEST_DIR = join(import.meta.dir, ".test-daemon");

let savedAgentctlDir: string | undefined;
let dbCounter = 0;
function uniqueDbPath(): string {
  return join(TEST_DIR, `test-${++dbCounter}-${Date.now()}.db`);
}

beforeEach(() => {
  savedAgentctlDir = process.env.AGENTCTL_DIR;
  process.env.AGENTCTL_DIR = TEST_DIR;
  mkdirSync(TEST_DIR, { recursive: true });
});
afterEach(() => {
  if (savedAgentctlDir === undefined) {
    delete process.env.AGENTCTL_DIR;
  } else {
    process.env.AGENTCTL_DIR = savedAgentctlDir;
  }
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("DaemonState", () => {
  test("manages connected accounts", () => {
    const state = new DaemonState(uniqueDbPath());
    state.connectAccount("claude", "token-abc");
    expect(state.getConnectedAccounts()).toEqual(["claude"]);
    state.disconnectAccount("claude");
    expect(state.getConnectedAccounts()).toEqual([]);
    state.close();
  });

  test("stores and retrieves messages", () => {
    const state = new DaemonState(uniqueDbPath());
    state.addMessage({ from: "claude", to: "claude-admin", type: "message", content: "hello", timestamp: new Date().toISOString() });
    const msgs = state.getMessages("claude-admin");
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe("hello");
    state.close();
  });

  test("marks messages as read", () => {
    const state = new DaemonState(uniqueDbPath());
    state.addMessage({ from: "claude", to: "claude-admin", type: "message", content: "hello", timestamp: new Date().toISOString() });
    const unread = state.getUnreadMessages("claude-admin");
    expect(unread).toHaveLength(1);
    state.markAllRead("claude-admin");
    expect(state.getUnreadMessages("claude-admin")).toHaveLength(0);
    state.close();
  });

  test("verifies tokens for connected accounts", () => {
    const state = new DaemonState(uniqueDbPath());
    state.connectAccount("claude", "secret-token");
    expect(state.verifyToken("claude", "secret-token")).toBe(true);
    expect(state.verifyToken("claude", "wrong-token")).toBe(false);
    expect(state.verifyToken("nonexistent", "any")).toBe(false);
    state.close();
  });

  test("isConnected returns correct status", () => {
    const state = new DaemonState(uniqueDbPath());
    expect(state.isConnected("claude")).toBe(false);
    state.connectAccount("claude", "tok");
    expect(state.isConnected("claude")).toBe(true);
    state.disconnectAccount("claude");
    expect(state.isConnected("claude")).toBe(false);
    state.close();
  });

  test("messages have auto-generated ids", () => {
    const state = new DaemonState(uniqueDbPath());
    state.addMessage({ from: "a", to: "b", type: "message", content: "test", timestamp: new Date().toISOString() });
    const msgs = state.getMessages("b");
    expect(msgs[0].id).toBeDefined();
    expect(typeof msgs[0].id).toBe("string");
    expect(msgs[0].id!.length).toBeGreaterThan(0);
    state.close();
  });

  test("getMessages returns only messages for the specified recipient", () => {
    const state = new DaemonState(uniqueDbPath());
    state.addMessage({ from: "a", to: "b", type: "message", content: "for b", timestamp: new Date().toISOString() });
    state.addMessage({ from: "a", to: "c", type: "message", content: "for c", timestamp: new Date().toISOString() });
    expect(state.getMessages("b")).toHaveLength(1);
    expect(state.getMessages("c")).toHaveLength(1);
    expect(state.getMessages("b")[0].content).toBe("for b");
    state.close();
  });
});

describe("DaemonState message routing", () => {
  test("message from account A arrives at account B", () => {
    const state = new DaemonState(uniqueDbPath());
    state.addMessage({
      from: "account-a",
      to: "account-b",
      type: "message",
      content: "Task update from A",
      timestamp: new Date().toISOString(),
    });

    const msgsForB = state.getMessages("account-b");
    expect(msgsForB).toHaveLength(1);
    expect(msgsForB[0].from).toBe("account-a");
    expect(msgsForB[0].content).toBe("Task update from A");

    // Account A should not see this message
    const msgsForA = state.getMessages("account-a");
    expect(msgsForA).toHaveLength(0);
    state.close();
  });

  test("multiple messages from A to B arrive in order", () => {
    const state = new DaemonState(uniqueDbPath());
    state.addMessage({ from: "a", to: "b", type: "message", content: "first", timestamp: "2026-02-12T10:00:00Z" });
    state.addMessage({ from: "a", to: "b", type: "message", content: "second", timestamp: "2026-02-12T10:01:00Z" });
    state.addMessage({ from: "a", to: "b", type: "message", content: "third", timestamp: "2026-02-12T10:02:00Z" });

    const msgs = state.getMessages("b");
    expect(msgs).toHaveLength(3);
    // getMessages returns newest first (DESC order)
    expect(msgs[0].content).toBe("third");
    expect(msgs[1].content).toBe("second");
    expect(msgs[2].content).toBe("first");
    state.close();
  });

  test("bidirectional messages between A and B", () => {
    const state = new DaemonState(uniqueDbPath());
    state.addMessage({ from: "a", to: "b", type: "message", content: "hello b", timestamp: new Date().toISOString() });
    state.addMessage({ from: "b", to: "a", type: "message", content: "hello a", timestamp: new Date().toISOString() });

    expect(state.getMessages("b")).toHaveLength(1);
    expect(state.getMessages("b")[0].content).toBe("hello b");
    expect(state.getMessages("a")).toHaveLength(1);
    expect(state.getMessages("a")[0].content).toBe("hello a");
    state.close();
  });

  test("unread tracking works across multiple recipients", () => {
    const state = new DaemonState(uniqueDbPath());
    state.addMessage({ from: "sender", to: "user-a", type: "message", content: "msg for a", timestamp: new Date().toISOString() });
    state.addMessage({ from: "sender", to: "user-b", type: "message", content: "msg for b", timestamp: new Date().toISOString() });
    state.addMessage({ from: "sender", to: "user-a", type: "message", content: "another for a", timestamp: new Date().toISOString() });

    expect(state.getUnreadMessages("user-a")).toHaveLength(2);
    expect(state.getUnreadMessages("user-b")).toHaveLength(1);

    // Mark A as read - B should still have unread
    state.markAllRead("user-a");
    expect(state.getUnreadMessages("user-a")).toHaveLength(0);
    expect(state.getUnreadMessages("user-b")).toHaveLength(1);
    state.close();
  });

  test("markAllRead only affects the specified recipient", () => {
    const state = new DaemonState(uniqueDbPath());
    state.addMessage({ from: "x", to: "y", type: "message", content: "for y", timestamp: new Date().toISOString() });
    state.addMessage({ from: "x", to: "z", type: "message", content: "for z", timestamp: new Date().toISOString() });

    state.markAllRead("y");

    expect(state.getUnreadMessages("y")).toHaveLength(0);
    expect(state.getUnreadMessages("z")).toHaveLength(1);
    // All messages still accessible via getMessages
    expect(state.getMessages("y")).toHaveLength(1);
    state.close();
  });

  test("markAllRead is idempotent", () => {
    const state = new DaemonState(uniqueDbPath());
    state.addMessage({ from: "a", to: "b", type: "message", content: "msg", timestamp: new Date().toISOString() });

    state.markAllRead("b");
    state.markAllRead("b"); // second call should not error
    expect(state.getUnreadMessages("b")).toHaveLength(0);
    state.close();
  });

  test("handoff messages are included in getMessages but filtered by getHandoffs", () => {
    const state = new DaemonState(uniqueDbPath());
    state.addMessage({ from: "a", to: "b", type: "message", content: "regular", timestamp: new Date().toISOString() });
    state.addMessage({ from: "a", to: "b", type: "handoff", content: "handoff task", timestamp: new Date().toISOString(), context: { branch: "main" } });

    expect(state.getMessages("b")).toHaveLength(2);
    expect(state.getHandoffs("b")).toHaveLength(1);
    expect(state.getHandoffs("b")[0].content).toBe("handoff task");
    state.close();
  });

  test("disconnected account messages are still queued", () => {
    const state = new DaemonState(uniqueDbPath());
    // Account C is not connected but messages are still stored
    state.addMessage({ from: "a", to: "c", type: "message", content: "queued for c", timestamp: new Date().toISOString() });

    expect(state.isConnected("c")).toBe(false);
    expect(state.getMessages("c")).toHaveLength(1);
    expect(state.getUnreadMessages("c")).toHaveLength(1);
    state.close();
  });

  test("messages from multiple senders to same recipient", () => {
    const state = new DaemonState(uniqueDbPath());
    state.addMessage({ from: "sender-1", to: "receiver", type: "message", content: "from 1", timestamp: new Date().toISOString() });
    state.addMessage({ from: "sender-2", to: "receiver", type: "message", content: "from 2", timestamp: new Date().toISOString() });
    state.addMessage({ from: "sender-3", to: "receiver", type: "message", content: "from 3", timestamp: new Date().toISOString() });

    const msgs = state.getMessages("receiver");
    expect(msgs).toHaveLength(3);
    const senders = msgs.map(m => m.from);
    expect(senders).toContain("sender-1");
    expect(senders).toContain("sender-2");
    expect(senders).toContain("sender-3");
    state.close();
  });
});
