import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { DaemonSender } from "../tools.js";

export function registerHealthTools(server: McpServer, sendToDaemon: DaemonSender, _account: string): void {
  server.registerTool("daemon_health", {
    description: "Get daemon health status: uptime, connections, memory usage, store status",
  }, async () => {
    const result = await sendToDaemon({ type: "health_check" });
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  });

  server.registerTool("check_account_health", {
    description: "Check health status of all accounts or a specific account. Shows connection status, last activity, error counts, and rate limit status.",
    inputSchema: {
      account: z.string().optional().describe("Specific account to check (omit for all)"),
    },
  }, async (args) => {
    const result = await sendToDaemon({ type: "health_status", account: args.account });
    if (args.account && result.accounts) {
      const filtered = result.accounts.filter((a: any) => a.name === args.account);
      return { content: [{ type: "text" as const, text: JSON.stringify(filtered) }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  });
}
