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
        const llmCaller = createAccountCaller(fullConfig.accounts);
        const council = new CouncilService(council_config, llmCaller);
        const analysis = await council.analyze(msg.goal, msg.context);
        safeWrite(socket, reply(msg, { type: "result", analysis }));
      } catch (err: any) {
        safeWrite(socket, reply(msg, { type: "error", error: err.message }));
      }
    },
  };
}
