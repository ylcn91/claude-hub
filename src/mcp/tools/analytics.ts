import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { DaemonSender } from "../tools.js";

export function registerAnalyticsTools(server: McpServer, sendToDaemon: DaemonSender, _account: string): void {
  server.registerTool("get_analytics", {
    description: "Get operational analytics: cycle times, accept/reject ratios, per-account productivity, SLA violations",
    inputSchema: {
      fromDate: z.string().optional().describe("Start date (ISO format)"),
      toDate: z.string().optional().describe("End date (ISO format)"),
    },
  }, async (args) => {
    const result = await sendToDaemon({
      type: "get_analytics",
      fromDate: args.fromDate,
      toDate: args.toDate,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  });
}
