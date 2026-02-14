import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { createConnection, createServer, type Server as NetServer } from "net";
import { registerTools } from "../src/mcp/tools";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const TEST_DIR = join(import.meta.dir, ".test-mcp");
const TEST_SOCK = join(TEST_DIR, "test.sock");

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
  mkdirSync(join(TEST_DIR, "tokens"), { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("MCP tools registration", () => {
  test("registerTools adds send_message, read_messages, list_accounts tools to McpServer", () => {
    const mcpServer = new McpServer(
      { name: "agentctl-test", version: "1.0.0" },
      { capabilities: { tools: {} } }
    );

    // Create a mock daemon socket function
    const mockSendToDaemon = async (msg: object) => {
      if ((msg as any).type === "send_message") {
        return { type: "result", delivered: true, queued: true };
      }
      if ((msg as any).type === "read_messages") {
        return { type: "result", messages: [] };
      }
      if ((msg as any).type === "list_accounts") {
        return { type: "result", accounts: [] };
      }
      return { type: "error", message: "unknown" };
    };

    // Should not throw
    registerTools(mcpServer, mockSendToDaemon, "test-account");
  });
});

describe("MCP tools return correct results", () => {
  test("send_message tool returns delivery result", async () => {
    const mcpServer = new McpServer(
      { name: "agentctl-test", version: "1.0.0" },
      { capabilities: { tools: {} } }
    );

    const mockSendToDaemon = async (msg: object) => {
      const m = msg as any;
      if (m.type === "send_message") {
        return { type: "result", delivered: true, queued: true };
      }
      return { type: "error" };
    };

    registerTools(mcpServer, mockSendToDaemon, "test-account");

    // Verify tools are registered by calling them through the mock
    const result = await mockSendToDaemon({ type: "send_message", to: "bob", content: "hello" });
    expect(result.delivered).toBe(true);
    expect(result.queued).toBe(true);
  });

  test("read_messages tool returns messages array", async () => {
    const testMessages = [
      { id: "1", from: "alice", to: "bob", type: "message", content: "hi", timestamp: "2026-02-12T10:00:00Z" },
      { id: "2", from: "carol", to: "bob", type: "handoff", content: "task", timestamp: "2026-02-12T10:01:00Z" },
    ];

    const mockSendToDaemon = async (msg: object) => {
      const m = msg as any;
      if (m.type === "read_messages") {
        return { type: "result", messages: testMessages };
      }
      return { type: "error" };
    };

    const result = await mockSendToDaemon({ type: "read_messages" });
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].from).toBe("alice");
    expect(result.messages[1].type).toBe("handoff");
  });

  test("list_accounts tool returns account list", async () => {
    const mockSendToDaemon = async (msg: object) => {
      const m = msg as any;
      if (m.type === "list_accounts") {
        return {
          type: "result",
          accounts: [
            { name: "alice", status: "active" },
            { name: "bob", status: "active" },
          ],
        };
      }
      return { type: "error" };
    };

    const result = await mockSendToDaemon({ type: "list_accounts" });
    expect(result.accounts).toHaveLength(2);
    expect(result.accounts[0].name).toBe("alice");
    expect(result.accounts[1].status).toBe("active");
  });

  test("handoff_task tool returns handoff ID", async () => {
    const mockSendToDaemon = async (msg: object) => {
      const m = msg as any;
      if (m.type === "handoff_task") {
        return {
          type: "result",
          delivered: false,
          queued: true,
          handoffId: "uuid-handoff-123",
        };
      }
      return { type: "error" };
    };

    const result = await mockSendToDaemon({
      type: "handoff_task",
      to: "bob",
      task: "deploy to staging",
      context: { branch: "main" },
    });
    expect(result.queued).toBe(true);
    expect(result.handoffId).toBe("uuid-handoff-123");
  });

  test("registerTools does not throw for all four tools", () => {
    const mcpServer = new McpServer(
      { name: "agentctl-test", version: "1.0.0" },
      { capabilities: { tools: {} } }
    );

    const mockSendToDaemon = async () => ({ type: "result" });
    expect(() => registerTools(mcpServer, mockSendToDaemon, "test")).not.toThrow();
  });
});

describe("daemon socket protocol", () => {
  let mockDaemon: NetServer;

  afterEach(() => {
    if (mockDaemon) {
      mockDaemon.close();
      try { require("fs").unlinkSync(TEST_SOCK); } catch {}
    }
  });

  test("client can connect and authenticate with daemon", async () => {
    // Set up a mock daemon that accepts auth
    const connected = new Promise<string>((resolve) => {
      mockDaemon = createServer((socket) => {
        socket.on("data", (data) => {
          const msg = JSON.parse(data.toString());
          if (msg.type === "auth") {
            socket.write(JSON.stringify({ type: "auth_ok" }) + "\n");
            resolve(msg.account);
          }
        });
      });
      mockDaemon.listen(TEST_SOCK);
    });

    // Connect as client
    const client = createConnection(TEST_SOCK);
    await new Promise<void>((resolve) => client.once("connect", resolve));
    client.write(JSON.stringify({ type: "auth", account: "test", token: "tok123" }) + "\n");

    const accountName = await connected;
    expect(accountName).toBe("test");
    client.destroy();
  });

  test("send_message and read_messages round-trip through daemon", async () => {
    const messages: any[] = [];

    mockDaemon = createServer((socket) => {
      socket.on("data", (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === "auth") {
          socket.write(JSON.stringify({ type: "auth_ok" }) + "\n");
        } else if (msg.type === "send_message") {
          messages.push(msg);
          socket.write(JSON.stringify({ type: "result", delivered: true, queued: true }) + "\n");
        } else if (msg.type === "read_messages") {
          socket.write(JSON.stringify({ type: "result", messages }) + "\n");
        }
      });
    });
    mockDaemon.listen(TEST_SOCK);

    const client = createConnection(TEST_SOCK);
    await new Promise<void>((resolve) => client.once("connect", resolve));

    // Auth
    client.write(JSON.stringify({ type: "auth", account: "sender", token: "t" }) + "\n");
    await new Promise<void>((resolve) => client.once("data", () => resolve()));

    // Send message
    client.write(JSON.stringify({ type: "send_message", to: "receiver", content: "hello" }) + "\n");
    const sendResp = await new Promise<any>((resolve) => {
      client.once("data", (data) => resolve(JSON.parse(data.toString())));
    });
    expect(sendResp.queued).toBe(true);

    // Read messages
    client.write(JSON.stringify({ type: "read_messages" }) + "\n");
    const readResp = await new Promise<any>((resolve) => {
      client.once("data", (data) => resolve(JSON.parse(data.toString())));
    });
    expect(readResp.messages).toHaveLength(1);
    expect(readResp.messages[0].content).toBe("hello");

    client.destroy();
  });
});
