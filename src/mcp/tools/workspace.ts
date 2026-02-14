import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { DaemonSender } from "../tools.js";

export function registerWorkspaceTools(server: McpServer, sendToDaemon: DaemonSender, _account: string): void {
  server.registerTool("prepare_workspace", {
    description: "Create an isolated git worktree workspace for a task. Idempotent — returns existing workspace if one already exists for the same repo+branch.",
    inputSchema: {
      repoPath: z.string().describe("Absolute path to the git repository"),
      branch: z.string().describe("Git branch name for the worktree"),
      handoffId: z.string().optional().describe("Associated handoff ID"),
    },
  }, async (args) => {
    const result = await sendToDaemon({
      type: "prepare_worktree_for_handoff",
      repoPath: args.repoPath,
      branch: args.branch,
      handoffId: args.handoffId,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  });

  server.registerTool("get_workspace_status", {
    description: "Get the status of a workspace by ID or by repo+branch key",
    inputSchema: {
      id: z.string().optional().describe("Workspace ID"),
      repoPath: z.string().optional().describe("Repository path (use with branch)"),
      branch: z.string().optional().describe("Branch name (use with repoPath)"),
    },
  }, async (args) => {
    const result = await sendToDaemon({
      type: "get_workspace_status",
      id: args.id,
      repoPath: args.repoPath,
      branch: args.branch,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  });

  server.registerTool("cleanup_workspace", {
    description: "Remove a git worktree workspace and clean up associated resources",
    inputSchema: {
      id: z.string().describe("Workspace ID to clean up"),
    },
  }, async (args) => {
    const result = await sendToDaemon({
      type: "cleanup_workspace",
      id: args.id,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  });
}
