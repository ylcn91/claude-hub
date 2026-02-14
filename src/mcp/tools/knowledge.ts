import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { sanitizeMCPText } from "../../services/input-sanitizer.js";
import type { DaemonSender } from "../tools.js";

export function registerKnowledgeTools(server: McpServer, sendToDaemon: DaemonSender, _account: string): void {
  server.registerTool("search_knowledge", {
    description: "Search the knowledge index for prompts, handoffs, task events, and notes using full-text search",
    inputSchema: {
      query: z.string().describe("Search query"),
      category: z.enum(["prompt", "handoff", "task_event", "decision_note", "message"]).optional().describe("Filter by category"),
      limit: z.number().optional().describe("Max results (default 20)"),
    },
  }, async (args) => {
    const result = await sendToDaemon({
      type: "search_knowledge",
      query: args.query,
      category: args.category,
      limit: args.limit,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  });

  server.registerTool("index_note", {
    description: "Index a note or decision in the knowledge base for future search",
    inputSchema: {
      title: z.string().describe("Note title"),
      content: z.string().describe("Note content"),
      tags: z.array(z.string()).optional().describe("Tags for categorization"),
      category: z.enum(["prompt", "handoff", "task_event", "decision_note", "message"]).optional().describe("Category (default: decision_note)"),
    },
  }, async (args) => {
    const titleSan = sanitizeMCPText(args.title, 500);
    const contentSan = sanitizeMCPText(args.content);
    const warnings = [...titleSan.warnings, ...contentSan.warnings];
    const result = await sendToDaemon({
      type: "index_note",
      title: titleSan.sanitized,
      content: contentSan.sanitized,
      tags: args.tags,
      category: args.category,
    });
    const response: any = { ...result };
    if (warnings.length > 0) response.sanitizationWarnings = warnings;
    return { content: [{ type: "text" as const, text: JSON.stringify(response) }] };
  });
}
