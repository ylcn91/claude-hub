/**
 * MCP tool error injection tests.
 *
 * Verifies that MCP tools handle daemon errors gracefully:
 * - Connection timeout (sendToDaemon rejects with timeout error)
 * - Malformed JSON response (sendToDaemon returns unexpected shape)
 * - Daemon returning error type
 *
 * We directly test the tool handler functions by creating a minimal McpServer
 * and calling the registered handlers with a mocked sendToDaemon.
 */
import { describe, test, expect } from "bun:test";
import { registerMessagingTools } from "../src/mcp/tools/messaging";
import { registerHealthTools } from "../src/mcp/tools/health";
import { registerWorkflowTools } from "../src/mcp/tools/workflow";
import { registerSessionTools } from "../src/mcp/tools/sessions";
import type { DaemonSender } from "../src/mcp/tools";

// Minimal McpServer stub that captures registered tool handlers
type ToolHandler = (args: any) => Promise<any>;

class MockMcpServer {
  tools = new Map<string, ToolHandler>();

  registerTool(name: string, _schema: any, handler: ToolHandler): void;
  registerTool(name: string, _schema: any, _opts: any, handler?: ToolHandler): void;
  registerTool(name: string, _schema: any, handlerOrOpts: any, maybeHandler?: ToolHandler): void {
    // The MCP SDK registerTool signature: (name, description, handler)
    // or (name, {description, inputSchema}, handler)
    const handler = typeof maybeHandler === "function" ? maybeHandler : handlerOrOpts;
    this.tools.set(name, handler);
  }

  async callTool(name: string, args: any = {}): Promise<any> {
    const handler = this.tools.get(name);
    if (!handler) throw new Error(`Tool '${name}' not registered`);
    return handler(args);
  }
}

function createMockServer(): MockMcpServer {
  return new MockMcpServer();
}

describe("MCP error injection: connection timeout", () => {
  const timeoutSender: DaemonSender = () =>
    Promise.reject(new Error("Request timed out (5000ms)"));

  test("send_message rejects with timeout error", async () => {
    const server = createMockServer();
    registerMessagingTools(server as any, timeoutSender, "test-account");

    await expect(server.callTool("send_message", { to: "bob", message: "hi" })).rejects.toThrow(
      "timed out"
    );
  });

  test("daemon_health rejects with timeout error", async () => {
    const server = createMockServer();
    registerHealthTools(server as any, timeoutSender, "test-account");

    await expect(server.callTool("daemon_health")).rejects.toThrow("timed out");
  });

  test("list_workflows rejects with timeout error", async () => {
    const server = createMockServer();
    registerWorkflowTools(server as any, timeoutSender, "test-account");

    await expect(server.callTool("list_workflows")).rejects.toThrow("timed out");
  });

  test("share_session rejects with timeout error", async () => {
    const server = createMockServer();
    registerSessionTools(server as any, timeoutSender, "test-account");

    await expect(
      server.callTool("share_session", { target: "bob" })
    ).rejects.toThrow("timed out");
  });
});

describe("MCP error injection: daemon returns error type", () => {
  const errorSender: DaemonSender = () =>
    Promise.resolve({ type: "error", error: "Internal daemon failure" });

  test("send_message propagates daemon error in response", async () => {
    const server = createMockServer();
    registerMessagingTools(server as any, errorSender, "test-account");

    const result = await server.callTool("send_message", { to: "bob", message: "hi" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.type).toBe("error");
    expect(parsed.error).toBe("Internal daemon failure");
  });

  test("daemon_health propagates daemon error in response", async () => {
    const server = createMockServer();
    registerHealthTools(server as any, errorSender, "test-account");

    const result = await server.callTool("daemon_health");
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.type).toBe("error");
    expect(parsed.error).toBe("Internal daemon failure");
  });

  test("trigger_workflow propagates daemon error in response", async () => {
    const server = createMockServer();
    registerWorkflowTools(server as any, errorSender, "test-account");

    const result = await server.callTool("trigger_workflow", {
      workflowName: "deploy",
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.type).toBe("error");
  });

  test("session_status propagates daemon error in response", async () => {
    const server = createMockServer();
    registerSessionTools(server as any, errorSender, "test-account");

    const result = await server.callTool("session_status", {});
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.type).toBe("error");
  });
});

describe("MCP error injection: malformed/unexpected response shape", () => {
  test("read_messages handles response with no messages field", async () => {
    const emptySender: DaemonSender = () => Promise.resolve({});
    const server = createMockServer();
    registerMessagingTools(server as any, emptySender, "test-account");

    const result = await server.callTool("read_messages", {});
    const parsed = JSON.parse(result.content[0].text);
    // Should default to empty array via ?? []
    expect(parsed).toEqual([]);
  });

  test("list_accounts handles response with no accounts field", async () => {
    const emptySender: DaemonSender = () => Promise.resolve({});
    const server = createMockServer();
    registerMessagingTools(server as any, emptySender, "test-account");

    const result = await server.callTool("list_accounts");
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual([]);
  });

  test("count_unread handles response with no count field", async () => {
    const emptySender: DaemonSender = () => Promise.resolve({});
    const server = createMockServer();
    registerMessagingTools(server as any, emptySender, "test-account");

    const result = await server.callTool("count_unread");
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.count).toBe(0);
  });

  test("tools handle null response from sendToDaemon", async () => {
    const nullSender: DaemonSender = () => Promise.resolve(null as any);
    const server = createMockServer();
    registerHealthTools(server as any, nullSender, "test-account");

    // Should either return the null serialized or throw — not crash silently
    const result = await server.callTool("daemon_health");
    expect(result.content[0].text).toBeDefined();
  });
});

describe("MCP error injection: connection refused", () => {
  const connectionRefusedSender: DaemonSender = () =>
    Promise.reject(new Error("connect ECONNREFUSED /tmp/hub.sock"));

  test("send_message rejects on connection refused", async () => {
    const server = createMockServer();
    registerMessagingTools(server as any, connectionRefusedSender, "test-account");

    await expect(server.callTool("send_message", { to: "bob", message: "hi" })).rejects.toThrow(
      "ECONNREFUSED"
    );
  });

  test("workflow_status rejects on connection refused", async () => {
    const server = createMockServer();
    registerWorkflowTools(server as any, connectionRefusedSender, "test-account");

    await expect(
      server.callTool("workflow_status", { runId: "run-123" })
    ).rejects.toThrow("ECONNREFUSED");
  });
});
