import type { TaskBoard, TaskStatus } from "./tasks";

export interface WorkloadSnapshot {
  accountName: string;
  wipCount: number;
  openCount: number;
  recentThroughput: number;
}

const TERMINAL_STATUSES: TaskStatus[] = ["accepted", "rejected"];
import { THROUGHPUT_WINDOW_MS } from "../constants";

export function computeWorkloadSnapshots(board: TaskBoard): Map<string, WorkloadSnapshot> {
  const now = Date.now();
  const snapshots = new Map<string, WorkloadSnapshot>();

  for (const task of board.tasks) {
    if (!task.assignee) continue;

    let snapshot = snapshots.get(task.assignee);
    if (!snapshot) {
      snapshot = { accountName: task.assignee, wipCount: 0, openCount: 0, recentThroughput: 0 };
      snapshots.set(task.assignee, snapshot);
    }

    if (task.status === "in_progress") {
      snapshot.wipCount++;
    }

    if (!TERMINAL_STATUSES.includes(task.status)) {
      snapshot.openCount++;
    }

    const hasRecentAccepted = task.events.some(
      (e) => e.to === "accepted" && now - new Date(e.timestamp).getTime() <= THROUGHPUT_WINDOW_MS
    );
    if (hasRecentAccepted) {
      snapshot.recentThroughput++;
    }
  }

  return snapshots;
}

export function computeWorkloadModifier(snapshot: WorkloadSnapshot): number {
  const wipPenalty = Math.max(-15, snapshot.wipCount * -5);
  const openPenalty = Math.max(-10, snapshot.openCount * -2);
  const throughputBonus = Math.min(15, snapshot.recentThroughput * 5);
  return wipPenalty + openPenalty + throughputBonus;
}
