/**
 * MCP tool error path tests for handoff and task tool categories.
 *
 * Complements mcp-error-injection.test.ts which covers messaging, health,
 * workflow, and session categories. This file focuses on:
 * - handoff_task with invalid payloads (validation catches bad inputs)
 * - handoff_task / accept_handoff with daemon errors
 * - update_task_status / report_progress with daemon errors
 * - Connection failure paths for task and handoff tools
 */
import { describe, test, expect } from "bun:test";
import { registerHandoffTools } from "../src/mcp/tools/handoff";
import { registerTaskTools } from "../src/mcp/tools/tasks";
import type { DaemonSender } from "../src/mcp/tools";

// Minimal McpServer stub that captures registered tool handlers
type ToolHandler = (args: any) => Promise<any>;

class MockMcpServer {
  tools = new Map<string, ToolHandler>();

  registerTool(name: string, _schema: any, handlerOrOpts: any, maybeHandler?: ToolHandler): void {
    const handler = typeof maybeHandler === "function" ? maybeHandler : handlerOrOpts;
    this.tools.set(name, handler);
  }

  async callTool(name: string, args: any = {}): Promise<any> {
    const handler = this.tools.get(name);
    if (!handler) throw new Error(`Tool '${name}' not registered`);
    return handler(args);
  }
}

// ── Handoff tool error paths ──

describe("handoff_task: invalid payload validation", () => {
  const successSender: DaemonSender = () =>
    Promise.resolve({ type: "result", delivered: true });

  test("returns validation error when acceptance_criteria is empty", async () => {
    const server = new MockMcpServer();
    registerHandoffTools(server as any, successSender, "test-account");

    const result = await server.callTool("handoff_task", {
      to: "bob",
      goal: "deploy",
      acceptance_criteria: [],
      run_commands: ["bun test"],
      blocked_by: ["none"],
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe("Invalid handoff payload");
    expect(parsed.details).toBeDefined();
  });

  test("returns validation error when run_commands is empty", async () => {
    const server = new MockMcpServer();
    registerHandoffTools(server as any, successSender, "test-account");

    const result = await server.callTool("handoff_task", {
      to: "bob",
      goal: "deploy",
      acceptance_criteria: ["tests pass"],
      run_commands: [],
      blocked_by: ["none"],
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe("Invalid handoff payload");
  });

  test("returns validation error when blocked_by is empty", async () => {
    const server = new MockMcpServer();
    registerHandoffTools(server as any, successSender, "test-account");

    const result = await server.callTool("handoff_task", {
      to: "bob",
      goal: "deploy",
      acceptance_criteria: ["tests pass"],
      run_commands: ["bun test"],
      blocked_by: [],
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe("Invalid handoff payload");
  });
});

describe("handoff tools: daemon error responses", () => {
  const errorSender: DaemonSender = () =>
    Promise.resolve({ type: "error", error: "account not found" });

  test("handoff_task propagates daemon error", async () => {
    const server = new MockMcpServer();
    registerHandoffTools(server as any, errorSender, "test-account");

    const result = await server.callTool("handoff_task", {
      to: "bob",
      goal: "deploy app",
      acceptance_criteria: ["app is running"],
      run_commands: ["bun test"],
      blocked_by: ["none"],
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.type).toBe("error");
    expect(parsed.error).toBe("account not found");
  });

  test("accept_handoff propagates daemon error", async () => {
    const server = new MockMcpServer();
    registerHandoffTools(server as any, errorSender, "test-account");

    const result = await server.callTool("accept_handoff", {
      handoffId: "nonexistent-id",
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.type).toBe("error");
    expect(parsed.error).toBe("account not found");
  });

  test("suggest_assignee propagates daemon error", async () => {
    const server = new MockMcpServer();
    registerHandoffTools(server as any, errorSender, "test-account");

    const result = await server.callTool("suggest_assignee", {
      skills: ["typescript"],
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.type).toBe("error");
  });
});

describe("handoff tools: connection failure", () => {
  const connectionFailSender: DaemonSender = () =>
    Promise.reject(new Error("connect ECONNREFUSED /tmp/hub.sock"));

  test("handoff_task rejects on connection refused", async () => {
    const server = new MockMcpServer();
    registerHandoffTools(server as any, connectionFailSender, "test-account");

    await expect(
      server.callTool("handoff_task", {
        to: "bob",
        goal: "deploy",
        acceptance_criteria: ["tests pass"],
        run_commands: ["bun test"],
        blocked_by: ["none"],
      })
    ).rejects.toThrow("ECONNREFUSED");
  });

  test("accept_handoff rejects on connection refused", async () => {
    const server = new MockMcpServer();
    registerHandoffTools(server as any, connectionFailSender, "test-account");

    await expect(
      server.callTool("accept_handoff", { handoffId: "h-123" })
    ).rejects.toThrow("ECONNREFUSED");
  });
});

// ── Task tool error paths ──

describe("task tools: daemon error responses", () => {
  const errorSender: DaemonSender = () =>
    Promise.resolve({ type: "error", error: "task not found" });

  test("update_task_status propagates daemon error", async () => {
    const server = new MockMcpServer();
    registerTaskTools(server as any, errorSender, "test-account");

    const result = await server.callTool("update_task_status", {
      taskId: "nonexistent",
      status: "in_progress",
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.type).toBe("error");
    expect(parsed.error).toBe("task not found");
  });

  test("report_progress propagates daemon error", async () => {
    const server = new MockMcpServer();
    registerTaskTools(server as any, errorSender, "test-account");

    const result = await server.callTool("report_progress", {
      taskId: "t-123",
      percent: 50,
      currentStep: "running tests",
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.type).toBe("error");
    expect(parsed.error).toBe("task not found");
  });

  test("analyze_task propagates daemon error", async () => {
    const server = new MockMcpServer();
    registerTaskTools(server as any, errorSender, "test-account");

    const result = await server.callTool("analyze_task", {
      goal: "refactor authentication",
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.type).toBe("error");
  });

  test("check_adaptive_sla propagates daemon error", async () => {
    const server = new MockMcpServer();
    registerTaskTools(server as any, errorSender, "test-account");

    const result = await server.callTool("check_adaptive_sla", {});

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.type).toBe("error");
  });

  test("get_trust_scores propagates daemon error", async () => {
    const server = new MockMcpServer();
    registerTaskTools(server as any, errorSender, "test-account");

    const result = await server.callTool("get_trust_scores", {});

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.type).toBe("error");
  });
});

describe("task tools: connection timeout", () => {
  const timeoutSender: DaemonSender = () =>
    Promise.reject(new Error("Request timed out (5000ms)"));

  test("update_task_status rejects with timeout error", async () => {
    const server = new MockMcpServer();
    registerTaskTools(server as any, timeoutSender, "test-account");

    await expect(
      server.callTool("update_task_status", {
        taskId: "t-123",
        status: "in_progress",
      })
    ).rejects.toThrow("timed out");
  });

  test("report_progress rejects with timeout error", async () => {
    const server = new MockMcpServer();
    registerTaskTools(server as any, timeoutSender, "test-account");

    await expect(
      server.callTool("report_progress", {
        taskId: "t-123",
        percent: 75,
        currentStep: "deploying",
      })
    ).rejects.toThrow("timed out");
  });
});

describe("task tools: connection refused", () => {
  const connectionRefusedSender: DaemonSender = () =>
    Promise.reject(new Error("connect ECONNREFUSED /tmp/hub.sock"));

  test("update_task_status rejects on connection refused", async () => {
    const server = new MockMcpServer();
    registerTaskTools(server as any, connectionRefusedSender, "test-account");

    await expect(
      server.callTool("update_task_status", {
        taskId: "t-123",
        status: "accepted",
      })
    ).rejects.toThrow("ECONNREFUSED");
  });
});
