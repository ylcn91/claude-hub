import type { Task, TaskStatus } from "./tasks";

export interface SLAConfig {
  inProgressMaxMs: number;
  blockedMaxMs: number;
  reviewMaxMs: number;
  checkIntervalMs: number;
}

export const DEFAULT_SLA_CONFIG: SLAConfig = {
  inProgressMaxMs: 30 * 60 * 1000,
  blockedMaxMs: 15 * 60 * 1000,
  reviewMaxMs: 10 * 60 * 1000,
  checkIntervalMs: 60 * 1000,
};

export interface Escalation {
  taskId: string;
  taskTitle: string;
  currentStatus: TaskStatus;
  assignee?: string;
  staleForMs: number;
  action: "ping" | "reassign_suggestion" | "escalate";
}

export function humanTime(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function lastEventTimestamp(task: Task, targetStatus: TaskStatus): number {
  for (let i = task.events.length - 1; i >= 0; i--) {
    const ev = task.events[i];
    if (ev.type === "status_changed" && ev.to === targetStatus) {
      return new Date(ev.timestamp).getTime();
    }
  }
  return new Date(task.createdAt).getTime();
}

export function checkStaleTasks(
  tasks: Task[],
  config: SLAConfig = DEFAULT_SLA_CONFIG,
  now: Date = new Date(),
): Escalation[] {
  const escalations: Escalation[] = [];
  const nowMs = now.getTime();

  for (const task of tasks) {
    if (task.status === "in_progress") {
      const isBlocked = task.tags?.includes("blocked") ?? false;
      const enteredAt = lastEventTimestamp(task, "in_progress");
      const staleForMs = nowMs - enteredAt;

      if (isBlocked) {
        if (staleForMs > config.blockedMaxMs) {
          escalations.push({
            taskId: task.id,
            taskTitle: task.title,
            currentStatus: task.status,
            assignee: task.assignee,
            staleForMs,
            action: "escalate",
          });
        }
      } else if (staleForMs > config.inProgressMaxMs * 2) {
        escalations.push({
          taskId: task.id,
          taskTitle: task.title,
          currentStatus: task.status,
          assignee: task.assignee,
          staleForMs,
          action: "reassign_suggestion",
        });
      } else if (staleForMs > config.inProgressMaxMs) {
        escalations.push({
          taskId: task.id,
          taskTitle: task.title,
          currentStatus: task.status,
          assignee: task.assignee,
          staleForMs,
          action: "ping",
        });
      }
    } else if (task.status === "ready_for_review") {
      const enteredAt = lastEventTimestamp(task, "ready_for_review");
      const staleForMs = nowMs - enteredAt;

      if (staleForMs > config.reviewMaxMs) {
        escalations.push({
          taskId: task.id,
          taskTitle: task.title,
          currentStatus: task.status,
          assignee: task.assignee,
          staleForMs,
          action: "ping",
        });
      }
    }
  }

  return escalations;
}

export function formatEscalationMessage(escalation: Escalation): string {
  const assigneeStr = escalation.assignee ?? "unassigned";
  const time = humanTime(escalation.staleForMs);

  switch (escalation.action) {
    case "ping":
      return `⏰ Task "${escalation.taskTitle}" has been ${escalation.currentStatus} for ${time}. Assignee: ${assigneeStr}`;
    case "reassign_suggestion":
      return `⚠️ Task "${escalation.taskTitle}" stale for ${time}. Consider reassigning from ${assigneeStr}.`;
    case "escalate":
      return `🚨 Task "${escalation.taskTitle}" blocked for ${time}. Needs immediate attention.`;
  }
}
