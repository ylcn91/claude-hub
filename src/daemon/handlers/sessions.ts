import type { Socket } from "net";
import type { HandlerContext, HandlerFn } from "../handler-types";

export function registerSessionHandlers(ctx: HandlerContext): Record<string, HandlerFn> {
  const { state, safeWrite, reply, getAccountName } = ctx;

  return {
    share_session: (socket: Socket, msg: any) => {
      const accountName = getAccountName(socket);
      if (typeof msg.target !== "string" || !msg.target) {
        safeWrite(socket, reply(msg, { type: "error", error: "Invalid field: target" }));
        return;
      }
      // M4: Prevent self-pairing
      if (msg.target === accountName) {
        safeWrite(socket, reply(msg, { type: "error", error: "Cannot create session with yourself" }));
        return;
      }
      // m5: Validate target account is connected
      if (!state.isConnected(msg.target)) {
        safeWrite(socket, reply(msg, { type: "error", error: "Target account is not connected" }));
        return;
      }
      const session = state.sharedSessionManager.createSession(accountName, msg.target, msg.workspace ?? "");
      safeWrite(socket, reply(msg, { type: "result", session }));
    },

    join_session: (socket: Socket, msg: any) => {
      const accountName = getAccountName(socket);
      if (typeof msg.sessionId !== "string" || !msg.sessionId) {
        safeWrite(socket, reply(msg, { type: "error", error: "Invalid field: sessionId" }));
        return;
      }
      const success = state.sharedSessionManager.joinSession(msg.sessionId, accountName);
      safeWrite(socket, reply(msg, { type: "result", success }));
    },

    session_broadcast: (socket: Socket, msg: any) => {
      const accountName = getAccountName(socket);
      if (typeof msg.sessionId !== "string" || !msg.sessionId) {
        safeWrite(socket, reply(msg, { type: "error", error: "Invalid field: sessionId" }));
        return;
      }
      // C1: Verify membership before broadcast
      if (!state.sharedSessionManager.isMember(msg.sessionId, accountName)) {
        safeWrite(socket, reply(msg, { type: "error", error: "Not a member of this session" }));
        return;
      }
      // M6: Use return value from addUpdate to report accurate sent status
      const sent = state.sharedSessionManager.addUpdate(msg.sessionId, accountName, msg.data);
      safeWrite(socket, reply(msg, { type: "result", sent }));
    },

    session_status: (socket: Socket, msg: any) => {
      const accountName = getAccountName(socket);
      if (msg.sessionId) {
        // C1: Verify membership before returning session status
        if (!state.sharedSessionManager.isMember(msg.sessionId, accountName)) {
          safeWrite(socket, reply(msg, { type: "error", error: "Not a member of this session" }));
          return;
        }
        const session = state.sharedSessionManager.getSession(msg.sessionId);
        safeWrite(socket, reply(msg, { type: "result", session }));
      } else {
        // M5: Return all active sessions for the account
        const sessions = state.sharedSessionManager.getActiveSessionsForAccount(accountName);
        safeWrite(socket, reply(msg, { type: "result", session: sessions[0] ?? null, sessions }));
      }
    },

    session_history: (socket: Socket, msg: any) => {
      const accountName = getAccountName(socket);
      if (typeof msg.sessionId !== "string" || !msg.sessionId) {
        safeWrite(socket, reply(msg, { type: "error", error: "Invalid field: sessionId" }));
        return;
      }
      // C1: Verify membership before returning history
      if (!state.sharedSessionManager.isMember(msg.sessionId, accountName)) {
        safeWrite(socket, reply(msg, { type: "error", error: "Not a member of this session" }));
        return;
      }
      const updates = state.sharedSessionManager.getUpdates(msg.sessionId, accountName);
      safeWrite(socket, reply(msg, { type: "result", updates }));
    },

    leave_session: (socket: Socket, msg: any) => {
      const accountName = getAccountName(socket);
      if (typeof msg.sessionId !== "string" || !msg.sessionId) {
        safeWrite(socket, reply(msg, { type: "error", error: "Invalid field: sessionId" }));
        return;
      }
      // C1: Membership is verified inside endSession
      // m4: endSession returns boolean - reflect reality in response
      const ended = state.sharedSessionManager.endSession(msg.sessionId, accountName);
      safeWrite(socket, reply(msg, { type: "result", ended }));
    },

    session_ping: (socket: Socket, msg: any) => {
      const accountName = getAccountName(socket);
      if (typeof msg.sessionId !== "string" || !msg.sessionId) {
        safeWrite(socket, reply(msg, { type: "error", error: "Invalid field: sessionId" }));
        return;
      }
      // C1 + C3: Verify membership before recording ping
      if (!state.sharedSessionManager.isMember(msg.sessionId, accountName)) {
        safeWrite(socket, reply(msg, { type: "error", error: "Not a member of this session" }));
        return;
      }
      const pinged = state.sharedSessionManager.recordPing(msg.sessionId, accountName);
      safeWrite(socket, reply(msg, { type: "result", pinged }));
    },

    name_session: (socket: Socket, msg: any) => {
      const accountName = getAccountName(socket);
      if (!state.sessionStore) {
        safeWrite(socket, reply(msg, { type: "error", error: "Sessions feature not enabled" }));
        return;
      }
      if (typeof msg.sessionId !== "string" || !msg.sessionId) {
        safeWrite(socket, reply(msg, { type: "error", error: "Invalid field: sessionId" }));
        return;
      }
      if (typeof msg.name !== "string" || !msg.name) {
        safeWrite(socket, reply(msg, { type: "error", error: "Invalid field: name" }));
        return;
      }
      const session = state.sessionStore.nameSession(msg.sessionId, msg.name, {
        account: msg.account ?? accountName,
        tags: msg.tags,
        notes: msg.notes,
      });
      safeWrite(socket, reply(msg, { type: "result", session }));
    },

    list_sessions: (socket: Socket, msg: any) => {
      if (!state.sessionStore) {
        safeWrite(socket, reply(msg, { type: "error", error: "Sessions feature not enabled" }));
        return;
      }
      if (msg.limit !== undefined && (!Number.isInteger(msg.limit) || msg.limit < 0)) {
        safeWrite(socket, reply(msg, { type: "error", error: "Invalid limit" }));
        return;
      }
      if (msg.offset !== undefined && (!Number.isInteger(msg.offset) || msg.offset < 0)) {
        safeWrite(socket, reply(msg, { type: "error", error: "Invalid offset" }));
        return;
      }
      const sessions = state.sessionStore.list({
        account: msg.account,
        limit: msg.limit,
        offset: msg.offset,
      });
      safeWrite(socket, reply(msg, { type: "result", sessions }));
    },

    search_sessions: (socket: Socket, msg: any) => {
      if (!state.sessionStore) {
        safeWrite(socket, reply(msg, { type: "error", error: "Sessions feature not enabled" }));
        return;
      }
      if (typeof msg.query !== "string" || !msg.query) {
        safeWrite(socket, reply(msg, { type: "error", error: "Invalid field: query" }));
        return;
      }
      if (msg.limit !== undefined && (!Number.isInteger(msg.limit) || msg.limit < 0)) {
        safeWrite(socket, reply(msg, { type: "error", error: "Invalid limit" }));
        return;
      }
      const results = state.sessionStore.search(msg.query, msg.limit);
      safeWrite(socket, reply(msg, { type: "result", results }));
    },
  };
}
