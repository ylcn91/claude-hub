import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { sanitizeMCPText } from "../../services/input-sanitizer.js";
import type { DaemonSender } from "../tools.js";

export function registerTaskTools(server: McpServer, sendToDaemon: DaemonSender, account: string): void {
  server.registerTool("update_task_status", {
    description: "Update a task's status following lifecycle rules (todo→in_progress→ready_for_review→accepted/rejected). When submitting for review, include workspace info to enable auto-acceptance.",
    inputSchema: {
      taskId: z.string().describe("Task ID"),
      status: z.enum(["todo", "in_progress", "ready_for_review", "accepted", "rejected"]).describe("New status"),
      reason: z.string().optional().describe("Required reason when rejecting"),
      workspacePath: z.string().optional().describe("Workspace path (for ready_for_review)"),
      branch: z.string().optional().describe("Branch name (for ready_for_review)"),
      workspaceId: z.string().optional().describe("Workspace ID (for ready_for_review)"),
    },
  }, async (args) => {
    let reason = args.reason;
    const warnings: string[] = [];
    if (reason) {
      const s = sanitizeMCPText(reason);
      reason = s.sanitized;
      warnings.push(...s.warnings);
    }
    const result = await sendToDaemon({
      type: "update_task_status",
      taskId: args.taskId,
      status: args.status,
      reason,
      workspacePath: args.workspacePath,
      branch: args.branch,
      workspaceId: args.workspaceId,
    });
    const response: any = { ...result };
    if (warnings.length > 0) response.sanitizationWarnings = warnings;
    return { content: [{ type: "text" as const, text: JSON.stringify(response) }] };
  });

  server.registerTool("report_progress", {
    description: "Report intermediate progress on a task. Enables proactive SLA monitoring and behind-schedule detection.",
    inputSchema: {
      taskId: z.string().describe("Task ID"),
      percent: z.number().min(0).max(100).describe("Completion percentage (0-100)"),
      currentStep: z.string().describe('What you are doing now (e.g. "running tests")'),
      blockers: z.array(z.string()).optional().describe("Current blockers, if any"),
      estimatedRemainingMinutes: z.number().optional().describe("Estimated minutes remaining"),
      artifactsProduced: z.array(z.string()).optional().describe("Files created/modified so far"),
    },
  }, async (args) => {
    const result = await sendToDaemon({
      type: "report_progress",
      taskId: args.taskId,
      agent: account,
      percent: args.percent,
      currentStep: args.currentStep,
      blockers: args.blockers,
      estimatedRemainingMinutes: args.estimatedRemainingMinutes,
      artifactsProduced: args.artifactsProduced,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  });

  server.registerTool("analyze_task", {
    description: "Run multi-model council analysis on a task before delegation. Returns complexity assessment, recommended approach, required skills, and best-fit provider.",
    inputSchema: {
      goal: z.string().describe("Task goal to analyze"),
      context: z.string().optional().describe("Additional context about the task"),
    },
  }, async (args) => {
    const result = await sendToDaemon({
      type: "council_analyze",
      goal: args.goal,
      context: args.context,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  });

  server.registerTool("check_sla", {
    description: "Manually check for stale tasks that violate SLA thresholds. Returns escalation recommendations.",
  }, async () => {
    const { loadTasks } = await import("../../services/tasks.js");
    const { checkStaleTasks, DEFAULT_SLA_CONFIG } = await import("../../services/sla-engine.js");
    const board = await loadTasks();
    const escalations = checkStaleTasks(board.tasks, DEFAULT_SLA_CONFIG);
    return { content: [{ type: "text" as const, text: JSON.stringify(escalations) }] };
  });

  server.registerTool("check_adaptive_sla", {
    description: "Run adaptive SLA check with graduated responses. Returns actionable recommendations (ping, reassign, quarantine, escalate) based on task criticality and progress.",
  }, async () => {
    const result = await sendToDaemon({ type: "adaptive_sla_check" });
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  });

  server.registerTool("verify_task", {
    description: "Run multi-LLM council verification on a completed task. Multiple models independently review the diff against goal and acceptance criteria, then a chairman produces a final verdict (ACCEPT/REJECT/ACCEPT_WITH_NOTES). Feature gated on council.",
    inputSchema: {
      taskId: z.string().describe("Task ID to verify"),
      goal: z.string().describe("Task goal"),
      acceptance_criteria: z.array(z.string()).describe("Acceptance criteria to verify against"),
      diff: z.string().optional().describe("Git diff of changes"),
      testResults: z.string().optional().describe("Test execution results"),
      filesChanged: z.array(z.string()).optional().describe("List of changed files"),
      riskNotes: z.array(z.string()).optional().describe("Risk assessment notes"),
    },
  }, async (args) => {
    // Feature gate: council must be enabled
    const { loadConfig } = await import("../../config.js");
    const config = await loadConfig();
    if (!config.features?.council) {
      return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Council feature is not enabled. Set features.council = true in config." }) }] };
    }

    const { verifyTaskCompletion } = await import("../../services/verification-council.js");
    const { createAccountCaller } = await import("../../services/council.js");

    const llmCaller = createAccountCaller(config.accounts);

    const result = await verifyTaskCompletion(
      args.taskId,
      {
        diff: args.diff,
        testResults: args.testResults,
        filesChanged: args.filesChanged,
        riskNotes: args.riskNotes,
      },
      {
        goal: args.goal,
        acceptance_criteria: args.acceptance_criteria,
      },
      {
        members: config.council?.members,
        chairman: config.council?.chairman,
        llmCaller,
      },
    );

    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  });

  server.registerTool("get_trust_scores", {
    description: "Get trust and reputation scores for all agents or a specific agent. Shows completion rate, SLA compliance, quality metrics, and trust level.",
    inputSchema: {
      account: z.string().optional().describe("Specific account (omit for all)"),
    },
  }, async (args) => {
    const result = await sendToDaemon({ type: "get_trust", account: args.account });
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  });
}
