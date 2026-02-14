import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { DaemonState } from "../src/daemon/state";
import { ProgressTracker } from "../src/services/progress-tracker";
import { EventBus } from "../src/services/event-bus";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";

// We test the handler logic by directly exercising the state objects
// and verifying the behavior that the handlers rely on.

const TEST_DIR = join(import.meta.dir, ".test-missing-handlers");
process.env.AGENTCTL_DIR = TEST_DIR;

let dbCounter = 0;
function uniqueDbPath(): string {
  return join(TEST_DIR, `test-${++dbCounter}-${Date.now()}.db`);
}

beforeEach(() => mkdirSync(TEST_DIR, { recursive: true }));
afterEach(() => rmSync(TEST_DIR, { recursive: true, force: true }));

describe("report_progress handler logic", () => {
  test("ProgressTracker.report stores and returns a report with timestamp", () => {
    const tracker = new ProgressTracker();
    const report = tracker.report({
      taskId: "task-1",
      agent: "claude",
      percent: 50,
      currentStep: "Building components",
    });
    expect(report.taskId).toBe("task-1");
    expect(report.agent).toBe("claude");
    expect(report.percent).toBe(50);
    expect(report.currentStep).toBe("Building components");
    expect(report.timestamp).toBeDefined();
  });

  test("ProgressTracker.report handles optional fields", () => {
    const tracker = new ProgressTracker();
    const report = tracker.report({
      taskId: "task-1",
      agent: "claude",
      percent: 75,
      currentStep: "Testing",
      blockers: ["waiting on API"],
      estimatedRemainingMinutes: 10,
      artifactsProduced: ["src/main.ts"],
    });
    expect(report.blockers).toEqual(["waiting on API"]);
    expect(report.estimatedRemainingMinutes).toBe(10);
    expect(report.artifactsProduced).toEqual(["src/main.ts"]);
  });

  test("ProgressTracker tracks history and getLatest works", () => {
    const tracker = new ProgressTracker();
    tracker.report({ taskId: "task-1", agent: "a", percent: 25, currentStep: "step1" });
    tracker.report({ taskId: "task-1", agent: "a", percent: 50, currentStep: "step2" });
    tracker.report({ taskId: "task-1", agent: "a", percent: 75, currentStep: "step3" });

    const latest = tracker.getLatest("task-1");
    expect(latest).not.toBeNull();
    expect(latest!.percent).toBe(75);
    expect(latest!.currentStep).toBe("step3");

    const history = tracker.getHistory("task-1");
    expect(history).toHaveLength(3);
  });

  test("EventBus emits PROGRESS_UPDATE events", () => {
    const bus = new EventBus();
    const received: any[] = [];
    bus.on("PROGRESS_UPDATE", (e) => received.push(e));

    bus.emit({
      type: "PROGRESS_UPDATE",
      taskId: "task-1",
      agent: "claude",
      data: { percent: 50, currentStep: "Building" },
    });

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe("PROGRESS_UPDATE");
    expect(received[0].taskId).toBe("task-1");
  });

  test("EventBus emits CHECKPOINT_REACHED when percent is 100", () => {
    const bus = new EventBus();
    const checkpoints: any[] = [];
    bus.on("CHECKPOINT_REACHED", (e) => checkpoints.push(e));

    bus.emit({
      type: "CHECKPOINT_REACHED",
      taskId: "task-1",
      agent: "claude",
      percent: 100,
      step: "complete",
    });

    expect(checkpoints).toHaveLength(1);
    expect(checkpoints[0].percent).toBe(100);
  });

  test("DaemonState has progressTracker and eventBus initialized", () => {
    const state = new DaemonState(uniqueDbPath());
    expect(state.progressTracker).toBeInstanceOf(ProgressTracker);
    expect(state.eventBus).toBeInstanceOf(EventBus);
    state.close();
  });

  test("full report_progress flow through state objects", () => {
    const state = new DaemonState(uniqueDbPath());
    const events: any[] = [];
    state.eventBus.on("PROGRESS_UPDATE", (e) => events.push(e));
    state.eventBus.on("CHECKPOINT_REACHED", (e) => events.push(e));

    // Simulate report_progress handler behavior
    const report = state.progressTracker.report({
      taskId: "task-1",
      agent: "claude",
      percent: 100,
      currentStep: "Done",
    });

    state.eventBus.emit({
      type: "PROGRESS_UPDATE",
      taskId: "task-1",
      agent: "claude",
      data: { percent: 100, currentStep: "Done" },
    });

    state.eventBus.emit({
      type: "CHECKPOINT_REACHED",
      taskId: "task-1",
      agent: "claude",
      percent: 100,
      step: "Done",
    });

    expect(report.percent).toBe(100);
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("PROGRESS_UPDATE");
    expect(events[1].type).toBe("CHECKPOINT_REACHED");
    state.close();
  });
});

describe("council_analyze handler logic", () => {
  test("CouncilService can be instantiated with config and custom caller", async () => {
    const { CouncilService } = await import("../src/services/council");
    const mockCaller = async (_model: string, _sys: string, _user: string) =>
      JSON.stringify({
        complexity: "medium",
        estimatedDurationMinutes: 30,
        requiredSkills: ["typescript"],
        recommendedApproach: "test approach",
        risks: [],
      });

    const council = new CouncilService(
      { models: ["test-model"], chairman: "test-model" },
      mockCaller,
    );
    expect(council).toBeDefined();
  });

  test("CouncilService.analyze returns analysis with expected structure", async () => {
    const { CouncilService } = await import("../src/services/council");
    let callCount = 0;

    const mockCaller = async (_model: string, systemPrompt: string, _user: string) => {
      callCount++;
      // Stage 1: individual analysis
      if (systemPrompt.includes("task analysis expert")) {
        return JSON.stringify({
          complexity: "medium",
          estimatedDurationMinutes: 30,
          requiredSkills: ["typescript"],
          recommendedApproach: "test approach",
          risks: ["none"],
        });
      }
      // Stage 2: peer review
      if (systemPrompt.includes("peer reviewer")) {
        return JSON.stringify({
          ranking: [0],
          reasoning: "Only one analysis",
        });
      }
      // Stage 3: synthesis
      if (systemPrompt.includes("chairman")) {
        return JSON.stringify({
          consensusComplexity: "medium",
          consensusDurationMinutes: 30,
          consensusSkills: ["typescript"],
          recommendedApproach: "test approach",
          confidence: 0.8,
        });
      }
      return "{}";
    };

    const council = new CouncilService(
      { models: ["model-a"], chairman: "model-a" },
      mockCaller,
    );

    const result = await council.analyze("Build a new feature");
    expect(result.taskGoal).toBe("Build a new feature");
    expect(result.timestamp).toBeDefined();
    expect(result.individualAnalyses).toHaveLength(1);
    expect(result.synthesis.chairman).toBe("model-a");
    expect(result.synthesis.consensusComplexity).toBe("medium");
    expect(result.synthesis.confidence).toBe(0.8);
  });

  test("CouncilService throws when no API key provided and no custom caller", async () => {
    const { CouncilService } = await import("../src/services/council");
    const origKey = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;

    expect(() => {
      new CouncilService({ models: ["m"], chairman: "m" });
    }).toThrow("Council requires an OpenRouter API key");

    if (origKey) process.env.OPENROUTER_API_KEY = origKey;
  });
});

describe("get_trust handler logic", () => {
  test("TrustStore.get returns null for unknown account", () => {
    const state = new DaemonState(uniqueDbPath());
    state.initTrust(uniqueDbPath());

    const result = state.trustStore!.get("unknown");
    expect(result).toBeNull();
    state.close();
  });

  test("TrustStore.get returns reputation for known account", () => {
    const state = new DaemonState(uniqueDbPath());
    state.initTrust(uniqueDbPath());

    state.trustStore!.recordOutcome("alice", "completed", 10);
    const result = state.trustStore!.get("alice");
    expect(result).not.toBeNull();
    expect(result!.accountName).toBe("alice");
    expect(result!.totalTasksCompleted).toBe(1);
    state.close();
  });

  test("TrustStore.getAll returns all agents", () => {
    const state = new DaemonState(uniqueDbPath());
    state.initTrust(uniqueDbPath());

    state.trustStore!.recordOutcome("alice", "completed", 10);
    state.trustStore!.recordOutcome("bob", "completed", 20);

    const all = state.trustStore!.getAll();
    expect(all).toHaveLength(2);
    const names = all.map((r) => r.accountName);
    expect(names).toContain("alice");
    expect(names).toContain("bob");
    state.close();
  });

  test("trust feature gate: trustStore is undefined without initTrust", () => {
    const state = new DaemonState(uniqueDbPath());
    expect(state.trustStore).toBeUndefined();
    state.close();
  });
});

describe("adaptive_sla_check handler logic", () => {
  test("AdaptiveCoordinator evaluates empty task list with no actions", async () => {
    const { AdaptiveCoordinator } = await import("../src/services/adaptive-coordinator");
    const coordinator = new AdaptiveCoordinator();
    const actions = coordinator.evaluate([]);
    expect(actions).toEqual([]);
  });

  test("AdaptiveCoordinator pings stale in_progress task", async () => {
    const { AdaptiveCoordinator } = await import("../src/services/adaptive-coordinator");
    const coordinator = new AdaptiveCoordinator({ pingAfterMinutes: 5 });

    const startedAt = new Date(Date.now() - 10 * 60_000).toISOString(); // 10 min ago
    const actions = coordinator.evaluate([
      {
        taskId: "task-1",
        status: "in_progress",
        assignee: "claude",
        startedAt,
        reassignmentCount: 0,
      },
    ]);

    const pings = actions.filter((a) => a.action === "ping");
    expect(pings.length).toBeGreaterThanOrEqual(1);
    expect(pings[0].action).toBe("ping");
  });

  test("AdaptiveCoordinator escalates when max reassignments reached", async () => {
    const { AdaptiveCoordinator } = await import("../src/services/adaptive-coordinator");
    const coordinator = new AdaptiveCoordinator({
      maxReassignments: 2,
      suggestReassignAfterMinutes: 5,
    });

    const startedAt = new Date(Date.now() - 10 * 60_000).toISOString();
    const actions = coordinator.evaluate([
      {
        taskId: "task-1",
        status: "in_progress",
        assignee: "claude",
        startedAt,
        reassignmentCount: 3,
      },
    ]);

    const escalations = actions.filter((a) => a.action === "escalate_human");
    expect(escalations.length).toBeGreaterThanOrEqual(1);
  });

  test("ProgressTracker.getLatest provides data for adaptive SLA mapping", () => {
    const tracker = new ProgressTracker();
    tracker.report({
      taskId: "task-1",
      agent: "claude",
      percent: 30,
      currentStep: "Analysis",
    });

    const latest = tracker.getLatest("task-1");
    expect(latest).not.toBeNull();
    // This data is what adaptive_sla_check maps into TaskState.lastProgressReport
    expect(latest!.percent).toBe(30);
    expect(latest!.timestamp).toBeDefined();
  });
});
