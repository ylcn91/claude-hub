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
    const result = await sendToDaemon({ type: "archive_messages", days: args.days ?? 7 });
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

  server.registerTool("list_handoff_types", {
    description: "List all available handoff template types with their descriptions, default criteria, commands, and blockers",
  }, async () => {
    const { loadTemplates } = await import("../services/handoff-templates.js");
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

  // ── F2: GitHub Integration Tools ──

  server.registerTool("link_to_github", {
    description: "Link a task to a GitHub issue or PR for automated status sync",
    inputSchema: {
      taskId: z.string().describe("Task ID to link"),
      url: z.string().describe("GitHub issue or PR URL"),
      externalId: z.string().describe("External ID in format 'owner/repo#123'"),
      linkType: z.enum(["issue", "pr"]).describe("Link type: issue or PR"),
    },
  }, async (args) => {
    const result = await sendToDaemon({
      type: "link_task",
      taskId: args.taskId,
      url: args.url,
      externalId: args.externalId,
      linkType: args.linkType,
      provider: "github",
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  });

  server.registerTool("get_task_links", {
    description: "Get all external links (GitHub issues/PRs) for a task",
    inputSchema: {
      taskId: z.string().describe("Task ID"),
    },
  }, async (args) => {
    const result = await sendToDaemon({ type: "get_task_links", taskId: args.taskId });
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  });

  server.registerTool("sync_github_status", {
    description: "Get the current status of a linked GitHub issue",
    inputSchema: {
      owner: z.string().describe("Repository owner"),
      repo: z.string().describe("Repository name"),
      issueNumber: z.number().describe("Issue or PR number"),
    },
  }, async (args) => {
    const { getIssueStatus } = await import("../integrations/github.js");
    const status = await getIssueStatus({
      owner: args.owner,
      repo: args.repo,
      issueNumber: args.issueNumber,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(status) }] };
  });

  // ── F3: Review Bundle Tools ──

  server.registerTool("get_review_bundle", {
    description: "Get the review bundle for a task (diff summary, test results, risk notes)",
    inputSchema: {
      taskId: z.string().describe("Task ID"),
    },
  }, async (args) => {
    const result = await sendToDaemon({ type: "get_review_bundle", taskId: args.taskId });
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  });

  server.registerTool("generate_review_bundle", {
    description: "Generate a review bundle for a task with git diff analysis, optional test execution, and risk assessment",
    inputSchema: {
      taskId: z.string().describe("Task ID"),
      workDir: z.string().describe("Working directory path"),
      branch: z.string().describe("Branch to review"),
      baseBranch: z.string().optional().describe("Base branch (default: main)"),
      runCommands: z.array(z.string()).optional().describe("Commands to run for testing"),
    },
  }, async (args) => {
    const result = await sendToDaemon({
      type: "generate_review_bundle",
      taskId: args.taskId,
      workDir: args.workDir,
      branch: args.branch,
      baseBranch: args.baseBranch,
      runCommands: args.runCommands,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  });

  // ── F4: Knowledge Index Tools ──

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
    const result = await sendToDaemon({
      type: "index_note",
      title: args.title,
      content: args.content,
      tags: args.tags,
      category: args.category,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  });

  // ── F5: Analytics Tools ──

  server.registerTool("get_analytics", {
    description: "Get operational analytics: cycle times, accept/reject ratios, per-account productivity, SLA violations",
    inputSchema: {
      fromDate: z.string().optional().describe("Start date (ISO format)"),
      toDate: z.string().optional().describe("End date (ISO format)"),
    },
  }, async (args) => {
    const result = await sendToDaemon({
      type: "get_analytics",
      fromDate: args.fromDate,
      toDate: args.toDate,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  });

  // ── Workflow Tools ──

  server.registerTool("trigger_workflow", {
    description: "Trigger a workflow by name. Loads YAML definition from workflows directory and starts DAG execution.",
    inputSchema: {
      workflowName: z.string().describe("Name of the workflow to trigger"),
      context: z.string().optional().describe("Trigger context string"),
    },
  }, async (args) => {
    const result = await sendToDaemon({
      type: "workflow_trigger",
      workflowName: args.workflowName,
      context: args.context,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  });

  server.registerTool("workflow_status", {
    description: "Get the status of a workflow run including all step statuses",
    inputSchema: {
      runId: z.string().describe("Workflow run ID"),
    },
  }, async (args) => {
    const result = await sendToDaemon({
      type: "workflow_status",
      runId: args.runId,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  });

  server.registerTool("list_workflows", {
    description: "List all available workflow definitions from the workflows directory",
  }, async () => {
    const result = await sendToDaemon({ type: "workflow_list" });
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  });

  server.registerTool("cancel_workflow", {
    description: "Cancel a running workflow. All pending/assigned steps will be skipped.",
    inputSchema: {
      runId: z.string().describe("Workflow run ID to cancel"),
    },
  }, async (args) => {
    const result = await sendToDaemon({
      type: "workflow_cancel",
      runId: args.runId,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  });

  // ── Retro Tools ──

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

  // ── F6: Daemon Health Tool ──

  server.registerTool("daemon_health", {
    description: "Get daemon health status: uptime, connections, memory usage, store status",
  }, async () => {
    const result = await sendToDaemon({ type: "health_check" });
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  });

  // ── Cross-Account Code Search Tool ──

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

  // ── Account Health Tool ──

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

  // ── Live Session Sharing Tools ──

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
    const result = await sendToDaemon({
      type: "session_broadcast",
      sessionId: args.sessionId,
      data: args.data,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
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

  // ── Session Naming Tools ──

  server.registerTool("name_session", {
    description: "Name or rename a session for easy identification and future search",
    inputSchema: {
      sessionId: z.string().describe("Session ID to name"),
      name: z.string().describe("Human-readable name for the session"),
      tags: z.array(z.string()).optional().describe("Tags for categorization"),
      notes: z.string().optional().describe("Optional notes about the session"),
    },
  }, async (args) => {
    const result = await sendToDaemon({
      type: "name_session",
      sessionId: args.sessionId,
      name: args.name,
      tags: args.tags,
      notes: args.notes,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
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

  // ── Phase 2: Intelligent Delegation Tools ──

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

  server.registerTool("get_trust_scores", {
    description: "Get trust and reputation scores for all agents or a specific agent. Shows completion rate, SLA compliance, quality metrics, and trust level.",
    inputSchema: {
      account: z.string().optional().describe("Specific account (omit for all)"),
    },
  }, async (args) => {
    const result = await sendToDaemon({ type: "get_trust", account: args.account });
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  });

  server.registerTool("check_adaptive_sla", {
    description: "Run adaptive SLA check with graduated responses. Returns actionable recommendations (ping, reassign, quarantine, escalate) based on task criticality and progress.",
  }, async () => {
    const result = await sendToDaemon({ type: "adaptive_sla_check" });
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  });

  // ── Phase 6: Council Verification Tool ──

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
    const { loadConfig } = await import("../config.js");
    const config = await loadConfig();
    if (!config.features?.council) {
      return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Council feature is not enabled. Set features.council = true in config." }) }] };
    }

    const { verifyTaskCompletion, needsCouncilVerification } = await import("../services/verification-council.js");
    const { createOpenRouterCaller } = await import("../services/council.js");

    const apiKey = config.council?.apiKey ?? process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Council verification requires an OpenRouter API key" }) }] };
    }

    const llmCaller = createOpenRouterCaller(apiKey);

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
        models: config.council?.models,
        chairman: config.council?.chairman,
        llmCaller,
      },
    );

    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  });
}
