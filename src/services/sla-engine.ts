import type { Task, TaskStatus } from "./tasks";
import type { EntireAdapter, EntireSessionMetrics } from "./entire-adapter";
import type { EventBus } from "./event-bus";
import type { TaskCharacteristics } from "./event-bus";

export interface SLAConfig {
  inProgressMaxMs: number;
  blockedMaxMs: number;
  reviewMaxMs: number;
  checkIntervalMs: number;
}

export const DEFAULT_SLA_CONFIG: SLAConfig = {
  inProgressMaxMs: 30 * 60 * 1000,  // 30 minutes before ping
  blockedMaxMs: 15 * 60 * 1000,     // 15 minutes before escalation
  reviewMaxMs: 10 * 60 * 1000,      // 10 minutes before review nudge
  checkIntervalMs: 60 * 1000,       // 1 minute check interval
};

// --- Adaptive SLA types ---

export type AdaptiveAction =
  | "ping"
  | "suggest_reassign"
  | "auto_reassign"
  | "escalate_human"
  | "terminate";

export type EntireTriggerType =
  | "token_burn_rate"
  | "no_checkpoint"
  | "context_saturation"
  | "session_ended_incomplete";

export interface EntireTrigger {
  type: EntireTriggerType;
  taskId: string;
  sessionId: string;
  agent: string;
  detail: string;
  metrics?: EntireSessionMetrics;
}

export interface AdaptiveEscalation {
  taskId: string;
  taskTitle: string;
  currentStatus: TaskStatus;
  assignee?: string;
  action: AdaptiveAction;
  trigger: EntireTrigger;
  alternatives?: string[];
  characteristics?: TaskCharacteristics;
}

export interface Escalation {
  taskId: string;
  taskTitle: string;
  currentStatus: TaskStatus;
  assignee?: string;
  staleForMs: number;
  action: "ping" | "reassign_suggestion" | "escalate";
}

// --- Adaptive SLA thresholds ---

export interface AdaptiveSLAConfig {
  /** Multiplier over average burn rate to trigger warning */
  tokenBurnRateMultiplier: number;
  /** Minutes without a checkpoint before warning */
  noCheckpointMinutes: number;
  /** Context saturation fraction (0-1) to trigger warning */
  contextSaturationThreshold: number;
  /** Minimum minutes between re-delegations for a single task */
  cooldownMinutes: number;
  /** Multiplier on threshold for unresponsive agent termination */
  terminateUnresponsiveMultiplier: number;
}

export const DEFAULT_ADAPTIVE_SLA_CONFIG: AdaptiveSLAConfig = {
  tokenBurnRateMultiplier: 2,
  noCheckpointMinutes: 10,
  contextSaturationThreshold: 0.8,
  cooldownMinutes: 15,
  terminateUnresponsiveMultiplier: 2,
};

// --- Cooldown tracker ---

const cooldowns = new Map<string, number>();

export function isCoolingDown(taskId: string, now: number, cooldownMs: number): boolean {
  const lastAction = cooldowns.get(taskId);
  if (!lastAction) return false;
  return (now - lastAction) < cooldownMs;
}

export function setCooldown(taskId: string, now: number): void {
  cooldowns.set(taskId, now);
}

export function clearCooldowns(): void {
  cooldowns.clear();
}

// --- Graduated response logic ---

export function determineAction(
  trigger: EntireTrigger,
  characteristics?: TaskCharacteristics,
  unresponsiveSince?: number,
  thresholdMs?: number,
): AdaptiveAction {
  const terminateMultiplier = DEFAULT_ADAPTIVE_SLA_CONFIG.terminateUnresponsiveMultiplier;

  // If agent unresponsive for 2x threshold, terminate
  if (unresponsiveSince !== undefined && thresholdMs !== undefined) {
    const unresponsiveMs = Date.now() - unresponsiveSince;
    if (unresponsiveMs > thresholdMs * terminateMultiplier) {
      return "terminate";
    }
  }

  // escalate_human only if reversibility is 'irreversible'
  if (characteristics?.reversibility === "irreversible") {
    return "escalate_human";
  }

  // auto_reassign only if criticality >= 'high'
  if (
    trigger.type === "session_ended_incomplete" ||
    trigger.type === "context_saturation"
  ) {
    if (
      characteristics?.criticality === "high" ||
      characteristics?.criticality === "critical"
    ) {
      return "auto_reassign";
    }
    return "suggest_reassign";
  }

  // token_burn_rate and no_checkpoint default to ping
  if (trigger.type === "token_burn_rate" || trigger.type === "no_checkpoint") {
    return "ping";
  }

  return "ping";
}

// --- Entire.io trigger detection ---

export function detectEntireTriggers(
  metrics: EntireSessionMetrics,
  taskId: string,
  averageBurnRate: number,
  lastCheckpointTime: number,
  now: number,
  config: AdaptiveSLAConfig = DEFAULT_ADAPTIVE_SLA_CONFIG,
): EntireTrigger[] {
  const triggers: EntireTrigger[] = [];

  // token_burn_rate: rate > 2x average
  if (averageBurnRate > 0 && metrics.tokenBurnRate > averageBurnRate * config.tokenBurnRateMultiplier) {
    triggers.push({
      type: "token_burn_rate",
      taskId,
      sessionId: metrics.sessionId,
      agent: metrics.agentType,
      detail: `Burn rate ${Math.round(metrics.tokenBurnRate)}/min exceeds ${config.tokenBurnRateMultiplier}x average (${Math.round(averageBurnRate)}/min)`,
      metrics,
    });
  }

  // no_checkpoint: no checkpoint in configured minutes
  const minutesSinceCheckpoint = (now - lastCheckpointTime) / 60_000;
  if (minutesSinceCheckpoint > config.noCheckpointMinutes) {
    triggers.push({
      type: "no_checkpoint",
      taskId,
      sessionId: metrics.sessionId,
      agent: metrics.agentType,
      detail: `No checkpoint for ${Math.round(minutesSinceCheckpoint)} minutes (threshold: ${config.noCheckpointMinutes}min)`,
      metrics,
    });
  }

  // context_saturation: > threshold
  if (metrics.contextSaturation > config.contextSaturationThreshold) {
    triggers.push({
      type: "context_saturation",
      taskId,
      sessionId: metrics.sessionId,
      agent: metrics.agentType,
      detail: `Context at ${Math.round(metrics.contextSaturation * 100)}% (threshold: ${Math.round(config.contextSaturationThreshold * 100)}%)`,
      metrics,
    });
  }

  // session_ended_incomplete: phase is "ended" but task still in_progress
  if (metrics.phase === "ended") {
    triggers.push({
      type: "session_ended_incomplete",
      taskId,
      sessionId: metrics.sessionId,
      agent: metrics.agentType,
      detail: `Session ended but task "${taskId}" still in progress`,
      metrics,
    });
  }

  return triggers;
}

// --- Adaptive SLA engine ---

export class AdaptiveSLAEngine {
  private entireAdapter: EntireAdapter | null;
  private eventBus: EventBus | null;
  private config: AdaptiveSLAConfig;
  private averageBurnRates = new Map<string, number>();
  private lastCheckpointTimes = new Map<string, number>();
  private unresponsiveSince = new Map<string, number>();

  constructor(opts?: {
    entireAdapter?: EntireAdapter;
    eventBus?: EventBus;
    config?: AdaptiveSLAConfig;
  }) {
    this.entireAdapter = opts?.entireAdapter ?? null;
    this.eventBus = opts?.eventBus ?? null;
    this.config = opts?.config ?? DEFAULT_ADAPTIVE_SLA_CONFIG;
  }

  /** Record average burn rate for a task (used as baseline) */
  setAverageBurnRate(taskId: string, rate: number): void {
    this.averageBurnRates.set(taskId, rate);
  }

  /** Record last checkpoint time for a task */
  setLastCheckpointTime(taskId: string, time: number): void {
    this.lastCheckpointTimes.set(taskId, time);
  }

  /** Mark an agent as unresponsive since a given time */
  markUnresponsive(taskId: string, since: number): void {
    this.unresponsiveSince.set(taskId, since);
  }

  /** Clear unresponsive marker */
  clearUnresponsive(taskId: string): void {
    this.unresponsiveSince.delete(taskId);
  }

  /**
   * Check entire.io-monitored tasks for adaptive SLA triggers.
   * Only runs when entireMonitoring feature flag is true.
   */
  checkAdaptiveTasks(
    tasks: Task[],
    entireMonitoringEnabled: boolean,
    now: number = Date.now(),
  ): AdaptiveEscalation[] {
    if (!entireMonitoringEnabled || !this.entireAdapter) {
      return [];
    }

    const escalations: AdaptiveEscalation[] = [];
    const cooldownMs = this.config.cooldownMinutes * 60_000;

    for (const task of tasks) {
      if (task.status !== "in_progress") continue;

      // Skip if task is cooling down from a recent re-delegation
      if (isCoolingDown(task.id, now, cooldownMs)) continue;

      // Try to get metrics from entire.io adapter
      // The session ID is linked via entireAdapter.linkSessionToTask
      const sessionId = this.entireAdapter.getLinkedTaskId(task.id);
      // We need the reverse lookup: task -> session. Iterate known sessions.
      const metrics = this.getMetricsForTask(task.id);
      if (!metrics) continue;

      const averageBurnRate = this.averageBurnRates.get(task.id) ?? 0;
      const lastCheckpointTime = this.lastCheckpointTimes.get(task.id) ?? now;

      const triggers = detectEntireTriggers(
        metrics,
        task.id,
        averageBurnRate,
        lastCheckpointTime,
        now,
        this.config,
      );

      for (const trigger of triggers) {
        const characteristics = this.getTaskCharacteristics(task);
        const unresponsive = this.unresponsiveSince.get(task.id);
        const thresholdMs = this.config.noCheckpointMinutes * 60_000;

        const action = determineAction(trigger, characteristics, unresponsive, thresholdMs);

        const escalation: AdaptiveEscalation = {
          taskId: task.id,
          taskTitle: task.title,
          currentStatus: task.status,
          assignee: task.assignee,
          action,
          trigger,
          characteristics,
        };

        escalations.push(escalation);

        // Emit event bus events for triggers
        if (this.eventBus) {
          if (trigger.type === "session_ended_incomplete") {
            this.eventBus.emit({
              type: "SLA_BREACH",
              taskId: task.id,
              threshold: trigger.type,
              elapsed: metrics.elapsedMinutes,
            });
          } else {
            this.eventBus.emit({
              type: trigger.type === "no_checkpoint" ? "SLA_WARNING" : "RESOURCE_WARNING",
              taskId: task.id,
              ...(trigger.type === "no_checkpoint"
                ? { threshold: trigger.type, elapsed: metrics.elapsedMinutes }
                : { agent: trigger.agent, warning: trigger.detail }),
            });
          }
        }

        // Set cooldown if action involves reassignment
        if (action === "auto_reassign" || action === "suggest_reassign") {
          setCooldown(task.id, now);
        }
      }
    }

    return escalations;
  }

  /** Look up metrics for a task via the entire adapter's session-task map */
  private getMetricsForTask(taskId: string): EntireSessionMetrics | null {
    if (!this.entireAdapter) return null;
    // The adapter maps session -> task, so we check if there's a matching session
    // We expose getSessionMetrics which takes sessionId.
    // For the reverse lookup, we rely on the adapter having linked sessions to tasks.
    return this.entireAdapter.getSessionMetrics(taskId);
  }

  /** Extract task characteristics from tags (convention-based) */
  private getTaskCharacteristics(task: Task): TaskCharacteristics | undefined {
    if (!task.tags || task.tags.length === 0) return undefined;

    const characteristics: TaskCharacteristics = {};

    for (const tag of task.tags) {
      if (tag.startsWith("criticality:")) {
        characteristics.criticality = tag.split(":")[1] as TaskCharacteristics["criticality"];
      }
      if (tag.startsWith("reversibility:")) {
        characteristics.reversibility = tag.split(":")[1] as TaskCharacteristics["reversibility"];
      }
      if (tag.startsWith("complexity:")) {
        characteristics.complexity = tag.split(":")[1] as TaskCharacteristics["complexity"];
      }
    }

    return Object.keys(characteristics).length > 0 ? characteristics : undefined;
  }
}

// --- Original time-based SLA functions (unchanged) ---

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
