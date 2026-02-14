import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { DaemonSender } from "../tools.js";

export function registerGithubTools(server: McpServer, sendToDaemon: DaemonSender, _account: string): void {
  server.registerTool("link_to_github", {
    description: "Link a task to a GitHub issue or PR for automated status sync",
    inputSchema: {
      taskId: z.string().describe("Task ID to link"),
      url: z.string().describe("GitHub issue or PR URL"),
      externalId: z.string().describe("External ID in format 'owner/repo#123'"),
      linkType: z.enum(["issue", "pr"]).describe("Link type: issue or PR"),
    },
  }, async (args) => {
    const result = await sendToDaemon({
      type: "link_task",
      taskId: args.taskId,
      url: args.url,
      externalId: args.externalId,
      linkType: args.linkType,
      provider: "github",
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  });

  server.registerTool("get_task_links", {
    description: "Get all external links (GitHub issues/PRs) for a task",
    inputSchema: {
      taskId: z.string().describe("Task ID"),
    },
  }, async (args) => {
    const result = await sendToDaemon({ type: "get_task_links", taskId: args.taskId });
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  });

  server.registerTool("sync_github_status", {
    description: "Get the current status of a linked GitHub issue",
    inputSchema: {
      owner: z.string().describe("Repository owner"),
      repo: z.string().describe("Repository name"),
      issueNumber: z.number().describe("Issue or PR number"),
    },
  }, async (args) => {
    const { getIssueStatus } = await import("../../integrations/github.js");
    const status = await getIssueStatus({
      owner: args.owner,
      repo: args.repo,
      issueNumber: args.issueNumber,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(status) }] };
  });
}
