import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { sanitizeMCPText } from "../../services/input-sanitizer.js";
import type { DaemonSender } from "../tools.js";

export function registerSessionTools(server: McpServer, sendToDaemon: DaemonSender, _account: string): void {
  server.registerTool("share_session", {
    description: "Start a live pair-programming session with another account. The target account must join using join_session.",
    inputSchema: {
      target: z.string().describe("Target account to pair with"),
      workspace: z.string().optional().describe("Workspace or project path"),
    },
  }, async (args) => {
    const result = await sendToDaemon({
      type: "share_session",
      target: args.target,
      workspace: args.workspace,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  });

  server.registerTool("join_session", {
    description: "Accept an invitation and join a live pair-programming session",
    inputSchema: {
      sessionId: z.string().describe("Session ID to join"),
    },
  }, async (args) => {
    const result = await sendToDaemon({
      type: "join_session",
      sessionId: args.sessionId,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  });

  server.registerTool("session_broadcast", {
    description: "Send an update to the other participant in a live session (file changes, messages, context)",
    inputSchema: {
      sessionId: z.string().describe("Session ID"),
      data: z.record(z.string(), z.unknown()).describe("Update data to broadcast"),
    },
  }, async (args) => {
    // Sanitize string values in broadcast data
    const warnings: string[] = [];
    const sanitizedData: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(args.data)) {
      if (typeof value === "string") {
        const s = sanitizeMCPText(value);
        sanitizedData[key] = s.sanitized;
        warnings.push(...s.warnings);
      } else {
        sanitizedData[key] = value;
      }
    }
    const result = await sendToDaemon({
      type: "session_broadcast",
      sessionId: args.sessionId,
      data: sanitizedData,
    });
    const response: any = { ...result };
    if (warnings.length > 0) response.sanitizationWarnings = warnings;
    return { content: [{ type: "text" as const, text: JSON.stringify(response) }] };
  });

  server.registerTool("session_status", {
    description: "Check the status of a live session. If no sessionId is provided, returns the active session for the current account.",
    inputSchema: {
      sessionId: z.string().optional().describe("Session ID (optional, defaults to active session)"),
    },
  }, async (args) => {
    const result = await sendToDaemon({
      type: "session_status",
      sessionId: args.sessionId,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  });

  server.registerTool("session_history", {
    description: "Get recent unread updates from a live session",
    inputSchema: {
      sessionId: z.string().describe("Session ID"),
    },
  }, async (args) => {
    const result = await sendToDaemon({
      type: "session_history",
      sessionId: args.sessionId,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  });

  server.registerTool("leave_session", {
    description: "End participation in a live pair-programming session",
    inputSchema: {
      sessionId: z.string().describe("Session ID to leave"),
    },
  }, async (args) => {
    const result = await sendToDaemon({
      type: "leave_session",
      sessionId: args.sessionId,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  });

  server.registerTool("name_session", {
    description: "Name or rename a session for easy identification and future search",
    inputSchema: {
      sessionId: z.string().describe("Session ID to name"),
      name: z.string().describe("Human-readable name for the session"),
      tags: z.array(z.string()).optional().describe("Tags for categorization"),
      notes: z.string().optional().describe("Optional notes about the session"),
    },
  }, async (args) => {
    const nameSan = sanitizeMCPText(args.name, 200);
    const warnings = [...nameSan.warnings];
    let notes = args.notes;
    if (notes) {
      const notesSan = sanitizeMCPText(notes, 2_000);
      notes = notesSan.sanitized;
      warnings.push(...notesSan.warnings);
    }
    const result = await sendToDaemon({
      type: "name_session",
      sessionId: args.sessionId,
      name: nameSan.sanitized,
      tags: args.tags,
      notes,
    });
    const response: any = { ...result };
    if (warnings.length > 0) response.sanitizationWarnings = warnings;
    return { content: [{ type: "text" as const, text: JSON.stringify(response) }] };
  });

  server.registerTool("list_named_sessions", {
    description: "List named sessions, optionally filtered by account",
    inputSchema: {
      account: z.string().optional().describe("Filter by account name"),
      limit: z.number().optional().describe("Max results (default 50)"),
      offset: z.number().optional().describe("Offset for pagination"),
    },
  }, async (args) => {
    const result = await sendToDaemon({
      type: "list_sessions",
      account: args.account,
      limit: args.limit,
      offset: args.offset,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  });

  server.registerTool("search_sessions", {
    description: "Full-text search across named sessions by name, tags, notes, or account",
    inputSchema: {
      query: z.string().describe("Search query"),
      limit: z.number().optional().describe("Max results (default 20)"),
    },
  }, async (args) => {
    const result = await sendToDaemon({
      type: "search_sessions",
      query: args.query,
      limit: args.limit,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  });
}
