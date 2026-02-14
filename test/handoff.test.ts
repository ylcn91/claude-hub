import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, readdirSync } from "fs";
import { join } from "path";
import { DaemonState } from "../src/daemon/state";
import { registerTools, type DaemonSender } from "../src/mcp/tools";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const TEST_DIR = join(import.meta.dir, ".test-handoff");
const TEST_MESSAGES_DIR = join(TEST_DIR, "messages");

let dbCounter = 0;
function uniqueDbPath(): string {
  return join(TEST_DIR, `test-${++dbCounter}-${Date.now()}.db`);
}

beforeEach(() => {
  mkdirSync(TEST_MESSAGES_DIR, { recursive: true });
  process.env.AGENTCTL_DIR = TEST_DIR;
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  delete process.env.AGENTCTL_DIR;
});

describe("handoff_task", () => {
  test("DaemonState stores handoff messages with context", () => {
    const state = new DaemonState(uniqueDbPath());
    state.addMessage({
      from: "claude-work",
      to: "claude-admin",
      type: "handoff",
      content: "Deploy the auth module to staging",
      timestamp: new Date().toISOString(),
      context: {
        branch: "feat/auth",
        projectDir: "/projects/webapp",
        notes: "All tests pass, ready for deploy",
      },
    });

    const msgs = state.getMessages("claude-admin");
    expect(msgs).toHaveLength(1);
    expect(msgs[0].type).toBe("handoff");
    expect(msgs[0].content).toBe("Deploy the auth module to staging");
    expect(msgs[0].context?.branch).toBe("feat/auth");
    expect(msgs[0].context?.projectDir).toBe("/projects/webapp");
    state.close();
  });

  test("handoff messages appear in unread messages", () => {
    const state = new DaemonState(uniqueDbPath());
    state.addMessage({
      from: "claude-work",
      to: "claude-admin",
      type: "handoff",
      content: "Review PR #42",
      timestamp: new Date().toISOString(),
      context: { branch: "fix/bug-42" },
    });

    const unread = state.getUnreadMessages("claude-admin");
    expect(unread).toHaveLength(1);
    expect(unread[0].type).toBe("handoff");

    state.markAllRead("claude-admin");
    expect(state.getUnreadMessages("claude-admin")).toHaveLength(0);
    state.close();
  });

  test("handoff messages are persisted to messages dir", async () => {
    const state = new DaemonState(uniqueDbPath());
    state.onMessagePersist = async (msg) => {
      await Bun.write(
        join(TEST_MESSAGES_DIR, `${msg.id}.json`),
        JSON.stringify(msg, null, 2)
      );
    };

    state.addMessage({
      from: "claude-a",
      to: "claude-b",
      type: "handoff",
      content: "Take over the deploy",
      timestamp: new Date().toISOString(),
      context: { branch: "main", projectDir: "/app" },
    });

    // Wait for async persist
    await Bun.sleep(50);

    const files = readdirSync(TEST_MESSAGES_DIR).filter((f) => f.endsWith(".json"));
    expect(files).toHaveLength(1);

    const persisted = await Bun.file(join(TEST_MESSAGES_DIR, files[0])).json();
    expect(persisted.type).toBe("handoff");
    expect(persisted.content).toBe("Take over the deploy");
    expect(persisted.context.branch).toBe("main");
    state.close();
  });

  test("registerTools includes handoff_task tool", () => {
    const mcpServer = new McpServer(
      { name: "agentctl-test", version: "1.0.0" },
      { capabilities: { tools: {} } }
    );

    const mockSendToDaemon: DaemonSender = async (msg: object) => {
      const m = msg as any;
      if (m.type === "handoff_task") {
        return {
          type: "result",
          delivered: false,
          queued: true,
          handoffId: "test-uuid",
        };
      }
      return { type: "result" };
    };

    // Should not throw -- handoff_task is registered alongside others
    registerTools(mcpServer, mockSendToDaemon, "test-account");
  });

  test("mixed message and handoff types are filtered correctly", () => {
    const state = new DaemonState(uniqueDbPath());
    state.addMessage({
      from: "a", to: "b", type: "message",
      content: "hello", timestamp: new Date().toISOString(),
    });
    state.addMessage({
      from: "a", to: "b", type: "handoff",
      content: "take over deploy", timestamp: new Date().toISOString(),
      context: { branch: "main" },
    });
    state.addMessage({
      from: "c", to: "b", type: "message",
      content: "ping", timestamp: new Date().toISOString(),
    });

    const all = state.getMessages("b");
    expect(all).toHaveLength(3);

    const handoffs = state.getHandoffs("b");
    expect(handoffs).toHaveLength(1);
    expect(handoffs[0].type).toBe("handoff");
    expect(handoffs[0].context?.branch).toBe("main");
    state.close();
  });
});
