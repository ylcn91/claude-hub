import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { sanitizeMCPText } from "../../services/input-sanitizer.js";
import type { DaemonSender } from "../tools.js";

export function registerPromptTools(server: McpServer, _sendToDaemon: DaemonSender, _account: string): void {
  server.registerTool("save_prompt", {
    description: "Save a prompt to the prompt library for reuse",
    inputSchema: {
      title: z.string().describe("Prompt title"),
      content: z.string().describe("Prompt content"),
      tags: z.array(z.string()).optional().describe("Tags for categorization"),
    },
  }, async (args) => {
    const titleSan = sanitizeMCPText(args.title, 500);
    const contentSan = sanitizeMCPText(args.content);
    const warnings = [...titleSan.warnings, ...contentSan.warnings];
    const { savePrompt } = await import("../../services/prompt-library.js");
    const prompt = await savePrompt({ title: titleSan.sanitized, content: contentSan.sanitized, tags: args.tags });
    const response: any = { ...prompt };
    if (warnings.length > 0) response.sanitizationWarnings = warnings;
    return { content: [{ type: "text" as const, text: JSON.stringify(response) }] };
  });

  server.registerTool("list_prompts", {
    description: "List or search prompts in the prompt library",
    inputSchema: {
      query: z.string().optional().describe("Search query (filters by title and tags)"),
    },
  }, async (args) => {
    if (args.query) {
      const { searchPrompts } = await import("../../services/prompt-library.js");
      const results = await searchPrompts(args.query);
      return { content: [{ type: "text" as const, text: JSON.stringify(results) }] };
    }
    const { loadPrompts } = await import("../../services/prompt-library.js");
    const prompts = await loadPrompts();
    return { content: [{ type: "text" as const, text: JSON.stringify(prompts) }] };
  });

  server.registerTool("use_prompt", {
    description: "Retrieve a prompt by ID from the library (increments usage count)",
    inputSchema: {
      id: z.string().describe("Prompt ID"),
    },
  }, async (args) => {
    const { getPrompt } = await import("../../services/prompt-library.js");
    const prompt = await getPrompt(args.id);
    if (!prompt) {
      return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Prompt not found" }) }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(prompt) }] };
  });
}
