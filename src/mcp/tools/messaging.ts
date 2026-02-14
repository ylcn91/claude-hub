import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { sanitizeMCPText } from "../../services/input-sanitizer.js";
import type { DaemonSender } from "../tools.js";

export function registerMessagingTools(server: McpServer, sendToDaemon: DaemonSender, account: string): void {
  server.registerTool("send_message", {
    description: "Send a message to another Claude Code account",
    inputSchema: {
      to: z.string().describe("Target account name"),
      message: z.string().describe("Message content"),
    },
  }, async (args) => {
    const { sanitized, warnings } = sanitizeMCPText(args.message);
    const result = await sendToDaemon({
      type: "send_message",
      to: args.to,
      content: sanitized,
    });
    const response: any = { ...result };
    if (warnings.length > 0) response.sanitizationWarnings = warnings;
    return { content: [{ type: "text" as const, text: JSON.stringify(response) }] };
  });

  server.registerTool("read_messages", {
    description: "Read unread messages from other accounts",
    inputSchema: {
      limit: z.number().optional().describe("Max messages to return (default 50)"),
      offset: z.number().optional().describe("Offset for pagination"),
    },
  }, async (args) => {
    const result = await sendToDaemon({ type: "read_messages", limit: args.limit, offset: args.offset });
    return { content: [{ type: "text" as const, text: JSON.stringify(result.messages ?? []) }] };
  });

  server.registerTool("list_accounts", {
    description: "List all registered accounts with their connection status (active/inactive)",
  }, async () => {
    const result = await sendToDaemon({ type: "list_accounts" });
    return { content: [{ type: "text" as const, text: JSON.stringify(result.accounts ?? []) }] };
  });

  server.registerTool("copy_context", {
    description: "Copy context/content to the shared clipboard for other accounts to access",
    inputSchema: {
      content: z.string().describe("Content to copy"),
      label: z.string().optional().describe("Optional label for the clipboard entry"),
    },
  }, async (args) => {
    const contentSan = sanitizeMCPText(args.content);
    const warnings = [...contentSan.warnings];
    const { copyToClipboard } = await import("../../services/clipboard.js");
    const entry = await copyToClipboard(account, contentSan.sanitized, args.label);
    const response: any = { copied: true, id: entry.id };
    if (warnings.length > 0) response.sanitizationWarnings = warnings;
    return { content: [{ type: "text" as const, text: JSON.stringify(response) }] };
  });

  server.registerTool("paste_context", {
    description: "Get the most recent content from the shared clipboard",
    inputSchema: {
      count: z.number().optional().describe("Number of entries to retrieve (default 1)"),
    },
  }, async (args) => {
    const { pasteFromClipboard } = await import("../../services/clipboard.js");
    const entries = await pasteFromClipboard(args.count);
    return { content: [{ type: "text" as const, text: JSON.stringify(entries) }] };
  });

  server.registerTool("count_unread", {
    description: "Get count of unread messages without marking them as read",
  }, async () => {
    const result = await sendToDaemon({ type: "count_unread" });
    return { content: [{ type: "text" as const, text: JSON.stringify({ count: result.count ?? 0 }) }] };
  });

  server.registerTool("archive_messages", {
    description: "Archive old read messages (older than specified days)",
    inputSchema: {
      days: z.number().optional().describe("Days old to archive (default 7)"),
    },
  }, async (args) => {
    const result = await sendToDaemon({ type: "archive_messages", days: args.days ?? 7 });
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  });
}
