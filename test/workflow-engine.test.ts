import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { WorkflowStore } from "../src/services/workflow-store";
import { WorkflowEngine } from "../src/services/workflow-engine";
import type { WorkflowDefinition } from "../src/services/workflow-parser";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let store: WorkflowStore;
let engine: WorkflowEngine;
let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "workflow-engine-test-"));
  store = new WorkflowStore(join(tmpDir, "workflow.db"));
  engine = new WorkflowEngine(store, undefined, {});
});

afterEach(() => {
  store.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

function linearWorkflow(): WorkflowDefinition {
  return {
    name: "linear",
    version: 1,
    steps: [
      { id: "a", title: "Step A", assign: "agent-1", handoff: { goal: "Do A" } },
      { id: "b", title: "Step B", assign: "agent-2", depends_on: ["a"], handoff: { goal: "Do B" } },
      { id: "c", title: "Step C", assign: "agent-3", depends_on: ["b"], handoff: { goal: "Do C" } },
    ],
    on_failure: "notify",
    retro: false,
  };
}

function parallelWorkflow(): WorkflowDefinition {
  return {
    name: "parallel",
    version: 1,
    steps: [
      { id: "start", title: "Start", assign: "agent-1", handoff: { goal: "Start" } },
      { id: "branch_a", title: "Branch A", assign: "agent-2", depends_on: ["start"], handoff: { goal: "A" } },
      { id: "branch_b", title: "Branch B", assign: "agent-3", depends_on: ["start"], handoff: { goal: "B" } },
      { id: "merge", title: "Merge", assign: "agent-1", depends_on: ["branch_a", "branch_b"], handoff: { goal: "Merge" } },
    ],
    on_failure: "notify",
    retro: false,
  };
}

function conditionalWorkflow(): WorkflowDefinition {
  return {
    name: "conditional",
    version: 1,
    steps: [
      { id: "review", title: "Review", assign: "reviewer", handoff: { goal: "Review" } },
      {
        id: "fix",
        title: "Fix",
        assign: "dev",
        depends_on: ["review"],
        condition: { when: "step.review.result == 'rejected'" },
        handoff: { goal: "Fix issues" },
      },
      {
        id: "deploy",
        title: "Deploy",
        assign: "ops",
        depends_on: ["review"],
        condition: { when: "step.review.result == 'accepted'" },
        handoff: { goal: "Deploy" },
      },
    ],
    on_failure: "notify",
    retro: false,
  };
}

test("trigger linear 3-step workflow -- first step scheduled", async () => {
  const def = linearWorkflow();
  const runId = await engine.triggerWorkflow(def, "test context");

  expect(runId).toBeDefined();
  const run = store.getRun(runId);
  expect(run!.status).toBe("running");

  const steps = store.getStepRunsForRun(runId);
  expect(steps).toHaveLength(3);

  // Step A should be assigned (no dependencies)
  const stepA = steps.find(s => s.step_id === "a");
  expect(stepA!.status).toBe("assigned");
  expect(stepA!.assigned_to).toBe("agent-1");

  // Steps B and C should still be pending
  const stepB = steps.find(s => s.step_id === "b");
  expect(stepB!.status).toBe("pending");

  const stepC = steps.find(s => s.step_id === "c");
  expect(stepC!.status).toBe("pending");
});

test("trigger workflow with parallel steps -- independent steps scheduled together", async () => {
  const def = parallelWorkflow();
  const runId = await engine.triggerWorkflow(def, "");

  // Start should be assigned
  const steps = store.getStepRunsForRun(runId);
  const start = steps.find(s => s.step_id === "start");
  expect(start!.status).toBe("assigned");

  // Complete start step
  await engine.onStepCompleted(runId, "start", "accepted", def);

  const updatedSteps = store.getStepRunsForRun(runId);
  const branchA = updatedSteps.find(s => s.step_id === "branch_a");
  const branchB = updatedSteps.find(s => s.step_id === "branch_b");
  const merge = updatedSteps.find(s => s.step_id === "merge");

  // Both branches should be assigned
  expect(branchA!.status).toBe("assigned");
  expect(branchB!.status).toBe("assigned");
  // Merge should still be pending
  expect(merge!.status).toBe("pending");
});

test("trigger workflow with condition -- skips step when condition false", async () => {
  const def = conditionalWorkflow();
  const runId = await engine.triggerWorkflow(def, "");

  // Complete review with "accepted"
  await engine.onStepCompleted(runId, "review", "accepted", def);

  const steps = store.getStepRunsForRun(runId);
  const fix = steps.find(s => s.step_id === "fix");
  const deploy = steps.find(s => s.step_id === "deploy");

  // "fix" should be skipped (condition: result == 'rejected', but result was 'accepted')
  expect(fix!.status).toBe("skipped");
  expect(fix!.result).toBe("condition_not_met");

  // "deploy" should be assigned (condition: result == 'accepted' matches)
  expect(deploy!.status).toBe("assigned");
});

test("onStepCompleted unblocks dependent steps", async () => {
  const def = linearWorkflow();
  const runId = await engine.triggerWorkflow(def, "");

  // Complete step A
  await engine.onStepCompleted(runId, "a", "accepted", def);

  const steps = store.getStepRunsForRun(runId);
  const stepB = steps.find(s => s.step_id === "b");
  expect(stepB!.status).toBe("assigned");

  // Step C should still be pending
  const stepC = steps.find(s => s.step_id === "c");
  expect(stepC!.status).toBe("pending");
});

test("onStepFailed with retry -- re-schedules", async () => {
  const def: WorkflowDefinition = {
    name: "retry-test",
    version: 1,
    steps: [{ id: "flaky", title: "Flaky", assign: "agent-1", handoff: { goal: "Try" } }],
    on_failure: "notify",
    max_retries: 2,
    retro: false,
  };

  const runId = await engine.triggerWorkflow(def, "");

  // First failure -- should retry (attempt 1 <= max_retries 2)
  await engine.onStepFailed(runId, "flaky", "timeout", def);

  const steps = store.getStepRunsForRun(runId);
  const step = steps.find(s => s.step_id === "flaky");
  // After retry, it should be re-assigned (pending -> assigned again by scheduleReadySteps)
  expect(step!.attempt).toBe(2);
  expect(step!.status).toBe("assigned");
});

test("onStepFailed with abort -- marks run failed", async () => {
  const def: WorkflowDefinition = {
    name: "abort-test",
    version: 1,
    steps: [
      { id: "a", title: "A", assign: "agent-1", handoff: { goal: "Do A" } },
      { id: "b", title: "B", assign: "agent-2", depends_on: ["a"], handoff: { goal: "Do B" } },
    ],
    on_failure: "abort",
    retro: false,
  };

  const runId = await engine.triggerWorkflow(def, "");

  // Fail step A with no retries
  await engine.onStepFailed(runId, "a", "crashed", def);

  const run = store.getRun(runId);
  expect(run!.status).toBe("failed");

  const steps = store.getStepRunsForRun(runId);
  const stepA = steps.find(s => s.step_id === "a");
  expect(stepA!.status).toBe("failed");

  const stepB = steps.find(s => s.step_id === "b");
  expect(stepB!.status).toBe("skipped");
  expect(stepB!.result).toBe("aborted_due_to_failure");
});

test("cancelWorkflow skips pending steps", async () => {
  const def = linearWorkflow();
  const runId = await engine.triggerWorkflow(def, "");

  await engine.cancelWorkflow(runId);

  const run = store.getRun(runId);
  expect(run!.status).toBe("cancelled");

  const steps = store.getStepRunsForRun(runId);
  // Step A was assigned, so it should be skipped
  const stepA = steps.find(s => s.step_id === "a");
  expect(stepA!.status).toBe("skipped");
  expect(stepA!.result).toBe("cancelled");

  // Steps B and C were pending, should be skipped
  for (const id of ["b", "c"]) {
    const step = steps.find(s => s.step_id === id);
    expect(step!.status).toBe("skipped");
  }
});

test("complete workflow when all steps done", async () => {
  const def: WorkflowDefinition = {
    name: "simple",
    version: 1,
    steps: [{ id: "only", title: "Only step", assign: "agent", handoff: { goal: "Do it" } }],
    on_failure: "notify",
    retro: false,
  };

  const runId = await engine.triggerWorkflow(def, "");
  await engine.onStepCompleted(runId, "only", "accepted", def);

  const run = store.getRun(runId);
  expect(run!.status).toBe("completed");
  expect(run!.completed_at).toBeDefined();
});

test("events are recorded for workflow lifecycle", async () => {
  const def: WorkflowDefinition = {
    name: "events-test",
    version: 1,
    steps: [{ id: "s1", title: "Step 1", assign: "a", handoff: { goal: "G" } }],
    on_failure: "notify",
    retro: false,
  };

  const runId = await engine.triggerWorkflow(def, "");
  await engine.onStepCompleted(runId, "s1", "accepted", def);

  const events = store.getEvents(runId);
  const types = events.map(e => e.type);
  expect(types).toContain("workflow_started");
  expect(types).toContain("step_assigned");
  expect(types).toContain("step_completed");
  expect(types).toContain("workflow_completed");
});

describe("circular dependency detection", () => {
  test("rejects direct cycle: A depends on B, B depends on A", async () => {
    const def: WorkflowDefinition = {
      name: "direct-cycle",
      version: 1,
      steps: [
        { id: "a", title: "A", assign: "agent-1", depends_on: ["b"], handoff: { goal: "Do A" } },
        { id: "b", title: "B", assign: "agent-2", depends_on: ["a"], handoff: { goal: "Do B" } },
      ],
      on_failure: "notify",
      retro: false,
    };

    await expect(engine.triggerWorkflow(def, "test")).rejects.toThrow("cycle");
  });

  test("rejects indirect cycle: A -> B -> C -> A", async () => {
    const def: WorkflowDefinition = {
      name: "indirect-cycle",
      version: 1,
      steps: [
        { id: "a", title: "A", assign: "agent-1", depends_on: ["c"], handoff: { goal: "Do A" } },
        { id: "b", title: "B", assign: "agent-2", depends_on: ["a"], handoff: { goal: "Do B" } },
        { id: "c", title: "C", assign: "agent-3", depends_on: ["b"], handoff: { goal: "Do C" } },
      ],
      on_failure: "notify",
      retro: false,
    };

    await expect(engine.triggerWorkflow(def, "test")).rejects.toThrow("cycle");
  });

  test("rejects self-referencing step: A depends on A", async () => {
    const def: WorkflowDefinition = {
      name: "self-ref",
      version: 1,
      steps: [
        { id: "a", title: "A", assign: "agent-1", depends_on: ["a"], handoff: { goal: "Do A" } },
      ],
      on_failure: "notify",
      retro: false,
    };

    await expect(engine.triggerWorkflow(def, "test")).rejects.toThrow("cycle");
  });

  test("rejects dependency on unknown step", async () => {
    const def: WorkflowDefinition = {
      name: "unknown-dep",
      version: 1,
      steps: [
        { id: "a", title: "A", assign: "agent-1", depends_on: ["nonexistent"], handoff: { goal: "Do A" } },
      ],
      on_failure: "notify",
      retro: false,
    };

    await expect(engine.triggerWorkflow(def, "test")).rejects.toThrow("unknown step");
  });

  test("valid DAG still works after adding cycle detection", async () => {
    const def: WorkflowDefinition = {
      name: "valid-dag",
      version: 1,
      steps: [
        { id: "a", title: "A", assign: "agent-1", handoff: { goal: "Do A" } },
        { id: "b", title: "B", assign: "agent-2", depends_on: ["a"], handoff: { goal: "Do B" } },
        { id: "c", title: "C", assign: "agent-3", depends_on: ["a"], handoff: { goal: "Do C" } },
        { id: "d", title: "D", assign: "agent-1", depends_on: ["b", "c"], handoff: { goal: "Do D" } },
      ],
      on_failure: "notify",
      retro: false,
    };

    const runId = await engine.triggerWorkflow(def, "dag-test");
    expect(runId).toBeDefined();

    const steps = store.getStepRunsForRun(runId);
    expect(steps).toHaveLength(4);

    // Only step A should be assigned (no deps)
    const stepA = steps.find(s => s.step_id === "a");
    expect(stepA!.status).toBe("assigned");

    // B, C, D should be pending
    for (const id of ["b", "c", "d"]) {
      const step = steps.find(s => s.step_id === id);
      expect(step!.status).toBe("pending");
    }
  });
});
