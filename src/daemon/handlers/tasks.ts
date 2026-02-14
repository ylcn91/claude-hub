import type { Socket } from "net";
import type { HandlerContext, HandlerFn } from "../handler-types";
import { loadTasks, saveTasks, updateTaskStatus, rejectTask, acceptTask, submitForReview, type TaskStatus } from "../../services/tasks";
import { runAcceptanceSuite } from "../../services/acceptance-runner";
import { createReceipt } from "../../services/verification-receipts";

const VALID_TASK_STATUSES = new Set<string>(["todo", "in_progress", "ready_for_review", "accepted", "rejected"]);

export function registerTaskHandlers(ctx: HandlerContext): Record<string, HandlerFn> {
  const { state, features, safeWrite, reply, getAccountName } = ctx;

  return {
    update_task_status: async (socket: Socket, msg: any) => {
      const accountName = getAccountName(socket);
      try {
        if (typeof msg.taskId !== "string" || !msg.taskId) {
          safeWrite(socket, reply(msg, { type: "error", error: "Invalid field: taskId" }));
          return;
        }
        if (!VALID_TASK_STATUSES.has(msg.status)) {
          safeWrite(socket, reply(msg, { type: "error", error: "Invalid field: status" }));
          return;
        }
        let board = await loadTasks();
        const status = msg.status as TaskStatus;

        if (status === "rejected") {
          if (!msg.reason) {
            safeWrite(socket, reply(msg, { type: "error", error: "Reason is required when rejecting" }));
            return;
          }
          board = rejectTask(board, msg.taskId, msg.reason);
        } else if (status === "accepted") {
          board = acceptTask(board, msg.taskId);
        } else if (status === "ready_for_review" && (msg.workspacePath || msg.branch)) {
          board = submitForReview(board, msg.taskId, {
            workspacePath: msg.workspacePath ?? "",
            branch: msg.branch ?? "",
            workspaceId: msg.workspaceId,
          });
        } else {
          board = updateTaskStatus(board, msg.taskId, status);
        }

        await saveTasks(board);
        const task = board.tasks.find((t) => t.id === msg.taskId);

        // F-02: Emit status-specific EventBus events
        if (status === "in_progress") {
          state.eventBus.emit({ type: "TASK_STARTED", taskId: msg.taskId, agent: accountName });
        } else if (status === "ready_for_review") {
          state.eventBus.emit({ type: "CHECKPOINT_REACHED", taskId: msg.taskId, agent: accountName, percent: 100, step: "ready_for_review" });
        } else if (status === "accepted") {
          state.eventBus.emit({ type: "TASK_COMPLETED", taskId: msg.taskId, agent: task?.assignee ?? accountName, result: "success" });

          // F-03: Record trust outcome on accept
          if (state.trustStore && task?.assignee) {
            const createdEvent = task.events.find((e: any) => e.type === "status_changed" && e.to === "in_progress");
            const durationMinutes = createdEvent
              ? (Date.now() - new Date(createdEvent.timestamp).getTime()) / 60000
              : undefined;
            const oldRep = state.trustStore.get(task.assignee);
            const oldScore = oldRep?.trustScore ?? 50;
            state.trustStore.recordOutcome(task.assignee, "completed", durationMinutes);
            const newRep = state.trustStore.get(task.assignee);
            if (newRep && newRep.trustScore !== oldScore) {
              state.eventBus.emit({
                type: "TRUST_UPDATE",
                agent: task.assignee,
                delta: newRep.trustScore - oldScore,
                reason: "task_accepted",
              });
            }
          }

          // F-10: Create verification receipt on accept (human-review)
          if (task) {
            try {
              // Look for the handoff that matches this exact task by ID
              const assignee = task.assignee ?? accountName;
              const candidates = assignee !== accountName
                ? [...state.getHandoffs(assignee), ...state.getHandoffs(accountName)]
                : state.getHandoffs(accountName);
              const handoff = candidates.find((h: any) => h.id === msg.taskId);
              const specPayload = handoff ? handoff.content : msg.taskId;
              const receipt = createReceipt({
                taskId: msg.taskId,
                delegator: accountName,
                delegatee: task.assignee ?? accountName,
                specPayload,
                verdict: "accepted",
                method: "human-review",
              });
              state.eventBus.emit({
                type: "TASK_VERIFIED",
                taskId: msg.taskId,
                verifier: accountName,
                passed: true,
                receipt,
              });
              state.activityStore?.emit({
                type: "task_verified",
                timestamp: receipt.timestamp,
                account: accountName,
                taskId: msg.taskId,
                metadata: { receipt },
              });
            } catch (e: any) { console.error("[receipt]", e.message); }
          }
        } else if (status === "rejected") {
          state.eventBus.emit({ type: "TASK_COMPLETED", taskId: msg.taskId, agent: task?.assignee ?? accountName, result: "failure" });

          // F-03: Record trust outcome on reject
          if (state.trustStore && task?.assignee) {
            const oldRep = state.trustStore.get(task.assignee);
            const oldScore = oldRep?.trustScore ?? 50;
            state.trustStore.recordOutcome(task.assignee, "rejected");
            const newRep = state.trustStore.get(task.assignee);
            if (newRep && newRep.trustScore !== oldScore) {
              state.eventBus.emit({
                type: "TRUST_UPDATE",
                agent: task.assignee,
                delta: newRep.trustScore - oldScore,
                reason: "task_rejected",
              });
            }
          }

          // F-10: Create verification receipt on reject (human-review)
          if (task) {
            try {
              const receipt = createReceipt({
                taskId: msg.taskId,
                delegator: accountName,
                delegatee: task.assignee ?? accountName,
                specPayload: msg.taskId,
                verdict: "rejected",
                method: "human-review",
              });
              state.eventBus.emit({
                type: "TASK_VERIFIED",
                taskId: msg.taskId,
                verifier: accountName,
                passed: false,
                receipt,
              });
              state.activityStore?.emit({
                type: "task_verified",
                timestamp: receipt.timestamp,
                account: accountName,
                taskId: msg.taskId,
                metadata: { receipt },
              });
            } catch (e: any) { console.error("[receipt]", e.message); }
          }
        }

        // F2: GitHub integration hooks (non-blocking)
        if (features?.githubIntegration) {
          (async () => {
            try {
              const { onTaskStatusChanged } = await import("../../services/integration-hooks");
              await onTaskStatusChanged(msg.taskId, status, { reason: msg.reason });
            } catch (e: any) { console.error("[github]", e.message); }
          })();
        }

        // F3: Auto-generate review bundle on ready_for_review (non-blocking)
        if (status === "ready_for_review" && features?.reviewBundles && task?.workspaceContext) {
          (async () => {
            try {
              const { generateReviewBundle } = await import("../../services/review-bundle");
              const { saveBundle } = await import("../../services/review-bundle-store");
              const bundle = await generateReviewBundle({
                taskId: msg.taskId,
                workDir: task.workspaceContext!.workspacePath,
                branch: task.workspaceContext!.branch,
              });
              await saveBundle(bundle);
            } catch (e: any) { console.error("[review-bundle]", e.message); }
          })();
        }

        // Auto-acceptance: if transitioning to ready_for_review and feature enabled
        if (status === "ready_for_review" && features?.autoAcceptance && task) {
          // F-11: Cognitive friction check BEFORE running auto-acceptance
          if (features.cognitiveFriction) {
            try {
              const assignee = task.assignee ?? accountName;
              const candidates = assignee !== accountName
                ? [...state.getHandoffs(assignee), ...state.getHandoffs(accountName)]
                : state.getHandoffs(accountName);
              const handoffForFriction = candidates.find((h: any) => {
                if (h.id === msg.taskId) return true;
                const ctx2 = h.context ?? {};
                return ctx2.branch === msg.branch || ctx2.projectDir === msg.workspacePath;
              });
              if (handoffForFriction) {
                let frictionPayload: any;
                try { frictionPayload = JSON.parse(handoffForFriction.content); } catch { console.warn("[cognitive-friction] failed to parse handoff content as JSON"); }
                if (frictionPayload) {
                  const { checkCognitiveFriction } = await import("../../services/cognitive-friction");
                  const friction = checkCognitiveFriction(frictionPayload);
                  if (friction.requiresHumanReview) {
                    state.activityStore?.emit({
                      type: "cognitive_friction_triggered",
                      timestamp: new Date().toISOString(),
                      account: accountName,
                      metadata: {
                        taskId: msg.taskId,
                        frictionLevel: friction.frictionLevel,
                        reason: friction.reason,
                      },
                    });
                    safeWrite(socket, reply(msg, {
                      type: "result",
                      task,
                      acceptance: "blocked",
                      reason: friction.reason,
                      frictionLevel: friction.frictionLevel,
                    }));
                    return;
                  }
                }
              }
            } catch (e: any) {
              console.error("[cognitive-friction]", e.message);
            }
          }

          safeWrite(socket, reply(msg, { type: "result", task, acceptance: "running" }));
          (async () => {
            try {
              const handoffs = state.getHandoffs(accountName);
              const handoff = handoffs.find((h: any) => {
                const ctx2 = h.context ?? {};
                return ctx2.branch === msg.branch || ctx2.projectDir === msg.workspacePath;
              });
              if (!handoff) return;
              let payload: any;
              try {
                payload = JSON.parse(handoff.content);
              } catch {
                return; /* handoff content is not valid JSON, skip auto-acceptance */
              }
              const cmds: string[] = payload.run_commands ?? [];
              if (cmds.length === 0) return;
              const workDir = task.workspaceContext?.workspacePath ?? msg.workspacePath;
              if (!workDir) return;

              const result = await runAcceptanceSuite(cmds, workDir);
              let updatedBoard = await loadTasks();
              if (result.passed) {
                updatedBoard = acceptTask(updatedBoard, msg.taskId);
              } else {
                updatedBoard = rejectTask(updatedBoard, msg.taskId, result.summary);
              }
              await saveTasks(updatedBoard);

              // F-10: Create verification receipt after auto-acceptance
              try {
                const receipt = createReceipt({
                  taskId: msg.taskId,
                  delegator: handoff.from,
                  delegatee: task.assignee ?? accountName,
                  specPayload: handoff.content,
                  verdict: result.passed ? "accepted" : "rejected",
                  method: "auto-acceptance",
                });
                state.eventBus.emit({
                  type: "TASK_VERIFIED",
                  taskId: msg.taskId,
                  verifier: "auto-acceptance",
                  passed: result.passed,
                  receipt,
                });
                state.activityStore?.emit({
                  type: "task_verified",
                  timestamp: receipt.timestamp,
                  account: "auto-acceptance",
                  taskId: msg.taskId,
                  metadata: { receipt },
                });
              } catch (e: any) {
                console.error("[receipt]", e.message);
                state.eventBus.emit({
                  type: "TASK_VERIFIED",
                  taskId: msg.taskId,
                  verifier: "auto-acceptance",
                  passed: result.passed,
                });
              }

              // F-03: Record trust outcome after auto-acceptance
              if (state.trustStore && task.assignee) {
                const createdEvent = task.events.find((e: any) => e.type === "status_changed" && e.to === "in_progress");
                const durationMinutes = createdEvent
                  ? (Date.now() - new Date(createdEvent.timestamp).getTime()) / 60000
                  : undefined;
                const oldRep = state.trustStore.get(task.assignee);
                const oldScore = oldRep?.trustScore ?? 50;
                if (result.passed) {
                  state.trustStore.recordOutcome(task.assignee, "completed", durationMinutes);
                } else {
                  state.trustStore.recordOutcome(task.assignee, "failed");
                }
                const newRep = state.trustStore.get(task.assignee);
                if (newRep && newRep.trustScore !== oldScore) {
                  state.eventBus.emit({
                    type: "TRUST_UPDATE",
                    agent: task.assignee,
                    delta: newRep.trustScore - oldScore,
                    reason: result.passed ? "auto_acceptance_passed" : "auto_acceptance_failed",
                  });
                }
              }
            } catch (e: any) { console.error("[accept]", e.message); }
          })();
        } else {
          safeWrite(socket, reply(msg, { type: "result", task }));
        }
      } catch (err: any) {
        safeWrite(socket, reply(msg, { type: "error", error: err.message }));
      }
    },

    report_progress: (socket: Socket, msg: any) => {
      const accountName = getAccountName(socket);
      if (typeof msg.taskId !== "string" || !msg.taskId) {
        safeWrite(socket, reply(msg, { type: "error", error: "Invalid field: taskId" }));
        return;
      }
      if (typeof msg.percent !== "number" || msg.percent < 0 || msg.percent > 100) {
        safeWrite(socket, reply(msg, { type: "error", error: "Invalid field: percent" }));
        return;
      }
      const report = state.progressTracker.report({
        taskId: msg.taskId,
        agent: msg.agent ?? accountName,
        percent: msg.percent,
        currentStep: msg.currentStep ?? "",
        blockers: msg.blockers,
        estimatedRemainingMinutes: msg.estimatedRemainingMinutes,
        artifactsProduced: msg.artifactsProduced,
      });
      state.eventBus.emit({
        type: "PROGRESS_UPDATE",
        taskId: msg.taskId,
        agent: msg.agent ?? accountName,
        data: { percent: msg.percent, currentStep: msg.currentStep ?? "" },
      });
      if (msg.percent === 100) {
        state.eventBus.emit({
          type: "CHECKPOINT_REACHED",
          taskId: msg.taskId,
          agent: msg.agent ?? accountName,
          percent: 100,
          step: msg.currentStep ?? "complete",
        });
      }
      safeWrite(socket, reply(msg, { type: "result", report }));
    },

    adaptive_sla_check: async (socket: Socket, msg: any) => {
      if (!features?.slaEngine) {
        safeWrite(socket, reply(msg, { type: "error", error: "SLA engine not enabled" }));
        return;
      }
      try {
        const { AdaptiveCoordinator } = await import("../../services/adaptive-coordinator");
        const board = await loadTasks();
        const taskStates = board.tasks
          .filter((t) => t.status === "in_progress")
          .map((t) => {
            const startEvent = t.events?.find((e: any) => e.to === "in_progress");
            const latest = state.progressTracker.getLatest(t.id);
            return {
              taskId: t.id,
              status: t.status,
              assignee: t.assignee ?? "",
              criticality: t.priority as any,
              startedAt: startEvent?.timestamp,
              lastProgressReport: latest ? { percent: latest.percent, timestamp: latest.timestamp } : undefined,
              reassignmentCount: 0,
            };
          });
        const coordinator = new AdaptiveCoordinator(msg.config);
        const actions = coordinator.evaluate(taskStates);
        safeWrite(socket, reply(msg, { type: "result", actions }));
      } catch (err: any) {
        safeWrite(socket, reply(msg, { type: "error", error: err.message }));
      }
    },

    get_trust: (socket: Socket, msg: any) => {
      if (!features?.trust) {
        safeWrite(socket, reply(msg, { type: "error", error: "Trust feature not enabled" }));
        return;
      }
      if (!state.trustStore) {
        safeWrite(socket, reply(msg, { type: "error", error: "Trust store not initialized" }));
        return;
      }
      if (msg.account) {
        const trust = state.trustStore.get(msg.account);
        safeWrite(socket, reply(msg, { type: "result", trust }));
      } else {
        const all = state.trustStore.getAll();
        safeWrite(socket, reply(msg, { type: "result", trust: all }));
      }
    },

    reinstate_agent: (socket: Socket, msg: any) => {
      if (!state.circuitBreaker) {
        safeWrite(socket, reply(msg, { type: "error", error: "Circuit breaker not enabled" }));
        return;
      }
      if (typeof msg.account !== "string" || !msg.account) {
        safeWrite(socket, reply(msg, { type: "error", error: "Invalid field: account" }));
        return;
      }
      const reinstated = state.circuitBreaker.reinstateAgent(msg.account);
      safeWrite(socket, reply(msg, { type: "result", reinstated }));
    },

    check_circuit_breaker: (socket: Socket, msg: any) => {
      if (!state.circuitBreaker) {
        safeWrite(socket, reply(msg, { type: "error", error: "Circuit breaker not enabled" }));
        return;
      }
      if (msg.account) {
        const record = state.circuitBreaker.getQuarantineRecord(msg.account);
        const quarantined = state.circuitBreaker.isQuarantined(msg.account);
        safeWrite(socket, reply(msg, { type: "result", quarantined, record }));
      } else {
        const all = state.circuitBreaker.getAllQuarantined();
        safeWrite(socket, reply(msg, { type: "result", quarantined: all }));
      }
    },
  };
}
