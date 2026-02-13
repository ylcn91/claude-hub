import type { TaskBoard, Task, TaskEvent } from "./tasks";

export interface AccountMetrics {
  accountName: string;
  assigned: number;
  accepted: number;
  rejected: number;
  acceptRate: number;
  avgCycleTimeMs: number;
  currentWip: number;
}

export interface AnalyticsSnapshot {
  generatedAt: string;
  fromDate?: string;
  toDate?: string;
  totalTasks: number;
  totalAccepted: number;
  totalRejected: number;
  overallAcceptRate: number;
  avgCycleTimeMs: number;
  perAccount: AccountMetrics[];
  slaViolations: { total: number; byAction: Record<string, number> };
}

export function computeAnalytics(
  board: TaskBoard,
  opts?: { fromDate?: string; toDate?: string }
): AnalyticsSnapshot {
  const fromMs = opts?.fromDate ? new Date(opts.fromDate).getTime() : -Infinity;
  const toMs = opts?.toDate ? new Date(opts.toDate).getTime() : Infinity;

  const filtered = board.tasks.filter((t) => {
    const created = new Date(t.createdAt).getTime();
    return created >= fromMs && created <= toMs;
  });

  // Group by assignee
  const byAssignee = new Map<string, Task[]>();
  for (const task of filtered) {
    const key = task.assignee ?? "(unassigned)";
    const list = byAssignee.get(key) ?? [];
    list.push(task);
    byAssignee.set(key, list);
  }

  const perAccount: AccountMetrics[] = [];
  let totalAccepted = 0;
  let totalRejected = 0;
  let allCycleTimes: number[] = [];

  for (const [accountName, tasks] of byAssignee) {
    const assigned = tasks.length;
    const accepted = tasks.filter((t) => t.status === "accepted").length;
    const rejected = tasks.filter((t) => t.status === "rejected").length;
    const denom = accepted + rejected;
    const acceptRate = denom > 0 ? accepted / denom : 0;

    const cycleTimes: number[] = [];
    for (const task of tasks) {
      if (task.status === "accepted") {
        const acceptedEvent = task.events.find(
          (e) => e.to === "accepted" && e.type === "status_changed"
        );
        if (acceptedEvent) {
          const diff =
            new Date(acceptedEvent.timestamp).getTime() -
            new Date(task.createdAt).getTime();
          cycleTimes.push(diff);
        }
      }
    }

    const avgCycleTimeMs =
      cycleTimes.length > 0
        ? cycleTimes.reduce((a, b) => a + b, 0) / cycleTimes.length
        : 0;

    const currentWip = tasks.filter((t) => t.status === "in_progress").length;

    totalAccepted += accepted;
    totalRejected += rejected;
    allCycleTimes.push(...cycleTimes);

    perAccount.push({
      accountName,
      assigned,
      accepted,
      rejected,
      acceptRate,
      avgCycleTimeMs,
      currentWip,
    });
  }

  // SLA violations: search all events for "sla" in any field
  const slaByAction: Record<string, number> = {};
  let slaTotal = 0;
  for (const task of filtered) {
    for (const event of task.events) {
      if (eventContainsSla(event)) {
        slaTotal++;
        const action = event.type;
        slaByAction[action] = (slaByAction[action] ?? 0) + 1;
      }
    }
  }

  const overallDenom = totalAccepted + totalRejected;
  const overallAcceptRate = overallDenom > 0 ? totalAccepted / overallDenom : 0;
  const overallAvgCycle =
    allCycleTimes.length > 0
      ? allCycleTimes.reduce((a, b) => a + b, 0) / allCycleTimes.length
      : 0;

  return {
    generatedAt: new Date().toISOString(),
    fromDate: opts?.fromDate,
    toDate: opts?.toDate,
    totalTasks: filtered.length,
    totalAccepted,
    totalRejected,
    overallAcceptRate,
    avgCycleTimeMs: overallAvgCycle,
    perAccount,
    slaViolations: { total: slaTotal, byAction: slaByAction },
  };
}

function eventContainsSla(event: TaskEvent): boolean {
  const fields = [event.type, event.from, event.to, event.reason];
  return fields.some((v) => v != null && v.toLowerCase().includes("sla"));
}

export function formatAnalyticsSummary(snapshot: AnalyticsSnapshot): string {
  const lines: string[] = [];
  lines.push("=== Analytics Summary ===");
  lines.push(`Generated: ${snapshot.generatedAt}`);
  if (snapshot.fromDate || snapshot.toDate) {
    lines.push(`Range: ${snapshot.fromDate ?? "..."} to ${snapshot.toDate ?? "..."}`);
  }
  lines.push("");
  lines.push(`Total Tasks:    ${snapshot.totalTasks}`);
  lines.push(`Accepted:       ${snapshot.totalAccepted}`);
  lines.push(`Rejected:       ${snapshot.totalRejected}`);
  lines.push(`Accept Rate:    ${(snapshot.overallAcceptRate * 100).toFixed(1)}%`);
  lines.push(`Avg Cycle Time: ${formatMs(snapshot.avgCycleTimeMs)}`);
  lines.push("");
  lines.push("Per Account:");
  lines.push(
    `  ${"Account".padEnd(20)} ${"Assigned".padEnd(10)} ${"Accepted".padEnd(10)} ${"Rejected".padEnd(10)} ${"Rate".padEnd(8)} ${"Avg Cycle".padEnd(12)} ${"WIP".padEnd(5)}`
  );
  lines.push(`  ${"─".repeat(75)}`);
  for (const m of snapshot.perAccount) {
    lines.push(
      `  ${m.accountName.padEnd(20)} ${String(m.assigned).padEnd(10)} ${String(m.accepted).padEnd(10)} ${String(m.rejected).padEnd(10)} ${(m.acceptRate * 100).toFixed(0).padStart(3)}%     ${formatMs(m.avgCycleTimeMs).padEnd(12)} ${String(m.currentWip).padEnd(5)}`
    );
  }

  if (snapshot.slaViolations.total > 0) {
    lines.push("");
    lines.push(`SLA Violations: ${snapshot.slaViolations.total}`);
    for (const [action, count] of Object.entries(snapshot.slaViolations.byAction)) {
      lines.push(`  ${action}: ${count}`);
    }
  }

  return lines.join("\n");
}

export function formatMs(ms: number): string {
  if (ms === 0) return "N/A";
  if (ms < 60000) return `${(ms / 1000).toFixed(0)}s`;
  if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`;
  return `${(ms / 3600000).toFixed(1)}h`;
}
