import type { Socket } from "net";
import type { HandlerContext, HandlerFn } from "../handler-types";
import { notifyMessage } from "../../services/notifications";
import { loadConfig } from "../../config";

export function registerMessagingHandlers(ctx: HandlerContext): Record<string, HandlerFn> {
  const { state, safeWrite, reply, getAccountName } = ctx;

  return {
    send_message: (socket: Socket, msg: any) => {
      const accountName = getAccountName(socket);
      if (typeof msg.to !== "string" || !msg.to) {
        safeWrite(socket, reply(msg, { type: "error", error: "Invalid field: to" }));
        return;
      }
      if (typeof msg.content !== "string" || !msg.content) {
        safeWrite(socket, reply(msg, { type: "error", error: "Invalid field: content" }));
        return;
      }
      state.addMessage({
        from: accountName,
        to: msg.to,
        type: "message",
        content: msg.content,
        timestamp: new Date().toISOString(),
      });
      notifyMessage(accountName, msg.to, msg.content).catch(e => console.error("[notify]", e.message));
      safeWrite(socket, reply(msg, { type: "result", delivered: state.isConnected(msg.to), queued: true }));
    },

    count_unread: (socket: Socket, msg: any) => {
      const accountName = getAccountName(socket);
      const count = state.countUnread(accountName);
      safeWrite(socket, reply(msg, { type: "result", count }));
    },

    read_messages: (socket: Socket, msg: any) => {
      const accountName = getAccountName(socket);
      if (msg.limit !== undefined && (!Number.isInteger(msg.limit) || msg.limit < 0)) {
        safeWrite(socket, reply(msg, { type: "error", error: "Invalid field: limit" }));
        return;
      }
      if (msg.offset !== undefined && (!Number.isInteger(msg.offset) || msg.offset < 0)) {
        safeWrite(socket, reply(msg, { type: "error", error: "Invalid field: offset" }));
        return;
      }
      const hasPagination = msg.limit !== undefined || msg.offset !== undefined;
      const messages = hasPagination
        ? state.getMessages(accountName, { limit: msg.limit as number | undefined, offset: msg.offset as number | undefined })
        : state.getUnreadMessages(accountName);
      if (!hasPagination) {
        state.markAllRead(accountName);
      }
      safeWrite(socket, reply(msg, { type: "result", messages }));
    },

    list_accounts: async (socket: Socket, msg: any) => {
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
        safeWrite(socket, reply(msg, { type: "result", accounts }));
      } catch (err: any) {
        safeWrite(socket, reply(msg, { type: "error", error: err.message }));
      }
    },

    archive_messages: (socket: Socket, msg: any) => {
      const days = msg.days ?? 7;
      if (!Number.isInteger(days) || days < 1) {
        safeWrite(socket, reply(msg, { type: "error", error: "Invalid field: days" }));
        return;
      }
      const archived = state.archiveOld(days);
      safeWrite(socket, reply(msg, { type: "result", archived }));
    },
  };
}
