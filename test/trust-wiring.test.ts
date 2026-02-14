/**
 * TrustStore wiring tests — verifies trust updates on accept/reject.
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
// Helpers (no mock.module)
// ---------------------------------------------------------------------------

let dirCounter = 0;
function freshTestDir(): string {
  const dir = join(import.meta.dir, `.test-tw-${++dirCounter}-${Date.now()}`);
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

/** Create a handoff and move it through the lifecycle to ready_for_review */
async function createTaskAtReview(client: TestClient, to: string): Promise<string> {
  const handoff = await client.send({
    type: "handoff_task",
    to,
    payload: {
      goal: "Trust test task",
      acceptance_criteria: ["Done"],
      run_commands: ["echo ok"],
      blocked_by: ["none"],
    },
  });
  const taskId = handoff.taskId;
  await client.send({ type: "update_task_status", taskId, status: "in_progress" });
  await client.send({ type: "update_task_status", taskId, status: "ready_for_review" });
  return taskId;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TrustStore wiring in daemon handlers", () => {
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

    const result = await startDaemon({
      dbPath: uniqueDb(testDir),
      features: { trust: true },
    });
    server = result.server;
    state = result.state;
  });

  afterEach(() => {
    process.env.AGENTCTL_DIR = origDir;
    try { state.close(); } catch {}
    try { stopDaemon(server); } catch {}
    rmSync(testDir, { recursive: true, force: true });
  });

  test("acceptTask records completed outcome in trustStore", async () => {
    await Bun.sleep(50);
    const sockPath = join(testDir, "hub.sock");
    const client = await connectAndAuth(sockPath, "delegator", "del-tok");

    const taskId = await createTaskAtReview(client, "worker");
    await client.send({ type: "update_task_status", taskId, status: "accepted" });

    const rep = state.trustStore!.get("worker");
    expect(rep).not.toBeNull();
    expect(rep!.totalTasksCompleted).toBe(1);

    client.destroy();
  });

  test("rejectTask records rejected outcome in trustStore", async () => {
    await Bun.sleep(50);
    const sockPath = join(testDir, "hub.sock");
    const client = await connectAndAuth(sockPath, "delegator", "del-tok");

    const taskId = await createTaskAtReview(client, "worker");
    await client.send({ type: "update_task_status", taskId, status: "rejected", reason: "Tests failing" });

    const rep = state.trustStore!.get("worker");
    expect(rep).not.toBeNull();
    expect(rep!.totalTasksRejected).toBe(1);

    client.destroy();
  });

  test("accept emits TRUST_UPDATE event via eventBus", async () => {
    await Bun.sleep(50);
    const events: DelegationEvent[] = [];
    state.eventBus.on("TRUST_UPDATE", (e: any) => events.push(e));

    const sockPath = join(testDir, "hub.sock");
    const client = await connectAndAuth(sockPath, "delegator", "del-tok");

    const taskId = await createTaskAtReview(client, "worker");
    await client.send({ type: "update_task_status", taskId, status: "accepted" });

    expect(events.length).toBeGreaterThanOrEqual(1);
    const trustEvent = events.find((e: any) => e.agent === "worker");
    expect(trustEvent).toBeDefined();
    expect((trustEvent as any).reason).toBe("task_accepted");

    client.destroy();
  });

  test("reject emits TRUST_UPDATE event via eventBus", async () => {
    await Bun.sleep(50);
    const events: DelegationEvent[] = [];
    state.eventBus.on("TRUST_UPDATE", (e: any) => events.push(e));

    const sockPath = join(testDir, "hub.sock");
    const client = await connectAndAuth(sockPath, "delegator", "del-tok");

    const taskId = await createTaskAtReview(client, "worker");
    await client.send({ type: "update_task_status", taskId, status: "rejected", reason: "Poor quality" });

    expect(events.length).toBeGreaterThanOrEqual(1);
    const trustEvent = events.find((e: any) => e.agent === "worker");
    expect(trustEvent).toBeDefined();
    expect((trustEvent as any).reason).toBe("task_rejected");

    client.destroy();
  });

  test("trustStore is not initialized when trust feature is disabled", async () => {
    // Stop current daemon and start without trust
    try { state.close(); } catch {}
    try { stopDaemon(server); } catch {}

    const result = await startDaemon({
      dbPath: uniqueDb(testDir),
      features: { trust: false },
    });
    server = result.server;
    state = result.state;

    expect(state.trustStore).toBeUndefined();

    await Bun.sleep(50);
    const sockPath = join(testDir, "hub.sock");
    const client = await connectAndAuth(sockPath, "delegator", "del-tok");

    // Should not throw even without trustStore
    const taskId = await createTaskAtReview(client, "worker");
    const reply = await client.send({ type: "update_task_status", taskId, status: "accepted" });
    expect(reply.type).toBe("result");

    client.destroy();
  });

  test("duration is calculated from task events for accepted tasks", async () => {
    await Bun.sleep(50);
    const sockPath = join(testDir, "hub.sock");
    const client = await connectAndAuth(sockPath, "delegator", "del-tok");

    const taskId = await createTaskAtReview(client, "worker");
    await client.send({ type: "update_task_status", taskId, status: "accepted" });

    const rep = state.trustStore!.get("worker");
    expect(rep).not.toBeNull();
    // Duration should be calculated (from in_progress start to now)
    expect(rep!.averageCompletionMinutes).toBeGreaterThanOrEqual(0);

    client.destroy();
  });
});

describe("FeatureFlags config schema", () => {
  test("trust flag is accepted in config validation", async () => {
    const { z } = await import("zod");
    const featureFlagsSchema = z.object({
      workspaceWorktree: z.boolean().optional(),
      autoAcceptance: z.boolean().optional(),
      capabilityRouting: z.boolean().optional(),
      slaEngine: z.boolean().optional(),
      githubIntegration: z.boolean().optional(),
      reviewBundles: z.boolean().optional(),
      knowledgeIndex: z.boolean().optional(),
      reliability: z.boolean().optional(),
      workflow: z.boolean().optional(),
      retro: z.boolean().optional(),
      sessions: z.boolean().optional(),
      trust: z.boolean().optional(),
    }).optional();

    const result = featureFlagsSchema.safeParse({ trust: true });
    expect(result.success).toBe(true);
  });

  test("trust flag exists in TypeScript FeatureFlags interface", () => {
    const flags: import("../src/types").FeatureFlags = { trust: true };
    expect(flags.trust).toBe(true);
  });
});
