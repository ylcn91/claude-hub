import type { WorkflowStore } from "./workflow-store";
import type { ActivityStore } from "./activity-store";
import type { WorkflowDefinition } from "./workflow-parser";
import { validateDAG } from "./workflow-parser";
import type { RetroEngine } from "./retro-engine";
import { evaluateCondition, type EvalContext } from "./condition-evaluator";

export class WorkflowEngine {
  retroEngine?: RetroEngine;

  constructor(
    private store: WorkflowStore,
    private activityStore: ActivityStore | undefined,
    private daemonState: any,
  ) {}

  async triggerWorkflow(definition: WorkflowDefinition, context: string): Promise<string> {
    // Validate dependency graph before execution — catches cycles even when
    // the definition was constructed programmatically (not via parseWorkflow).
    validateDAG(definition.steps);

    const now = new Date().toISOString();

    const run = this.store.createRun({
      workflow_name: definition.name,
      status: "running",
      trigger_context: context,
      started_at: now,
      completed_at: null,
      retro_id: null,
    });

    for (const step of definition.steps) {
      this.store.createStepRun({
        run_id: run.id,
        step_id: step.id,
        status: "pending",
        assigned_to: null,
        task_id: null,
        handoff_id: null,
        started_at: null,
        completed_at: null,
        attempt: 1,
        result: null,
      });
    }

    this.activityStore?.emit({
      type: "workflow_started",
      timestamp: now,
      account: "system",
      workflowRunId: run.id,
      metadata: { workflowName: definition.name, context },
    });

    this.store.addEvent({
      run_id: run.id,
      step_id: null,
      type: "workflow_started",
      detail: JSON.stringify({ name: definition.name }),
      timestamp: now,
    });

    await this.scheduleReadySteps(run.id, definition);

    return run.id;
  }

  async scheduleReadySteps(runId: string, definition?: WorkflowDefinition): Promise<void> {
    const stepRuns = this.store.getStepRunsForRun(runId);
    const run = this.store.getRun(runId);
    if (!run) return;

    // Build context for condition checking
    const stepContext = new Map<string, { result?: string; duration_ms?: number; assignee?: string }>();
    for (const sr of stepRuns) {
      if (sr.status === "completed" || sr.status === "failed" || sr.status === "skipped") {
        let durationMs: number | undefined;
        if (sr.started_at && sr.completed_at) {
          durationMs = new Date(sr.completed_at).getTime() - new Date(sr.started_at).getTime();
        }
        stepContext.set(sr.step_id, {
          result: sr.result ?? undefined,
          duration_ms: durationMs,
          assignee: sr.assigned_to ?? undefined,
        });
      }
    }

    const conditionCtx: EvalContext = {
      steps: stepContext,
      trigger: { context: run.trigger_context ?? "" },
    };

    const completedStepIds = new Set(
      stepRuns
        .filter((sr) => sr.status === "completed" || sr.status === "failed" || sr.status === "skipped")
        .map((sr) => sr.step_id)
    );

    const stepDefs = definition?.steps;
    let didSkip = false;

    for (const sr of stepRuns) {
      if (sr.status !== "pending") continue;

      const stepDef = stepDefs?.find((s) => s.id === sr.step_id);
      if (!stepDef) continue;

      const deps = stepDef.depends_on ?? [];
      const allDepsComplete = deps.every((dep) => completedStepIds.has(dep));
      if (!allDepsComplete) continue;

      // Check condition
      if (stepDef.condition) {
        const conditionMet = evaluateCondition(stepDef.condition.when, conditionCtx);
        if (!conditionMet) {
          this.store.updateStepRun(sr.id, {
            status: "skipped",
            completed_at: new Date().toISOString(),
            result: "condition_not_met",
          });
          this.store.addEvent({
            run_id: runId,
            step_id: sr.step_id,
            type: "step_skipped",
            detail: JSON.stringify({ condition: stepDef.condition.when }),
            timestamp: new Date().toISOString(),
          });
          didSkip = true;
          continue;
        }
      }

      // Determine assignee
      let assignee = stepDef.assign;
      if (assignee === "auto" && this.daemonState?.capabilityStore) {
        try {
          const { rankAccounts } = await import("./account-capabilities");
          const capabilities = this.daemonState.capabilityStore.getAll();
          const scores = rankAccounts(capabilities, stepDef.skills ?? []);
          if (scores.length > 0) {
            assignee = scores[0].accountName;
          }
        } catch {
          // Keep "auto" as assignee
        }
      }

      const now = new Date().toISOString();
      this.store.updateStepRun(sr.id, {
        status: "assigned",
        assigned_to: assignee,
        started_at: now,
      });

      this.activityStore?.emit({
        type: "workflow_step_completed",
        timestamp: now,
        account: assignee,
        workflowRunId: runId,
        metadata: { stepId: sr.step_id, status: "assigned", assignee },
      });

      this.store.addEvent({
        run_id: runId,
        step_id: sr.step_id,
        type: "step_assigned",
        detail: JSON.stringify({ assignee }),
        timestamp: now,
      });
    }

    // If we skipped steps, some downstream steps may now be unblocked
    if (didSkip) {
      // Re-check after skips — but avoid infinite recursion by only recursing once
      const updatedRuns = this.store.getStepRunsForRun(runId);
      const pendingCount = updatedRuns.filter((sr) => sr.status === "pending").length;
      if (pendingCount > 0) {
        // Rebuild completed set and try again (non-recursive, just one more pass)
        const newCompleted = new Set(
          updatedRuns.filter((sr) => sr.status === "completed" || sr.status === "failed" || sr.status === "skipped").map((sr) => sr.step_id)
        );
        for (const sr of updatedRuns) {
          if (sr.status !== "pending") continue;
          const stepDef = stepDefs?.find((s) => s.id === sr.step_id);
          if (!stepDef) continue;
          const deps = stepDef.depends_on ?? [];
          if (!deps.every((dep) => newCompleted.has(dep))) continue;

          let assignee = stepDef.assign;
          const now = new Date().toISOString();
          this.store.updateStepRun(sr.id, {
            status: "assigned",
            assigned_to: assignee,
            started_at: now,
          });
          this.store.addEvent({
            run_id: runId,
            step_id: sr.step_id,
            type: "step_assigned",
            detail: JSON.stringify({ assignee }),
            timestamp: now,
          });
        }
      }
    }

    // Check if workflow is complete
    const finalStepRuns = this.store.getStepRunsForRun(runId);
    const allTerminal = finalStepRuns.every(
      (sr) => sr.status === "completed" || sr.status === "failed" || sr.status === "skipped"
    );

    if (allTerminal && finalStepRuns.length > 0) {
      await this.completeWorkflow(runId, definition);
    }
  }

  async onStepCompleted(
    runId: string,
    stepId: string,
    result: "accepted" | "rejected" | "failed",
    definition: WorkflowDefinition,
  ): Promise<void> {
    const stepRun = this.store.getStepRunByStepId(runId, stepId);
    if (!stepRun) throw new Error(`Step run not found: step '${stepId}' in run '${runId}'`);

    const now = new Date().toISOString();

    this.store.updateStepRun(stepRun.id, {
      status: "completed",
      result,
      completed_at: now,
    });

    this.activityStore?.emit({
      type: "workflow_step_completed",
      timestamp: now,
      account: stepRun.assigned_to ?? "system",
      workflowRunId: runId,
      metadata: { stepId, result },
    });

    this.store.addEvent({
      run_id: runId,
      step_id: stepId,
      type: "step_completed",
      detail: JSON.stringify({ result }),
      timestamp: now,
    });

    await this.scheduleReadySteps(runId, definition);
  }

  async onStepFailed(
    runId: string,
    stepId: string,
    error: string,
    definition: WorkflowDefinition,
  ): Promise<void> {
    const stepRun = this.store.getStepRunByStepId(runId, stepId);
    if (!stepRun) throw new Error(`Step run not found: step '${stepId}' in run '${runId}'`);

    const now = new Date().toISOString();
    const maxRetries = definition.max_retries ?? 0;

    if (stepRun.attempt <= maxRetries) {
      this.store.updateStepRun(stepRun.id, {
        status: "pending",
        attempt: stepRun.attempt + 1,
        completed_at: null,
        started_at: null,
        assigned_to: null,
        result: null,
      });

      this.store.addEvent({
        run_id: runId,
        step_id: stepId,
        type: "step_retried",
        detail: JSON.stringify({ attempt: stepRun.attempt + 1, error }),
        timestamp: now,
      });

      await this.scheduleReadySteps(runId, definition);
      return;
    }

    this.store.updateStepRun(stepRun.id, {
      status: "failed",
      result: error,
      completed_at: now,
    });

    this.store.addEvent({
      run_id: runId,
      step_id: stepId,
      type: "step_failed",
      detail: JSON.stringify({ error }),
      timestamp: now,
    });

    if (definition.on_failure === "abort") {
      const allStepRuns = this.store.getStepRunsForRun(runId);
      for (const sr of allStepRuns) {
        if (sr.status === "pending" || sr.status === "assigned") {
          this.store.updateStepRun(sr.id, {
            status: "skipped",
            completed_at: now,
            result: "aborted_due_to_failure",
          });
        }
      }
      this.store.updateRunStatus(runId, "failed", now);

      this.store.addEvent({
        run_id: runId,
        step_id: null,
        type: "workflow_aborted",
        detail: JSON.stringify({ reason: `Step '${stepId}' failed: ${error}` }),
        timestamp: now,
      });
    } else {
      this.store.addEvent({
        run_id: runId,
        step_id: stepId,
        type: "step_failure_notified",
        detail: JSON.stringify({ error }),
        timestamp: now,
      });

      await this.scheduleReadySteps(runId, definition);
    }
  }

  async cancelWorkflow(runId: string): Promise<void> {
    const run = this.store.getRun(runId);
    if (!run) throw new Error(`Workflow run '${runId}' not found`);

    const now = new Date().toISOString();
    const stepRuns = this.store.getStepRunsForRun(runId);

    for (const sr of stepRuns) {
      if (sr.status === "pending" || sr.status === "assigned") {
        this.store.updateStepRun(sr.id, {
          status: "skipped",
          completed_at: now,
          result: "cancelled",
        });
      }
    }

    this.store.updateRunStatus(runId, "cancelled", now);

    this.store.addEvent({
      run_id: runId,
      step_id: null,
      type: "workflow_cancelled",
      detail: null,
      timestamp: now,
    });
  }

  private async completeWorkflow(runId: string, definition?: WorkflowDefinition): Promise<void> {
    const now = new Date().toISOString();
    this.store.updateRunStatus(runId, "completed", now);

    this.activityStore?.emit({
      type: "workflow_completed",
      timestamp: now,
      account: "system",
      workflowRunId: runId,
      metadata: {},
    });

    this.store.addEvent({
      run_id: runId,
      step_id: null,
      type: "workflow_completed",
      detail: null,
      timestamp: now,
    });

    // Trigger retro if enabled
    if (definition?.retro && this.retroEngine) {
      const stepRuns = this.store.getStepRunsForRun(runId);
      const participants = [...new Set(stepRuns.map(s => s.assigned_to).filter(Boolean))] as string[];
      if (participants.length > 0) {
        this.store.updateRunStatus(runId, "retro_in_progress");
        this.retroEngine.startRetro(runId, participants);
      }
    }
  }
}
