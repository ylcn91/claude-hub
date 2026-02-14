/**
 * EventBus wiring tests — verifies daemon handlers emit correct events.
 * Uses real daemon server with real filesystem (no mock.module).
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { startDaemon, stopDaemon } from "../src/daemon/server";
import { createConnection, type Socket, type Server } from "net";
import { createLineParser, frameSend } from "../src/daemon/framing";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import type { DelegationEvent } from "../src/services/event-bus";
import type { DaemonState } from "../src/daemon/state";

// ---------------------------------------------------------------------------
// Helpers (no mock.module — real daemon, real filesystem)
// ---------------------------------------------------------------------------

let dirCounter = 0;
function freshTestDir(): string {
  const dir = join(import.meta.dir, `.test-eb-wiring-${++dirCounter}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, "tokens"), { recursive: true });
  return dir;
}

function createToken(testDir: string, name: string, token: string): void {
  writeFileSync(join(testDir, "tokens", `${name}.token`), token, { mode: 0o600 });
}

function uniqueDb(testDir: string): string {
  return join(testDir, `msg-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

interface TestClient {
  socket: Socket;
  send(msg: object, timeoutMs?: number): Promise<any>;
  destroy(): void;
}

function createTestClient(socket: Socket): TestClient {
  const waiters: Array<(msg: any) => void> = [];
  const parser = createLineParser((msg) => {
    const waiter = waiters.shift();
    if (waiter) waiter(msg);
  });
  socket.on("data", (chunk) => parser.feed(chunk));
  return {
    socket,
    send(msg, timeoutMs = 5000) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const idx = waiters.indexOf(resolve as any);
          if (idx >= 0) waiters.splice(idx, 1);
          reject(new Error("send timeout"));
        }, timeoutMs);
        waiters.push((response) => {
          clearTimeout(timer);
          resolve(response);
        });
        socket.write(frameSend(msg));
      });
    },
    destroy() { socket.destroy(); },
  };
}

async function connectAndAuth(sockPath: string, account: string, token: string): Promise<TestClient> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(sockPath);
    socket.once("error", reject);
    socket.once("connect", async () => {
      const client = createTestClient(socket);
      const authResp = await client.send({ type: "auth", account, token });
      if (authResp.type === "auth_fail") {
        reject(new Error(`Auth failed: ${authResp.error}`));
        return;
      }
      resolve(client);
    });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("EventBus wiring in daemon handlers", () => {
  let testDir: string;
  let server: Server;
  let state: DaemonState;
  let origDir: string | undefined;

  beforeEach(async () => {
    testDir = freshTestDir();
    origDir = process.env.AGENTCTL_DIR;
    process.env.AGENTCTL_DIR = testDir;
    createToken(testDir, "delegator", "del-tok");
    createToken(testDir, "worker", "work-tok");

    const result = await startDaemon({ dbPath: uniqueDb(testDir) });
    server = result.server;
    state = result.state;
  });

  afterEach(() => {
    process.env.AGENTCTL_DIR = origDir;
    try { state.close(); } catch {}
    try { stopDaemon(server); } catch {}
    rmSync(testDir, { recursive: true, force: true });
  });

  test("handoff_task emits TASK_CREATED event", async () => {
    await Bun.sleep(50);
    const events: DelegationEvent[] = [];
    state.eventBus.on("TASK_CREATED", (e: any) => events.push(e));

    const client = await connectAndAuth(join(testDir, "hub.sock"), "delegator", "del-tok");
    const reply = await client.send({
      type: "handoff_task",
      to: "worker",
      payload: {
        goal: "Implement feature X",
        acceptance_criteria: ["Tests pass"],
        run_commands: ["echo ok"],
        blocked_by: ["none"],
        complexity: "high",
        criticality: "medium",
      },
    });
    expect(reply.type).toBe("result");
    expect(reply.queued).toBe(true);

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("TASK_CREATED");
    expect((events[0] as any).delegator).toBe("delegator");
    expect((events[0] as any).characteristics?.complexity).toBe("high");

    client.destroy();
  });

  test("handoff_accept emits TASK_ASSIGNED event", async () => {
    await Bun.sleep(50);
    const events: DelegationEvent[] = [];
    state.eventBus.on("TASK_ASSIGNED", (e: any) => events.push(e));

    const sockPath = join(testDir, "hub.sock");
    const delegator = await connectAndAuth(sockPath, "delegator", "del-tok");

    // Create handoff
    const handoff = await delegator.send({
      type: "handoff_task",
      to: "worker",
      payload: {
        goal: "Do something",
        acceptance_criteria: ["Done"],
        run_commands: ["echo ok"],
        blocked_by: ["none"],
      },
    });
    const handoffId = handoff.handoffId;

    // Worker accepts
    const worker = await connectAndAuth(sockPath, "worker", "work-tok");
    const acceptReply = await worker.send({ type: "handoff_accept", handoffId });
    expect(acceptReply.type).toBe("result");

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("TASK_ASSIGNED");
    expect((events[0] as any).delegatee).toBe("worker");
    expect((events[0] as any).delegator).toBe("delegator");

    delegator.destroy();
    worker.destroy();
  });

  test("update_task_status emits TASK_STARTED for in_progress", async () => {
    await Bun.sleep(50);
    const events: DelegationEvent[] = [];
    state.eventBus.on("TASK_STARTED", (e: any) => events.push(e));

    const sockPath = join(testDir, "hub.sock");
    const delegator = await connectAndAuth(sockPath, "delegator", "del-tok");

    // Create task via handoff (starts as todo)
    const handoff = await delegator.send({
      type: "handoff_task",
      to: "worker",
      payload: {
        goal: "Start this task",
        acceptance_criteria: ["Done"],
        run_commands: ["echo ok"],
        blocked_by: ["none"],
      },
    });

    // Move to in_progress
    await delegator.send({ type: "update_task_status", taskId: handoff.taskId, status: "in_progress" });

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("TASK_STARTED");
    expect((events[0] as any).agent).toBe("delegator");

    delegator.destroy();
  });

  test("update_task_status emits CHECKPOINT_REACHED for ready_for_review", async () => {
    await Bun.sleep(50);
    const events: DelegationEvent[] = [];
    state.eventBus.on("CHECKPOINT_REACHED", (e: any) => events.push(e));

    const sockPath = join(testDir, "hub.sock");
    const delegator = await connectAndAuth(sockPath, "delegator", "del-tok");

    const handoff = await delegator.send({
      type: "handoff_task",
      to: "worker",
      payload: {
        goal: "Review this",
        acceptance_criteria: ["Looks good"],
        run_commands: ["echo ok"],
        blocked_by: ["none"],
      },
    });

    await delegator.send({ type: "update_task_status", taskId: handoff.taskId, status: "in_progress" });
    await delegator.send({ type: "update_task_status", taskId: handoff.taskId, status: "ready_for_review" });

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("CHECKPOINT_REACHED");
    expect((events[0] as any).percent).toBe(100);
    expect((events[0] as any).step).toBe("ready_for_review");

    delegator.destroy();
  });

  test("update_task_status emits TASK_COMPLETED with success for accepted", async () => {
    await Bun.sleep(50);
    const events: DelegationEvent[] = [];
    state.eventBus.on("TASK_COMPLETED", (e: any) => events.push(e));

    const sockPath = join(testDir, "hub.sock");
    const delegator = await connectAndAuth(sockPath, "delegator", "del-tok");

    const handoff = await delegator.send({
      type: "handoff_task",
      to: "worker",
      payload: {
        goal: "Accept this",
        acceptance_criteria: ["Good"],
        run_commands: ["echo ok"],
        blocked_by: ["none"],
      },
    });

    await delegator.send({ type: "update_task_status", taskId: handoff.taskId, status: "in_progress" });
    await delegator.send({ type: "update_task_status", taskId: handoff.taskId, status: "ready_for_review" });
    await delegator.send({ type: "update_task_status", taskId: handoff.taskId, status: "accepted" });

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("TASK_COMPLETED");
    expect((events[0] as any).result).toBe("success");

    delegator.destroy();
  });

  test("update_task_status emits TASK_COMPLETED with failure for rejected", async () => {
    await Bun.sleep(50);
    const events: DelegationEvent[] = [];
    state.eventBus.on("TASK_COMPLETED", (e: any) => events.push(e));

    const sockPath = join(testDir, "hub.sock");
    const delegator = await connectAndAuth(sockPath, "delegator", "del-tok");

    const handoff = await delegator.send({
      type: "handoff_task",
      to: "worker",
      payload: {
        goal: "Reject this",
        acceptance_criteria: ["Perfect"],
        run_commands: ["echo ok"],
        blocked_by: ["none"],
      },
    });

    await delegator.send({ type: "update_task_status", taskId: handoff.taskId, status: "in_progress" });
    await delegator.send({ type: "update_task_status", taskId: handoff.taskId, status: "ready_for_review" });
    await delegator.send({ type: "update_task_status", taskId: handoff.taskId, status: "rejected", reason: "Tests failing" });

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("TASK_COMPLETED");
    expect((events[0] as any).result).toBe("failure");

    delegator.destroy();
  });

  test("EventBus events include id and timestamp", async () => {
    await Bun.sleep(50);
    let captured: any;
    state.eventBus.on("TASK_CREATED", (e: any) => { captured = e; });

    const client = await connectAndAuth(join(testDir, "hub.sock"), "delegator", "del-tok");
    await client.send({
      type: "handoff_task",
      to: "worker",
      payload: {
        goal: "Test timestamps",
        acceptance_criteria: ["Ok"],
        run_commands: ["echo ok"],
        blocked_by: ["none"],
      },
    });

    expect(captured).toBeDefined();
    expect(captured.id).toBeDefined();
    expect(captured.timestamp).toBeDefined();
    expect(new Date(captured.timestamp).getTime()).toBeGreaterThan(0);

    client.destroy();
  });

  test("wildcard subscriber receives all handler events", async () => {
    await Bun.sleep(50);
    const events: DelegationEvent[] = [];
    state.eventBus.on("*", (e: any) => events.push(e));

    const sockPath = join(testDir, "hub.sock");
    const client = await connectAndAuth(sockPath, "delegator", "del-tok");

    // Create task (emits TASK_CREATED)
    const handoff = await client.send({
      type: "handoff_task",
      to: "worker",
      payload: {
        goal: "Wildcard test",
        acceptance_criteria: ["Ok"],
        run_commands: ["echo ok"],
        blocked_by: ["none"],
      },
    });

    // Move to in_progress (emits TASK_STARTED)
    await client.send({ type: "update_task_status", taskId: handoff.taskId, status: "in_progress" });

    expect(events.length).toBeGreaterThanOrEqual(2);
    const types = events.map(e => e.type);
    expect(types).toContain("TASK_CREATED");
    expect(types).toContain("TASK_STARTED");

    client.destroy();
  });
});
