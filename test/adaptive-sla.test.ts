import { test, expect, describe, beforeEach } from "bun:test";
import {
  detectEntireTriggers,
  determineAction,
  isCoolingDown,
  setCooldown,
  clearCooldowns,
  AdaptiveSLAEngine,
  DEFAULT_ADAPTIVE_SLA_CONFIG,
  type EntireTrigger,
  type AdaptiveSLAConfig,
} from "../src/services/sla-engine";
import { EventBus } from "../src/services/event-bus";
import type { EntireSessionMetrics } from "../src/services/entire-adapter";
import type { Task } from "../src/services/tasks";
import type { TaskCharacteristics } from "../src/services/event-bus";

// --- Helpers ---

function makeMetrics(overrides: Partial<EntireSessionMetrics> = {}): EntireSessionMetrics {
  return {
    sessionId: "sess-1",
    phase: "active",
    stepCount: 3,
    filesTouched: ["a.ts", "b.ts"],
    totalTokens: 50_000,
    tokenBurnRate: 500,
    contextSaturation: 0.25,
    progressEstimate: 30,
    elapsedMinutes: 10,
    agentType: "Claude Code",
    ...overrides,
  };
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    title: "Test task",
    status: "in_progress",
    assignee: "agent-alpha",
    createdAt: new Date(Date.now() - 30 * 60_000).toISOString(),
    events: [
      {
        type: "status_changed",
        timestamp: new Date(Date.now() - 20 * 60_000).toISOString(),
        from: "todo",
        to: "in_progress",
      },
    ],
    ...overrides,
  };
}

function makeTrigger(overrides: Partial<EntireTrigger> = {}): EntireTrigger {
  return {
    type: "token_burn_rate",
    taskId: "task-1",
    sessionId: "sess-1",
    agent: "Claude Code",
    detail: "test trigger",
    ...overrides,
  };
}

// --- detectEntireTriggers ---

describe("detectEntireTriggers", () => {
  const now = Date.now();

  test("detects token_burn_rate when rate exceeds 2x average", () => {
    const metrics = makeMetrics({ tokenBurnRate: 1100 });
    const triggers = detectEntireTriggers(metrics, "task-1", 500, now, now);
    expect(triggers.some((t) => t.type === "token_burn_rate")).toBe(true);
    expect(triggers.find((t) => t.type === "token_burn_rate")!.detail).toContain("1100");
  });

  test("does NOT trigger token_burn_rate when rate is within 2x", () => {
    const metrics = makeMetrics({ tokenBurnRate: 900 });
    const triggers = detectEntireTriggers(metrics, "task-1", 500, now, now);
    expect(triggers.some((t) => t.type === "token_burn_rate")).toBe(false);
  });

  test("does NOT trigger token_burn_rate when average is 0", () => {
    const metrics = makeMetrics({ tokenBurnRate: 5000 });
    const triggers = detectEntireTriggers(metrics, "task-1", 0, now, now);
    expect(triggers.some((t) => t.type === "token_burn_rate")).toBe(false);
  });

  test("detects no_checkpoint after 10 minutes", () => {
    const lastCheckpoint = now - 11 * 60_000; // 11 minutes ago
    const metrics = makeMetrics();
    const triggers = detectEntireTriggers(metrics, "task-1", 0, lastCheckpoint, now);
    expect(triggers.some((t) => t.type === "no_checkpoint")).toBe(true);
  });

  test("does NOT trigger no_checkpoint within 10 minutes", () => {
    const lastCheckpoint = now - 9 * 60_000; // 9 minutes ago
    const metrics = makeMetrics();
    const triggers = detectEntireTriggers(metrics, "task-1", 0, lastCheckpoint, now);
    expect(triggers.some((t) => t.type === "no_checkpoint")).toBe(false);
  });

  test("detects context_saturation above 80%", () => {
    const metrics = makeMetrics({ contextSaturation: 0.85 });
    const triggers = detectEntireTriggers(metrics, "task-1", 0, now, now);
    expect(triggers.some((t) => t.type === "context_saturation")).toBe(true);
    expect(triggers.find((t) => t.type === "context_saturation")!.detail).toContain("85%");
  });

  test("does NOT trigger context_saturation at 80% exactly", () => {
    const metrics = makeMetrics({ contextSaturation: 0.80 });
    const triggers = detectEntireTriggers(metrics, "task-1", 0, now, now);
    expect(triggers.some((t) => t.type === "context_saturation")).toBe(false);
  });

  test("detects session_ended_incomplete when phase is ended", () => {
    const metrics = makeMetrics({ phase: "ended" });
    const triggers = detectEntireTriggers(metrics, "task-1", 0, now, now);
    expect(triggers.some((t) => t.type === "session_ended_incomplete")).toBe(true);
  });

  test("does NOT trigger session_ended_incomplete when phase is active", () => {
    const metrics = makeMetrics({ phase: "active" });
    const triggers = detectEntireTriggers(metrics, "task-1", 0, now, now);
    expect(triggers.some((t) => t.type === "session_ended_incomplete")).toBe(false);
  });

  test("can detect multiple triggers simultaneously", () => {
    const lastCheckpoint = now - 15 * 60_000;
    const metrics = makeMetrics({
      tokenBurnRate: 2000,
      contextSaturation: 0.9,
      phase: "ended",
    });
    const triggers = detectEntireTriggers(metrics, "task-1", 500, lastCheckpoint, now);
    expect(triggers.length).toBe(4); // all four triggers
    const types = triggers.map((t) => t.type);
    expect(types).toContain("token_burn_rate");
    expect(types).toContain("no_checkpoint");
    expect(types).toContain("context_saturation");
    expect(types).toContain("session_ended_incomplete");
  });

  test("respects custom config thresholds", () => {
    const customConfig: AdaptiveSLAConfig = {
      tokenBurnRateMultiplier: 3,
      noCheckpointMinutes: 5,
      contextSaturationThreshold: 0.5,
      cooldownMinutes: 30,
      terminateUnresponsiveMultiplier: 3,
    };
    const lastCheckpoint = now - 6 * 60_000;
    const metrics = makeMetrics({
      tokenBurnRate: 1200,
      contextSaturation: 0.6,
    });
    const triggers = detectEntireTriggers(metrics, "task-1", 500, lastCheckpoint, now, customConfig);
    // burn rate 1200 < 500*3=1500 → no trigger
    expect(triggers.some((t) => t.type === "token_burn_rate")).toBe(false);
    // 6 min > 5 min → trigger
    expect(triggers.some((t) => t.type === "no_checkpoint")).toBe(true);
    // 0.6 > 0.5 → trigger
    expect(triggers.some((t) => t.type === "context_saturation")).toBe(true);
  });
});

// --- determineAction ---

describe("determineAction", () => {
  test("returns ping for token_burn_rate trigger", () => {
    const trigger = makeTrigger({ type: "token_burn_rate" });
    expect(determineAction(trigger)).toBe("ping");
  });

  test("returns ping for no_checkpoint trigger", () => {
    const trigger = makeTrigger({ type: "no_checkpoint" });
    expect(determineAction(trigger)).toBe("ping");
  });

  test("returns suggest_reassign for context_saturation with no criticality", () => {
    const trigger = makeTrigger({ type: "context_saturation" });
    expect(determineAction(trigger)).toBe("suggest_reassign");
  });

  test("returns auto_reassign for context_saturation with high criticality", () => {
    const trigger = makeTrigger({ type: "context_saturation" });
    const chars: TaskCharacteristics = { criticality: "high" };
    expect(determineAction(trigger, chars)).toBe("auto_reassign");
  });

  test("returns auto_reassign for session_ended_incomplete with critical criticality", () => {
    const trigger = makeTrigger({ type: "session_ended_incomplete" });
    const chars: TaskCharacteristics = { criticality: "critical" };
    expect(determineAction(trigger, chars)).toBe("auto_reassign");
  });

  test("returns suggest_reassign for session_ended_incomplete with medium criticality", () => {
    const trigger = makeTrigger({ type: "session_ended_incomplete" });
    const chars: TaskCharacteristics = { criticality: "medium" };
    expect(determineAction(trigger, chars)).toBe("suggest_reassign");
  });

  test("returns escalate_human when reversibility is irreversible", () => {
    const trigger = makeTrigger({ type: "context_saturation" });
    const chars: TaskCharacteristics = { reversibility: "irreversible" };
    expect(determineAction(trigger, chars)).toBe("escalate_human");
  });

  test("escalate_human takes priority over auto_reassign for irreversible tasks", () => {
    const trigger = makeTrigger({ type: "session_ended_incomplete" });
    const chars: TaskCharacteristics = { criticality: "critical", reversibility: "irreversible" };
    expect(determineAction(trigger, chars)).toBe("escalate_human");
  });

  test("returns terminate when agent unresponsive for 2x threshold", () => {
    const trigger = makeTrigger({ type: "no_checkpoint" });
    const thresholdMs = 10 * 60_000; // 10 min
    const unresponsiveSince = Date.now() - 25 * 60_000; // 25 min ago (> 2*10)
    expect(determineAction(trigger, undefined, unresponsiveSince, thresholdMs)).toBe("terminate");
  });

  test("does NOT terminate when agent unresponsive for less than 2x threshold", () => {
    const trigger = makeTrigger({ type: "no_checkpoint" });
    const thresholdMs = 10 * 60_000;
    const unresponsiveSince = Date.now() - 15 * 60_000; // 15 min (< 2*10=20)
    expect(determineAction(trigger, undefined, unresponsiveSince, thresholdMs)).not.toBe("terminate");
  });
});

// --- Cooldown tracking ---

describe("cooldown tracking", () => {
  beforeEach(() => {
    clearCooldowns();
  });

  test("isCoolingDown returns false when no cooldown set", () => {
    expect(isCoolingDown("task-1", Date.now(), 15 * 60_000)).toBe(false);
  });

  test("isCoolingDown returns true within cooldown window", () => {
    const now = Date.now();
    setCooldown("task-1", now);
    expect(isCoolingDown("task-1", now + 5 * 60_000, 15 * 60_000)).toBe(true);
  });

  test("isCoolingDown returns false after cooldown expires", () => {
    const now = Date.now();
    setCooldown("task-1", now);
    expect(isCoolingDown("task-1", now + 20 * 60_000, 15 * 60_000)).toBe(false);
  });

  test("clearCooldowns resets all cooldowns", () => {
    const now = Date.now();
    setCooldown("task-1", now);
    setCooldown("task-2", now);
    clearCooldowns();
    expect(isCoolingDown("task-1", now + 1000, 15 * 60_000)).toBe(false);
    expect(isCoolingDown("task-2", now + 1000, 15 * 60_000)).toBe(false);
  });
});

// --- AdaptiveSLAEngine ---

describe("AdaptiveSLAEngine", () => {
  beforeEach(() => {
    clearCooldowns();
  });

  test("returns empty when entireMonitoringEnabled is false", () => {
    const engine = new AdaptiveSLAEngine();
    const tasks = [makeTask()];
    const result = engine.checkAdaptiveTasks(tasks, false);
    expect(result).toEqual([]);
  });

  test("returns empty when no entireAdapter provided", () => {
    const engine = new AdaptiveSLAEngine();
    const tasks = [makeTask()];
    const result = engine.checkAdaptiveTasks(tasks, true);
    expect(result).toEqual([]);
  });

  test("skips tasks not in_progress", () => {
    const mockAdapter = {
      getSessionMetrics: () => makeMetrics({ tokenBurnRate: 5000 }),
      getLinkedTaskId: () => "task-1",
    } as any;
    const engine = new AdaptiveSLAEngine({ entireAdapter: mockAdapter });
    engine.setAverageBurnRate("task-1", 500);
    const tasks = [makeTask({ status: "todo" }), makeTask({ status: "accepted" })];
    const result = engine.checkAdaptiveTasks(tasks, true);
    expect(result).toEqual([]);
  });

  test("detects triggers and produces escalations for in_progress tasks", () => {
    const now = Date.now();
    const mockAdapter = {
      getSessionMetrics: (id: string) =>
        id === "task-1" ? makeMetrics({ contextSaturation: 0.9, phase: "active" }) : null,
      getLinkedTaskId: () => "task-1",
    } as any;
    const engine = new AdaptiveSLAEngine({ entireAdapter: mockAdapter });
    const tasks = [makeTask()];
    const result = engine.checkAdaptiveTasks(tasks, true, now);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].trigger.type).toBe("context_saturation");
    expect(result[0].action).toBe("suggest_reassign");
  });

  test("emits RESOURCE_WARNING event for context_saturation trigger", () => {
    const now = Date.now();
    const eventBus = new EventBus();
    const emitted: any[] = [];
    eventBus.on("RESOURCE_WARNING", (e) => emitted.push(e));

    const mockAdapter = {
      getSessionMetrics: () => makeMetrics({ contextSaturation: 0.9 }),
      getLinkedTaskId: () => "task-1",
    } as any;
    const engine = new AdaptiveSLAEngine({ entireAdapter: mockAdapter, eventBus });
    const tasks = [makeTask()];
    engine.checkAdaptiveTasks(tasks, true, now);
    expect(emitted.length).toBe(1);
    expect(emitted[0].type).toBe("RESOURCE_WARNING");
  });

  test("emits SLA_WARNING event for no_checkpoint trigger", () => {
    const now = Date.now();
    const eventBus = new EventBus();
    const emitted: any[] = [];
    eventBus.on("SLA_WARNING", (e) => emitted.push(e));

    const mockAdapter = {
      getSessionMetrics: () => makeMetrics(),
      getLinkedTaskId: () => "task-1",
    } as any;
    const engine = new AdaptiveSLAEngine({ entireAdapter: mockAdapter, eventBus });
    engine.setLastCheckpointTime("task-1", now - 15 * 60_000);
    const tasks = [makeTask()];
    engine.checkAdaptiveTasks(tasks, true, now);
    expect(emitted.length).toBe(1);
    expect(emitted[0].type).toBe("SLA_WARNING");
  });

  test("emits SLA_BREACH event for session_ended_incomplete trigger", () => {
    const now = Date.now();
    const eventBus = new EventBus();
    const emitted: any[] = [];
    eventBus.on("SLA_BREACH", (e) => emitted.push(e));

    const mockAdapter = {
      getSessionMetrics: () => makeMetrics({ phase: "ended" }),
      getLinkedTaskId: () => "task-1",
    } as any;
    const engine = new AdaptiveSLAEngine({ entireAdapter: mockAdapter, eventBus });
    const tasks = [makeTask()];
    engine.checkAdaptiveTasks(tasks, true, now);
    expect(emitted.length).toBe(1);
    expect(emitted[0].type).toBe("SLA_BREACH");
    expect(emitted[0].threshold).toBe("session_ended_incomplete");
  });

  test("applies cooldown after reassignment actions", () => {
    const now = Date.now();
    const mockAdapter = {
      getSessionMetrics: () => makeMetrics({ contextSaturation: 0.9 }),
      getLinkedTaskId: () => "task-1",
    } as any;
    const engine = new AdaptiveSLAEngine({ entireAdapter: mockAdapter });
    const tasks = [makeTask()];

    // First check — should produce escalation
    const first = engine.checkAdaptiveTasks(tasks, true, now);
    expect(first.length).toBeGreaterThan(0);

    // Second check within cooldown — should be skipped
    const second = engine.checkAdaptiveTasks(tasks, true, now + 5 * 60_000);
    expect(second.length).toBe(0);

    // Third check after cooldown expires — should produce escalation again
    const third = engine.checkAdaptiveTasks(tasks, true, now + 20 * 60_000);
    expect(third.length).toBeGreaterThan(0);
  });

  test("extracts task characteristics from tags", () => {
    const now = Date.now();
    const mockAdapter = {
      getSessionMetrics: () => makeMetrics({ contextSaturation: 0.9 }),
      getLinkedTaskId: () => "task-1",
    } as any;
    const engine = new AdaptiveSLAEngine({ entireAdapter: mockAdapter });
    const tasks = [makeTask({ tags: ["criticality:high", "reversibility:partial"] })];
    const result = engine.checkAdaptiveTasks(tasks, true, now);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].characteristics?.criticality).toBe("high");
    expect(result[0].characteristics?.reversibility).toBe("partial");
    expect(result[0].action).toBe("auto_reassign");
  });

  test("escalate_human for irreversible tasks regardless of trigger", () => {
    const now = Date.now();
    const mockAdapter = {
      getSessionMetrics: () => makeMetrics({ contextSaturation: 0.9 }),
      getLinkedTaskId: () => "task-1",
    } as any;
    const engine = new AdaptiveSLAEngine({ entireAdapter: mockAdapter });
    const tasks = [makeTask({ tags: ["reversibility:irreversible", "criticality:critical"] })];
    const result = engine.checkAdaptiveTasks(tasks, true, now);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].action).toBe("escalate_human");
  });

  test("terminate action for unresponsive agent", () => {
    const now = Date.now();
    const mockAdapter = {
      getSessionMetrics: () => makeMetrics({ contextSaturation: 0.9 }),
      getLinkedTaskId: () => "task-1",
    } as any;
    const engine = new AdaptiveSLAEngine({ entireAdapter: mockAdapter });
    // Mark agent as unresponsive for 25 min (> 2x 10 min threshold)
    engine.markUnresponsive("task-1", now - 25 * 60_000);
    const tasks = [makeTask()];
    const result = engine.checkAdaptiveTasks(tasks, true, now);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].action).toBe("terminate");
  });

  test("does NOT terminate when unresponsive time is below 2x threshold", () => {
    const now = Date.now();
    const mockAdapter = {
      getSessionMetrics: () => makeMetrics({ contextSaturation: 0.9 }),
      getLinkedTaskId: () => "task-1",
    } as any;
    const engine = new AdaptiveSLAEngine({ entireAdapter: mockAdapter });
    // Mark as unresponsive for 15 min (< 2x 10 min = 20 min)
    engine.markUnresponsive("task-1", now - 15 * 60_000);
    const tasks = [makeTask()];
    const result = engine.checkAdaptiveTasks(tasks, true, now);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].action).not.toBe("terminate");
  });

  test("clearUnresponsive removes the marker", () => {
    const now = Date.now();
    const mockAdapter = {
      getSessionMetrics: () => makeMetrics({ contextSaturation: 0.9 }),
      getLinkedTaskId: () => "task-1",
    } as any;
    const engine = new AdaptiveSLAEngine({ entireAdapter: mockAdapter });
    engine.markUnresponsive("task-1", now - 25 * 60_000);
    engine.clearUnresponsive("task-1");
    const tasks = [makeTask()];
    const result = engine.checkAdaptiveTasks(tasks, true, now);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].action).not.toBe("terminate");
  });

  test("handles tasks with no tags gracefully", () => {
    const now = Date.now();
    const mockAdapter = {
      getSessionMetrics: () => makeMetrics({ contextSaturation: 0.9 }),
      getLinkedTaskId: () => "task-1",
    } as any;
    const engine = new AdaptiveSLAEngine({ entireAdapter: mockAdapter });
    const tasks = [makeTask({ tags: undefined })];
    const result = engine.checkAdaptiveTasks(tasks, true, now);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].characteristics).toBeUndefined();
    expect(result[0].action).toBe("suggest_reassign");
  });

  test("skips tasks with no metrics from adapter", () => {
    const now = Date.now();
    const mockAdapter = {
      getSessionMetrics: () => null,
      getLinkedTaskId: () => undefined,
    } as any;
    const engine = new AdaptiveSLAEngine({ entireAdapter: mockAdapter });
    const tasks = [makeTask()];
    const result = engine.checkAdaptiveTasks(tasks, true, now);
    expect(result).toEqual([]);
  });

  test("custom config overrides default thresholds", () => {
    const now = Date.now();
    const mockAdapter = {
      getSessionMetrics: () => makeMetrics({ contextSaturation: 0.55 }),
      getLinkedTaskId: () => "task-1",
    } as any;
    const customConfig: AdaptiveSLAConfig = {
      ...DEFAULT_ADAPTIVE_SLA_CONFIG,
      contextSaturationThreshold: 0.5,
    };
    const engine = new AdaptiveSLAEngine({ entireAdapter: mockAdapter, config: customConfig });
    const tasks = [makeTask()];
    const result = engine.checkAdaptiveTasks(tasks, true, now);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].trigger.type).toBe("context_saturation");
  });
});
