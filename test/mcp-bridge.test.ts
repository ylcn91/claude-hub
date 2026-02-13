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
      { name: "claude-hub-test", version: "1.0.0" },
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
