import { createServer, type Server } from "net";
import { existsSync, unlinkSync, writeFileSync, readFileSync, mkdirSync } from "fs";
import { DaemonState } from "./state";
import { createLineParser, frameSend } from "./framing";
import { notifyHandoff, notifyMessage, sendNotification } from "../services/notifications";
import { validateHandoff } from "../services/handoff";
import { loadTasks, saveTasks, updateTaskStatus, rejectTask, acceptTask, submitForReview, type TaskStatus } from "../services/tasks";
import { runAcceptanceSuite } from "../services/acceptance-runner";
import { rankAccounts } from "../services/account-capabilities";
import { checkStaleTasks, formatEscalationMessage, DEFAULT_SLA_CONFIG } from "../services/sla-engine";

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

export function verifyAccountToken(account: string, token: string): boolean {
  const tokenPath = `${getTokensDir()}/${account}.token`;
  try {
    const stored = readFileSync(tokenPath, "utf-8").trim();
    return stored === token;
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
  sockPath?: string;
  features?: { workspaceWorktree?: boolean; autoAcceptance?: boolean; capabilityRouting?: boolean; slaEngine?: boolean };
}

export function startDaemon(opts?: DaemonOpts): { server: Server; state: DaemonState; sockPath: string } {
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

  mkdirSync(getHubDir(), { recursive: true });

  const sockPath = opts?.sockPath ?? getSockPath();

  // Cleanup orphaned socket
  if (existsSync(sockPath)) unlinkSync(sockPath);

  const server = createServer((socket) => {
    let authenticated = false;
    let accountName = "";

    const parser = createLineParser((msg) => {
      // First message must be auth handshake
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

      // Handle message types
      if (msg.type === "send_message") {
        state.addMessage({
          from: accountName,
          to: msg.to,
          type: "message",
          content: msg.content,
          timestamp: new Date().toISOString(),
        });
        // Fire notification (non-blocking)
        notifyMessage(accountName, msg.to, msg.content).catch(e => console.error("[notify]", e.message));
        socket.write(reply(msg, { type: "result", delivered: state.isConnected(msg.to), queued: true }));
      }

      if (msg.type === "count_unread") {
        const count = state.countUnread(accountName);
        socket.write(reply(msg, { type: "result", count }));
        return;
      }

      if (msg.type === "read_messages") {
        const limit = msg.limit as number | undefined;
        const offset = msg.offset as number | undefined;
        const messages = (limit || offset)
          ? state.getMessages(accountName, { limit, offset })
          : state.getUnreadMessages(accountName);
        if (!limit && !offset) {
          state.markAllRead(accountName);
        }
        socket.write(reply(msg, { type: "result", messages }));
      }

      if (msg.type === "list_accounts") {
        const accounts = state.getConnectedAccounts().map((name) => ({
          name,
          status: "active" as const,
        }));
        socket.write(reply(msg, { type: "result", accounts }));
      }

      if (msg.type === "handoff_task") {
        // Server-side validation (bypass protection)
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
        // Fire notification (non-blocking)
        notifyHandoff(accountName, msg.to, validation.payload.goal).catch(e => console.error("[notify]", e.message));
        socket.write(reply(msg, {
          type: "result",
          delivered: state.isConnected(msg.to),
          queued: true,
          handoffId,
        }));
      }

      if (msg.type === "update_task_status") {
        (async () => {
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

            // Auto-acceptance: if transitioning to ready_for_review and feature enabled
            if (status === "ready_for_review" && features?.autoAcceptance && task) {
              socket.write(reply(msg, { type: "result", task, acceptance: "running" }));
              // Run acceptance async — find handoff run_commands
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
                } catch(e: any) { console.error("[accept]", e.message) }
              })();
            } else {
              socket.write(reply(msg, { type: "result", task }));
            }
          } catch (err: any) {
            socket.write(reply(msg, { type: "error", error: err.message }));
          }
        })();
      }

      if (msg.type === "archive_messages") {
        const archived = state.archiveOld(msg.days);
        socket.write(reply(msg, { type: "result", archived }));
      }

      // ── Workspace handlers ──
      if (msg.type === "prepare_worktree_for_handoff") {
        if (!state.workspaceManager) {
          socket.write(reply(msg, { type: "error", error: "Workspace feature not enabled" }));
          return;
        }
        (async () => {
          try {
            const result = await state.workspaceManager!.prepareWorktree({
              repoPath: msg.repoPath,
              branch: msg.branch,
              ownerAccount: accountName,
              handoffId: msg.handoffId,
            });
            socket.write(reply(msg, { type: "result", ...result }));
          } catch (err: any) {
            socket.write(reply(msg, { type: "error", error: err.message }));
          }
        })();
      }

      if (msg.type === "get_workspace_status") {
        if (!state.workspaceManager) {
          socket.write(reply(msg, { type: "error", error: "Workspace feature not enabled" }));
          return;
        }
        (async () => {
          try {
            const ws = msg.id
              ? await state.workspaceManager!.getWorkspace(msg.id)
              : await state.workspaceManager!.getWorkspaceByKey(msg.repoPath, msg.branch);
            socket.write(reply(msg, { type: "result", workspace: ws }));
          } catch (err: any) {
            socket.write(reply(msg, { type: "error", error: err.message }));
          }
        })();
      }

      if (msg.type === "cleanup_workspace") {
        if (!state.workspaceManager) {
          socket.write(reply(msg, { type: "error", error: "Workspace feature not enabled" }));
          return;
        }
        (async () => {
          try {
            const result = await state.workspaceManager!.cleanupWorkspace(msg.id);
            socket.write(reply(msg, { type: "result", ...result }));
          } catch (err: any) {
            socket.write(reply(msg, { type: "error", error: err.message }));
          }
        })();
      }

      if (msg.type === "handoff_accept") {
        (async () => {
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

            // Auto-prepare workspace if feature enabled and context has repo info
            if (state.workspaceManager && context.projectDir && context.branch) {
              try {
                const wsResult = await state.workspaceManager.prepareWorktree({
                  repoPath: context.projectDir,
                  branch: context.branch,
                  ownerAccount: accountName,
                  handoffId: msg.handoffId,
                });
                if (wsResult.ok) workspace = wsResult.data;
              } catch(e: any) { console.error("[workspace]", e.message) }
            }

            socket.write(reply(msg, {
              type: "result",
              handoff: { id: handoff.id, payload, context },
              workspace,
            }));
          } catch (err: any) {
            socket.write(reply(msg, { type: "error", error: err.message }));
          }
        })();
      }

      // ── Routing handler ──
      if (msg.type === "suggest_assignee") {
        if (!state.capabilityStore) {
          socket.write(reply(msg, { type: "error", error: "Capability routing not enabled" }));
          return;
        }
        const capabilities = state.capabilityStore.getAll();
        const skills: string[] = msg.skills ?? [];
        const scores = rankAccounts(capabilities, skills, {
          excludeAccounts: msg.excludeAccounts,
          priority: msg.priority,
        });
        socket.write(reply(msg, { type: "result", scores }));
      }
    });

    socket.on("data", (data) => parser.feed(data));

    socket.on("close", () => {
      if (accountName) state.disconnectAccount(accountName);
    });
  });

  server.listen(sockPath, () => {
    writeFileSync(getPidPath(), String(process.pid));
  });

  return { server, state, sockPath };
}

export function stopDaemon(server: Server, sockPath?: string): void {
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
