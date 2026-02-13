import { createServer, type Server } from "net";
import { existsSync, unlinkSync, writeFileSync, readFileSync, mkdirSync } from "fs";
import { timingSafeEqual } from "crypto";
import { DaemonState } from "./state";
import { createLineParser, frameSend } from "./framing";
import { notifyHandoff, notifyMessage, sendNotification } from "../services/notifications";
import { validateHandoff } from "../services/handoff";
import { loadTasks, saveTasks, updateTaskStatus, rejectTask, acceptTask, submitForReview, type TaskStatus } from "../services/tasks";
import { runAcceptanceSuite } from "../services/acceptance-runner";
import { rankAccounts } from "../services/account-capabilities";
import { loadConfig } from "../config";
import { checkStaleTasks, formatEscalationMessage, DEFAULT_SLA_CONFIG } from "../services/sla-engine";
import { computeWorkloadSnapshots, computeWorkloadModifier } from "../services/workload-metrics";
import { getHealthStatus } from "./health";
import { startWatchdog } from "./watchdog";

function getHubDir(): string {
  return process.env.CLAUDE_HUB_DIR ?? `${process.env.HOME}/.claude-hub`;
}

function getSockPath(): string {
  return `${getHubDir()}/hub.sock`;
}

function getPidPath(): string {
  return `${getHubDir()}/daemon.pid`;
}

function getTokensDir(): string {
  return `${getHubDir()}/tokens`;
}

const SAFE_ACCOUNT_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,62}$/;

export function verifyAccountToken(account: string, token: string): boolean {
  if (!SAFE_ACCOUNT_NAME_RE.test(account)) return false;
  const tokenPath = `${getTokensDir()}/${account}.token`;
  try {
    const stored = readFileSync(tokenPath, "utf-8").trim();
    if (stored.length !== token.length) return false;
    return timingSafeEqual(Buffer.from(stored), Buffer.from(token));
  } catch {
    return false;
  }
}

function reply(msg: any, response: object): string {
  return frameSend({ ...response, ...(msg.requestId ? { requestId: msg.requestId } : {}) });
}

export interface DaemonOpts {
  dbPath?: string;
  workspaceDbPath?: string;
  capabilityDbPath?: string;
  knowledgeDbPath?: string;
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
  };
}

export function startDaemon(opts?: DaemonOpts): { server: Server; state: DaemonState; sockPath: string; watchdog?: { stop: () => void } } {
  const state = new DaemonState(opts?.dbPath);
  const features = opts?.features;

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
          sendNotification("Claude Hub SLA", formatEscalationMessage(esc)).catch(e => console.error("[sla]", e.message));
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

  let watchdog: { stop: () => void } | undefined;
  if (features?.reliability) {
    watchdog = startWatchdog(state, state.startedAt);
  }

  mkdirSync(getHubDir(), { recursive: true });

  const sockPath = opts?.sockPath ?? getSockPath();

  // Cleanup orphaned socket
  if (existsSync(sockPath)) unlinkSync(sockPath);

  const server = createServer((socket) => {
    let authenticated = false;
    let accountName = "";

    const parser = createLineParser((msg) => {
      // Allow unauthenticated ping for health checks (reveals no data)
      if (msg.type === "ping") {
        socket.write(reply(msg, { type: "pong" }));
        return;
      }

      // All other messages require auth
      if (!authenticated) {
        if (msg.type === "auth" && msg.account && msg.token) {
          if (verifyAccountToken(msg.account, msg.token)) {
            authenticated = true;
            accountName = msg.account;
            state.connectAccount(accountName, msg.token);
            socket.write(reply(msg, { type: "auth_ok" }));
          } else {
            socket.write(reply(msg, { type: "auth_fail", error: "Invalid token" }));
            socket.end();
          }
        }
        return;
      }

      // Handler map — O(1) dispatch, guarantees only one handler runs per message
      const handlers: Record<string, (msg: any) => void> = {
        send_message: (msg) => {
          state.addMessage({
            from: accountName,
            to: msg.to,
            type: "message",
            content: msg.content,
            timestamp: new Date().toISOString(),
          });
          notifyMessage(accountName, msg.to, msg.content).catch(e => console.error("[notify]", e.message));
          socket.write(reply(msg, { type: "result", delivered: state.isConnected(msg.to), queued: true }));
        },

        count_unread: (msg) => {
          const count = state.countUnread(accountName);
          socket.write(reply(msg, { type: "result", count }));
        },

        read_messages: (msg) => {
          const limit = msg.limit as number | undefined;
          const offset = msg.offset as number | undefined;
          const messages = (limit || offset)
            ? state.getMessages(accountName, { limit, offset })
            : state.getUnreadMessages(accountName);
          if (!limit && !offset) {
            state.markAllRead(accountName);
          }
          socket.write(reply(msg, { type: "result", messages }));
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
            socket.write(reply(msg, { type: "result", accounts }));
          } catch (err: any) {
            socket.write(reply(msg, { type: "error", error: err.message }));
          }
        },

        handoff_task: (msg) => {
          const validation = validateHandoff(msg.payload);
          if (!validation.valid) {
            socket.write(reply(msg, {
              type: "error",
              error: "Invalid handoff payload",
              details: validation.errors,
            }));
            return;
          }

          const handoffMsg = {
            from: accountName,
            to: msg.to,
            type: "handoff" as const,
            content: JSON.stringify(validation.payload),
            timestamp: new Date().toISOString(),
            context: msg.context ?? {},
          };
          const handoffId = state.addMessage(handoffMsg);
          notifyHandoff(accountName, msg.to, validation.payload.goal).catch(e => console.error("[notify]", e.message));
          socket.write(reply(msg, {
            type: "result",
            delivered: state.isConnected(msg.to),
            queued: true,
            handoffId,
          }));
        },

        update_task_status: async (msg) => {
          try {
            let board = await loadTasks();
            const status = msg.status as TaskStatus;

            if (status === "rejected") {
              if (!msg.reason) {
                socket.write(reply(msg, { type: "error", error: "Reason is required when rejecting" }));
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
              socket.write(reply(msg, { type: "result", task, acceptance: "running" }));
              (async () => {
                try {
                  const handoffs = state.getHandoffs(accountName);
                  const handoff = handoffs.find((h: any) => {
                    const ctx = h.context ?? {};
                    return ctx.branch === msg.branch || ctx.projectDir === msg.workspacePath;
                  });
                  if (!handoff) return;
                  const payload = JSON.parse(handoff.content);
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
                } catch (e: any) { console.error("[accept]", e.message); }
              })();
            } else {
              socket.write(reply(msg, { type: "result", task }));
            }
          } catch (err: any) {
            socket.write(reply(msg, { type: "error", error: err.message }));
          }
        },

        archive_messages: (msg) => {
          const archived = state.archiveOld(msg.days);
          socket.write(reply(msg, { type: "result", archived }));
        },

        prepare_worktree_for_handoff: async (msg) => {
          if (!state.workspaceManager) {
            socket.write(reply(msg, { type: "error", error: "Workspace feature not enabled" }));
            return;
          }
          try {
            const result = await state.workspaceManager.prepareWorktree({
              repoPath: msg.repoPath,
              branch: msg.branch,
              ownerAccount: accountName,
              handoffId: msg.handoffId,
            });
            socket.write(reply(msg, { type: "result", ...result }));
          } catch (err: any) {
            socket.write(reply(msg, { type: "error", error: err.message }));
          }
        },

        get_workspace_status: async (msg) => {
          if (!state.workspaceManager) {
            socket.write(reply(msg, { type: "error", error: "Workspace feature not enabled" }));
            return;
          }
          try {
            const ws = msg.id
              ? await state.workspaceManager.getWorkspace(msg.id)
              : await state.workspaceManager.getWorkspaceByKey(msg.repoPath, msg.branch);
            socket.write(reply(msg, { type: "result", workspace: ws }));
          } catch (err: any) {
            socket.write(reply(msg, { type: "error", error: err.message }));
          }
        },

        cleanup_workspace: async (msg) => {
          if (!state.workspaceManager) {
            socket.write(reply(msg, { type: "error", error: "Workspace feature not enabled" }));
            return;
          }
          try {
            const result = await state.workspaceManager.cleanupWorkspace(msg.id);
            socket.write(reply(msg, { type: "result", ...result }));
          } catch (err: any) {
            socket.write(reply(msg, { type: "error", error: err.message }));
          }
        },

        handoff_accept: async (msg) => {
          try {
            const handoffs = state.getHandoffs(accountName);
            const handoff = handoffs.find((h: any) => h.id === msg.handoffId);
            if (!handoff) {
              socket.write(reply(msg, { type: "error", error: "Handoff not found" }));
              return;
            }
            const payload = JSON.parse(handoff.content);
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

            socket.write(reply(msg, {
              type: "result",
              handoff: { id: handoff.id, payload, context },
              workspace,
            }));
          } catch (err: any) {
            socket.write(reply(msg, { type: "error", error: err.message }));
          }
        },

        suggest_assignee: async (msg) => {
          if (!state.capabilityStore) {
            socket.write(reply(msg, { type: "error", error: "Capability routing not enabled" }));
            return;
          }
          try {
            const capabilities = state.capabilityStore.getAll();
            const skills: string[] = msg.skills ?? [];

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
            socket.write(reply(msg, { type: "result", scores }));
          } catch (err: any) {
            socket.write(reply(msg, { type: "error", error: err.message }));
          }
        },

        ping: (msg) => {
          socket.write(reply(msg, { type: "pong" }));
        },

        health_check: (msg) => {
          const status = getHealthStatus(state, state.startedAt);
          socket.write(reply(msg, { type: "result", ...status }));
        },

        search_knowledge: (msg) => {
          if (!state.knowledgeStore) {
            socket.write(reply(msg, { type: "error", error: "Knowledge index not enabled" }));
            return;
          }
          const results = state.knowledgeStore.search(msg.query, msg.category, msg.limit);
          socket.write(reply(msg, { type: "result", results }));
        },

        index_note: (msg) => {
          if (!state.knowledgeStore) {
            socket.write(reply(msg, { type: "error", error: "Knowledge index not enabled" }));
            return;
          }
          const entry = state.knowledgeStore.index({
            category: msg.category ?? "decision_note",
            title: msg.title,
            content: msg.content,
            tags: msg.tags ?? [],
            accountName: accountName,
          });
          socket.write(reply(msg, { type: "result", entry }));
        },

        link_task: (msg) => {
          if (!state.externalLinkStore) {
            socket.write(reply(msg, { type: "error", error: "GitHub integration not enabled" }));
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
            socket.write(reply(msg, { type: "result", link }));
          } catch (err: any) {
            socket.write(reply(msg, { type: "error", error: err.message }));
          }
        },

        get_task_links: (msg) => {
          if (!state.externalLinkStore) {
            socket.write(reply(msg, { type: "error", error: "GitHub integration not enabled" }));
            return;
          }
          try {
            const links = state.externalLinkStore.getLinksForTask(msg.taskId);
            socket.write(reply(msg, { type: "result", links }));
          } catch (err: any) {
            socket.write(reply(msg, { type: "error", error: err.message }));
          }
        },

        get_review_bundle: async (msg) => {
          try {
            const { getBundle } = await import("../services/review-bundle-store");
            const bundle = await getBundle(msg.taskId);
            socket.write(reply(msg, { type: "result", bundle }));
          } catch (err: any) {
            socket.write(reply(msg, { type: "error", error: err.message }));
          }
        },

        generate_review_bundle: async (msg) => {
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
            socket.write(reply(msg, { type: "result", bundle }));
          } catch (err: any) {
            socket.write(reply(msg, { type: "error", error: err.message }));
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
            socket.write(reply(msg, { type: "result", ...snapshot }));
          } catch (err: any) {
            socket.write(reply(msg, { type: "error", error: err.message }));
          }
        },
      };

      const handler = handlers[msg.type];
      if (handler) handler(msg);
    });

    socket.on("data", (data) => parser.feed(data));

    socket.on("close", () => {
      if (accountName) state.disconnectAccount(accountName);
    });
  });

  server.listen(sockPath, () => {
    writeFileSync(getPidPath(), String(process.pid));
  });

  return { server, state, sockPath, watchdog };
}

export function stopDaemon(server: Server, sockPath?: string, watchdog?: { stop: () => void }): void {
  watchdog?.stop();
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
