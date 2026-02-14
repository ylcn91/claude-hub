import { describe, test, expect, beforeEach } from "bun:test";
import {
  CircuitBreakerService,
  DEFAULT_CIRCUIT_BREAKER_CONFIG,
  type CircuitBreakerDeps,
} from "../src/services/circuit-breaker";
import { EventBus } from "../src/services/event-bus";
import { ProgressTracker } from "../src/services/progress-tracker";
import type { TaskBoard } from "../src/services/tasks";

function makeDeps(overrides?: Partial<CircuitBreakerDeps>): CircuitBreakerDeps {
  return {
    eventBus: new EventBus(),
    progressTracker: new ProgressTracker(),
    activityStore: { emit: () => ({}) },
    ...overrides,
  };
}

function makeBoard(tasks: Array<{ id: string; assignee?: string; status: string }>): TaskBoard {
  return {
    tasks: tasks.map((t) => ({
      id: t.id,
      title: `Task ${t.id}`,
      status: t.status as any,
      assignee: t.assignee,
      createdAt: new Date().toISOString(),
      events: [],
    })),
  };
}

describe("CircuitBreakerService", () => {
  let deps: CircuitBreakerDeps;
  let cb: CircuitBreakerService;

  beforeEach(() => {
    deps = makeDeps();
    cb = new CircuitBreakerService(deps);
  });

  describe("consecutive failures", () => {
    test("tracks consecutive failure count", () => {
      cb.recordFailure("agent-a");
      expect(cb.getConsecutiveFailures("agent-a")).toBe(1);

      cb.recordFailure("agent-a");
      expect(cb.getConsecutiveFailures("agent-a")).toBe(2);
    });

    test("resets count on success", () => {
      cb.recordFailure("agent-a");
      cb.recordFailure("agent-a");
      cb.recordSuccess("agent-a");

      expect(cb.getConsecutiveFailures("agent-a")).toBe(0);
    });

    test("quarantines after reaching threshold (default 3)", async () => {
      const board = makeBoard([]);
      deps.loadTasksFn = async () => board;
      deps.saveTasksFn = async () => {};
      cb = new CircuitBreakerService(deps);

      cb.recordFailure("agent-a");
      cb.recordFailure("agent-a");
      // Third failure triggers quarantine (async)
      cb.recordFailure("agent-a");

      // Wait for the async quarantine to complete
      await Bun.sleep(10);

      expect(cb.isQuarantined("agent-a")).toBe(true);
      const record = cb.getQuarantineRecord("agent-a");
      expect(record).not.toBeNull();
      expect(record!.trigger).toBe("consecutive_failures");
      expect(record!.reason).toContain("3 consecutive");
    });

    test("does not quarantine below threshold", () => {
      cb.recordFailure("agent-a");
      cb.recordFailure("agent-a");

      expect(cb.isQuarantined("agent-a")).toBe(false);
    });

    test("custom threshold works", async () => {
      const board = makeBoard([]);
      deps.loadTasksFn = async () => board;
      deps.saveTasksFn = async () => {};
      cb = new CircuitBreakerService(deps, { consecutiveFailureThreshold: 5 });

      for (let i = 0; i < 4; i++) cb.recordFailure("agent-a");
      expect(cb.isQuarantined("agent-a")).toBe(false);

      cb.recordFailure("agent-a");
      await Bun.sleep(10);
      expect(cb.isQuarantined("agent-a")).toBe(true);
    });

    test("ignores failures for already quarantined agent", async () => {
      const board = makeBoard([]);
      deps.loadTasksFn = async () => board;
      deps.saveTasksFn = async () => {};
      cb = new CircuitBreakerService(deps);

      // Quarantine manually
      await cb.quarantineAgent("agent-a", "manual", "consecutive_failures");

      // Further failures should not affect the count
      cb.recordFailure("agent-a");
      cb.recordFailure("agent-a");
      // Count is not tracked while quarantined
      expect(cb.getConsecutiveFailures("agent-a")).toBe(0);
    });

    test("tracks failures independently per agent", () => {
      cb.recordFailure("agent-a");
      cb.recordFailure("agent-a");
      cb.recordFailure("agent-b");

      expect(cb.getConsecutiveFailures("agent-a")).toBe(2);
      expect(cb.getConsecutiveFailures("agent-b")).toBe(1);
    });
  });

  describe("quarantine and reinstate", () => {
    test("quarantineAgent creates a record", async () => {
      const board = makeBoard([]);
      deps.loadTasksFn = async () => board;
      deps.saveTasksFn = async () => {};
      cb = new CircuitBreakerService(deps);

      const record = await cb.quarantineAgent("agent-a", "test reason", "consecutive_failures");

      expect(record.accountName).toBe("agent-a");
      expect(record.reason).toBe("test reason");
      expect(record.trigger).toBe("consecutive_failures");
      expect(record.quarantinedAt).toBeTruthy();
      expect(cb.isQuarantined("agent-a")).toBe(true);
    });

    test("quarantineAgent revokes active tasks", async () => {
      const board = makeBoard([
        { id: "t1", assignee: "agent-a", status: "in_progress" },
        { id: "t2", assignee: "agent-a", status: "todo" },
        { id: "t3", assignee: "agent-b", status: "in_progress" },
        { id: "t4", assignee: "agent-a", status: "accepted" },
      ]);
      let savedBoard: TaskBoard | null = null;
      deps.loadTasksFn = async () => board;
      deps.saveTasksFn = async (b) => { savedBoard = b; };
      cb = new CircuitBreakerService(deps);

      const record = await cb.quarantineAgent("agent-a", "bad agent", "trust_drop");

      expect(record.revokedTaskIds).toContain("t1");
      expect(record.revokedTaskIds).toContain("t2");
      expect(record.revokedTaskIds).not.toContain("t3"); // different agent
      expect(record.revokedTaskIds).not.toContain("t4"); // accepted status
      expect(record.revokedTaskIds).toHaveLength(2);

      // Verify tasks were unassigned
      expect(savedBoard).not.toBeNull();
      const t1 = savedBoard!.tasks.find((t) => t.id === "t1");
      expect(t1!.assignee).toBeUndefined();
      const t3 = savedBoard!.tasks.find((t) => t.id === "t3");
      expect(t3!.assignee).toBe("agent-b");
    });

    test("quarantineAgent emits REASSIGNMENT events", async () => {
      const board = makeBoard([
        { id: "t1", assignee: "agent-a", status: "in_progress" },
        { id: "t2", assignee: "agent-a", status: "todo" },
      ]);
      deps.loadTasksFn = async () => board;
      deps.saveTasksFn = async () => {};
      cb = new CircuitBreakerService(deps);

      await cb.quarantineAgent("agent-a", "reason", "consecutive_failures");

      const events = deps.eventBus.getRecent({ type: "REASSIGNMENT" });
      expect(events).toHaveLength(2);
      expect((events[0] as any).from).toBe("agent-a");
      expect((events[0] as any).to).toBe("unassigned");
      expect((events[0] as any).trigger).toContain("circuit_breaker");
    });

    test("quarantineAgent logs to activity store", async () => {
      const emitted: any[] = [];
      deps.activityStore = { emit: (e: any) => { emitted.push(e); return e; } };
      deps.loadTasksFn = async () => makeBoard([]);
      deps.saveTasksFn = async () => {};
      cb = new CircuitBreakerService(deps);

      await cb.quarantineAgent("agent-a", "test", "unresponsive");

      expect(emitted).toHaveLength(1);
      expect(emitted[0].type).toBe("agent_quarantined");
      expect(emitted[0].account).toBe("agent-a");
      expect(emitted[0].metadata.trigger).toBe("unresponsive");
    });

    test("reinstateAgent removes quarantine", async () => {
      deps.loadTasksFn = async () => makeBoard([]);
      deps.saveTasksFn = async () => {};
      cb = new CircuitBreakerService(deps);

      await cb.quarantineAgent("agent-a", "test", "consecutive_failures");
      expect(cb.isQuarantined("agent-a")).toBe(true);

      const result = cb.reinstateAgent("agent-a");
      expect(result).toBe(true);
      expect(cb.isQuarantined("agent-a")).toBe(false);
    });

    test("reinstateAgent resets failure counters", async () => {
      deps.loadTasksFn = async () => makeBoard([]);
      deps.saveTasksFn = async () => {};
      cb = new CircuitBreakerService(deps);

      cb.recordFailure("agent-a");
      cb.recordFailure("agent-a");
      cb.recordFailure("agent-a");
      await Bun.sleep(10);

      cb.reinstateAgent("agent-a");
      expect(cb.getConsecutiveFailures("agent-a")).toBe(0);
    });

    test("reinstateAgent logs to activity store", async () => {
      const emitted: any[] = [];
      deps.activityStore = { emit: (e: any) => { emitted.push(e); return e; } };
      deps.loadTasksFn = async () => makeBoard([]);
      deps.saveTasksFn = async () => {};
      cb = new CircuitBreakerService(deps);

      await cb.quarantineAgent("agent-a", "test", "trust_drop");
      emitted.length = 0;

      cb.reinstateAgent("agent-a");
      expect(emitted).toHaveLength(1);
      expect(emitted[0].type).toBe("agent_reinstated");
      expect(emitted[0].account).toBe("agent-a");
    });

    test("reinstateAgent returns false for non-quarantined agent", () => {
      expect(cb.reinstateAgent("agent-a")).toBe(false);
    });

    test("getAllQuarantined returns all records", async () => {
      deps.loadTasksFn = async () => makeBoard([]);
      deps.saveTasksFn = async () => {};
      cb = new CircuitBreakerService(deps);

      await cb.quarantineAgent("agent-a", "r1", "consecutive_failures");
      await cb.quarantineAgent("agent-b", "r2", "trust_drop");

      const all = cb.getAllQuarantined();
      expect(all).toHaveLength(2);
      const names = all.map((r) => r.accountName);
      expect(names).toContain("agent-a");
      expect(names).toContain("agent-b");
    });
  });

  describe("trust drop detection", () => {
    test("detects trust drop exceeding threshold", async () => {
      // Create a mock trust store
      const now = new Date();
      const recentTime = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(); // 2h ago
      const mockTrustStore = {
        getHistory: (_account: string, _limit?: number) => [
          { id: "1", timestamp: recentTime, delta: -10, reason: "failure1", oldScore: 60, newScore: 50 },
          { id: "2", timestamp: recentTime, delta: -15, reason: "failure2", oldScore: 50, newScore: 35 },
        ],
      } as any;

      deps.trustStore = mockTrustStore;
      deps.loadTasksFn = async () => makeBoard([]);
      deps.saveTasksFn = async () => {};
      cb = new CircuitBreakerService(deps);

      const dropped = cb.checkTrustDrop("agent-a");
      expect(dropped).toBe(true);
      // Wait for async quarantine
      await Bun.sleep(10);
      expect(cb.isQuarantined("agent-a")).toBe(true);
      const record = cb.getQuarantineRecord("agent-a");
      expect(record!.trigger).toBe("trust_drop");
    });

    test("ignores trust changes outside window", () => {
      const oldTime = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(); // 48h ago
      const mockTrustStore = {
        getHistory: () => [
          { id: "1", timestamp: oldTime, delta: -30, reason: "old", oldScore: 80, newScore: 50 },
        ],
      } as any;

      deps.trustStore = mockTrustStore;
      cb = new CircuitBreakerService(deps);

      const dropped = cb.checkTrustDrop("agent-a");
      expect(dropped).toBe(false);
    });

    test("does not trigger below threshold", () => {
      const recentTime = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
      const mockTrustStore = {
        getHistory: () => [
          { id: "1", timestamp: recentTime, delta: -10, reason: "minor", oldScore: 60, newScore: 50 },
        ],
      } as any;

      deps.trustStore = mockTrustStore;
      cb = new CircuitBreakerService(deps);

      const dropped = cb.checkTrustDrop("agent-a");
      expect(dropped).toBe(false);
    });

    test("returns false when no trust store available", () => {
      // deps.trustStore is undefined by default
      const dropped = cb.checkTrustDrop("agent-a");
      expect(dropped).toBe(false);
    });

    test("returns false when no history available", () => {
      deps.trustStore = { getHistory: () => [] } as any;
      cb = new CircuitBreakerService(deps);

      const dropped = cb.checkTrustDrop("agent-a");
      expect(dropped).toBe(false);
    });

    test("skips check for already quarantined agent", async () => {
      deps.loadTasksFn = async () => makeBoard([]);
      deps.saveTasksFn = async () => {};
      const recentTime = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
      deps.trustStore = {
        getHistory: () => [
          { id: "1", timestamp: recentTime, delta: -30, reason: "big drop", oldScore: 80, newScore: 50 },
        ],
      } as any;
      cb = new CircuitBreakerService(deps);

      await cb.quarantineAgent("agent-a", "already quarantined", "consecutive_failures");
      const dropped = cb.checkTrustDrop("agent-a");
      expect(dropped).toBe(false);
    });
  });

  describe("unresponsive detection", () => {
    test("detects stalled tasks", async () => {
      // Create a progress report that is old
      const tracker = new ProgressTracker();
      // Manually inject an old report by reporting and then checking with threshold
      tracker.report({
        taskId: "t1",
        agent: "agent-a",
        percent: 50,
        currentStep: "working",
      });

      // Hack the timestamp to be old
      const history = tracker.getHistory("t1");
      (history[0] as any).timestamp = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1h ago

      deps.progressTracker = tracker;
      deps.loadTasksFn = async () => makeBoard([{ id: "t1", assignee: "agent-a", status: "in_progress" }]);
      deps.saveTasksFn = async () => {};
      cb = new CircuitBreakerService(deps);

      const unresponsive = cb.checkUnresponsive("agent-a", ["t1"]);
      expect(unresponsive).toBe(true);
      // Wait for async quarantine
      await Bun.sleep(10);
      expect(cb.isQuarantined("agent-a")).toBe(true);
      const record = cb.getQuarantineRecord("agent-a");
      expect(record!.trigger).toBe("unresponsive");
    });

    test("does not flag recent progress", () => {
      const tracker = new ProgressTracker();
      tracker.report({
        taskId: "t1",
        agent: "agent-a",
        percent: 50,
        currentStep: "working",
      });

      deps.progressTracker = tracker;
      cb = new CircuitBreakerService(deps);

      const unresponsive = cb.checkUnresponsive("agent-a", ["t1"]);
      expect(unresponsive).toBe(false);
    });

    test("does not flag tasks with no progress reports", () => {
      // ProgressTracker.isStalled returns false when there are no reports
      const tracker = new ProgressTracker();
      deps.progressTracker = tracker;
      cb = new CircuitBreakerService(deps);

      const unresponsive = cb.checkUnresponsive("agent-a", ["t1"]);
      expect(unresponsive).toBe(false);
    });

    test("skips check for already quarantined agent", async () => {
      deps.loadTasksFn = async () => makeBoard([]);
      deps.saveTasksFn = async () => {};
      cb = new CircuitBreakerService(deps);

      await cb.quarantineAgent("agent-a", "already quarantined", "consecutive_failures");
      const unresponsive = cb.checkUnresponsive("agent-a", ["t1"]);
      expect(unresponsive).toBe(false);
    });
  });

  describe("checkAgent", () => {
    test("returns quarantined true for already quarantined agent", async () => {
      deps.loadTasksFn = async () => makeBoard([]);
      deps.saveTasksFn = async () => {};
      cb = new CircuitBreakerService(deps);

      await cb.quarantineAgent("agent-a", "test reason", "trust_drop");
      const result = cb.checkAgent("agent-a", []);
      expect(result.quarantined).toBe(true);
      expect(result.reason).toBe("test reason");
    });

    test("returns quarantined false for healthy agent", () => {
      const result = cb.checkAgent("agent-a", []);
      expect(result.quarantined).toBe(false);
      expect(result.reason).toBeUndefined();
    });

    test("triggers quarantine via consecutive failures check", async () => {
      deps.loadTasksFn = async () => makeBoard([]);
      deps.saveTasksFn = async () => {};
      cb = new CircuitBreakerService(deps);

      cb.recordFailure("agent-a");
      cb.recordFailure("agent-a");
      cb.recordFailure("agent-a");
      await Bun.sleep(10);

      const result = cb.checkAgent("agent-a", []);
      expect(result.quarantined).toBe(true);
    });
  });

  describe("EventBus integration", () => {
    test("subscribes to TASK_COMPLETED failure events", async () => {
      deps.loadTasksFn = async () => makeBoard([]);
      deps.saveTasksFn = async () => {};
      cb = new CircuitBreakerService(deps);
      cb.subscribe();

      deps.eventBus.emit({ type: "TASK_COMPLETED", taskId: "t1", agent: "agent-a", result: "failure" });
      deps.eventBus.emit({ type: "TASK_COMPLETED", taskId: "t2", agent: "agent-a", result: "failure" });
      deps.eventBus.emit({ type: "TASK_COMPLETED", taskId: "t3", agent: "agent-a", result: "failure" });

      await Bun.sleep(20);

      expect(cb.isQuarantined("agent-a")).toBe(true);
      cb.unsubscribe();
    });

    test("subscribes to TASK_COMPLETED success events to reset counter", () => {
      cb.subscribe();

      deps.eventBus.emit({ type: "TASK_COMPLETED", taskId: "t1", agent: "agent-a", result: "failure" });
      deps.eventBus.emit({ type: "TASK_COMPLETED", taskId: "t2", agent: "agent-a", result: "failure" });
      deps.eventBus.emit({ type: "TASK_COMPLETED", taskId: "t3", agent: "agent-a", result: "success" });

      expect(cb.getConsecutiveFailures("agent-a")).toBe(0);
      expect(cb.isQuarantined("agent-a")).toBe(false);
      cb.unsubscribe();
    });

    test("subscribes to TRUST_UPDATE events", () => {
      // No trust store means trust check is a no-op, but subscription should not error
      cb.subscribe();

      deps.eventBus.emit({ type: "TRUST_UPDATE", agent: "agent-a", delta: -5, reason: "test" });
      // Should not throw
      expect(cb.isQuarantined("agent-a")).toBe(false);
      cb.unsubscribe();
    });

    test("unsubscribe stops listening", () => {
      cb.subscribe();
      cb.unsubscribe();

      deps.eventBus.emit({ type: "TASK_COMPLETED", taskId: "t1", agent: "agent-a", result: "failure" });

      expect(cb.getConsecutiveFailures("agent-a")).toBe(0);
    });
  });

  describe("default config", () => {
    test("has expected defaults", () => {
      expect(DEFAULT_CIRCUIT_BREAKER_CONFIG.consecutiveFailureThreshold).toBe(3);
      expect(DEFAULT_CIRCUIT_BREAKER_CONFIG.trustDropThreshold).toBe(20);
      expect(DEFAULT_CIRCUIT_BREAKER_CONFIG.trustDropWindowHours).toBe(24);
      expect(DEFAULT_CIRCUIT_BREAKER_CONFIG.unresponsiveMinutes).toBe(30);
    });
  });

  describe("isQuarantined and getQuarantineRecord", () => {
    test("returns false/null for unknown agent", () => {
      expect(cb.isQuarantined("unknown")).toBe(false);
      expect(cb.getQuarantineRecord("unknown")).toBeNull();
    });
  });
});
