import type { Socket } from "net";
import type { HandlerContext, HandlerFn } from "../handler-types";
import { getHealthStatus } from "../health";
import { loadConfig } from "../../config";

export function registerHealthHandlers(ctx: HandlerContext): Record<string, HandlerFn> {
  const { state, safeWrite, reply } = ctx;

  return {
    ping: (socket: Socket, msg: any) => {
      safeWrite(socket, reply(msg, { type: "pong" }));
    },

    health_check: (socket: Socket, msg: any) => {
      const status = getHealthStatus(state, state.startedAt);
      safeWrite(socket, reply(msg, { type: "result", ...status }));
    },

    health_status: async (socket: Socket, msg: any) => {
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
  };
}
