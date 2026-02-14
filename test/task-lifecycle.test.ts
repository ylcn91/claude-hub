import { test, expect, describe } from "bun:test";
import {
  addTask,
  updateTaskStatus,
  rejectTask,
  acceptTask,
  type TaskBoard,
  type TaskStatus,
} from "../src/services/tasks";

function emptyBoard(): TaskBoard {
  return { tasks: [] };
}

function boardWithTask(status: TaskStatus): { board: TaskBoard; id: string } {
  let board = addTask(emptyBoard(), "Test task");
  const id = board.tasks[0].id;
  // Walk the task to the desired status via valid transitions
  const path: Record<TaskStatus, TaskStatus[]> = {
    todo: [],
    in_progress: ["in_progress"],
    ready_for_review: ["in_progress", "ready_for_review"],
    accepted: ["in_progress", "ready_for_review"], // will use acceptTask
    rejected: ["in_progress", "ready_for_review"], // will use rejectTask
  };
  for (const step of path[status]) {
    board = updateTaskStatus(board, id, step);
  }
  if (status === "accepted") {
    board = acceptTask(board, id);
  }
  // Note: rejected auto-reopens to in_progress, so we don't build that here
  return { board, id };
}

describe("addTask", () => {
  test("creates task with status 'todo'", () => {
    const board = addTask(emptyBoard(), "New task");
    expect(board.tasks).toHaveLength(1);
    expect(board.tasks[0].status).toBe("todo");
  });

  test("creates task with empty events array", () => {
    const board = addTask(emptyBoard(), "New task");
    expect(board.tasks[0].events).toEqual([]);
  });
});

describe("valid transitions", () => {
  test("todo → in_progress", () => {
    const { board, id } = boardWithTask("todo");
    const updated = updateTaskStatus(board, id, "in_progress");
    expect(updated.tasks[0].status).toBe("in_progress");
  });

  test("in_progress → ready_for_review", () => {
    const { board, id } = boardWithTask("in_progress");
    const updated = updateTaskStatus(board, id, "ready_for_review");
    expect(updated.tasks[0].status).toBe("ready_for_review");
  });

  test("ready_for_review → accepted (via acceptTask)", () => {
    const { board, id } = boardWithTask("ready_for_review");
    const updated = acceptTask(board, id);
    expect(updated.tasks[0].status).toBe("accepted");
  });

  test("ready_for_review → rejected (via rejectTask, auto-reopens to in_progress)", () => {
    const { board, id } = boardWithTask("ready_for_review");
    const updated = rejectTask(board, id, "Needs more tests");
    expect(updated.tasks[0].status).toBe("in_progress");
  });
});

describe("invalid transitions", () => {
  test("todo → accepted throws", () => {
    const { board, id } = boardWithTask("todo");
    expect(() => updateTaskStatus(board, id, "accepted")).toThrow("Invalid transition");
  });

  test("todo → ready_for_review throws", () => {
    const { board, id } = boardWithTask("todo");
    expect(() => updateTaskStatus(board, id, "ready_for_review")).toThrow("Invalid transition");
  });

  test("in_progress → accepted throws", () => {
    const { board, id } = boardWithTask("in_progress");
    expect(() => updateTaskStatus(board, id, "accepted")).toThrow("Invalid transition");
  });

  test("in_progress → todo throws", () => {
    const { board, id } = boardWithTask("in_progress");
    expect(() => updateTaskStatus(board, id, "todo")).toThrow("Invalid transition");
  });

  test("accepted → todo throws", () => {
    const { board, id } = boardWithTask("accepted");
    expect(() => updateTaskStatus(board, id, "todo")).toThrow("Invalid transition");
  });

  test("accepted → in_progress throws", () => {
    const { board, id } = boardWithTask("accepted");
    expect(() => updateTaskStatus(board, id, "in_progress")).toThrow("Invalid transition");
  });

  test("ready_for_review → in_progress throws", () => {
    const { board, id } = boardWithTask("ready_for_review");
    expect(() => updateTaskStatus(board, id, "in_progress")).toThrow("Invalid transition");
  });

  test("ready_for_review → todo throws", () => {
    const { board, id } = boardWithTask("ready_for_review");
    expect(() => updateTaskStatus(board, id, "todo")).toThrow("Invalid transition");
  });
});

describe("rejectTask", () => {
  test("auto-reopens to in_progress", () => {
    const { board, id } = boardWithTask("ready_for_review");
    const updated = rejectTask(board, id, "Missing edge case handling");
    expect(updated.tasks[0].status).toBe("in_progress");
  });

  test("requires reason", () => {
    const { board, id } = boardWithTask("ready_for_review");
    expect(() => rejectTask(board, id, "")).toThrow("Reason is required");
  });

  test("throws on non-ready_for_review task", () => {
    const { board, id } = boardWithTask("in_progress");
    expect(() => rejectTask(board, id, "Some reason")).toThrow("expected ready_for_review");
  });

  test("throws on todo task", () => {
    const { board, id } = boardWithTask("todo");
    expect(() => rejectTask(board, id, "Some reason")).toThrow("expected ready_for_review");
  });
});

describe("acceptTask", () => {
  test("sets status to accepted", () => {
    const { board, id } = boardWithTask("ready_for_review");
    const updated = acceptTask(board, id);
    expect(updated.tasks[0].status).toBe("accepted");
  });

  test("throws on non-ready_for_review task", () => {
    const { board, id } = boardWithTask("in_progress");
    expect(() => acceptTask(board, id)).toThrow("expected ready_for_review");
  });

  test("throws on todo task", () => {
    const { board, id } = boardWithTask("todo");
    expect(() => acceptTask(board, id)).toThrow("expected ready_for_review");
  });
});

describe("event logging", () => {
  test("records status_changed events on transitions", () => {
    let board = addTask(emptyBoard(), "Tracked task");
    const id = board.tasks[0].id;

    board = updateTaskStatus(board, id, "in_progress");
    expect(board.tasks[0].events).toHaveLength(1);
    expect(board.tasks[0].events[0].type).toBe("status_changed");
    expect(board.tasks[0].events[0].from).toBe("todo");
    expect(board.tasks[0].events[0].to).toBe("in_progress");

    board = updateTaskStatus(board, id, "ready_for_review");
    expect(board.tasks[0].events).toHaveLength(2);
    expect(board.tasks[0].events[1].from).toBe("in_progress");
    expect(board.tasks[0].events[1].to).toBe("ready_for_review");
  });

  test("records review_accepted event", () => {
    const { board, id } = boardWithTask("ready_for_review");
    const updated = acceptTask(board, id);
    const events = updated.tasks[0].events;
    const acceptedEvents = events.filter((e) => e.type === "review_accepted");
    expect(acceptedEvents).toHaveLength(1);
    expect(acceptedEvents[0].from).toBe("ready_for_review");
    expect(acceptedEvents[0].to).toBe("accepted");
  });

  test("records rejection reason in event log", () => {
    const { board, id } = boardWithTask("ready_for_review");
    const updated = rejectTask(board, id, "Needs refactoring");
    const events = updated.tasks[0].events;

    const rejectedEvents = events.filter((e) => e.type === "review_rejected");
    expect(rejectedEvents).toHaveLength(1);
    expect(rejectedEvents[0].reason).toBe("Needs refactoring");
    expect(rejectedEvents[0].from).toBe("ready_for_review");
    expect(rejectedEvents[0].to).toBe("rejected");
  });

  test("rejection logs three events: status_changed to rejected, review_rejected, status_changed to in_progress", () => {
    const { board, id } = boardWithTask("ready_for_review");
    // board already has 2 events from todo→in_progress→ready_for_review
    const prevEventCount = board.tasks[0].events.length;
    const updated = rejectTask(board, id, "Fix bugs");
    const newEvents = updated.tasks[0].events.slice(prevEventCount);

    expect(newEvents).toHaveLength(3);
    expect(newEvents[0]).toMatchObject({ type: "status_changed", from: "ready_for_review", to: "rejected" });
    expect(newEvents[1]).toMatchObject({ type: "review_rejected", reason: "Fix bugs" });
    expect(newEvents[2]).toMatchObject({ type: "status_changed", from: "rejected", to: "in_progress" });
  });

  test("all events have timestamps", () => {
    let board = addTask(emptyBoard(), "Timestamp check");
    const id = board.tasks[0].id;
    board = updateTaskStatus(board, id, "in_progress");
    board = updateTaskStatus(board, id, "ready_for_review");
    board = acceptTask(board, id);

    for (const event of board.tasks[0].events) {
      expect(event.timestamp).toBeTruthy();
      expect(() => new Date(event.timestamp)).not.toThrow();
    }
  });
});
