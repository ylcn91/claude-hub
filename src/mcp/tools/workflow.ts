import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { DaemonSender } from "../tools.js";

export function registerWorkflowTools(server: McpServer, sendToDaemon: DaemonSender, _account: string): void {
  server.registerTool("trigger_workflow", {
    description: "Trigger a workflow by name. Loads YAML definition from workflows directory and starts DAG execution.",
    inputSchema: {
      workflowName: z.string().describe("Name of the workflow to trigger"),
      context: z.string().optional().describe("Trigger context string"),
    },
  }, async (args) => {
    const result = await sendToDaemon({
      type: "workflow_trigger",
      workflowName: args.workflowName,
      context: args.context,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  });

  server.registerTool("workflow_status", {
    description: "Get the status of a workflow run including all step statuses",
    inputSchema: {
      runId: z.string().describe("Workflow run ID"),
    },
  }, async (args) => {
    const result = await sendToDaemon({
      type: "workflow_status",
      runId: args.runId,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  });

  server.registerTool("list_workflows", {
    description: "List all available workflow definitions from the workflows directory",
  }, async () => {
    const result = await sendToDaemon({ type: "workflow_list" });
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  });

  server.registerTool("cancel_workflow", {
    description: "Cancel a running workflow. All pending/assigned steps will be skipped.",
    inputSchema: {
      runId: z.string().describe("Workflow run ID to cancel"),
    },
  }, async (args) => {
    const result = await sendToDaemon({
      type: "workflow_cancel",
      runId: args.runId,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  });
}
