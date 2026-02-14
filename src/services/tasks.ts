import { atomicWrite, atomicRead } from "./file-store";

export type TaskStatus = "todo" | "in_progress" | "ready_for_review" | "accepted" | "rejected";
export type TaskPriority = "P0" | "P1" | "P2";

export type TaskEventType = "status_changed" | "review_rejected" | "review_accepted" | "cleanup_queued";

export interface TaskEvent {
  type: TaskEventType;
  timestamp: string;
  from?: TaskStatus;
  to?: TaskStatus;
  reason?: string;
}

export interface WorkspaceContext {
  workspacePath: string;
  branch: string;
  workspaceId?: string;
}

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  assignee?: string;
  createdAt: string;
  priority?: TaskPriority;
  dueDate?: string;
  tags?: string[];
  events: TaskEvent[];
  workspaceContext?: WorkspaceContext;
}

export const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  todo: ["in_progress"],
  in_progress: ["ready_for_review"],
  ready_for_review: ["accepted", "rejected"],
  accepted: [],
  rejected: [],
};

export interface TaskBoard {
  tasks: Task[];
}

const EMPTY_BOARD: TaskBoard = { tasks: [] };

import { getTasksPath as getTasksPathFromPaths } from "../paths";

function getTasksPath(): string {
  return getTasksPathFromPaths();
}

export async function loadTasks(path?: string): Promise<TaskBoard> {
  const tasksPath = path ?? getTasksPath();
  const raw = await atomicRead<TaskBoard>(tasksPath);
  if (!raw || !Array.isArray(raw.tasks)) return { ...EMPTY_BOARD };
  return raw;
}

export async function saveTasks(board: TaskBoard, path?: string): Promise<void> {
  const tasksPath = path ?? getTasksPath();
  await atomicWrite(tasksPath, board);
}

export function addTask(
  board: TaskBoard,
  title: string,
  assignee?: string,
  opts?: { priority?: TaskPriority; dueDate?: string; tags?: string[] }
): TaskBoard {
  const task: Task = {
    id: crypto.randomUUID(),
    title,
    status: "todo",
    assignee,
    createdAt: new Date().toISOString(),
    priority: opts?.priority,
    dueDate: opts?.dueDate,
    tags: opts?.tags,
    events: [],
  };
  return { tasks: [...board.tasks, task] };
}

const PRIORITY_RANK: Record<string, number> = { P0: 0, P1: 1, P2: 2 };

export function sortByPriority(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const pa = PRIORITY_RANK[a.priority ?? "P2"] ?? 2;
    const pb = PRIORITY_RANK[b.priority ?? "P2"] ?? 2;
    return pa - pb;
  });
}

export function updateTaskStatus(board: TaskBoard, id: string, status: TaskStatus): TaskBoard {
  const task = board.tasks.find((t) => t.id === id);
  if (!task) throw new Error(`Task ${id} not found`);

  const allowed = VALID_TRANSITIONS[task.status];
  if (!allowed.includes(status)) {
    throw new Error(`Invalid transition: ${task.status} → ${status}`);
  }

  const now = new Date().toISOString();
  const events: TaskEvent[] = [
    ...task.events,
    { type: "status_changed", timestamp: now, from: task.status, to: status },
  ];

  return {
    tasks: board.tasks.map((t) => (t.id === id ? { ...t, status, events } : t)),
  };
}

export function rejectTask(board: TaskBoard, id: string, reason: string): TaskBoard {
  if (!reason) throw new Error("Reason is required when rejecting a task");

  const task = board.tasks.find((t) => t.id === id);
  if (!task) throw new Error(`Task ${id} not found`);
  if (task.status !== "ready_for_review") {
    throw new Error(`Cannot reject task: status is ${task.status}, expected ready_for_review`);
  }

  const now = new Date().toISOString();
  const events: TaskEvent[] = [
    ...task.events,
    { type: "status_changed", timestamp: now, from: "ready_for_review", to: "rejected" },
    { type: "review_rejected", timestamp: now, from: "ready_for_review", to: "rejected", reason },
    { type: "status_changed", timestamp: now, from: "rejected", to: "in_progress" },
  ];

  return {
    tasks: board.tasks.map((t) => (t.id === id ? { ...t, status: "in_progress" as TaskStatus, events } : t)),
  };
}

export function submitForReview(board: TaskBoard, id: string, wsContext?: WorkspaceContext): TaskBoard {
  const task = board.tasks.find((t) => t.id === id);
  if (!task) throw new Error(`Task ${id} not found`);
  if (task.status !== "in_progress") {
    throw new Error(`Cannot submit for review: status is ${task.status}, expected in_progress`);
  }

  const now = new Date().toISOString();
  const events: TaskEvent[] = [
    ...task.events,
    { type: "status_changed", timestamp: now, from: "in_progress", to: "ready_for_review" },
  ];

  return {
    tasks: board.tasks.map((t) =>
      t.id === id
        ? { ...t, status: "ready_for_review" as TaskStatus, events, workspaceContext: wsContext ?? t.workspaceContext }
        : t
    ),
  };
}

export function acceptTask(board: TaskBoard, id: string, justification?: string): TaskBoard {
  const task = board.tasks.find((t) => t.id === id);
  if (!task) throw new Error(`Task ${id} not found`);
  if (task.status !== "ready_for_review") {
    throw new Error(`Cannot accept task: status is ${task.status}, expected ready_for_review`);
  }

  const now = new Date().toISOString();
  const events: TaskEvent[] = [
    ...task.events,
    { type: "status_changed", timestamp: now, from: "ready_for_review", to: "accepted" },
    { type: "review_accepted", timestamp: now, from: "ready_for_review", to: "accepted", reason: justification },
    ...(task.workspaceContext ? [{ type: "cleanup_queued" as TaskEventType, timestamp: now }] : []),
  ];

  return {
    tasks: board.tasks.map((t) => (t.id === id ? { ...t, status: "accepted" as TaskStatus, events } : t)),
  };
}

export function assignTask(board: TaskBoard, id: string, assignee: string | undefined): TaskBoard {
  return {
    tasks: board.tasks.map((t) => (t.id === id ? { ...t, assignee } : t)),
  };
}

export function removeTask(board: TaskBoard, id: string): TaskBoard {
  return { tasks: board.tasks.filter((t) => t.id !== id) };
}
