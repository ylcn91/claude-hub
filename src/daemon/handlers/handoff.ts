import type { Socket } from "net";
import type { HandlerContext, HandlerFn } from "../handler-types";
import { notifyHandoff } from "../../services/notifications";
import { validateHandoff } from "../../services/handoff";
import { checkDelegationDepth } from "../../services/delegation-depth";
import { loadTasks, saveTasks, type TaskStatus } from "../../services/tasks";
import { rankAccounts } from "../../services/account-capabilities";
import { computeWorkloadSnapshots, computeWorkloadModifier } from "../../services/workload-metrics";
import { loadConfig } from "../../config";

export function registerHandoffHandlers(ctx: HandlerContext): Record<string, HandlerFn> {
  const { state, features, safeWrite, reply, getAccountName } = ctx;

  return {
    handoff_task: async (socket: Socket, msg: any) => {
      const accountName = getAccountName(socket);
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

      // F-13: Delegation depth check
      let depthConfig = features?.delegationDepth;
      if (!depthConfig) {
        try {
          const cfg = await loadConfig();
          if (cfg.defaults?.maxDelegationDepth != null) {
            depthConfig = { maxDepth: cfg.defaults.maxDelegationDepth };
          }
        } catch (err) { console.warn("[daemon:handoff] config load failed:", err instanceof Error ? err.message : err); }
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
      const ctx2 = msg.context ?? {};
      if (ctx2.projectDir) {
        try {
          const { collectContext } = await import("../../services/context-collector");
          autoContext = await collectContext(ctx2.projectDir);
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
        context: ctx2,
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

    reauthorize_delegation: (socket: Socket, msg: any) => {
      const accountName = getAccountName(socket);
      if (typeof msg.handoffId !== "string" || !msg.handoffId) {
        safeWrite(socket, reply(msg, { type: "error", error: "Invalid field: handoffId" }));
        return;
      }
      if (typeof msg.newMaxDepth !== "number" || msg.newMaxDepth < 1) {
        safeWrite(socket, reply(msg, { type: "error", error: "Invalid field: newMaxDepth (must be a positive number)" }));
        return;
      }
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

    handoff_accept: async (socket: Socket, msg: any) => {
      const accountName = getAccountName(socket);
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

    suggest_assignee: async (socket: Socket, msg: any) => {
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
        } catch (err) { console.warn("[daemon:suggest_assignee] workload enrichment failed:", err instanceof Error ? err.message : err); }

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
  };
}
