import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { DaemonSender } from "../tools.js";

export function registerSearchTools(server: McpServer, sendToDaemon: DaemonSender, _account: string): void {
  server.registerTool("search_across_accounts", {
    description: "Search for a pattern across all account working directories using ripgrep. Results are grouped by account.",
    inputSchema: {
      pattern: z.string().describe("Search pattern (regex supported)"),
      accounts: z.array(z.string()).optional().describe("Limit search to specific accounts"),
      maxResults: z.number().optional().describe("Maximum results to return (default 100)"),
    },
  }, async (args) => {
    const result = await sendToDaemon({
      type: "search_code",
      pattern: args.pattern,
      targets: args.accounts,
      maxResults: args.maxResults,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  });
}
