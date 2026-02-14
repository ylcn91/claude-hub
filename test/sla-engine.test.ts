import { describe, test, expect } from "bun:test";
import type { Task, TaskStatus } from "../src/services/tasks";
import type { TaskEvent } from "../src/services/tasks";
import {
  checkStaleTasks,
  formatEscalationMessage,
  humanTime,
  DEFAULT_SLA_CONFIG,
} from "../src/services/sla-engine";
import type { SLAConfig } from "../src/services/sla-engine";

function makeTask(overrides: Partial<Task> & { id: string; title: string }): Task {
  return {
    status: "todo",
    createdAt: new Date().toISOString(),
    events: [],
    ...overrides,
  };
}

function makeEvent(to: TaskStatus, minutesAgo: number, now: Date): TaskEvent {
  const ts = new Date(now.getTime() - minutesAgo * 60 * 1000);
  return { type: "status_changed", timestamp: ts.toISOString(), to };
}

describe("checkStaleTasks", () => {
  const now = new Date("2026-02-13T12:00:00Z");

  test("fresh in_progress task produces no escalation", () => {
    const task = makeTask({
      id: "1",
      title: "Fresh task",
      status: "in_progress",
      events: [makeEvent("in_progress", 5, now)],
    });
    const result = checkStaleTasks([task], DEFAULT_SLA_CONFIG, now);
    expect(result).toHaveLength(0);
  });

  test("stale in_progress (35min) produces ping", () => {
    const task = makeTask({
      id: "2",
      title: "Stale task",
      status: "in_progress",
      assignee: "alice",
      events: [makeEvent("in_progress", 35, now)],
    });
    const result = checkStaleTasks([task], DEFAULT_SLA_CONFIG, now);
    expect(result).toHaveLength(1);
    expect(result[0].action).toBe("ping");
    expect(result[0].taskId).toBe("2");
    expect(result[0].assignee).toBe("alice");
  });

  test("very stale in_progress (65min) produces reassign_suggestion", () => {
    const task = makeTask({
      id: "3",
      title: "Very stale task",
      status: "in_progress",
      assignee: "bob",
      events: [makeEvent("in_progress", 65, now)],
    });
    const result = checkStaleTasks([task], DEFAULT_SLA_CONFIG, now);
    expect(result).toHaveLength(1);
    expect(result[0].action).toBe("reassign_suggestion");
  });

  test("blocked task > 15min produces escalate", () => {
    const task = makeTask({
      id: "4",
      title: "Blocked task",
      status: "in_progress",
      tags: ["blocked"],
      events: [makeEvent("in_progress", 20, now)],
    });
    const result = checkStaleTasks([task], DEFAULT_SLA_CONFIG, now);
    expect(result).toHaveLength(1);
    expect(result[0].action).toBe("escalate");
  });

  test("blocked task < 15min produces no escalation", () => {
    const task = makeTask({
      id: "5",
      title: "Recently blocked",
      status: "in_progress",
      tags: ["blocked"],
      events: [makeEvent("in_progress", 10, now)],
    });
    const result = checkStaleTasks([task], DEFAULT_SLA_CONFIG, now);
    expect(result).toHaveLength(0);
  });

  test("stale ready_for_review (12min) produces ping", () => {
    const task = makeTask({
      id: "6",
      title: "Awaiting review",
      status: "ready_for_review",
      assignee: "carol",
      events: [makeEvent("ready_for_review", 12, now)],
    });
    const result = checkStaleTasks([task], DEFAULT_SLA_CONFIG, now);
    expect(result).toHaveLength(1);
    expect(result[0].action).toBe("ping");
    expect(result[0].currentStatus).toBe("ready_for_review");
  });

  test("fresh ready_for_review (5min) produces no escalation", () => {
    const task = makeTask({
      id: "7",
      title: "Fresh review",
      status: "ready_for_review",
      events: [makeEvent("ready_for_review", 5, now)],
    });
    const result = checkStaleTasks([task], DEFAULT_SLA_CONFIG, now);
    expect(result).toHaveLength(0);
  });

  test("todo task produces no escalation regardless of age", () => {
    const task = makeTask({
      id: "8",
      title: "Old todo",
      status: "todo",
      createdAt: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
    });
    const result = checkStaleTasks([task], DEFAULT_SLA_CONFIG, now);
    expect(result).toHaveLength(0);
  });

  test("accepted task produces no escalation", () => {
    const task = makeTask({
      id: "9",
      title: "Done task",
      status: "accepted",
      events: [
        makeEvent("in_progress", 120, now),
        makeEvent("ready_for_review", 90, now),
        makeEvent("accepted", 60, now),
      ],
    });
    const result = checkStaleTasks([task], DEFAULT_SLA_CONFIG, now);
    expect(result).toHaveLength(0);
  });

  test("custom SLA config with shorter thresholds triggers escalation sooner", () => {
    const shortConfig: SLAConfig = {
      inProgressMaxMs: 5 * 60 * 1000,   // 5 min
      blockedMaxMs: 3 * 60 * 1000,      // 3 min
      reviewMaxMs: 2 * 60 * 1000,       // 2 min
      checkIntervalMs: 30 * 1000,
    };
    const task = makeTask({
      id: "10",
      title: "Quick task",
      status: "in_progress",
      events: [makeEvent("in_progress", 7, now)],
    });
    // 7 min > 5 min threshold → ping
    const result = checkStaleTasks([task], shortConfig, now);
    expect(result).toHaveLength(1);
    expect(result[0].action).toBe("ping");

    // Same task with default config → no escalation (7 < 30)
    const defaultResult = checkStaleTasks([task], DEFAULT_SLA_CONFIG, now);
    expect(defaultResult).toHaveLength(0);
  });
});

describe("formatEscalationMessage", () => {
  test("each action type produces correct format", () => {
    const ping = formatEscalationMessage({
      taskId: "1",
      taskTitle: "Build API",
      currentStatus: "in_progress",
      assignee: "alice",
      staleForMs: 35 * 60 * 1000,
      action: "ping",
    });
    expect(ping).toBe('⏰ Task "Build API" has been in_progress for 35m. Assignee: alice');

    const reassign = formatEscalationMessage({
      taskId: "2",
      taskTitle: "Fix bug",
      currentStatus: "in_progress",
      assignee: "bob",
      staleForMs: 90 * 60 * 1000,
      action: "reassign_suggestion",
    });
    expect(reassign).toBe('⚠️ Task "Fix bug" stale for 1h 30m. Consider reassigning from bob.');

    const escalate = formatEscalationMessage({
      taskId: "3",
      taskTitle: "Deploy service",
      currentStatus: "in_progress",
      staleForMs: 20 * 60 * 1000,
      action: "escalate",
    });
    expect(escalate).toBe('🚨 Task "Deploy service" blocked for 20m. Needs immediate attention.');
  });

  test("unassigned tasks show 'unassigned'", () => {
    const msg = formatEscalationMessage({
      taskId: "4",
      taskTitle: "Orphan task",
      currentStatus: "in_progress",
      staleForMs: 45 * 60 * 1000,
      action: "ping",
    });
    expect(msg).toContain("Assignee: unassigned");
  });
});

describe("humanTime", () => {
  test("formats minutes only", () => {
    expect(humanTime(5 * 60 * 1000)).toBe("5m");
    expect(humanTime(45 * 60 * 1000)).toBe("45m");
  });

  test("formats hours and minutes", () => {
    expect(humanTime(90 * 60 * 1000)).toBe("1h 30m");
    expect(humanTime(150 * 60 * 1000)).toBe("2h 30m");
  });

  test("formats exact hours", () => {
    expect(humanTime(60 * 60 * 1000)).toBe("1h");
    expect(humanTime(120 * 60 * 1000)).toBe("2h");
  });
});
