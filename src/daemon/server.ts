import { createServer, createConnection, type Server, type Socket } from "net";
import { existsSync, unlinkSync, writeFileSync, readFileSync, mkdirSync, chmodSync } from "fs";
import { dirname, join } from "path";
import { timingSafeEqual } from "crypto";
import { DaemonState } from "./state";
import { createLineParser, frameSend } from "./framing";
import { DaemonMessageSchema } from "./schemas";
import { sendNotification } from "../services/notifications";
import { loadTasks } from "../services/tasks";
import { loadConfig } from "../config";
import { checkStaleTasks, formatEscalationMessage, DEFAULT_SLA_CONFIG } from "../services/sla-engine";
import { startWatchdog } from "./watchdog";
import { getHubDir, getSockPath, getPidPath, getTokensDir } from "../paths";
import { ACCOUNT_NAME_RE } from "../services/account-manager";
import { buildHandlerMap } from "./handler-registry";
import type { HandlerContext, DaemonFeatures } from "./handler-types";

export async function verifyAccountToken(account: string, token: string): Promise<boolean> {
  if (!ACCOUNT_NAME_RE.test(account)) return false;
  const tokenPath = `${getTokensDir()}/${account}.token`;
  try {
    const stored = (await Bun.file(tokenPath).text()).trim();
    if (stored.length !== token.length) return false;
    return timingSafeEqual(Buffer.from(stored), Buffer.from(token));
  } catch {
    return false; /* token file missing or unreadable */
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

import { MAX_PAYLOAD_BYTES, IDLE_TIMEOUT_MS } from "../constants";

export { DaemonFeatures };

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
  features?: DaemonFeatures;
  entireGitDir?: string;
  council?: { members: string[]; chairman: string };
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

  // Bridge EventBus -> ActivityStore: forward relevant delegation events for persistence
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

  // Cleanup orphaned socket -- only if no live daemon is using it
  if (existsSync(sockPath)) {
    try {
      const probe = createConnection(sockPath);
      await new Promise<void>((resolve, reject) => {
        probe.once("connect", () => {
          probe.destroy();
          reject(new Error("Daemon already running"));
        });
        probe.once("error", () => {
          resolve();
        });
      });
    } catch (err: any) {
      if (err.message === "Daemon already running") throw err;
    }
    unlinkSync(sockPath);
  }

  // Per-socket account name tracking
  const socketAccounts = new WeakMap<Socket, string>();

  // Build handler map once with shared context
  const handlerCtx: HandlerContext = {
    state,
    features,
    councilConfig,
    safeWrite,
    reply,
    getAccountName: (socket: Socket) => socketAccounts.get(socket) ?? "",
  };
  const handlers = buildHandlerMap(handlerCtx);

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
                socketAccounts.set(socket, accountName);
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

      // Dispatch to handler
      const handler = handlers[msg.type];
      if (handler) {
        try {
          const result: unknown = handler(socket, msg);
          if (result instanceof Promise) {
            result.catch((err: any) => {
              console.error(`[daemon:${msg.type}] async handler error:`, err.message ?? err);
              safeWrite(socket, reply(msg, { type: "error", error: err.message ?? "Internal error" }));
            });
          }
        } catch (err: any) {
          console.error(`[daemon:${msg.type}] handler error:`, err.message ?? err);
          safeWrite(socket, reply(msg, { type: "error", error: err.message ?? "Internal error" }));
        }
      } else {
        safeWrite(socket, reply(msg, { type: "error", error: `Unknown message type: ${msg.type}` }));
      }
    }, (raw: unknown) => {
      const parsed = DaemonMessageSchema.safeParse(raw);
      if (!parsed.success) {
        // If it's valid JSON with a type field, let it through for a proper error response
        if (raw && typeof raw === "object" && "type" in raw) {
          console.warn(`[framing] invalid message (type=${(raw as any).type}):`, parsed.error.message);
          return raw;
        }
        console.warn("[framing] invalid message (no type):", parsed.error.message);
        return null;
      }
      return parsed.data;
    }, (err, rawLine) => {
      console.error(`[daemon] JSON parse error from ${accountName || "unauthenticated"}: ${err.message} — line: ${rawLine.substring(0, 120)}`);
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
      try { chmodSync(sockPath, 0o600); } catch { /* chmod may fail on some filesystems */ }
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
  try { unlinkSync(sp); } catch { /* socket file may already be removed */ }
  try { unlinkSync(getPidPath()); } catch { /* PID file may already be removed */ }
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
      /* process not alive -- stale PID file */
      try { unlinkSync(pidPath); } catch { /* PID file already removed */ }
      return "Daemon not running (stale PID file removed)";
    }
  } catch {
    return "Daemon not running"; /* no PID file found */
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
