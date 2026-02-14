// F-09: Circuit Breakers
// Paper ref: Section 4.7 (Safety Mechanisms) — automatic quarantine of misbehaving agents

import type { EventBus, DelegationEvent } from "./event-bus";
import type { ProgressTracker } from "./progress-tracker";
import type { TrustStore } from "../daemon/trust-store";
import type { TaskBoard } from "./tasks";
import { loadTasks, saveTasks, assignTask } from "./tasks";

export interface CircuitBreakerConfig {
  consecutiveFailureThreshold: number;
  trustDropThreshold: number;
  trustDropWindowHours: number;
  unresponsiveMinutes: number;
}

export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  consecutiveFailureThreshold: 3,
  trustDropThreshold: 20,
  trustDropWindowHours: 24,
  unresponsiveMinutes: 30,
};

export type QuarantineTrigger = "consecutive_failures" | "trust_drop" | "unresponsive";

export interface QuarantineRecord {
  accountName: string;
  quarantinedAt: string;
  reason: string;
  trigger: QuarantineTrigger;
  revokedTaskIds: string[];
}

export interface CircuitBreakerDeps {
  eventBus: EventBus;
  trustStore?: TrustStore;
  progressTracker: ProgressTracker;
  activityStore?: { emit: (event: any) => any };
  loadTasksFn?: () => Promise<TaskBoard>;
  saveTasksFn?: (board: TaskBoard) => Promise<void>;
}

export class CircuitBreakerService {
  private config: CircuitBreakerConfig;
  private quarantined = new Map<string, QuarantineRecord>();
  private consecutiveFailures = new Map<string, number>();
  private deps: CircuitBreakerDeps;
  private unsubscribers: Array<() => void> = [];

  constructor(deps: CircuitBreakerDeps, config?: Partial<CircuitBreakerConfig>) {
    this.config = { ...DEFAULT_CIRCUIT_BREAKER_CONFIG, ...config };
    this.deps = deps;
  }

  subscribe(): void {
    const unsub1 = this.deps.eventBus.on("TASK_COMPLETED", (event) => {
      if (event.type !== "TASK_COMPLETED") return;
      const { agent, result } = event as DelegationEvent & { type: "TASK_COMPLETED"; id: string; timestamp: string };
      if (result === "failure") {
        this.recordFailure(agent);
      } else {
        this.recordSuccess(agent);
      }
    });

    const unsub2 = this.deps.eventBus.on("TRUST_UPDATE", (event) => {
      if (event.type !== "TRUST_UPDATE") return;
      const { agent } = event as DelegationEvent & { type: "TRUST_UPDATE"; id: string; timestamp: string };
      this.checkTrustDrop(agent);
    });

    this.unsubscribers.push(unsub1, unsub2);
  }

  unsubscribe(): void {
    for (const unsub of this.unsubscribers) unsub();
    this.unsubscribers = [];
  }

  recordFailure(accountName: string): void {
    if (this.isQuarantined(accountName)) return;
    const count = (this.consecutiveFailures.get(accountName) ?? 0) + 1;
    this.consecutiveFailures.set(accountName, count);

    if (count >= this.config.consecutiveFailureThreshold) {
      this.quarantineAgent(
        accountName,
        `${count} consecutive task failures`,
        "consecutive_failures",
      );
    }
  }

  recordSuccess(accountName: string): void {
    this.consecutiveFailures.set(accountName, 0);
  }

  getConsecutiveFailures(accountName: string): number {
    return this.consecutiveFailures.get(accountName) ?? 0;
  }

  checkTrustDrop(accountName: string): boolean {
    if (this.isQuarantined(accountName)) return false;
    const trustStore = this.deps.trustStore;
    if (!trustStore) return false;

    const history = trustStore.getHistory(accountName, 200);
    if (history.length === 0) return false;

    const windowStart = new Date(Date.now() - this.config.trustDropWindowHours * 60 * 60 * 1000).toISOString();

    const recentEntries = history.filter((h) => h.timestamp >= windowStart);
    if (recentEntries.length === 0) return false;

    const totalDrop = recentEntries.reduce((sum, h) => sum + h.delta, 0);

    if (totalDrop <= -this.config.trustDropThreshold) {
      this.quarantineAgent(
        accountName,
        `Trust score dropped ${Math.abs(totalDrop)} points in ${this.config.trustDropWindowHours}h (threshold: ${this.config.trustDropThreshold})`,
        "trust_drop",
      );
      return true;
    }

    return false;
  }

  checkUnresponsive(accountName: string, taskIds: string[]): boolean {
    if (this.isQuarantined(accountName)) return false;

    const stalledTasks = taskIds.filter((taskId) =>
      this.deps.progressTracker.isStalled(taskId, this.config.unresponsiveMinutes),
    );

    if (stalledTasks.length > 0) {
      this.quarantineAgent(
        accountName,
        `No progress reports for ${this.config.unresponsiveMinutes}+ minutes on ${stalledTasks.length} task(s): ${stalledTasks.join(", ")}`,
        "unresponsive",
      );
      return true;
    }

    return false;
  }

  async quarantineAgent(
    accountName: string,
    reason: string,
    trigger: QuarantineTrigger,
  ): Promise<QuarantineRecord> {
    const loadFn = this.deps.loadTasksFn ?? loadTasks;
    const saveFn = this.deps.saveTasksFn ?? saveTasks;

    // Revoke all active tasks assigned to this agent
    let board = await loadFn();
    const revokedTaskIds: string[] = [];

    for (const task of board.tasks) {
      if (task.assignee === accountName && (task.status === "todo" || task.status === "in_progress")) {
        board = assignTask(board, task.id, undefined);
        revokedTaskIds.push(task.id);

        // Emit REASSIGNMENT event for each revoked task
        this.deps.eventBus.emit({
          type: "REASSIGNMENT",
          taskId: task.id,
          from: accountName,
          to: "unassigned",
          trigger: `circuit_breaker:${trigger}`,
        });
      }
    }

    if (revokedTaskIds.length > 0) {
      await saveFn(board);
    }

    const record: QuarantineRecord = {
      accountName,
      quarantinedAt: new Date().toISOString(),
      reason,
      trigger,
      revokedTaskIds,
    };
    this.quarantined.set(accountName, record);

    // Log to activity store
    if (this.deps.activityStore) {
      this.deps.activityStore.emit({
        type: "agent_quarantined",
        timestamp: record.quarantinedAt,
        account: accountName,
        metadata: { reason, trigger, revokedTaskIds },
      });
    }

    return record;
  }

  reinstateAgent(accountName: string): boolean {
    if (!this.quarantined.has(accountName)) return false;

    this.quarantined.delete(accountName);
    this.consecutiveFailures.set(accountName, 0);

    // Log reinstatement
    if (this.deps.activityStore) {
      this.deps.activityStore.emit({
        type: "agent_reinstated",
        timestamp: new Date().toISOString(),
        account: accountName,
        metadata: {},
      });
    }

    return true;
  }

  isQuarantined(accountName: string): boolean {
    return this.quarantined.has(accountName);
  }

  getQuarantineRecord(accountName: string): QuarantineRecord | null {
    return this.quarantined.get(accountName) ?? null;
  }

  getAllQuarantined(): QuarantineRecord[] {
    return Array.from(this.quarantined.values());
  }

  checkAgent(
    accountName: string,
    activeTaskIds: string[],
  ): { quarantined: boolean; reason?: string } {
    if (this.isQuarantined(accountName)) {
      const record = this.getQuarantineRecord(accountName)!;
      return { quarantined: true, reason: record.reason };
    }

    // Check consecutive failures
    const failures = this.getConsecutiveFailures(accountName);
    if (failures >= this.config.consecutiveFailureThreshold) {
      return { quarantined: true, reason: `${failures} consecutive failures` };
    }

    // Check trust drop
    if (this.checkTrustDrop(accountName)) {
      return { quarantined: true, reason: "trust score drop" };
    }

    // Check unresponsive
    if (activeTaskIds.length > 0 && this.checkUnresponsive(accountName, activeTaskIds)) {
      return { quarantined: true, reason: "unresponsive agent" };
    }

    return { quarantined: false };
  }
}
