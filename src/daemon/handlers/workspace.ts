import type { Socket } from "net";
import type { HandlerContext, HandlerFn } from "../handler-types";

export function registerWorkspaceHandlers(ctx: HandlerContext): Record<string, HandlerFn> {
  const { state, safeWrite, reply, getAccountName } = ctx;

  return {
    prepare_worktree_for_handoff: async (socket: Socket, msg: any) => {
      const accountName = getAccountName(socket);
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

    get_workspace_status: async (socket: Socket, msg: any) => {
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

    cleanup_workspace: async (socket: Socket, msg: any) => {
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
  };
}
