// F-02: Standardized Observability Event Taxonomy
// Paper ref: Section 4.5 (Monitoring) — standardized observability events

import type { VerificationReceipt } from "./verification-receipts";
export type { VerificationReceipt };

export interface TaskCharacteristics {
  complexity?: "low" | "medium" | "high" | "critical";
  criticality?: "low" | "medium" | "high" | "critical";
  uncertainty?: "low" | "medium" | "high";
  verifiability?: "auto-testable" | "needs-review" | "subjective";
  reversibility?: "reversible" | "partial" | "irreversible";
}

export interface ProgressData {
  percent: number;
  currentStep: string;
  blockers?: string[];
  estimatedRemainingMinutes?: number;
  artifactsProduced?: string[];
}

// Discriminated union of all delegation lifecycle events
export type DelegationEvent =
  | { type: "TASK_CREATED"; taskId: string; delegator: string; characteristics?: TaskCharacteristics }
  | { type: "TASK_ASSIGNED"; taskId: string; delegator: string; delegatee: string; reason: string }
  | { type: "TASK_STARTED"; taskId: string; agent: string }
  | { type: "CHECKPOINT_REACHED"; taskId: string; agent: string; percent: number; step: string }
  | { type: "RESOURCE_WARNING"; taskId: string; agent: string; warning: string }
  | { type: "PROGRESS_UPDATE"; taskId: string; agent: string; data: ProgressData }
  | { type: "SLA_WARNING"; taskId: string; threshold: string; elapsed: number }
  | { type: "SLA_BREACH"; taskId: string; threshold: string; elapsed: number }
  | { type: "TASK_COMPLETED"; taskId: string; agent: string; result: "success" | "failure" }
  | { type: "TASK_VERIFIED"; taskId: string; verifier: string; passed: boolean; receipt?: VerificationReceipt }
  | { type: "REASSIGNMENT"; taskId: string; from: string; to: string; trigger: string }
  | { type: "DELEGATION_CHAIN"; taskId: string; chain: string[] }
  | { type: "TRUST_UPDATE"; agent: string; delta: number; reason: string }
  | { type: "TDD_CYCLE_START"; testFile: string; phase: "red" | "green" | "refactor" }
  | { type: "TDD_TEST_PASS"; testFile: string; passCount: number; duration: number }
  | { type: "TDD_TEST_FAIL"; testFile: string; failCount: number; duration: number }
  | { type: "TDD_REFACTOR"; testFile: string };

export type DelegationEventType = DelegationEvent["type"];

export type EventHandler = (event: DelegationEvent & { id: string; timestamp: string }) => void;

export class EventBus {
  private handlers = new Map<string, Set<EventHandler>>();
  private recentEvents: Array<DelegationEvent & { id: string; timestamp: string }> = [];
  private maxRecent: number;

  constructor(opts?: { maxRecent?: number }) {
    this.maxRecent = opts?.maxRecent ?? 1000;
  }

  emit(event: DelegationEvent): string {
    const id = crypto.randomUUID();
    const timestamped = { ...event, id, timestamp: new Date().toISOString() };

    this.recentEvents.push(timestamped);
    if (this.recentEvents.length > this.maxRecent) {
      this.recentEvents.shift();
    }

    // Notify type-specific subscribers
    const typeHandlers = this.handlers.get(event.type);
    if (typeHandlers) {
      for (const handler of typeHandlers) {
        try { handler(timestamped); } catch (e: any) {
          console.error(`[event-bus] handler error for ${event.type}:`, e.message);
        }
      }
    }

    // Notify wildcard subscribers
    const wildcardHandlers = this.handlers.get("*");
    if (wildcardHandlers) {
      for (const handler of wildcardHandlers) {
        try { handler(timestamped); } catch (e: any) {
          console.error("[event-bus] wildcard handler error:", e.message);
        }
      }
    }

    return id;
  }

  on(eventType: DelegationEventType | "*", handler: EventHandler): () => void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }
    this.handlers.get(eventType)!.add(handler);

    // Return unsubscribe function
    return () => {
      this.handlers.get(eventType)?.delete(handler);
    };
  }

  getRecent(opts?: { type?: DelegationEventType; taskId?: string; limit?: number }): Array<DelegationEvent & { id: string; timestamp: string }> {
    let events = this.recentEvents;
    if (opts?.type) {
      events = events.filter((e) => e.type === opts.type);
    }
    if (opts?.taskId) {
      events = events.filter((e) => "taskId" in e && (e as any).taskId === opts.taskId);
    }
    const limit = opts?.limit ?? 50;
    return events.slice(-limit);
  }

  clear(): void {
    this.recentEvents = [];
    this.handlers.clear();
  }
}
