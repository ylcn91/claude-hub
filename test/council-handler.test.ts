import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { registerCouncilHandlers } from "../src/daemon/handlers/council";
import type { HandlerContext, HandlerFn } from "../src/daemon/handler-types";
import { DaemonState } from "../src/daemon/state";
import {
  loadCouncilCache,
  loadVerificationCache,
} from "../src/services/council-store";

const TEST_DIR = join(import.meta.dir, ".test-council-handler");

let savedAgentctlDir: string | undefined;
let dbCounter = 0;
function uniqueDbPath(): string {
  return join(TEST_DIR, `test-${++dbCounter}-${Date.now()}.db`);
}

// Create a mock socket and capture writes
function createMockSocket() {
  const written: string[] = [];
  return {
    socket: {
      write(data: string) {
        written.push(data);
        return true;
      },
      writable: true,
      destroyed: false,
    } as any,
    written,
  };
}

function createMockContext(opts: {
  features?: { council?: boolean };
  councilConfig?: { members: string[]; chairman: string; timeoutMs?: number };
}): { ctx: HandlerContext; state: DaemonState } {
  const state = new DaemonState(uniqueDbPath());
  const ctx: HandlerContext = {
    state,
    features: opts.features as any,
    councilConfig: opts.councilConfig,
    safeWrite: (socket: any, data: string) => {
      socket.write(data);
    },
    reply: (_msg: any, response: object) => {
      return JSON.stringify(response);
    },
    getAccountName: () => "test-account",
  };
  return { ctx, state };
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

describe("council_verify handler", () => {
  test("returns error when council feature is not enabled", async () => {
    const { ctx, state } = createMockContext({ features: { council: false } });
    const handlers = registerCouncilHandlers(ctx);
    const { socket, written } = createMockSocket();

    await handlers.council_verify(socket, { type: "council_verify", taskId: "t1", goal: "test", acceptance_criteria: ["c1"] });

    expect(written).toHaveLength(1);
    const response = JSON.parse(written[0]);
    expect(response.type).toBe("error");
    expect(response.error).toContain("Council feature not enabled");
    state.close();
  });

  test("returns error when council feature flag is missing", async () => {
    const { ctx, state } = createMockContext({ features: {} });
    const handlers = registerCouncilHandlers(ctx);
    const { socket, written } = createMockSocket();

    await handlers.council_verify(socket, { type: "council_verify", taskId: "t1", goal: "test", acceptance_criteria: ["c1"] });

    expect(written).toHaveLength(1);
    const response = JSON.parse(written[0]);
    expect(response.type).toBe("error");
    expect(response.error).toContain("Council feature not enabled");
    state.close();
  });

  test("validates taskId field", async () => {
    const { ctx, state } = createMockContext({ features: { council: true } });
    const handlers = registerCouncilHandlers(ctx);
    const { socket, written } = createMockSocket();

    await handlers.council_verify(socket, { type: "council_verify", goal: "test", acceptance_criteria: ["c1"] });

    expect(written).toHaveLength(1);
    const response = JSON.parse(written[0]);
    expect(response.type).toBe("error");
    expect(response.error).toContain("Invalid field: taskId");
    state.close();
  });

  test("validates goal field", async () => {
    const { ctx, state } = createMockContext({ features: { council: true } });
    const handlers = registerCouncilHandlers(ctx);
    const { socket, written } = createMockSocket();

    await handlers.council_verify(socket, { type: "council_verify", taskId: "t1", acceptance_criteria: ["c1"] });

    expect(written).toHaveLength(1);
    const response = JSON.parse(written[0]);
    expect(response.type).toBe("error");
    expect(response.error).toContain("Invalid field: goal");
    state.close();
  });

  test("validates acceptance_criteria field", async () => {
    const { ctx, state } = createMockContext({ features: { council: true } });
    const handlers = registerCouncilHandlers(ctx);
    const { socket, written } = createMockSocket();

    await handlers.council_verify(socket, { type: "council_verify", taskId: "t1", goal: "test" });

    expect(written).toHaveLength(1);
    const response = JSON.parse(written[0]);
    expect(response.type).toBe("error");
    expect(response.error).toContain("Invalid field: acceptance_criteria");
    state.close();
  });

  test("rejects empty taskId", async () => {
    const { ctx, state } = createMockContext({ features: { council: true } });
    const handlers = registerCouncilHandlers(ctx);
    const { socket, written } = createMockSocket();

    await handlers.council_verify(socket, { type: "council_verify", taskId: "", goal: "test", acceptance_criteria: ["c1"] });

    const response = JSON.parse(written[0]);
    expect(response.type).toBe("error");
    expect(response.error).toContain("Invalid field: taskId");
    state.close();
  });

  test("rejects empty goal", async () => {
    const { ctx, state } = createMockContext({ features: { council: true } });
    const handlers = registerCouncilHandlers(ctx);
    const { socket, written } = createMockSocket();

    await handlers.council_verify(socket, { type: "council_verify", taskId: "t1", goal: "", acceptance_criteria: ["c1"] });

    const response = JSON.parse(written[0]);
    expect(response.type).toBe("error");
    expect(response.error).toContain("Invalid field: goal");
    state.close();
  });
});

describe("council_analyze handler", () => {
  test("returns error when council feature is not enabled", async () => {
    const { ctx, state } = createMockContext({ features: { council: false } });
    const handlers = registerCouncilHandlers(ctx);
    const { socket, written } = createMockSocket();

    await handlers.council_analyze(socket, { type: "council_analyze", goal: "test" });

    const response = JSON.parse(written[0]);
    expect(response.type).toBe("error");
    expect(response.error).toContain("Council feature not enabled");
    state.close();
  });

  test("validates goal field", async () => {
    const { ctx, state } = createMockContext({ features: { council: true } });
    const handlers = registerCouncilHandlers(ctx);
    const { socket, written } = createMockSocket();

    await handlers.council_analyze(socket, { type: "council_analyze" });

    const response = JSON.parse(written[0]);
    expect(response.type).toBe("error");
    expect(response.error).toContain("Invalid field: goal");
    state.close();
  });

  test("rejects empty goal", async () => {
    const { ctx, state } = createMockContext({ features: { council: true } });
    const handlers = registerCouncilHandlers(ctx);
    const { socket, written } = createMockSocket();

    await handlers.council_analyze(socket, { type: "council_analyze", goal: "" });

    const response = JSON.parse(written[0]);
    expect(response.type).toBe("error");
    expect(response.error).toContain("Invalid field: goal");
    state.close();
  });
});

describe("council_history handler", () => {
  test("returns error when council feature is not enabled", async () => {
    const { ctx, state } = createMockContext({ features: { council: false } });
    const handlers = registerCouncilHandlers(ctx);
    const { socket, written } = createMockSocket();

    await handlers.council_history(socket, { type: "council_history" });

    const response = JSON.parse(written[0]);
    expect(response.type).toBe("error");
    expect(response.error).toContain("Council feature not enabled");
    state.close();
  });

  test("returns empty caches when no data exists", async () => {
    const { ctx, state } = createMockContext({ features: { council: true } });
    const handlers = registerCouncilHandlers(ctx);
    const { socket, written } = createMockSocket();

    await handlers.council_history(socket, { type: "council_history" });

    const response = JSON.parse(written[0]);
    expect(response.type).toBe("result");
    expect(response.analyses).toEqual([]);
    expect(response.verifications).toEqual([]);
    state.close();
  });

  test("returns persisted analyses after council_analyze stores data", async () => {
    // Directly write a council cache and verify it's returned by the handler
    const { appendCouncilAnalysis } = await import("../src/services/council-store");
    await appendCouncilAnalysis(
      {
        taskGoal: "Test goal",
        timestamp: new Date().toISOString(),
        individualAnalyses: [],
        peerRankings: [],
        aggregateRankings: [],
        synthesis: {
          chairman: "claude-1",
          consensusComplexity: "low",
          consensusDurationMinutes: 15,
          consensusSkills: [],
          recommendedApproach: "Simple",
          confidence: 0.9,
        },
      },
      TEST_DIR,
    );

    const { ctx, state } = createMockContext({ features: { council: true } });
    const handlers = registerCouncilHandlers(ctx);
    const { socket, written } = createMockSocket();

    await handlers.council_history(socket, { type: "council_history" });

    const response = JSON.parse(written[0]);
    expect(response.type).toBe("result");
    expect(response.analyses).toHaveLength(1);
    expect(response.analyses[0].taskGoal).toBe("Test goal");
    state.close();
  });
});

describe("handler registration", () => {
  test("registers all three council handlers", () => {
    const { ctx, state } = createMockContext({ features: { council: true } });
    const handlers = registerCouncilHandlers(ctx);

    expect(handlers.council_analyze).toBeFunction();
    expect(handlers.council_verify).toBeFunction();
    expect(handlers.council_history).toBeFunction();
    state.close();
  });

  test("consistent feature flag checking across all handlers", async () => {
    // All handlers should reject when council feature is disabled
    const { ctx, state } = createMockContext({ features: { council: false } });
    const handlers = registerCouncilHandlers(ctx);

    for (const [name, handler] of Object.entries(handlers)) {
      const { socket, written } = createMockSocket();
      await handler(socket, {
        type: name,
        taskId: "t1",
        goal: "test",
        acceptance_criteria: ["c1"],
      });

      const response = JSON.parse(written[0]);
      expect(response.type).toBe("error");
      expect(response.error).toContain("Council feature not enabled");
    }
    state.close();
  });
});
