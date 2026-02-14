import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerMessagingTools } from "./tools/messaging.js";
import { registerHandoffTools } from "./tools/handoff.js";
import { registerTaskTools } from "./tools/tasks.js";
import { registerWorkspaceTools } from "./tools/workspace.js";
import { registerPromptTools } from "./tools/prompts.js";
import { registerGithubTools } from "./tools/github.js";
import { registerReviewTools } from "./tools/review.js";
import { registerKnowledgeTools } from "./tools/knowledge.js";
import { registerAnalyticsTools } from "./tools/analytics.js";
import { registerWorkflowTools } from "./tools/workflow.js";
import { registerRetroTools } from "./tools/retro.js";
import { registerHealthTools } from "./tools/health.js";
import { registerSessionTools } from "./tools/sessions.js";
import { registerSearchTools } from "./tools/search.js";

export type DaemonSender = (msg: object) => Promise<any>;

export function registerTools(server: McpServer, sendToDaemon: DaemonSender, account: string): void {
  registerMessagingTools(server, sendToDaemon, account);
  registerHandoffTools(server, sendToDaemon, account);
  registerTaskTools(server, sendToDaemon, account);
  registerWorkspaceTools(server, sendToDaemon, account);
  registerPromptTools(server, sendToDaemon, account);
  registerGithubTools(server, sendToDaemon, account);
  registerReviewTools(server, sendToDaemon, account);
  registerKnowledgeTools(server, sendToDaemon, account);
  registerAnalyticsTools(server, sendToDaemon, account);
  registerWorkflowTools(server, sendToDaemon, account);
  registerRetroTools(server, sendToDaemon, account);
  registerHealthTools(server, sendToDaemon, account);
  registerSessionTools(server, sendToDaemon, account);
  registerSearchTools(server, sendToDaemon, account);
}
