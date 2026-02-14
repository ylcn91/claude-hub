import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { validateHandoff } from "../../services/handoff.js";
import { sanitizeMCPText } from "../../services/input-sanitizer.js";
import type { DaemonSender } from "../tools.js";

export function registerHandoffTools(server: McpServer, sendToDaemon: DaemonSender, _account: string): void {
  server.registerTool("handoff_task", {
    description: "Hand off a task to another account with a structured contract. Supports enriched task characteristics (complexity, criticality, verifiability, etc.) for intelligent delegation routing.",
    inputSchema: {
      to: z.string().describe("Target account name"),
      goal: z.string().describe("What the task should accomplish"),
      acceptance_criteria: z.array(z.string()).min(1).describe("List of acceptance criteria"),
      run_commands: z.array(z.string()).min(1).describe("Commands to run/verify the work"),
      blocked_by: z.array(z.string()).min(1).describe('Task IDs this is blocked by, or ["none"]'),
      branch: z.string().optional().describe("Git branch for context"),
      projectDir: z.string().optional().describe("Project directory path"),
      notes: z.string().optional().describe("Additional notes or context"),
      // Enriched task characteristics (Paper §2.2)
      complexity: z.enum(["low", "medium", "high", "critical"]).optional().describe("Task complexity level"),
      criticality: z.enum(["low", "medium", "high", "critical"]).optional().describe("How critical the task is"),
      uncertainty: z.enum(["low", "medium", "high"]).optional().describe("Level of uncertainty in requirements"),
      estimated_duration_minutes: z.number().min(0).optional().describe("Estimated duration in minutes"),
      verifiability: z.enum(["auto-testable", "needs-review", "subjective"]).optional().describe("How the outcome can be verified"),
      reversibility: z.enum(["reversible", "partial", "irreversible"]).optional().describe("Can the changes be reverted?"),
      required_skills: z.array(z.string()).optional().describe("Skills needed for this task"),
      autonomy_level: z.enum(["strict", "standard", "open-ended"]).optional().describe("Level of autonomy for the delegatee"),
      monitoring_level: z.enum(["outcome-only", "periodic", "continuous"]).optional().describe("How closely to monitor progress"),
    },
  }, async (args) => {
    const validation = validateHandoff({
      goal: args.goal,
      acceptance_criteria: args.acceptance_criteria,
      run_commands: args.run_commands,
      blocked_by: args.blocked_by,
      complexity: args.complexity,
      criticality: args.criticality,
      uncertainty: args.uncertainty,
      estimated_duration_minutes: args.estimated_duration_minutes,
      verifiability: args.verifiability,
      reversibility: args.reversibility,
      required_skills: args.required_skills,
      autonomy_level: args.autonomy_level,
      monitoring_level: args.monitoring_level,
    });
    if (!validation.valid) {
      return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Invalid handoff payload", details: validation.errors }) }] };
    }

    const context: Record<string, string> = {};
    if (args.branch) context.branch = args.branch;
    if (args.projectDir) context.projectDir = args.projectDir;
    if (args.notes) context.notes = args.notes;

    const result = await sendToDaemon({
      type: "handoff_task",
      to: args.to,
      payload: validation.payload,
      context,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  });

  server.registerTool("accept_handoff", {
    description: "Accept a pending handoff task. Automatically creates a workspace if workspace feature is enabled and handoff has repo context.",
    inputSchema: {
      handoffId: z.string().describe("Handoff message ID to accept"),
    },
  }, async (args) => {
    const result = await sendToDaemon({
      type: "handoff_accept",
      handoffId: args.handoffId,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  });

  server.registerTool("suggest_assignee", {
    description: "Get capability-based routing recommendations for task assignment. Returns scored list of accounts ranked by skill match, success rate, speed, and recency.",
    inputSchema: {
      skills: z.array(z.string()).optional().describe("Required skills for the task"),
      excludeAccounts: z.array(z.string()).optional().describe("Account names to exclude"),
      priority: z.enum(["P0", "P1", "P2"]).optional().describe("Task priority"),
    },
  }, async (args) => {
    const result = await sendToDaemon({
      type: "suggest_assignee",
      skills: args.skills,
      excludeAccounts: args.excludeAccounts,
      priority: args.priority,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  });

  server.registerTool("handoff_from_template", {
    description: "Create a handoff from a template. Loads template, merges with overrides, validates, and sends to target account.",
    inputSchema: {
      templateId: z.string().describe("Template ID or name"),
      to: z.string().describe("Target account name"),
      goal: z.string().describe("Task goal (overrides template)"),
      acceptance_criteria: z.array(z.string()).optional().describe("Override acceptance criteria"),
      run_commands: z.array(z.string()).optional().describe("Override run commands"),
      blocked_by: z.array(z.string()).optional().describe("Override blocked_by"),
      branch: z.string().optional().describe("Git branch for context"),
      projectDir: z.string().optional().describe("Project directory path"),
    },
  }, async (args) => {
    const { getTemplate, mergeTemplate } = await import("../../services/handoff-templates.js");
    const template = await getTemplate(args.templateId);
    if (!template) {
      return { content: [{ type: "text" as const, text: JSON.stringify({ error: `Template '${args.templateId}' not found` }) }] };
    }
    const payload = mergeTemplate(template, {
      goal: args.goal,
      acceptance_criteria: args.acceptance_criteria,
      run_commands: args.run_commands,
      blocked_by: args.blocked_by,
    });

    const context: Record<string, string> = {};
    if (args.branch) context.branch = args.branch;
    if (args.projectDir) context.projectDir = args.projectDir;

    const result = await sendToDaemon({
      type: "handoff_task",
      to: args.to,
      payload,
      context,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify({ ...result, templateUsed: template.name }) }] };
  });

  server.registerTool("list_handoff_templates", {
    description: "List all available handoff templates (built-in and custom)",
  }, async () => {
    const { loadTemplates } = await import("../../services/handoff-templates.js");
    const templates = await loadTemplates();
    return { content: [{ type: "text" as const, text: JSON.stringify(templates) }] };
  });

  server.registerTool("save_handoff_template", {
    description: "Save a new handoff template for reuse",
    inputSchema: {
      name: z.string().describe("Template name"),
      description: z.string().describe("Template description"),
      acceptance_criteria: z.array(z.string()).optional().describe("Default acceptance criteria"),
      run_commands: z.array(z.string()).optional().describe("Default run commands"),
      blocked_by: z.array(z.string()).optional().describe("Default blocked_by"),
    },
  }, async (args) => {
    const nameSan = sanitizeMCPText(args.name, 200);
    const descSan = sanitizeMCPText(args.description, 2_000);
    const warnings = [...nameSan.warnings, ...descSan.warnings];
    const { saveTemplate } = await import("../../services/handoff-templates.js");
    const template = await saveTemplate({
      name: nameSan.sanitized,
      description: descSan.sanitized,
      payload: {
        acceptance_criteria: args.acceptance_criteria,
        run_commands: args.run_commands,
        blocked_by: args.blocked_by,
      },
    });
    const response: any = { ...template };
    if (warnings.length > 0) response.sanitizationWarnings = warnings;
    return { content: [{ type: "text" as const, text: JSON.stringify(response) }] };
  });

  server.registerTool("list_handoff_types", {
    description: "List all available handoff template types with their descriptions, default criteria, commands, and blockers",
  }, async () => {
    const { loadTemplates } = await import("../../services/handoff-templates.js");
    const templates = await loadTemplates();
    const types = templates.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      acceptance_criteria: t.payload.acceptance_criteria ?? [],
      run_commands: t.payload.run_commands ?? [],
      blocked_by: t.payload.blocked_by ?? ["none"],
    }));
    return { content: [{ type: "text" as const, text: JSON.stringify(types) }] };
  });
}
