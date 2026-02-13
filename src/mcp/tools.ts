import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export type DaemonSender = (msg: object) => Promise<any>;

export function registerTools(server: McpServer, sendToDaemon: DaemonSender, account: string): void {
  server.registerTool("send_message", {
    description: "Send a message to another Claude Code account",
    inputSchema: {
      to: z.string().describe("Target account name"),
      message: z.string().describe("Message content"),
    },
  }, async (args) => {
    const result = await sendToDaemon({
      type: "send_message",
      to: args.to,
      content: args.message,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  });

  server.registerTool("read_messages", {
    description: "Read unread messages from other accounts",
  }, async () => {
    const result = await sendToDaemon({ type: "read_messages" });
    return { content: [{ type: "text" as const, text: JSON.stringify(result.messages ?? []) }] };
  });

  server.registerTool("list_accounts", {
    description: "List all registered accounts and their status",
  }, async () => {
    const result = await sendToDaemon({ type: "list_accounts" });
    return { content: [{ type: "text" as const, text: JSON.stringify(result.accounts ?? []) }] };
  });

  server.registerTool("handoff_task", {
    description: "Hand off a task to another Claude Code account with context (branch, project dir, notes). The task is persisted and delivered when the target account connects.",
    inputSchema: {
      to: z.string().describe("Target account name"),
      task: z.string().describe("Task description"),
      branch: z.string().optional().describe("Git branch for context"),
      projectDir: z.string().optional().describe("Project directory path"),
      notes: z.string().optional().describe("Additional notes or context"),
    },
  }, async (args) => {
    const context: Record<string, string> = {};
    if (args.branch) context.branch = args.branch;
    if (args.projectDir) context.projectDir = args.projectDir;
    if (args.notes) context.notes = args.notes;

    const result = await sendToDaemon({
      type: "handoff_task",
      to: args.to,
      task: args.task,
      context,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  });
}
