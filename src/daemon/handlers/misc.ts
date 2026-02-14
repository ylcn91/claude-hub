import type { Socket } from "net";
import type { HandlerContext, HandlerFn } from "../handler-types";
import { loadConfig } from "../../config";

export function registerMiscHandlers(ctx: HandlerContext): Record<string, HandlerFn> {
  const { state, safeWrite, reply, getAccountName } = ctx;

  return {
    query_activity: (socket: Socket, msg: any) => {
      if (!state.activityStore) {
        safeWrite(socket, reply(msg, { type: "error", error: "Activity store not enabled" }));
        return;
      }
      try {
        const events = state.activityStore.query({
          type: msg.activityType,
          account: msg.account,
          workflowRunId: msg.workflowRunId,
          since: msg.since,
          limit: msg.limit ?? 50,
        });
        safeWrite(socket, reply(msg, { type: "result", events }));
      } catch (err: any) {
        safeWrite(socket, reply(msg, { type: "error", error: err.message }));
      }
    },

    config_reload: async (socket: Socket, msg: any) => {
      try {
        const config = await loadConfig();
        safeWrite(socket, reply(msg, { type: "result", reloaded: true, accounts: config.accounts.length }));
      } catch (err: any) {
        safeWrite(socket, reply(msg, { type: "error", error: err.message }));
      }
    },

    search_code: async (socket: Socket, msg: any) => {
      try {
        const { searchDirectories } = await import("../../services/code-search");
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

    replay_session: async (socket: Socket, msg: any) => {
      try {
        if (typeof msg.sessionId !== "string" || !msg.sessionId) {
          safeWrite(socket, reply(msg, { type: "error", error: "Invalid field: sessionId" }));
          return;
        }
        if (typeof msg.repoPath !== "string" || !msg.repoPath) {
          safeWrite(socket, reply(msg, { type: "error", error: "Invalid field: repoPath" }));
          return;
        }
        if (!msg.repoPath.startsWith("/") || msg.repoPath.includes("..") || msg.repoPath.length > 4096) {
          safeWrite(socket, reply(msg, { type: "error", error: "Invalid repoPath format" }));
          return;
        }
        const { readCheckpoint } = await import("../../services/entire-integration");
        const { buildTimeline } = await import("../../services/replay");
        const { metadata, transcript } = await readCheckpoint(msg.repoPath, msg.sessionId);
        const timeline = await buildTimeline(msg.repoPath, msg.sessionId, transcript);
        safeWrite(socket, reply(msg, { type: "result", metadata, timeline }));
      } catch (err: any) {
        safeWrite(socket, reply(msg, { type: "error", error: err.message }));
      }
    },

    link_task: (socket: Socket, msg: any) => {
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

    get_task_links: (socket: Socket, msg: any) => {
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

    get_review_bundle: async (socket: Socket, msg: any) => {
      if (typeof msg.taskId !== "string" || !msg.taskId) {
        safeWrite(socket, reply(msg, { type: "error", error: "Invalid field: taskId" }));
        return;
      }
      try {
        const { getBundle } = await import("../../services/review-bundle-store");
        const bundle = await getBundle(msg.taskId);
        safeWrite(socket, reply(msg, { type: "result", bundle }));
      } catch (err: any) {
        safeWrite(socket, reply(msg, { type: "error", error: err.message }));
      }
    },

    generate_review_bundle: async (socket: Socket, msg: any) => {
      if (typeof msg.taskId !== "string" || !msg.taskId) {
        safeWrite(socket, reply(msg, { type: "error", error: "Invalid field: taskId" }));
        return;
      }
      try {
        const { generateReviewBundle } = await import("../../services/review-bundle");
        const { saveBundle } = await import("../../services/review-bundle-store");
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

    get_analytics: async (socket: Socket, msg: any) => {
      try {
        const { computeAnalytics } = await import("../../services/analytics");
        const { loadTasks } = await import("../../services/tasks");
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

    retro_start_session: (socket: Socket, msg: any) => {
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

    retro_submit_review: (socket: Socket, msg: any) => {
      const accountName = getAccountName(socket);
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

    retro_submit_synthesis: async (socket: Socket, msg: any) => {
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

    retro_status: (socket: Socket, msg: any) => {
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

    retro_get_past_learnings: async (socket: Socket, msg: any) => {
      if (!state.retroEngine) {
        safeWrite(socket, reply(msg, { type: "error", error: "Retro feature not enabled" }));
        return;
      }
      const learnings = await state.retroEngine.getPastLearnings();
      safeWrite(socket, reply(msg, { type: "result", learnings }));
    },
  };
}
