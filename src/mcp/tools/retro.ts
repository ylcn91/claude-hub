import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { DaemonSender } from "../tools.js";

export function registerRetroTools(server: McpServer, sendToDaemon: DaemonSender, _account: string): void {
  server.registerTool("start_retro", {
    description: "Start a retrospective session for a workflow run. Collects reviews from participants before synthesis.",
    inputSchema: {
      workflowRunId: z.string().describe("Workflow run ID to retro on"),
      participants: z.array(z.string()).describe("List of participant account names"),
      chairman: z.string().optional().describe("Chairman account (defaults to first participant)"),
    },
  }, async (args) => {
    const result = await sendToDaemon({
      type: "retro_start_session",
      workflowRunId: args.workflowRunId,
      participants: args.participants,
      chairman: args.chairman,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  });

  server.registerTool("submit_retro_review", {
    description: "Submit a review for an active retro session. Include what went well, what didn't, and suggestions.",
    inputSchema: {
      retroId: z.string().describe("Retro session ID"),
      whatWentWell: z.array(z.string()).describe("Things that went well"),
      whatDidntWork: z.array(z.string()).describe("Things that didn't work"),
      suggestions: z.array(z.string()).describe("Suggestions for improvement"),
      agentPerformanceNotes: z.record(z.string(), z.string()).optional().describe("Per-agent performance notes"),
    },
  }, async (args) => {
    const result = await sendToDaemon({
      type: "retro_submit_review",
      retroId: args.retroId,
      whatWentWell: args.whatWentWell,
      whatDidntWork: args.whatDidntWork,
      suggestions: args.suggestions,
      agentPerformanceNotes: args.agentPerformanceNotes,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  });

  server.registerTool("submit_retro_synthesis", {
    description: "Submit the final synthesized retro document (typically done by the chairman after aggregation).",
    inputSchema: {
      retroId: z.string().describe("Retro session ID"),
      document: z.any().describe("Synthesized retro document"),
    },
  }, async (args) => {
    const result = await sendToDaemon({
      type: "retro_submit_synthesis",
      retroId: args.retroId,
      document: args.document,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  });

  server.registerTool("retro_status", {
    description: "Get the status of a retro session and its synthesized document if available.",
    inputSchema: {
      retroId: z.string().describe("Retro session ID"),
    },
  }, async (args) => {
    const result = await sendToDaemon({
      type: "retro_status",
      retroId: args.retroId,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  });

  server.registerTool("get_past_learnings", {
    description: "Get learnings from past retrospectives via meta-learning knowledge index.",
  }, async () => {
    const result = await sendToDaemon({ type: "retro_get_past_learnings" });
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  });
}
