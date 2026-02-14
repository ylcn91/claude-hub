import { describe, test, expect } from "bun:test";
import {
  DaemonMessageSchema,
  AccountNameSchema,
  HexColorSchema,
  ProviderSchema,
  AddAccountArgsSchema,
} from "../src/daemon/schemas";

describe("DaemonMessageSchema", () => {
  // --- Pre-auth messages ---

  test("accepts valid auth message", () => {
    const result = DaemonMessageSchema.safeParse({
      type: "auth",
      account: "alice",
      token: "secret-token",
    });
    expect(result.success).toBe(true);
  });

  test("rejects auth with empty account", () => {
    const result = DaemonMessageSchema.safeParse({
      type: "auth",
      account: "",
      token: "secret-token",
    });
    expect(result.success).toBe(false);
  });

  test("rejects auth with empty token", () => {
    const result = DaemonMessageSchema.safeParse({
      type: "auth",
      account: "alice",
      token: "",
    });
    expect(result.success).toBe(false);
  });

  test("rejects auth with missing account", () => {
    const result = DaemonMessageSchema.safeParse({
      type: "auth",
      token: "secret",
    });
    expect(result.success).toBe(false);
  });

  test("accepts ping message", () => {
    const result = DaemonMessageSchema.safeParse({ type: "ping" });
    expect(result.success).toBe(true);
  });

  test("accepts ping with requestId", () => {
    const result = DaemonMessageSchema.safeParse({ type: "ping", requestId: "r1" });
    expect(result.success).toBe(true);
  });

  test("accepts config_reload", () => {
    const result = DaemonMessageSchema.safeParse({ type: "config_reload" });
    expect(result.success).toBe(true);
  });

  // --- Messaging ---

  test("accepts valid send_message", () => {
    const result = DaemonMessageSchema.safeParse({
      type: "send_message",
      to: "bob",
      content: "hello",
    });
    expect(result.success).toBe(true);
  });

  test("rejects send_message with empty to", () => {
    const result = DaemonMessageSchema.safeParse({
      type: "send_message",
      to: "",
      content: "hello",
    });
    expect(result.success).toBe(false);
  });

  test("rejects send_message with empty content", () => {
    const result = DaemonMessageSchema.safeParse({
      type: "send_message",
      to: "bob",
      content: "",
    });
    expect(result.success).toBe(false);
  });

  test("accepts count_unread", () => {
    const result = DaemonMessageSchema.safeParse({ type: "count_unread" });
    expect(result.success).toBe(true);
  });

  test("accepts read_messages with pagination", () => {
    const result = DaemonMessageSchema.safeParse({
      type: "read_messages",
      limit: 10,
      offset: 0,
    });
    expect(result.success).toBe(true);
  });

  test("rejects read_messages with negative limit", () => {
    const result = DaemonMessageSchema.safeParse({
      type: "read_messages",
      limit: -1,
    });
    expect(result.success).toBe(false);
  });

  test("accepts list_accounts", () => {
    const result = DaemonMessageSchema.safeParse({ type: "list_accounts" });
    expect(result.success).toBe(true);
  });

  test("accepts archive_messages with days", () => {
    const result = DaemonMessageSchema.safeParse({
      type: "archive_messages",
      days: 14,
    });
    expect(result.success).toBe(true);
  });

  test("rejects archive_messages with days < 1", () => {
    const result = DaemonMessageSchema.safeParse({
      type: "archive_messages",
      days: 0,
    });
    expect(result.success).toBe(false);
  });

  // --- Handoff ---

  test("accepts valid handoff_task", () => {
    const result = DaemonMessageSchema.safeParse({
      type: "handoff_task",
      to: "bob",
      payload: { goal: "fix bug" },
    });
    expect(result.success).toBe(true);
  });

  test("rejects handoff_task with empty to", () => {
    const result = DaemonMessageSchema.safeParse({
      type: "handoff_task",
      to: "",
      payload: { goal: "fix bug" },
    });
    expect(result.success).toBe(false);
  });

  test("accepts handoff_accept", () => {
    const result = DaemonMessageSchema.safeParse({
      type: "handoff_accept",
      handoffId: "h-123",
    });
    expect(result.success).toBe(true);
  });

  test("accepts reauthorize_delegation", () => {
    const result = DaemonMessageSchema.safeParse({
      type: "reauthorize_delegation",
      handoffId: "h-123",
      newMaxDepth: 3,
    });
    expect(result.success).toBe(true);
  });

  test("rejects reauthorize_delegation with newMaxDepth < 1", () => {
    const result = DaemonMessageSchema.safeParse({
      type: "reauthorize_delegation",
      handoffId: "h-123",
      newMaxDepth: 0,
    });
    expect(result.success).toBe(false);
  });

  test("accepts suggest_assignee", () => {
    const result = DaemonMessageSchema.safeParse({
      type: "suggest_assignee",
      skills: ["typescript", "react"],
    });
    expect(result.success).toBe(true);
  });

  // --- Tasks ---

  test("accepts valid update_task_status", () => {
    const result = DaemonMessageSchema.safeParse({
      type: "update_task_status",
      taskId: "t-1",
      status: "in_progress",
    });
    expect(result.success).toBe(true);
  });

  test("rejects update_task_status with invalid status", () => {
    const result = DaemonMessageSchema.safeParse({
      type: "update_task_status",
      taskId: "t-1",
      status: "invalid_status",
    });
    expect(result.success).toBe(false);
  });

  test("accepts update_task_status with rejected + reason", () => {
    const result = DaemonMessageSchema.safeParse({
      type: "update_task_status",
      taskId: "t-1",
      status: "rejected",
      reason: "tests failing",
    });
    expect(result.success).toBe(true);
  });

  test("accepts report_progress", () => {
    const result = DaemonMessageSchema.safeParse({
      type: "report_progress",
      taskId: "t-1",
      percent: 50,
    });
    expect(result.success).toBe(true);
  });

  test("rejects report_progress with percent > 100", () => {
    const result = DaemonMessageSchema.safeParse({
      type: "report_progress",
      taskId: "t-1",
      percent: 150,
    });
    expect(result.success).toBe(false);
  });

  test("rejects report_progress with percent < 0", () => {
    const result = DaemonMessageSchema.safeParse({
      type: "report_progress",
      taskId: "t-1",
      percent: -10,
    });
    expect(result.success).toBe(false);
  });

  test("accepts get_trust with optional account", () => {
    expect(DaemonMessageSchema.safeParse({ type: "get_trust" }).success).toBe(true);
    expect(DaemonMessageSchema.safeParse({ type: "get_trust", account: "bob" }).success).toBe(true);
  });

  test("accepts reinstate_agent", () => {
    const result = DaemonMessageSchema.safeParse({
      type: "reinstate_agent",
      account: "bob",
    });
    expect(result.success).toBe(true);
  });

  test("rejects reinstate_agent with empty account", () => {
    const result = DaemonMessageSchema.safeParse({
      type: "reinstate_agent",
      account: "",
    });
    expect(result.success).toBe(false);
  });

  test("accepts check_circuit_breaker", () => {
    expect(DaemonMessageSchema.safeParse({ type: "check_circuit_breaker" }).success).toBe(true);
    expect(DaemonMessageSchema.safeParse({ type: "check_circuit_breaker", account: "bob" }).success).toBe(true);
  });

  test("accepts adaptive_sla_check", () => {
    const result = DaemonMessageSchema.safeParse({ type: "adaptive_sla_check" });
    expect(result.success).toBe(true);
  });

  // --- Workspace ---

  test("accepts prepare_worktree_for_handoff", () => {
    const result = DaemonMessageSchema.safeParse({
      type: "prepare_worktree_for_handoff",
      repoPath: "/repo",
      branch: "feature",
    });
    expect(result.success).toBe(true);
  });

  test("accepts get_workspace_status", () => {
    const result = DaemonMessageSchema.safeParse({
      type: "get_workspace_status",
      id: "ws-1",
    });
    expect(result.success).toBe(true);
  });

  test("accepts cleanup_workspace", () => {
    const result = DaemonMessageSchema.safeParse({
      type: "cleanup_workspace",
      id: "ws-1",
    });
    expect(result.success).toBe(true);
  });

  // --- Council ---

  test("accepts council_analyze", () => {
    const result = DaemonMessageSchema.safeParse({
      type: "council_analyze",
      goal: "analyze this feature",
    });
    expect(result.success).toBe(true);
  });

  test("rejects council_analyze with empty goal", () => {
    const result = DaemonMessageSchema.safeParse({
      type: "council_analyze",
      goal: "",
    });
    expect(result.success).toBe(false);
  });

  test("accepts council_analyze with timeoutMs", () => {
    const result = DaemonMessageSchema.safeParse({
      type: "council_analyze",
      goal: "analyze this",
      timeoutMs: 60000,
    });
    expect(result.success).toBe(true);
  });

  test("rejects council_analyze with timeoutMs below 1000", () => {
    const result = DaemonMessageSchema.safeParse({
      type: "council_analyze",
      goal: "analyze this",
      timeoutMs: 500,
    });
    expect(result.success).toBe(false);
  });

  test("accepts valid council_verify", () => {
    const result = DaemonMessageSchema.safeParse({
      type: "council_verify",
      taskId: "t-1",
      goal: "fix the bug",
      acceptance_criteria: ["tests pass", "no regressions"],
    });
    expect(result.success).toBe(true);
  });

  test("accepts council_verify with all optional fields", () => {
    const result = DaemonMessageSchema.safeParse({
      type: "council_verify",
      taskId: "t-1",
      goal: "fix the bug",
      acceptance_criteria: ["tests pass"],
      diff: "--- a/file.ts\n+++ b/file.ts",
      testResults: "5 pass, 0 fail",
      filesChanged: ["src/file.ts"],
      riskNotes: ["touches auth layer"],
      timeoutMs: 60000,
    });
    expect(result.success).toBe(true);
  });

  test("rejects council_verify with empty taskId", () => {
    const result = DaemonMessageSchema.safeParse({
      type: "council_verify",
      taskId: "",
      goal: "fix the bug",
      acceptance_criteria: ["tests pass"],
    });
    expect(result.success).toBe(false);
  });

  test("rejects council_verify with empty goal", () => {
    const result = DaemonMessageSchema.safeParse({
      type: "council_verify",
      taskId: "t-1",
      goal: "",
      acceptance_criteria: ["tests pass"],
    });
    expect(result.success).toBe(false);
  });

  test("rejects council_verify without acceptance_criteria", () => {
    const result = DaemonMessageSchema.safeParse({
      type: "council_verify",
      taskId: "t-1",
      goal: "fix the bug",
    });
    expect(result.success).toBe(false);
  });

  test("rejects council_verify with timeoutMs below 1000", () => {
    const result = DaemonMessageSchema.safeParse({
      type: "council_verify",
      taskId: "t-1",
      goal: "fix",
      acceptance_criteria: ["pass"],
      timeoutMs: 100,
    });
    expect(result.success).toBe(false);
  });

  test("accepts council_history", () => {
    const result = DaemonMessageSchema.safeParse({
      type: "council_history",
    });
    expect(result.success).toBe(true);
  });

  test("accepts council_history with requestId", () => {
    const result = DaemonMessageSchema.safeParse({
      type: "council_history",
      requestId: "req-99",
    });
    expect(result.success).toBe(true);
  });

  // --- Knowledge ---

  test("accepts search_knowledge", () => {
    const result = DaemonMessageSchema.safeParse({
      type: "search_knowledge",
      query: "how to deploy",
    });
    expect(result.success).toBe(true);
  });

  test("accepts index_note", () => {
    const result = DaemonMessageSchema.safeParse({
      type: "index_note",
      title: "Decision",
      content: "We chose React",
      tags: ["frontend"],
    });
    expect(result.success).toBe(true);
  });

  // --- Sessions ---

  test("accepts share_session", () => {
    const result = DaemonMessageSchema.safeParse({
      type: "share_session",
      target: "bob",
    });
    expect(result.success).toBe(true);
  });

  test("accepts join_session", () => {
    const result = DaemonMessageSchema.safeParse({
      type: "join_session",
      sessionId: "s-1",
    });
    expect(result.success).toBe(true);
  });

  test("accepts session_broadcast", () => {
    const result = DaemonMessageSchema.safeParse({
      type: "session_broadcast",
      sessionId: "s-1",
      data: { cursor: { line: 10 } },
    });
    expect(result.success).toBe(true);
  });

  test("accepts session_status without sessionId", () => {
    const result = DaemonMessageSchema.safeParse({ type: "session_status" });
    expect(result.success).toBe(true);
  });

  test("accepts session_history", () => {
    const result = DaemonMessageSchema.safeParse({
      type: "session_history",
      sessionId: "s-1",
    });
    expect(result.success).toBe(true);
  });

  test("accepts leave_session", () => {
    const result = DaemonMessageSchema.safeParse({
      type: "leave_session",
      sessionId: "s-1",
    });
    expect(result.success).toBe(true);
  });

  test("accepts session_ping", () => {
    const result = DaemonMessageSchema.safeParse({
      type: "session_ping",
      sessionId: "s-1",
    });
    expect(result.success).toBe(true);
  });

  test("accepts name_session", () => {
    const result = DaemonMessageSchema.safeParse({
      type: "name_session",
      sessionId: "s-1",
      name: "my-session",
    });
    expect(result.success).toBe(true);
  });

  test("accepts list_sessions", () => {
    const result = DaemonMessageSchema.safeParse({ type: "list_sessions" });
    expect(result.success).toBe(true);
  });

  test("accepts search_sessions", () => {
    const result = DaemonMessageSchema.safeParse({
      type: "search_sessions",
      query: "debug",
    });
    expect(result.success).toBe(true);
  });

  // --- Workflow ---

  test("accepts workflow_trigger", () => {
    const result = DaemonMessageSchema.safeParse({
      type: "workflow_trigger",
      workflowName: "deploy",
    });
    expect(result.success).toBe(true);
  });

  test("accepts workflow_status", () => {
    const result = DaemonMessageSchema.safeParse({
      type: "workflow_status",
      runId: "run-1",
    });
    expect(result.success).toBe(true);
  });

  test("accepts workflow_list", () => {
    const result = DaemonMessageSchema.safeParse({ type: "workflow_list" });
    expect(result.success).toBe(true);
  });

  test("accepts workflow_cancel", () => {
    const result = DaemonMessageSchema.safeParse({
      type: "workflow_cancel",
      runId: "run-1",
    });
    expect(result.success).toBe(true);
  });

  // --- Health ---

  test("accepts health_check", () => {
    const result = DaemonMessageSchema.safeParse({ type: "health_check" });
    expect(result.success).toBe(true);
  });

  test("accepts health_status", () => {
    const result = DaemonMessageSchema.safeParse({ type: "health_status" });
    expect(result.success).toBe(true);
  });

  // --- Misc ---

  test("accepts query_activity with no filters", () => {
    const result = DaemonMessageSchema.safeParse({
      type: "query_activity",
    });
    expect(result.success).toBe(true);
  });

  test("accepts query_activity with all filters", () => {
    const result = DaemonMessageSchema.safeParse({
      type: "query_activity",
      activityType: "delegation_chain",
      account: "agent-a",
      workflowRunId: "wf-123",
      since: "2026-01-01T00:00:00Z",
      limit: 25,
    });
    expect(result.success).toBe(true);
  });

  test("rejects query_activity with non-positive limit", () => {
    const result = DaemonMessageSchema.safeParse({
      type: "query_activity",
      limit: 0,
    });
    expect(result.success).toBe(false);
  });

  test("accepts search_code", () => {
    const result = DaemonMessageSchema.safeParse({
      type: "search_code",
      pattern: "TODO",
    });
    expect(result.success).toBe(true);
  });

  test("accepts replay_session", () => {
    const result = DaemonMessageSchema.safeParse({
      type: "replay_session",
      sessionId: "s-1",
      repoPath: "/repo",
    });
    expect(result.success).toBe(true);
  });

  test("accepts link_task", () => {
    const result = DaemonMessageSchema.safeParse({
      type: "link_task",
      taskId: "t-1",
      url: "https://github.com/org/repo/issues/1",
    });
    expect(result.success).toBe(true);
  });

  test("accepts get_task_links", () => {
    const result = DaemonMessageSchema.safeParse({
      type: "get_task_links",
      taskId: "t-1",
    });
    expect(result.success).toBe(true);
  });

  test("accepts get_review_bundle", () => {
    const result = DaemonMessageSchema.safeParse({
      type: "get_review_bundle",
      taskId: "t-1",
    });
    expect(result.success).toBe(true);
  });

  test("accepts generate_review_bundle", () => {
    const result = DaemonMessageSchema.safeParse({
      type: "generate_review_bundle",
      taskId: "t-1",
      workDir: "/work",
      branch: "main",
    });
    expect(result.success).toBe(true);
  });

  test("accepts get_analytics", () => {
    const result = DaemonMessageSchema.safeParse({ type: "get_analytics" });
    expect(result.success).toBe(true);
  });

  test("accepts retro_start_session", () => {
    const result = DaemonMessageSchema.safeParse({
      type: "retro_start_session",
      participants: ["alice", "bob"],
    });
    expect(result.success).toBe(true);
  });

  test("accepts retro_submit_review", () => {
    const result = DaemonMessageSchema.safeParse({
      type: "retro_submit_review",
      retroId: "r-1",
      whatWentWell: ["fast delivery"],
    });
    expect(result.success).toBe(true);
  });

  test("accepts retro_submit_synthesis", () => {
    const result = DaemonMessageSchema.safeParse({
      type: "retro_submit_synthesis",
      retroId: "r-1",
      document: { summary: "good sprint" },
    });
    expect(result.success).toBe(true);
  });

  test("accepts retro_status", () => {
    const result = DaemonMessageSchema.safeParse({
      type: "retro_status",
      retroId: "r-1",
    });
    expect(result.success).toBe(true);
  });

  test("accepts retro_get_past_learnings", () => {
    const result = DaemonMessageSchema.safeParse({
      type: "retro_get_past_learnings",
    });
    expect(result.success).toBe(true);
  });

  // --- Invalid / unknown types ---

  test("rejects completely unknown type", () => {
    const result = DaemonMessageSchema.safeParse({
      type: "nonexistent_command",
    });
    expect(result.success).toBe(false);
  });

  test("rejects message with no type field", () => {
    const result = DaemonMessageSchema.safeParse({ data: "hello" });
    expect(result.success).toBe(false);
  });

  test("rejects message with null type", () => {
    const result = DaemonMessageSchema.safeParse({ type: null });
    expect(result.success).toBe(false);
  });

  test("rejects message with numeric type", () => {
    const result = DaemonMessageSchema.safeParse({ type: 12345 });
    expect(result.success).toBe(false);
  });

  test("preserves requestId in valid messages", () => {
    const result = DaemonMessageSchema.safeParse({
      type: "send_message",
      to: "bob",
      content: "hello",
      requestId: "req-42",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.requestId).toBe("req-42");
    }
  });
});

describe("AccountNameSchema", () => {
  test("accepts valid names", () => {
    expect(AccountNameSchema.safeParse("alice").success).toBe(true);
    expect(AccountNameSchema.safeParse("agent-1").success).toBe(true);
    expect(AccountNameSchema.safeParse("my_agent").success).toBe(true);
    expect(AccountNameSchema.safeParse("A").success).toBe(true);
    expect(AccountNameSchema.safeParse("0start").success).toBe(true);
  });

  test("rejects invalid names", () => {
    expect(AccountNameSchema.safeParse("").success).toBe(false);
    expect(AccountNameSchema.safeParse("-starts-with-dash").success).toBe(false);
    expect(AccountNameSchema.safeParse("_starts-with-underscore").success).toBe(false);
    expect(AccountNameSchema.safeParse("has spaces").success).toBe(false);
    expect(AccountNameSchema.safeParse("a".repeat(64)).success).toBe(false);
    expect(AccountNameSchema.safeParse("special!chars").success).toBe(false);
  });
});

describe("HexColorSchema", () => {
  test("accepts valid hex colors", () => {
    expect(HexColorSchema.safeParse("#FF0000").success).toBe(true);
    expect(HexColorSchema.safeParse("#aabbcc").success).toBe(true);
    expect(HexColorSchema.safeParse("#123456").success).toBe(true);
  });

  test("rejects invalid hex colors", () => {
    expect(HexColorSchema.safeParse("red").success).toBe(false);
    expect(HexColorSchema.safeParse("#FFF").success).toBe(false);
    expect(HexColorSchema.safeParse("FF0000").success).toBe(false);
    expect(HexColorSchema.safeParse("#GGGGGG").success).toBe(false);
    expect(HexColorSchema.safeParse("#FF00001").success).toBe(false);
  });
});

describe("ProviderSchema", () => {
  test("accepts all valid providers", () => {
    const providers = ["claude-code", "codex-cli", "openhands", "gemini-cli", "opencode", "cursor-agent"];
    for (const p of providers) {
      expect(ProviderSchema.safeParse(p).success).toBe(true);
    }
  });

  test("rejects invalid providers", () => {
    expect(ProviderSchema.safeParse("gpt-4").success).toBe(false);
    expect(ProviderSchema.safeParse("").success).toBe(false);
    expect(ProviderSchema.safeParse("claude").success).toBe(false);
  });
});

describe("AddAccountArgsSchema", () => {
  test("accepts minimal valid args", () => {
    const result = AddAccountArgsSchema.safeParse({ name: "alice" });
    expect(result.success).toBe(true);
  });

  test("accepts full valid args", () => {
    const result = AddAccountArgsSchema.safeParse({
      name: "alice",
      color: "#FF0000",
      provider: "claude-code",
    });
    expect(result.success).toBe(true);
  });

  test("rejects invalid name", () => {
    const result = AddAccountArgsSchema.safeParse({ name: "-invalid" });
    expect(result.success).toBe(false);
  });

  test("rejects invalid color", () => {
    const result = AddAccountArgsSchema.safeParse({
      name: "alice",
      color: "red",
    });
    expect(result.success).toBe(false);
  });

  test("rejects invalid provider", () => {
    const result = AddAccountArgsSchema.safeParse({
      name: "alice",
      provider: "gpt-4",
    });
    expect(result.success).toBe(false);
  });
});
