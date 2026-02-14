import type { Socket } from "net";
import type { HandlerContext, HandlerFn } from "../handler-types";

export function registerKnowledgeHandlers(ctx: HandlerContext): Record<string, HandlerFn> {
  const { state, safeWrite, reply, getAccountName } = ctx;

  return {
    search_knowledge: (socket: Socket, msg: any) => {
      if (!state.knowledgeStore) {
        safeWrite(socket, reply(msg, { type: "error", error: "Knowledge index not enabled" }));
        return;
      }
      const results = state.knowledgeStore.search(msg.query, msg.category, msg.limit);
      safeWrite(socket, reply(msg, { type: "result", results }));
    },

    index_note: (socket: Socket, msg: any) => {
      const accountName = getAccountName(socket);
      if (!state.knowledgeStore) {
        safeWrite(socket, reply(msg, { type: "error", error: "Knowledge index not enabled" }));
        return;
      }
      const entry = state.knowledgeStore.index({
        category: msg.category ?? "decision_note",
        title: msg.title,
        content: msg.content,
        tags: msg.tags ?? [],
        accountName: accountName,
      });
      safeWrite(socket, reply(msg, { type: "result", entry }));
    },
  };
}
