import type { HandlerContext, HandlerFn } from "./handler-types";
import { registerMessagingHandlers } from "./handlers/messaging";
import { registerHandoffHandlers } from "./handlers/handoff";
import { registerTaskHandlers } from "./handlers/tasks";
import { registerWorkspaceHandlers } from "./handlers/workspace";
import { registerCouncilHandlers } from "./handlers/council";
import { registerKnowledgeHandlers } from "./handlers/knowledge";
import { registerSessionHandlers } from "./handlers/sessions";
import { registerWorkflowHandlers } from "./handlers/workflow";
import { registerHealthHandlers } from "./handlers/health";
import { registerMiscHandlers } from "./handlers/misc";

export function buildHandlerMap(ctx: HandlerContext): Record<string, HandlerFn> {
  return {
    ...registerMessagingHandlers(ctx),
    ...registerHandoffHandlers(ctx),
    ...registerTaskHandlers(ctx),
    ...registerWorkspaceHandlers(ctx),
    ...registerCouncilHandlers(ctx),
    ...registerKnowledgeHandlers(ctx),
    ...registerSessionHandlers(ctx),
    ...registerWorkflowHandlers(ctx),
    ...registerHealthHandlers(ctx),
    ...registerMiscHandlers(ctx),
  };
}
