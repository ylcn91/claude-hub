import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { validateHandoff } from "../services/handoff.js";

export type DaemonSender = (msg: object) => Promise<any>;

export function registerTools(server: McpServer, sendToDaemon: DaemonSender, account: string): void {
  server.registerTool("send_message", {
    description: "Send a message to another Claude Code account",
    inputSchema: {
      to: z.string().describe("Target account name"),
      message: z.string().describe("Message content"),
    },
  }, async (args) => {
    const result = await sendToDaemon({
      type: "send_message",
      to: args.to,
      content: args.message,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
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
    description: "List all registered accounts and their status",
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
    const { copyToClipboard } = await import("../services/clipboard.js");
    const entry = await copyToClipboard(account, args.content, args.label);
    return { content: [{ type: "text" as const, text: JSON.stringify({ copied: true, id: entry.id }) }] };
  });

  server.registerTool("paste_context", {
    description: "Get the most recent content from the shared clipboard",
    inputSchema: {
      count: z.number().optional().describe("Number of entries to retrieve (default 1)"),
    },
  }, async (args) => {
    const { pasteFromClipboard } = await import("../services/clipboard.js");
    const entries = await pasteFromClipboard(args.count);
    return { content: [{ type: "text" as const, text: JSON.stringify(entries) }] };
  });

  server.registerTool("handoff_task", {
    description: "Hand off a task to another Claude Code account with a structured contract (goal, acceptance criteria, run commands, blockers). The task is persisted and delivered when the target account connects.",
    inputSchema: {
      to: z.string().describe("Target account name"),
      goal: z.string().describe("What the task should accomplish"),
      acceptance_criteria: z.array(z.string()).min(1).describe("List of acceptance criteria"),
      run_commands: z.array(z.string()).min(1).describe("Commands to run/verify the work"),
      blocked_by: z.array(z.string()).min(1).describe('Task IDs this is blocked by, or ["none"]'),
      branch: z.string().optional().describe("Git branch for context"),
      projectDir: z.string().optional().describe("Project directory path"),
      notes: z.string().optional().describe("Additional notes or context"),
    },
  }, async (args) => {
    const validation = validateHandoff({
      goal: args.goal,
      acceptance_criteria: args.acceptance_criteria,
      run_commands: args.run_commands,
      blocked_by: args.blocked_by,
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
    const result = await sendToDaemon({
      type: "update_task_status",
      taskId: args.taskId,
      status: args.status,
      reason: args.reason,
      workspacePath: args.workspacePath,
      branch: args.branch,
      workspaceId: args.workspaceId,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  });

  server.registerTool("archive_messages", {
    description: "Archive old read messages (older than specified days)",
    inputSchema: {
      days: z.number().optional().describe("Days old to archive (default 7)"),
    },
  }, async (args) => {
    const result = await sendToDaemon({ type: "archive_messages", days: args.days });
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  });

  // ── v4 Tools ──

  server.registerTool("prepare_workspace", {
    description: "Create an isolated git worktree workspace for a task. Idempotent — returns existing workspace if one already exists for the same repo+branch.",
    inputSchema: {
      repoPath: z.string().describe("Absolute path to the git repository"),
      branch: z.string().describe("Git branch name for the worktree"),
      handoffId: z.string().optional().describe("Associated handoff ID"),
    },
  }, async (args) => {
    const result = await sendToDaemon({
      type: "prepare_worktree_for_handoff",
      repoPath: args.repoPath,
      branch: args.branch,
      handoffId: args.handoffId,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  });

  server.registerTool("get_workspace_status", {
    description: "Get the status of a workspace by ID or by repo+branch key",
    inputSchema: {
      id: z.string().optional().describe("Workspace ID"),
      repoPath: z.string().optional().describe("Repository path (use with branch)"),
      branch: z.string().optional().describe("Branch name (use with repoPath)"),
    },
  }, async (args) => {
    const result = await sendToDaemon({
      type: "get_workspace_status",
      id: args.id,
      repoPath: args.repoPath,
      branch: args.branch,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  });

  server.registerTool("cleanup_workspace", {
    description: "Remove a git worktree workspace and clean up associated resources",
    inputSchema: {
      id: z.string().describe("Workspace ID to clean up"),
    },
  }, async (args) => {
    const result = await sendToDaemon({
      type: "cleanup_workspace",
      id: args.id,
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

  server.registerTool("check_sla", {
    description: "Manually check for stale tasks that violate SLA thresholds. Returns escalation recommendations.",
  }, async () => {
    const { loadTasks } = await import("../services/tasks.js");
    const { checkStaleTasks, DEFAULT_SLA_CONFIG } = await import("../services/sla-engine.js");
    const board = await loadTasks();
    const escalations = checkStaleTasks(board.tasks, DEFAULT_SLA_CONFIG);
    return { content: [{ type: "text" as const, text: JSON.stringify(escalations) }] };
  });

  server.registerTool("count_unread", {
    description: "Get count of unread messages without marking them as read",
  }, async () => {
    const result = await sendToDaemon({ type: "count_unread" });
    return { content: [{ type: "text" as const, text: JSON.stringify({ count: result.count ?? 0 }) }] };
  });

  // ── Handoff Template Tools ──

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
    const { getTemplate, mergeTemplate } = await import("../services/handoff-templates.js");
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
    const { loadTemplates } = await import("../services/handoff-templates.js");
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
    const { saveTemplate } = await import("../services/handoff-templates.js");
    const template = await saveTemplate({
      name: args.name,
      description: args.description,
      payload: {
        acceptance_criteria: args.acceptance_criteria,
        run_commands: args.run_commands,
        blocked_by: args.blocked_by,
      },
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(template) }] };
  });

  // ── Prompt Library Tools ──

  server.registerTool("save_prompt", {
    description: "Save a prompt to the prompt library for reuse",
    inputSchema: {
      title: z.string().describe("Prompt title"),
      content: z.string().describe("Prompt content"),
      tags: z.array(z.string()).optional().describe("Tags for categorization"),
    },
  }, async (args) => {
    const { savePrompt } = await import("../services/prompt-library.js");
    const prompt = await savePrompt({ title: args.title, content: args.content, tags: args.tags });
    return { content: [{ type: "text" as const, text: JSON.stringify(prompt) }] };
  });

  server.registerTool("list_prompts", {
    description: "List or search prompts in the prompt library",
    inputSchema: {
      query: z.string().optional().describe("Search query (filters by title and tags)"),
    },
  }, async (args) => {
    if (args.query) {
      const { searchPrompts } = await import("../services/prompt-library.js");
      const results = await searchPrompts(args.query);
      return { content: [{ type: "text" as const, text: JSON.stringify(results) }] };
    }
    const { loadPrompts } = await import("../services/prompt-library.js");
    const prompts = await loadPrompts();
    return { content: [{ type: "text" as const, text: JSON.stringify(prompts) }] };
  });

  server.registerTool("use_prompt", {
    description: "Retrieve a prompt by ID from the library (increments usage count)",
    inputSchema: {
      id: z.string().describe("Prompt ID"),
    },
  }, async (args) => {
    const { getPrompt } = await import("../services/prompt-library.js");
    const prompt = await getPrompt(args.id);
    if (!prompt) {
      return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Prompt not found" }) }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(prompt) }] };
  });
}
