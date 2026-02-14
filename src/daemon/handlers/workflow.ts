import type { Socket } from "net";
import type { HandlerContext, HandlerFn } from "../handler-types";
import { scanWorkflowDir } from "../../services/workflow-parser";
import { getHubDir } from "../../paths";
import { join } from "path";

export function registerWorkflowHandlers(ctx: HandlerContext): Record<string, HandlerFn> {
  const { state, safeWrite, reply } = ctx;

  return {
    workflow_trigger: async (socket: Socket, msg: any) => {
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

    workflow_status: (socket: Socket, msg: any) => {
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

    workflow_list: async (socket: Socket, msg: any) => {
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

    workflow_cancel: async (socket: Socket, msg: any) => {
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
  };
}
