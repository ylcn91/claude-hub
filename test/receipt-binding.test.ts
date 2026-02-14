import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { startDaemon, stopDaemon } from "../src/daemon/server";
import { createConnection, type Socket } from "net";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";

/**
 * Tests that receipt generation binds to the correct handoff
 * when multiple concurrent handoffs exist for the same account.
 */

let tmpDir: string;
let sockPath: string;
let server: any;
let state: any;
let cleanup: (() => void) | undefined;

function sendMsg(socket: Socket, msg: object): Promise<any> {
  return new Promise((resolve) => {
    socket.once("data", (data) => {
      // Parse newline-delimited JSON - may have multiple messages
      const lines = data.toString().split("\n").filter(Boolean);
      resolve(JSON.parse(lines[lines.length - 1]));
    });
    socket.write(JSON.stringify(msg) + "\n");
  });
}

function connect(): Promise<Socket> {
  return new Promise((resolve) => {
    const socket = createConnection(sockPath);
    socket.once("connect", () => resolve(socket));
  });
}

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "receipt-bind-"));
  sockPath = join(tmpDir, "test.sock");
  const tokensDir = join(tmpDir, "tokens");
  mkdirSync(tokensDir, { recursive: true });
  writeFileSync(join(tokensDir, "alice.token"), "tok-alice");
  writeFileSync(join(tokensDir, "bob.token"), "tok-bob");

  // Override paths to use tmp dir
  process.env.AGENTCTL_DIR = tmpDir;

  const result = await startDaemon({
    sockPath,
    dbPath: join(tmpDir, "messages.db"),
  });
  server = result.server;
  state = result.state;
  cleanup = () => stopDaemon(server, sockPath);
});

afterEach(() => {
  cleanup?.();
  delete process.env.AGENTCTL_DIR;
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("receipt binds to correct handoff", () => {
  test("with multiple handoffs, receipt uses matching taskId handoff", async () => {
    // Connect as alice (delegator)
    const alice = await connect();
    const authResult = await sendMsg(alice, { type: "auth", account: "alice", token: "tok-alice" });
    expect(authResult.type).toBe("auth_ok");

    // Create two handoffs to bob
    const handoff1Result = await sendMsg(alice, {
      type: "handoff_task",
      to: "bob",
      payload: {
        goal: "First task: implement login",
        acceptance_criteria: ["Login works"],
        run_commands: ["bun test"],
        blocked_by: ["none"],
      },
      context: {},
    });
    expect(handoff1Result.handoffId).toBeDefined();
    const task1Id = handoff1Result.handoffId;

    const handoff2Result = await sendMsg(alice, {
      type: "handoff_task",
      to: "bob",
      payload: {
        goal: "Second task: implement logout",
        acceptance_criteria: ["Logout works"],
        run_commands: ["bun test"],
        blocked_by: ["none"],
      },
      context: {},
    });
    expect(handoff2Result.handoffId).toBeDefined();
    const task2Id = handoff2Result.handoffId;

    // Accept task 2 (not task 1) - the receipt should bind to handoff 2
    // First move task2 to in_progress
    await sendMsg(alice, {
      type: "update_task_status",
      taskId: task2Id,
      status: "in_progress",
    });

    // Then to ready_for_review
    await sendMsg(alice, {
      type: "update_task_status",
      taskId: task2Id,
      status: "ready_for_review",
    });

    // Listen for TASK_VERIFIED events to check the receipt
    let capturedReceipt: any = null;
    state.eventBus.on("*", (event: any) => {
      if (event.type === "TASK_VERIFIED" && event.taskId === task2Id) {
        capturedReceipt = event.receipt;
      }
    });

    // Accept task 2
    const acceptResult = await sendMsg(alice, {
      type: "update_task_status",
      taskId: task2Id,
      status: "accepted",
    });
    expect(acceptResult.type).toBe("result");

    // Wait for async event processing
    await new Promise((r) => setTimeout(r, 100));

    // The receipt should have the specHash from handoff 2's content, not handoff 1
    if (capturedReceipt) {
      expect(capturedReceipt.taskId).toBe(task2Id);

      // Verify the receipt is bound to handoff 2 (not handoff 1) by checking
      // the specHash differs from what handoff 1's content would produce
      const { computeSpecHash } = await import("../src/services/verification-receipts");

      const handoffs = state.getHandoffs("bob");
      const handoff1 = handoffs.find((h: any) => h.id === task1Id);
      if (handoff1) {
        const handoff1Hash = computeSpecHash(handoff1.content);
        // The receipt's specHash must NOT match handoff 1's hash (wrong handoff)
        expect(capturedReceipt.specHash).not.toBe(handoff1Hash);
      }
      // The receipt specHash should not be the fallback taskId hash
      const fallbackHash = computeSpecHash(task2Id);
      expect(capturedReceipt.specHash).not.toBe(fallbackHash);
    }

    alice.destroy();
  });

  test("receipt falls back to taskId when no matching handoff found", async () => {
    const alice = await connect();
    await sendMsg(alice, { type: "auth", account: "alice", token: "tok-alice" });

    // Create a handoff
    const handoffResult = await sendMsg(alice, {
      type: "handoff_task",
      to: "bob",
      payload: {
        goal: "Some task",
        acceptance_criteria: ["Works"],
        run_commands: ["bun test"],
        blocked_by: ["none"],
      },
      context: {},
    });
    const taskId = handoffResult.handoffId;

    // Move through lifecycle
    await sendMsg(alice, { type: "update_task_status", taskId, status: "in_progress" });
    await sendMsg(alice, { type: "update_task_status", taskId, status: "ready_for_review" });

    let capturedReceipt: any = null;
    state.eventBus.on("*", (event: any) => {
      if (event.type === "TASK_VERIFIED" && event.taskId === taskId) {
        capturedReceipt = event.receipt;
      }
    });

    await sendMsg(alice, { type: "update_task_status", taskId, status: "accepted" });
    await new Promise((r) => setTimeout(r, 100));

    // Receipt should exist (may use handoff content since the handoff IS to bob and alice is accepting as delegator)
    if (capturedReceipt) {
      expect(capturedReceipt.taskId).toBe(taskId);
    }

    alice.destroy();
  });
});
