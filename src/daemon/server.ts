import { createServer, createConnection, type Server, type Socket } from "net";
import { existsSync, unlinkSync, writeFileSync, readFileSync, mkdirSync, chmodSync } from "fs";
import { dirname } from "path";
import { timingSafeEqual } from "crypto";
import { DaemonState } from "./state";
import { createLineParser, frameSend } from "./framing";
import { notifyHandoff, notifyMessage, sendNotification } from "../services/notifications";
import { validateHandoff } from "../services/handoff";
import { checkDelegationDepth, type DelegationDepthConfig } from "../services/delegation-depth";
import { loadTasks, saveTasks, updateTaskStatus, rejectTask, acceptTask, submitForReview, type TaskStatus } from "../services/tasks";
import { runAcceptanceSuite } from "../services/acceptance-runner";
import { rankAccounts } from "../services/account-capabilities";
import { loadConfig } from "../config";
import { checkStaleTasks, formatEscalationMessage, DEFAULT_SLA_CONFIG } from "../services/sla-engine";
import { computeWorkloadSnapshots, computeWorkloadModifier } from "../services/workload-metrics";
import { getHealthStatus } from "./health";
import { startWatchdog } from "./watchdog";
import { getHubDir, getSockPath, getPidPath, getTokensDir } from "../paths";
import { scanWorkflowDir } from "../services/workflow-parser";
import { ACCOUNT_NAME_RE } from "../services/account-manager";
import { createReceipt } from "../services/verification-receipts";
import { join } from "path";

export async function verifyAccountToken(account: string, token: string): Promise<boolean> {
  if (!ACCOUNT_NAME_RE.test(account)) return false;
  const tokenPath = `${getTokensDir()}/${account}.token`;
  try {
    const stored = (await Bun.file(tokenPath).text()).trim();
    if (stored.length !== token.length) return false;
    return timingSafeEqual(Buffer.from(stored), Buffer.from(token));
  } catch {
    return false;
  }
}

function reply(msg: any, response: object): string {
  return frameSend({ ...response, ...(msg.requestId ? { requestId: msg.requestId } : {}) });
}

function safeWrite(socket: Socket, data: string): void {
  if (socket.destroyed || !socket.writable) return;
  const ok = socket.write(data);
  if (!ok) {
    socket.once("drain", () => {});
  }
}

const VALID_TASK_STATUSES = new Set<string>(["todo", "in_progress", "ready_for_review", "accepted", "rejected"]);
const MAX_PAYLOAD_BYTES = 1_048_576; // 1 MB
const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export interface DaemonOpts {
  dbPath?: string;
  workspaceDbPath?: string;
  capabilityDbPath?: string;
  knowledgeDbPath?: string;
  activityDbPath?: string;
  workflowDbPath?: string;
  retroDbPath?: string;
  sessionsDbPath?: string;
  trustDbPath?: string;
  sockPath?: string;
  features?: {
    workspaceWorktree?: boolean;
    autoAcceptance?: boolean;
    capabilityRouting?: boolean;
    slaEngine?: boolean;
    githubIntegration?: boolean;
    reviewBundles?: boolean;
    knowledgeIndex?: boolean;
    reliability?: boolean;
    workflow?: boolean;
    retro?: boolean;
    sessions?: boolean;
    trust?: boolean;
    council?: boolean;
    circuitBreaker?: boolean;
    cognitiveFriction?: boolean;
    entireMonitoring?: boolean;
    delegationDepth?: DelegationDepthConfig;
  };
  entireGitDir?: string;
  council?: { models: string[]; chairman: string; apiKey?: string };
}

export async function startDaemon(opts?: DaemonOpts): Promise<{ server: Server; state: DaemonState; sockPath: string; watchdog?: { stop: () => void }; sessionCleanupTimer?: ReturnType<typeof setInterval>; entireAdapter?: import("../services/entire-adapter").EntireAdapter }> {
  const state = new DaemonState(opts?.dbPath);
  const features = opts?.features;
  const councilConfig = opts?.council;

  if (features?.workspaceWorktree) {
    state.initWorkspace(opts?.workspaceDbPath);
  }
  if (features?.capabilityRouting) {
    state.initCapabilities(opts?.capabilityDbPath);
  }
  if (features?.slaEngine) {
    state.slaTimerId = setInterval(async () => {
      try {
        const board = await loadTasks();
        const escalations = checkStaleTasks(board.tasks, DEFAULT_SLA_CONFIG);
        for (const esc of escalations) {
          sendNotification("agentctl SLA", formatEscalationMessage(esc)).catch(e => console.error("[sla]", e.message));
        }
      } catch(e: any) { console.error("[sla]", e.message) }
    }, DEFAULT_SLA_CONFIG.checkIntervalMs);
  }
  if (features?.knowledgeIndex) {
    state.initKnowledge(opts?.knowledgeDbPath);
  }
  if (features?.githubIntegration) {
    state.initExternalLinks();
  }
  if (features?.workflow || features?.retro) {
    state.initActivity(opts?.activityDbPath);
  }
  if (features?.workflow) {
    state.initWorkflow(opts?.workflowDbPath);
    mkdirSync(join(getHubDir(), "workflows"), { recursive: true });
  }
  if (features?.retro) {
    state.initRetro(opts?.retroDbPath);
  }
  if (features?.sessions) {
    state.initSessions(opts?.sessionsDbPath);
  }
  if (features?.trust) {
    state.initTrust(opts?.trustDbPath);
  }
  if (features?.circuitBreaker) {
    state.initCircuitBreaker();
  }

  // Entire.io session monitoring adapter
  let entireAdapter: import("../services/entire-adapter").EntireAdapter | undefined;
  if (features?.entireMonitoring && opts?.entireGitDir) {
    try {
      const { EntireAdapter } = await import("../services/entire-adapter");
      entireAdapter = new EntireAdapter(state.eventBus, opts.entireGitDir);
      entireAdapter.startWatching();
    } catch (e: any) {
      console.error("[entire-adapter]", e.message);
    }
  }

  // Bridge EventBus → ActivityStore: forward relevant delegation events for persistence
  if (state.activityStore) {
    const activityStore = state.activityStore;
    state.eventBus.on("*", (event) => {
      const typeMap: Record<string, string> = {
        TASK_CREATED: "task_created",
        TASK_ASSIGNED: "task_assigned",
        TASK_STARTED: "task_started",
        TASK_COMPLETED: "task_completed",
        TASK_VERIFIED: "task_verified",
        CHECKPOINT_REACHED: "checkpoint_reached",
        PROGRESS_UPDATE: "progress_update",
        SLA_WARNING: "sla_warning",
        SLA_BREACH: "sla_breach",
        REASSIGNMENT: "reassignment",
        TRUST_UPDATE: "trust_update",
        DELEGATION_CHAIN: "delegation_chain",
      };
      const activityType = typeMap[event.type];
      if (!activityType) return;
      const agent = ("agent" in event ? event.agent : undefined)
        ?? ("delegator" in event ? event.delegator : undefined)
        ?? "system";
      const taskId = "taskId" in event ? (event as any).taskId : undefined;
      activityStore.emit({
        type: activityType as any,
        timestamp: event.timestamp,
        account: agent,
        taskId,
        metadata: { ...event },
      });
    });
  }

  let watchdog: { stop: () => void } | undefined;
  if (features?.reliability) {
    watchdog = startWatchdog(state, state.startedAt);
  }

  mkdirSync(getHubDir(), { recursive: true });

  const sockPath = opts?.sockPath ?? getSockPath();
  const sockDir = dirname(sockPath);
  if (sockDir !== getHubDir()) {
    mkdirSync(sockDir, { recursive: true });
  }

  // Cleanup orphaned socket — only if no live daemon is using it
  if (existsSync(sockPath)) {
    try {
      const probe = createConnection(sockPath);
      // If connection succeeds, a live daemon owns this socket
      await new Promise<void>((resolve, reject) => {
        probe.once("connect", () => {
          probe.destroy();
          reject(new Error("Daemon already running"));
        });
        probe.once("error", () => {
          // Connection refused = stale socket, safe to unlink
          resolve();
        });
      });
    } catch (err: any) {
      if (err.message === "Daemon already running") throw err;
      // Any other error means socket is stale
    }
    unlinkSync(sockPath);
  }

  const server = createServer((socket) => {
    let authenticated = false;
    let accountName = "";
    let authAttempts = 0;
    let pendingBytes = 0;

    // Connection expiry: 30-minute idle timeout
    let idleTimer = setTimeout(() => socket.end(), IDLE_TIMEOUT_MS);
    const resetIdleTimer = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => socket.end(), IDLE_TIMEOUT_MS);
    };

    const parser = createLineParser((msg) => {
      pendingBytes = 0;
      resetIdleTimer();

      // Allow unauthenticated ping for health checks (reveals no data)
      if (msg.type === "ping") {
        safeWrite(socket, reply(msg, { type: "pong" }));
        return;
      }

      // Allow unauthenticated config_reload (socket is already permission-protected)
      if (msg.type === "config_reload") {
        (async () => {
          try {
            const config = await loadConfig();
            safeWrite(socket, reply(msg, { type: "result", reloaded: true, accounts: config.accounts.length }));
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            safeWrite(socket, reply(msg, { type: "error", error: message }));
          }
        })();
        return;
      }

      // All other messages require auth
      if (!authenticated) {
        if (msg.type === "auth" && msg.account && msg.token) {
          authAttempts++;
          if (authAttempts > 5) {
            socket.end();
            return;
          }
          (async () => {
            try {
              if (await verifyAccountToken(msg.account, msg.token)) {
                authenticated = true;
                accountName = msg.account;
                state.connectAccount(accountName, msg.token);
                safeWrite(socket, reply(msg, { type: "auth_ok" }));
              } else {
                safeWrite(socket, reply(msg, { type: "auth_fail", error: "Invalid token" }));
                socket.end();
              }
            } catch (err: any) {
              safeWrite(socket, reply(msg, { type: "auth_fail", error: err.message ?? "Auth error" }));
              socket.end();
            }
          })();
        }
        return;
      }

      // Handler map — O(1) dispatch, guarantees only one handler runs per message
      const handlers: Record<string, (msg: any) => void> = {
        send_message: (msg) => {
          if (typeof msg.to !== "string" || !msg.to) {
            safeWrite(socket, reply(msg, { type: "error", error: "Invalid field: to" }));
            return;
          }
          if (typeof msg.content !== "string" || !msg.content) {
            safeWrite(socket, reply(msg, { type: "error", error: "Invalid field: content" }));
            return;
          }
          state.addMessage({
            from: accountName,
            to: msg.to,
            type: "message",
            content: msg.content,
            timestamp: new Date().toISOString(),
          });
          notifyMessage(accountName, msg.to, msg.content).catch(e => console.error("[notify]", e.message));
          safeWrite(socket, reply(msg, { type: "result", delivered: state.isConnected(msg.to), queued: true }));
        },

        count_unread: (msg) => {
          const count = state.countUnread(accountName);
          safeWrite(socket, reply(msg, { type: "result", count }));
        },

        read_messages: (msg) => {
          if (msg.limit !== undefined && (!Number.isInteger(msg.limit) || msg.limit < 0)) {
            safeWrite(socket, reply(msg, { type: "error", error: "Invalid field: limit" }));
            return;
          }
          if (msg.offset !== undefined && (!Number.isInteger(msg.offset) || msg.offset < 0)) {
            safeWrite(socket, reply(msg, { type: "error", error: "Invalid field: offset" }));
            return;
          }
          const hasPagination = msg.limit !== undefined || msg.offset !== undefined;
          const messages = hasPagination
            ? state.getMessages(accountName, { limit: msg.limit as number | undefined, offset: msg.offset as number | undefined })
            : state.getUnreadMessages(accountName);
          if (!hasPagination) {
            state.markAllRead(accountName);
          }
          safeWrite(socket, reply(msg, { type: "result", messages }));
        },

        list_accounts: async (msg) => {
          try {
            const connected = new Set(state.getConnectedAccounts());
            const config = await loadConfig();
            const accounts = config.accounts.map((a) => ({
              name: a.name,
              status: connected.has(a.name) ? "active" as const : "inactive" as const,
            }));
            for (const name of connected) {
              if (!accounts.some((a) => a.name === name)) {
                accounts.push({ name, status: "active" as const });
              }
            }
            safeWrite(socket, reply(msg, { type: "result", accounts }));
          } catch (err: any) {
            safeWrite(socket, reply(msg, { type: "error", error: err.message }));
          }
        },

        handoff_task: async (msg) => {
          if (typeof msg.to !== "string" || !msg.to) {
            safeWrite(socket, reply(msg, { type: "error", error: "Invalid field: to" }));
            return;
          }
          const validation = validateHandoff(msg.payload);
          if (!validation.valid) {
            safeWrite(socket, reply(msg, {
              type: "error",
              error: "Invalid handoff payload",
              details: validation.errors,
            }));
            return;
          }

          // F-13: Delegation depth check — use feature config or defaults.maxDelegationDepth
          let depthConfig = features?.delegationDepth;
          if (!depthConfig) {
            try {
              const cfg = await loadConfig();
              if (cfg.defaults?.maxDelegationDepth != null) {
                depthConfig = { maxDepth: cfg.defaults.maxDelegationDepth };
              }
            } catch { /* config load is best-effort */ }
          }
          const depthCheck = checkDelegationDepth(validation.payload, depthConfig);

          // Emit DELEGATION_CHAIN event for audit trail
          const chain = [accountName, msg.to];
          if (validation.payload.parent_handoff_id) {
            chain.unshift(validation.payload.parent_handoff_id);
          }
          state.eventBus.emit({
            type: "DELEGATION_CHAIN",
            taskId: validation.payload.parent_handoff_id ?? `pending-${Date.now()}`,
            chain,
          });

          if (!depthCheck.allowed) {
            state.activityStore?.emit({
              type: "delegation_chain",
              timestamp: new Date().toISOString(),
              account: accountName,
              metadata: {
                delegatee: msg.to,
                currentDepth: depthCheck.currentDepth,
                maxDepth: depthCheck.maxDepth,
                reason: depthCheck.reason,
                blocked: true,
              },
            });
            safeWrite(socket, reply(msg, {
              type: "error",
              error: depthCheck.reason ?? "Delegation depth limit exceeded",
              depthCheck,
            }));
            return;
          }

          // Auto-collect context if projectDir is available
          let autoContext: any = undefined;
          const ctx = msg.context ?? {};
          if (ctx.projectDir) {
            try {
              const { collectContext } = await import("../services/context-collector");
              autoContext = await collectContext(ctx.projectDir);
            } catch (e: any) {
              console.error("[context-collector]", e.message);
            }
          }

          const handoffContent = autoContext
            ? { ...validation.payload, autoContext }
            : validation.payload;

          const handoffMsg = {
            from: accountName,
            to: msg.to,
            type: "handoff" as const,
            content: JSON.stringify(handoffContent),
            timestamp: new Date().toISOString(),
            context: ctx,
          };
          const handoffId = state.addMessage(handoffMsg);
          notifyHandoff(accountName, msg.to, validation.payload.goal).catch(e => console.error("[notify]", e.message));

          // Create a corresponding task on the task board
          try {
            let board = await loadTasks();
            const task = {
              id: handoffId,
              title: validation.payload.goal,
              status: "todo" as TaskStatus,
              assignee: msg.to,
              createdAt: new Date().toISOString(),
              events: [] as any[],
            };
            board = { tasks: [...board.tasks, task] };
            await saveTasks(board);
          } catch (e: any) { console.error("[handoff-task-create]", e.message); }

          // F-02: Emit TASK_CREATED event
          state.eventBus.emit({
            type: "TASK_CREATED",
            taskId: handoffId,
            delegator: accountName,
            characteristics: {
              complexity: validation.payload.complexity,
              criticality: validation.payload.criticality,
              uncertainty: validation.payload.uncertainty,
              verifiability: validation.payload.verifiability,
              reversibility: validation.payload.reversibility,
            },
          });

          safeWrite(socket, reply(msg, {
            type: "result",
            delivered: state.isConnected(msg.to),
            queued: true,
            handoffId,
            taskId: handoffId,
          }));
        },

        reauthorize_delegation: (msg) => {
          if (typeof msg.handoffId !== "string" || !msg.handoffId) {
            safeWrite(socket, reply(msg, { type: "error", error: "Invalid field: handoffId" }));
            return;
          }
          if (typeof msg.newMaxDepth !== "number" || msg.newMaxDepth < 1) {
            safeWrite(socket, reply(msg, { type: "error", error: "Invalid field: newMaxDepth (must be a positive number)" }));
            return;
          }
          // Store reauthorization as activity event for audit trail
          state.activityStore?.emit({
            type: "delegation_reauthorized",
            timestamp: new Date().toISOString(),
            account: accountName,
            metadata: {
              handoffId: msg.handoffId,
              newMaxDepth: msg.newMaxDepth,
              authorizedBy: accountName,
            },
          });
          safeWrite(socket, reply(msg, {
            type: "result",
            reauthorized: true,
            handoffId: msg.handoffId,
            newMaxDepth: msg.newMaxDepth,
          }));
        },

        update_task_status: async (msg) => {
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
                  const handoffs = state.getHandoffs(accountName);
                  const handoff = handoffs.find((h: any) => {
                    try { return typeof JSON.parse(h.content) === "object"; } catch { return false; }
                  });
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
                  const { onTaskStatusChanged } = await import("../services/integration-hooks");
                  await onTaskStatusChanged(msg.taskId, status, { reason: msg.reason });
                } catch (e: any) { console.error("[github]", e.message); }
              })();
            }

            // F3: Auto-generate review bundle on ready_for_review (non-blocking)
            if (status === "ready_for_review" && features?.reviewBundles && task?.workspaceContext) {
              (async () => {
                try {
                  const { generateReviewBundle } = await import("../services/review-bundle");
                  const { saveBundle } = await import("../services/review-bundle-store");
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
              // F-11: Cognitive friction — check BEFORE running auto-acceptance
              if (features.cognitiveFriction) {
                try {
                  // Look for the handoff to the assignee first, then to current account
                  const assignee = task.assignee ?? accountName;
                  const candidates = assignee !== accountName
                    ? [...state.getHandoffs(assignee), ...state.getHandoffs(accountName)]
                    : state.getHandoffs(accountName);
                  const handoffForFriction = candidates.find((h: any) => {
                    if (h.id === msg.taskId) return true;
                    const ctx = h.context ?? {};
                    return ctx.branch === msg.branch || ctx.projectDir === msg.workspacePath;
                  });
                  if (handoffForFriction) {
                    let frictionPayload: any;
                    try { frictionPayload = JSON.parse(handoffForFriction.content); } catch {}
                    if (frictionPayload) {
                      const { checkCognitiveFriction } = await import("../services/cognitive-friction");
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
                    const ctx = h.context ?? {};
                    return ctx.branch === msg.branch || ctx.projectDir === msg.workspacePath;
                  });
                  if (!handoff) return;
                  let payload: any;
                  try {
                    payload = JSON.parse(handoff.content);
                  } catch {
                    return;
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
                    // Still emit event even if receipt creation fails
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

        archive_messages: (msg) => {
          const days = msg.days ?? 7;
          if (!Number.isInteger(days) || days < 1) {
            safeWrite(socket, reply(msg, { type: "error", error: "Invalid field: days" }));
            return;
          }
          const archived = state.archiveOld(days);
          safeWrite(socket, reply(msg, { type: "result", archived }));
        },

        prepare_worktree_for_handoff: async (msg) => {
          if (!state.workspaceManager) {
            safeWrite(socket, reply(msg, { type: "error", error: "Workspace feature not enabled" }));
            return;
          }
          try {
            const result = await state.workspaceManager.prepareWorktree({
              repoPath: msg.repoPath,
              branch: msg.branch,
              ownerAccount: accountName,
              handoffId: msg.handoffId,
            });
            safeWrite(socket, reply(msg, { type: "result", ...result }));
          } catch (err: any) {
            safeWrite(socket, reply(msg, { type: "error", error: err.message }));
          }
        },

        get_workspace_status: async (msg) => {
          if (!state.workspaceManager) {
            safeWrite(socket, reply(msg, { type: "error", error: "Workspace feature not enabled" }));
            return;
          }
          try {
            const ws = msg.id
              ? await state.workspaceManager.getWorkspace(msg.id)
              : await state.workspaceManager.getWorkspaceByKey(msg.repoPath, msg.branch);
            safeWrite(socket, reply(msg, { type: "result", workspace: ws }));
          } catch (err: any) {
            safeWrite(socket, reply(msg, { type: "error", error: err.message }));
          }
        },

        cleanup_workspace: async (msg) => {
          if (!state.workspaceManager) {
            safeWrite(socket, reply(msg, { type: "error", error: "Workspace feature not enabled" }));
            return;
          }
          try {
            const result = await state.workspaceManager.cleanupWorkspace(msg.id);
            safeWrite(socket, reply(msg, { type: "result", ...result }));
          } catch (err: any) {
            safeWrite(socket, reply(msg, { type: "error", error: err.message }));
          }
        },

        handoff_accept: async (msg) => {
          try {
            const handoffs = state.getHandoffs(accountName);
            const handoff = handoffs.find((h: any) => h.id === msg.handoffId);
            if (!handoff) {
              safeWrite(socket, reply(msg, { type: "error", error: "Handoff not found" }));
              return;
            }
            let payload: any;
            try {
              payload = JSON.parse(handoff.content);
            } catch {
              safeWrite(socket, reply(msg, { type: "error", error: "Corrupted handoff data" }));
              return;
            }
            const context = handoff.context ?? {};
            let workspace = null;

            if (state.workspaceManager && context.projectDir && context.branch) {
              try {
                const wsResult = await state.workspaceManager.prepareWorktree({
                  repoPath: context.projectDir,
                  branch: context.branch,
                  ownerAccount: accountName,
                  handoffId: msg.handoffId,
                });
                if (wsResult.ok) workspace = wsResult.data;
              } catch (e: any) { console.error("[workspace]", e.message); }
            }

            // Extract autoContext from payload if present
            const { autoContext, ...payloadWithoutAuto } = payload;

            // F-02: Emit TASK_ASSIGNED event
            state.eventBus.emit({
              type: "TASK_ASSIGNED",
              taskId: msg.handoffId,
              delegator: handoff.from,
              delegatee: accountName,
              reason: "handoff_accepted",
            });

            safeWrite(socket, reply(msg, {
              type: "result",
              handoff: { id: handoff.id, payload: payloadWithoutAuto, context, autoContext },
              workspace,
            }));
          } catch (err: any) {
            safeWrite(socket, reply(msg, { type: "error", error: err.message }));
          }
        },

        suggest_assignee: async (msg) => {
          if (!state.capabilityStore) {
            safeWrite(socket, reply(msg, { type: "error", error: "Capability routing not enabled" }));
            return;
          }
          try {
            const capabilities = state.capabilityStore.getAll();
            const skills: string[] = msg.skills ?? [];

            // Enrich capabilities with trust scores from TrustStore
            if (state.trustStore) {
              for (const cap of capabilities) {
                const rep = state.trustStore.get(cap.accountName);
                if (rep) {
                  cap.trustScore = rep.trustScore;
                }
              }
            }

            let workload: Map<string, number> | undefined;
            try {
              const board = await loadTasks();
              const snapshots = computeWorkloadSnapshots(board);
              workload = new Map<string, number>();
              for (const [name, snap] of snapshots) {
                workload.set(name, computeWorkloadModifier(snap));
              }
            } catch { /* workload enrichment is best-effort */ }

            const scores = rankAccounts(capabilities, skills, {
              excludeAccounts: msg.excludeAccounts,
              priority: msg.priority,
              workload,
            });
            safeWrite(socket, reply(msg, { type: "result", scores }));
          } catch (err: any) {
            safeWrite(socket, reply(msg, { type: "error", error: err.message }));
          }
        },

        ping: (msg) => {
          safeWrite(socket, reply(msg, { type: "pong" }));
        },

        health_check: (msg) => {
          const status = getHealthStatus(state, state.startedAt);
          safeWrite(socket, reply(msg, { type: "result", ...status }));
        },

        search_knowledge: (msg) => {
          if (!state.knowledgeStore) {
            safeWrite(socket, reply(msg, { type: "error", error: "Knowledge index not enabled" }));
            return;
          }
          const results = state.knowledgeStore.search(msg.query, msg.category, msg.limit);
          safeWrite(socket, reply(msg, { type: "result", results }));
        },

        index_note: (msg) => {
          if (!state.knowledgeStore) {
            safeWrite(socket, reply(msg, { type: "error", error: "Knowledge index not enabled" }));
            return;
          }
          const entry = state.knowledgeStore.index({
            category: msg.category ?? "decision_note",
            title: msg.title,
            content: msg.content,
            tags: msg.tags ?? [],
            accountName: accountName,
          });
          safeWrite(socket, reply(msg, { type: "result", entry }));
        },

        link_task: (msg) => {
          if (!state.externalLinkStore) {
            safeWrite(socket, reply(msg, { type: "error", error: "GitHub integration not enabled" }));
            return;
          }
          if (typeof msg.taskId !== "string" || !msg.taskId) {
            safeWrite(socket, reply(msg, { type: "error", error: "Invalid field: taskId" }));
            return;
          }
          try {
            const link = state.externalLinkStore.addLink({
              provider: msg.provider ?? "github",
              type: msg.linkType ?? "issue",
              url: msg.url,
              externalId: msg.externalId,
              taskId: msg.taskId,
            });
            safeWrite(socket, reply(msg, { type: "result", link }));
          } catch (err: any) {
            safeWrite(socket, reply(msg, { type: "error", error: err.message }));
          }
        },

        get_task_links: (msg) => {
          if (!state.externalLinkStore) {
            safeWrite(socket, reply(msg, { type: "error", error: "GitHub integration not enabled" }));
            return;
          }
          if (typeof msg.taskId !== "string" || !msg.taskId) {
            safeWrite(socket, reply(msg, { type: "error", error: "Invalid field: taskId" }));
            return;
          }
          try {
            const links = state.externalLinkStore.getLinksForTask(msg.taskId);
            safeWrite(socket, reply(msg, { type: "result", links }));
          } catch (err: any) {
            safeWrite(socket, reply(msg, { type: "error", error: err.message }));
          }
        },

        get_review_bundle: async (msg) => {
          if (typeof msg.taskId !== "string" || !msg.taskId) {
            safeWrite(socket, reply(msg, { type: "error", error: "Invalid field: taskId" }));
            return;
          }
          try {
            const { getBundle } = await import("../services/review-bundle-store");
            const bundle = await getBundle(msg.taskId);
            safeWrite(socket, reply(msg, { type: "result", bundle }));
          } catch (err: any) {
            safeWrite(socket, reply(msg, { type: "error", error: err.message }));
          }
        },

        generate_review_bundle: async (msg) => {
          if (typeof msg.taskId !== "string" || !msg.taskId) {
            safeWrite(socket, reply(msg, { type: "error", error: "Invalid field: taskId" }));
            return;
          }
          try {
            const { generateReviewBundle } = await import("../services/review-bundle");
            const { saveBundle } = await import("../services/review-bundle-store");
            const bundle = await generateReviewBundle({
              taskId: msg.taskId,
              workDir: msg.workDir,
              baseBranch: msg.baseBranch,
              branch: msg.branch,
              runCommands: msg.runCommands,
            });
            await saveBundle(bundle);
            safeWrite(socket, reply(msg, { type: "result", bundle }));
          } catch (err: any) {
            safeWrite(socket, reply(msg, { type: "error", error: err.message }));
          }
        },

        get_analytics: async (msg) => {
          try {
            const { computeAnalytics } = await import("../services/analytics");
            const board = await loadTasks();
            const snapshot = computeAnalytics(board, {
              fromDate: msg.fromDate,
              toDate: msg.toDate,
            });
            safeWrite(socket, reply(msg, { type: "result", ...snapshot }));
          } catch (err: any) {
            safeWrite(socket, reply(msg, { type: "error", error: err.message }));
          }
        },

        workflow_trigger: async (msg) => {
          if (!state.workflowEngine) {
            safeWrite(socket, reply(msg, { type: "error", error: "Workflow feature not enabled" }));
            return;
          }
          try {
            const definitions = await scanWorkflowDir(join(getHubDir(), "workflows"));
            const def = definitions.find(d => d.name === msg.workflowName);
            if (!def) {
              safeWrite(socket, reply(msg, { type: "error", error: `Workflow '${msg.workflowName}' not found` }));
              return;
            }
            const runId = await state.workflowEngine.triggerWorkflow(def, msg.context ?? "");
            safeWrite(socket, reply(msg, { type: "result", runId, status: "running" }));
          } catch (err: any) {
            safeWrite(socket, reply(msg, { type: "error", error: err.message }));
          }
        },

        workflow_status: (msg) => {
          if (!state.workflowStore) {
            safeWrite(socket, reply(msg, { type: "error", error: "Workflow feature not enabled" }));
            return;
          }
          const run = state.workflowStore.getRun(msg.runId);
          if (!run) {
            safeWrite(socket, reply(msg, { type: "error", error: "Run not found" }));
            return;
          }
          const steps = state.workflowStore.getStepRunsForRun(msg.runId);
          safeWrite(socket, reply(msg, { type: "result", run, steps }));
        },

        workflow_list: async (msg) => {
          if (!state.workflowEngine) {
            safeWrite(socket, reply(msg, { type: "error", error: "Workflow feature not enabled" }));
            return;
          }
          try {
            const definitions = await scanWorkflowDir(join(getHubDir(), "workflows"));
            safeWrite(socket, reply(msg, { type: "result", definitions }));
          } catch (err: any) {
            safeWrite(socket, reply(msg, { type: "error", error: err.message }));
          }
        },

        workflow_cancel: async (msg) => {
          if (!state.workflowEngine) {
            safeWrite(socket, reply(msg, { type: "error", error: "Workflow feature not enabled" }));
            return;
          }
          try {
            await state.workflowEngine.cancelWorkflow(msg.runId);
            safeWrite(socket, reply(msg, { type: "result", cancelled: true }));
          } catch (err: any) {
            safeWrite(socket, reply(msg, { type: "error", error: err.message }));
          }
        },

        retro_start_session: (msg) => {
          if (!state.retroEngine) {
            safeWrite(socket, reply(msg, { type: "error", error: "Retro feature not enabled" }));
            return;
          }
          try {
            const session = state.retroEngine.startRetro(msg.workflowRunId, msg.participants, msg.chairman);
            safeWrite(socket, reply(msg, { type: "result", session }));
          } catch (err: any) {
            safeWrite(socket, reply(msg, { type: "error", error: err.message }));
          }
        },

        retro_submit_review: (msg) => {
          if (!state.retroEngine) {
            safeWrite(socket, reply(msg, { type: "error", error: "Retro feature not enabled" }));
            return;
          }
          try {
            const review = {
              author: accountName,
              whatWentWell: msg.whatWentWell ?? [],
              whatDidntWork: msg.whatDidntWork ?? [],
              suggestions: msg.suggestions ?? [],
              agentPerformanceNotes: msg.agentPerformanceNotes ?? {},
              submittedAt: new Date().toISOString(),
            };
            const status = state.retroEngine.submitReview(msg.retroId, review);
            if (status.allCollected) {
              const aggregation = state.retroEngine.aggregate(msg.retroId);
              safeWrite(socket, reply(msg, { type: "result", ...status, aggregation }));
            } else {
              safeWrite(socket, reply(msg, { type: "result", ...status }));
            }
          } catch (err: any) {
            safeWrite(socket, reply(msg, { type: "error", error: err.message }));
          }
        },

        retro_submit_synthesis: async (msg) => {
          if (!state.retroEngine) {
            safeWrite(socket, reply(msg, { type: "error", error: "Retro feature not enabled" }));
            return;
          }
          try {
            await state.retroEngine.completeSynthesis(msg.retroId, msg.document);
            safeWrite(socket, reply(msg, { type: "result", completed: true }));
          } catch (err: any) {
            safeWrite(socket, reply(msg, { type: "error", error: err.message }));
          }
        },

        retro_status: (msg) => {
          if (!state.retroEngine) {
            safeWrite(socket, reply(msg, { type: "error", error: "Retro feature not enabled" }));
            return;
          }
          const session = state.retroEngine.getSession(msg.retroId);
          if (!session) {
            safeWrite(socket, reply(msg, { type: "error", error: "Retro session not found" }));
            return;
          }
          const document = state.retroEngine.getDocument(msg.retroId);
          safeWrite(socket, reply(msg, { type: "result", session, document }));
        },

        retro_get_past_learnings: async (msg) => {
          if (!state.retroEngine) {
            safeWrite(socket, reply(msg, { type: "error", error: "Retro feature not enabled" }));
            return;
          }
          const learnings = await state.retroEngine.getPastLearnings();
          safeWrite(socket, reply(msg, { type: "result", learnings }));
        },

        config_reload: async (msg) => {
          try {
            const config = await loadConfig();
            safeWrite(socket, reply(msg, { type: "result", reloaded: true, accounts: config.accounts.length }));
          } catch (err: any) {
            safeWrite(socket, reply(msg, { type: "error", error: err.message }));
          }
        },

        search_code: async (msg) => {
          try {
            const { searchDirectories } = await import("../services/code-search");
            // Build workspace directory map from active workspaces
            let workspaceDirs: Map<string, string[]> | undefined;
            if (state.workspaceStore) {
              workspaceDirs = new Map();
              const readyWorkspaces = state.workspaceStore.getByStatus("ready");
              for (const ws of readyWorkspaces) {
                const existing = workspaceDirs.get(ws.ownerAccount) ?? [];
                existing.push(ws.worktreePath);
                workspaceDirs.set(ws.ownerAccount, existing);
              }
            }
            const result = await searchDirectories(msg.pattern, msg.targets, msg.maxResults, workspaceDirs);
            safeWrite(socket, reply(msg, { type: "result", ...result }));
          } catch (err: any) {
            safeWrite(socket, reply(msg, { type: "error", error: err.message }));
          }
        },

        replay_session: async (msg) => {
          try {
            if (typeof msg.sessionId !== "string" || !msg.sessionId) {
              safeWrite(socket, reply(msg, { type: "error", error: "Invalid field: sessionId" }));
              return;
            }
            if (typeof msg.repoPath !== "string" || !msg.repoPath) {
              safeWrite(socket, reply(msg, { type: "error", error: "Invalid field: repoPath" }));
              return;
            }
            // Validate repoPath: must be absolute, no traversal, reasonable length
            if (!msg.repoPath.startsWith("/") || msg.repoPath.includes("..") || msg.repoPath.length > 4096) {
              safeWrite(socket, reply(msg, { type: "error", error: "Invalid repoPath format" }));
              return;
            }
            const { readCheckpoint } = await import("../services/entire-integration");
            const { buildTimeline } = await import("../services/replay");
            // Read checkpoint once and pass transcript to buildTimeline to avoid double read
            const { metadata, transcript } = await readCheckpoint(msg.repoPath, msg.sessionId);
            const timeline = await buildTimeline(msg.repoPath, msg.sessionId, transcript);
            safeWrite(socket, reply(msg, { type: "result", metadata, timeline }));
          } catch (err: any) {
            safeWrite(socket, reply(msg, { type: "error", error: err.message }));
          }
        },

        health_status: async (msg) => {
          try {
            const config = await loadConfig();
            const accountNames = config.accounts.map((a) => a.name);
            const statuses = state.healthMonitor.getStatuses(accountNames);
            const accountStatuses = statuses.map((s) => ({
              name: s.account,
              status: s.status,
              connected: s.connected,
              lastActivity: s.lastActivity,
              errorCount: s.errorCount,
              rateLimited: s.rateLimited,
            }));
            safeWrite(socket, reply(msg, { type: "result", accounts: accountStatuses }));
          } catch (err: any) {
            safeWrite(socket, reply(msg, { type: "error", error: err.message }));
          }
        },

        share_session: (msg) => {
          if (typeof msg.target !== "string" || !msg.target) {
            safeWrite(socket, reply(msg, { type: "error", error: "Invalid field: target" }));
            return;
          }
          // M4: Prevent self-pairing
          if (msg.target === accountName) {
            safeWrite(socket, reply(msg, { type: "error", error: "Cannot create session with yourself" }));
            return;
          }
          // m5: Validate target account is connected
          if (!state.isConnected(msg.target)) {
            safeWrite(socket, reply(msg, { type: "error", error: "Target account is not connected" }));
            return;
          }
          const session = state.sharedSessionManager.createSession(accountName, msg.target, msg.workspace ?? "");
          safeWrite(socket, reply(msg, { type: "result", session }));
        },

        join_session: (msg) => {
          if (typeof msg.sessionId !== "string" || !msg.sessionId) {
            safeWrite(socket, reply(msg, { type: "error", error: "Invalid field: sessionId" }));
            return;
          }
          const success = state.sharedSessionManager.joinSession(msg.sessionId, accountName);
          safeWrite(socket, reply(msg, { type: "result", success }));
        },

        session_broadcast: (msg) => {
          if (typeof msg.sessionId !== "string" || !msg.sessionId) {
            safeWrite(socket, reply(msg, { type: "error", error: "Invalid field: sessionId" }));
            return;
          }
          // C1: Verify membership before broadcast
          if (!state.sharedSessionManager.isMember(msg.sessionId, accountName)) {
            safeWrite(socket, reply(msg, { type: "error", error: "Not a member of this session" }));
            return;
          }
          // M6: Use return value from addUpdate to report accurate sent status
          const sent = state.sharedSessionManager.addUpdate(msg.sessionId, accountName, msg.data);
          safeWrite(socket, reply(msg, { type: "result", sent }));
        },

        session_status: (msg) => {
          if (msg.sessionId) {
            // C1: Verify membership before returning session status
            if (!state.sharedSessionManager.isMember(msg.sessionId, accountName)) {
              safeWrite(socket, reply(msg, { type: "error", error: "Not a member of this session" }));
              return;
            }
            const session = state.sharedSessionManager.getSession(msg.sessionId);
            safeWrite(socket, reply(msg, { type: "result", session }));
          } else {
            // M5: Return all active sessions for the account
            const sessions = state.sharedSessionManager.getActiveSessionsForAccount(accountName);
            safeWrite(socket, reply(msg, { type: "result", session: sessions[0] ?? null, sessions }));
          }
        },

        session_history: (msg) => {
          if (typeof msg.sessionId !== "string" || !msg.sessionId) {
            safeWrite(socket, reply(msg, { type: "error", error: "Invalid field: sessionId" }));
            return;
          }
          // C1: Verify membership before returning history
          if (!state.sharedSessionManager.isMember(msg.sessionId, accountName)) {
            safeWrite(socket, reply(msg, { type: "error", error: "Not a member of this session" }));
            return;
          }
          const updates = state.sharedSessionManager.getUpdates(msg.sessionId, accountName);
          safeWrite(socket, reply(msg, { type: "result", updates }));
        },

        leave_session: (msg) => {
          if (typeof msg.sessionId !== "string" || !msg.sessionId) {
            safeWrite(socket, reply(msg, { type: "error", error: "Invalid field: sessionId" }));
            return;
          }
          // C1: Membership is verified inside endSession
          // m4: endSession returns boolean - reflect reality in response
          const ended = state.sharedSessionManager.endSession(msg.sessionId, accountName);
          safeWrite(socket, reply(msg, { type: "result", ended }));
        },

        session_ping: (msg) => {
          if (typeof msg.sessionId !== "string" || !msg.sessionId) {
            safeWrite(socket, reply(msg, { type: "error", error: "Invalid field: sessionId" }));
            return;
          }
          // C1 + C3: Verify membership before recording ping
          if (!state.sharedSessionManager.isMember(msg.sessionId, accountName)) {
            safeWrite(socket, reply(msg, { type: "error", error: "Not a member of this session" }));
            return;
          }
          const pinged = state.sharedSessionManager.recordPing(msg.sessionId, accountName);
          safeWrite(socket, reply(msg, { type: "result", pinged }));
        },

        name_session: (msg) => {
          if (!state.sessionStore) {
            safeWrite(socket, reply(msg, { type: "error", error: "Sessions feature not enabled" }));
            return;
          }
          if (typeof msg.sessionId !== "string" || !msg.sessionId) {
            safeWrite(socket, reply(msg, { type: "error", error: "Invalid field: sessionId" }));
            return;
          }
          if (typeof msg.name !== "string" || !msg.name) {
            safeWrite(socket, reply(msg, { type: "error", error: "Invalid field: name" }));
            return;
          }
          const session = state.sessionStore.nameSession(msg.sessionId, msg.name, {
            account: msg.account ?? accountName,
            tags: msg.tags,
            notes: msg.notes,
          });
          safeWrite(socket, reply(msg, { type: "result", session }));
        },

        list_sessions: (msg) => {
          if (!state.sessionStore) {
            safeWrite(socket, reply(msg, { type: "error", error: "Sessions feature not enabled" }));
            return;
          }
          if (msg.limit !== undefined && (!Number.isInteger(msg.limit) || msg.limit < 0)) {
            safeWrite(socket, reply(msg, { type: "error", error: "Invalid limit" }));
            return;
          }
          if (msg.offset !== undefined && (!Number.isInteger(msg.offset) || msg.offset < 0)) {
            safeWrite(socket, reply(msg, { type: "error", error: "Invalid offset" }));
            return;
          }
          const sessions = state.sessionStore.list({
            account: msg.account,
            limit: msg.limit,
            offset: msg.offset,
          });
          safeWrite(socket, reply(msg, { type: "result", sessions }));
        },

        search_sessions: (msg) => {
          if (!state.sessionStore) {
            safeWrite(socket, reply(msg, { type: "error", error: "Sessions feature not enabled" }));
            return;
          }
          if (typeof msg.query !== "string" || !msg.query) {
            safeWrite(socket, reply(msg, { type: "error", error: "Invalid field: query" }));
            return;
          }
          if (msg.limit !== undefined && (!Number.isInteger(msg.limit) || msg.limit < 0)) {
            safeWrite(socket, reply(msg, { type: "error", error: "Invalid limit" }));
            return;
          }
          const results = state.sessionStore.search(msg.query, msg.limit);
          safeWrite(socket, reply(msg, { type: "result", results }));
        },

        report_progress: (msg) => {
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

        council_analyze: async (msg) => {
          if (!features?.council) {
            safeWrite(socket, reply(msg, { type: "error", error: "Council feature not enabled" }));
            return;
          }
          if (typeof msg.goal !== "string" || !msg.goal) {
            safeWrite(socket, reply(msg, { type: "error", error: "Invalid field: goal" }));
            return;
          }
          try {
            const { CouncilService } = await import("../services/council");
            const config = councilConfig ?? (await loadConfig()).council;
            if (!config) {
              safeWrite(socket, reply(msg, { type: "error", error: "Council not configured (missing council config)" }));
              return;
            }
            const council = new CouncilService(config);
            const analysis = await council.analyze(msg.goal, msg.context);
            safeWrite(socket, reply(msg, { type: "result", analysis }));
          } catch (err: any) {
            safeWrite(socket, reply(msg, { type: "error", error: err.message }));
          }
        },

        get_trust: (msg) => {
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

        reinstate_agent: (msg) => {
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

        check_circuit_breaker: (msg) => {
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

        adaptive_sla_check: async (msg) => {
          if (!features?.slaEngine) {
            safeWrite(socket, reply(msg, { type: "error", error: "SLA engine not enabled" }));
            return;
          }
          try {
            const { AdaptiveCoordinator } = await import("../services/adaptive-coordinator");
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
      };

      const handler = handlers[msg.type];
      if (handler) {
        try {
          const result: unknown = handler(msg);
          // Catch rejections from async handlers
          if (result instanceof Promise) {
            result.catch((err: any) => {
              safeWrite(socket, reply(msg, { type: "error", error: err.message ?? "Internal error" }));
            });
          }
        } catch (err: any) {
          safeWrite(socket, reply(msg, { type: "error", error: err.message ?? "Internal error" }));
        }
      }
    });

    socket.on("data", (data) => {
      pendingBytes += data.length;
      if (pendingBytes > MAX_PAYLOAD_BYTES) {
        socket.destroy();
        return;
      }
      parser.feed(data);
    });

    socket.on("close", () => {
      clearTimeout(idleTimer);
      if (accountName) state.disconnectAccount(accountName);
    });
  });

  // m2: Periodic cleanup of stale/inactive shared sessions (every 60s)
  const SESSION_CLEANUP_INTERVAL_MS = 60_000;
  const SESSION_PURGE_THRESHOLD_MS = 30 * 60_000; // 30 minutes
  const sessionCleanupTimer = setInterval(() => {
    state.sharedSessionManager.cleanupStale();
    state.sharedSessionManager.purgeInactive(SESSION_PURGE_THRESHOLD_MS);
  }, SESSION_CLEANUP_INTERVAL_MS);

  await new Promise<void>((resolve, reject) => {
    server.once("error", (err) => {
      clearInterval(sessionCleanupTimer);
      reject(err);
    });
    server.listen(sockPath, () => {
      // Restrict socket to owner-only access (rw-------)
      try { chmodSync(sockPath, 0o600); } catch {}
      writeFileSync(getPidPath(), String(process.pid));
      resolve();
    });
  });

  return { server, state, sockPath, watchdog, sessionCleanupTimer, entireAdapter };
}

export function stopDaemon(server: Server, sockPath?: string, watchdog?: { stop: () => void }, sessionCleanupTimer?: ReturnType<typeof setInterval>, entireAdapter?: { stopWatching: () => void }): void {
  watchdog?.stop();
  entireAdapter?.stopWatching();
  if (sessionCleanupTimer) clearInterval(sessionCleanupTimer);
  server.close();
  const sp = sockPath ?? getSockPath();
  try { unlinkSync(sp); } catch {}
  try { unlinkSync(getPidPath()); } catch {}
}

export function daemonStatusCommand(): string {
  const pidPath = getPidPath();
  const sockPath = getSockPath();

  try {
    const pid = parseInt(readFileSync(pidPath, "utf-8").trim(), 10);
    try {
      process.kill(pid, 0); // signal 0 = existence check
      const hasSocket = existsSync(sockPath);
      return `Daemon running (PID: ${pid}${hasSocket ? ", socket: hub.sock" : ""})`;
    } catch {
      // Process not alive -- stale PID file
      try { unlinkSync(pidPath); } catch {}
      return "Daemon not running (stale PID file removed)";
    }
  } catch {
    return "Daemon not running";
  }
}

export function stopDaemonByPid(): void {
  const pidPath = getPidPath();
  try {
    const pid = parseInt(readFileSync(pidPath, "utf-8").trim(), 10);
    process.kill(pid, "SIGTERM");
    console.log(`Sent SIGTERM to daemon (pid ${pid})`);
  } catch {
    console.log("No running daemon found");
  }
}
