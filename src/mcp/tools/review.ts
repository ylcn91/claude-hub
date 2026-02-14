import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { DaemonSender } from "../tools.js";

export function registerReviewTools(server: McpServer, sendToDaemon: DaemonSender, _account: string): void {
  server.registerTool("get_review_bundle", {
    description: "Get the review bundle for a task (diff summary, test results, risk notes)",
    inputSchema: {
      taskId: z.string().describe("Task ID"),
    },
  }, async (args) => {
    const result = await sendToDaemon({ type: "get_review_bundle", taskId: args.taskId });
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  });

  server.registerTool("generate_review_bundle", {
    description: "Generate a review bundle for a task with git diff analysis, optional test execution, and risk assessment",
    inputSchema: {
      taskId: z.string().describe("Task ID"),
      workDir: z.string().describe("Working directory path"),
      branch: z.string().describe("Branch to review"),
      baseBranch: z.string().optional().describe("Base branch (default: main)"),
      runCommands: z.array(z.string()).optional().describe("Commands to run for testing"),
    },
  }, async (args) => {
    const result = await sendToDaemon({
      type: "generate_review_bundle",
      taskId: args.taskId,
      workDir: args.workDir,
      branch: args.branch,
      baseBranch: args.baseBranch,
      runCommands: args.runCommands,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  });
}
