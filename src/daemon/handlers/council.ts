import type { Socket } from "net";
import type { HandlerContext, HandlerFn } from "../handler-types";
import { loadConfig } from "../../config";

export function registerCouncilHandlers(ctx: HandlerContext): Record<string, HandlerFn> {
  const { features, councilConfig, safeWrite, reply } = ctx;

  return {
    council_analyze: async (socket: Socket, msg: any) => {
      if (!features?.council) {
        safeWrite(socket, reply(msg, { type: "error", error: "Council feature not enabled" }));
        return;
      }
      if (typeof msg.goal !== "string" || !msg.goal) {
        safeWrite(socket, reply(msg, { type: "error", error: "Invalid field: goal" }));
        return;
      }
      try {
        const { CouncilService, createAccountCaller } = await import("../../services/council");
        const fullConfig = await loadConfig();
        const council_config = councilConfig ?? fullConfig.council;
        if (!council_config) {
          safeWrite(socket, reply(msg, { type: "error", error: "Council not configured (missing council config)" }));
          return;
        }
        const timeoutMs = msg.timeoutMs ?? council_config.timeoutMs;
        const llmCaller = createAccountCaller(fullConfig.accounts, timeoutMs);
        const council = new CouncilService(council_config, llmCaller);
        const analysis = await council.analyze(msg.goal, msg.context);

        // Persist analysis for CouncilPanel UI
        try {
          const { appendCouncilAnalysis } = await import("../../services/council-store");
          await appendCouncilAnalysis(analysis);
        } catch (e: any) {
          console.error("[council] Failed to persist analysis:", e.message);
        }

        safeWrite(socket, reply(msg, { type: "result", analysis }));
      } catch (err: any) {
        safeWrite(socket, reply(msg, { type: "error", error: err.message }));
      }
    },

    council_verify: async (socket: Socket, msg: any) => {
      if (!features?.council) {
        safeWrite(socket, reply(msg, { type: "error", error: "Council feature not enabled" }));
        return;
      }
      if (typeof msg.taskId !== "string" || !msg.taskId) {
        safeWrite(socket, reply(msg, { type: "error", error: "Invalid field: taskId" }));
        return;
      }
      if (typeof msg.goal !== "string" || !msg.goal) {
        safeWrite(socket, reply(msg, { type: "error", error: "Invalid field: goal" }));
        return;
      }
      if (!Array.isArray(msg.acceptance_criteria)) {
        safeWrite(socket, reply(msg, { type: "error", error: "Invalid field: acceptance_criteria" }));
        return;
      }
      try {
        const { verifyTaskCompletion } = await import("../../services/verification-council");
        const { createAccountCaller } = await import("../../services/council");
        const fullConfig = await loadConfig();
        const council_config = councilConfig ?? fullConfig.council;
        if (!council_config) {
          safeWrite(socket, reply(msg, { type: "error", error: "Council not configured (missing council config)" }));
          return;
        }
        const timeoutMs = msg.timeoutMs ?? council_config.timeoutMs;
        const llmCaller = createAccountCaller(fullConfig.accounts, timeoutMs);

        const result = await verifyTaskCompletion(
          msg.taskId,
          {
            diff: msg.diff,
            testResults: msg.testResults,
            filesChanged: msg.filesChanged,
            riskNotes: msg.riskNotes,
          },
          {
            goal: msg.goal,
            acceptance_criteria: msg.acceptance_criteria,
          },
          {
            members: council_config.members,
            chairman: council_config.chairman,
            llmCaller,
          },
        );

        // Persist verification result for CouncilPanel UI
        try {
          const { appendVerificationResult } = await import("../../services/council-store");
          await appendVerificationResult(result);
        } catch (e: any) {
          console.error("[council] Failed to persist verification:", e.message);
        }

        safeWrite(socket, reply(msg, { type: "result", ...result }));
      } catch (err: any) {
        safeWrite(socket, reply(msg, { type: "error", error: err.message }));
      }
    },

    council_history: async (socket: Socket, msg: any) => {
      if (!features?.council) {
        safeWrite(socket, reply(msg, { type: "error", error: "Council feature not enabled" }));
        return;
      }
      try {
        const { loadCouncilCache, loadVerificationCache } = await import("../../services/council-store");
        const analyses = await loadCouncilCache();
        const verifications = await loadVerificationCache();
        safeWrite(socket, reply(msg, { type: "result", ...analyses, ...verifications }));
      } catch (err: any) {
        safeWrite(socket, reply(msg, { type: "error", error: err.message }));
      }
    },
  };
}
