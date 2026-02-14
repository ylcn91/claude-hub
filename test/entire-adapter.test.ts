import { test, expect, describe, beforeEach, mock } from "bun:test";
import { EventBus, type DelegationEvent } from "../src/services/event-bus";
import { EntireAdapter, type EntireSessionState, type EntireTokenUsage } from "../src/services/entire-adapter";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

function makeSession(overrides: Partial<EntireSessionState> = {}): EntireSessionState {
  return {
    session_id: "2026-02-14-abc123",
    base_commit: "deadbeef",
    started_at: new Date(Date.now() - 10 * 60_000).toISOString(), // 10 minutes ago
    checkpoint_count: 0,
    phase: "idle",
    agent_type: "Claude Code",
    files_touched: [],
    ...overrides,
  };
}

function makeTokenUsage(overrides: Partial<EntireTokenUsage> = {}): EntireTokenUsage {
  return {
    input_tokens: 0,
    cache_creation_tokens: 0,
    cache_read_tokens: 0,
    output_tokens: 0,
    api_call_count: 0,
    ...overrides,
  };
}

/** Poll until predicate returns true, or timeout (default 2s) */
async function waitFor(predicate: () => boolean, timeoutMs = 2000, intervalMs = 50): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

describe("EntireAdapter", () => {
  let tmpDir: string;
  let sessionsDir: string;
  let eventBus: EventBus;
  let adapter: EntireAdapter;
  let emitted: Array<DelegationEvent & { id: string; timestamp: string }>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "entire-adapter-test-"));
    sessionsDir = join(tmpDir, "entire-sessions");
    eventBus = new EventBus();
    emitted = [];
    eventBus.on("*", (event) => emitted.push(event));
    adapter = new EntireAdapter(eventBus, tmpDir);
  });

  describe("readSession", () => {
    test("parses entire.io session JSON with snake_case fields", () => {
      mkdirSync(sessionsDir, { recursive: true });
      const session = makeSession({
        session_id: "2026-02-14-test-session",
        base_commit: "abc123def",
        phase: "active",
        checkpoint_count: 3,
        files_touched: ["src/main.ts", "test/main.test.ts"],
        agent_type: "Claude Code",
        token_usage: makeTokenUsage({
          input_tokens: 5000,
          cache_creation_tokens: 200,
          cache_read_tokens: 1000,
          output_tokens: 2000,
          api_call_count: 5,
        }),
        worktree_path: "/home/user/project",
      });
      const filePath = join(sessionsDir, "2026-02-14-test-session.json");
      writeFileSync(filePath, JSON.stringify(session));

      const result = adapter.readSession(filePath);
      expect(result).not.toBeNull();
      expect(result!.session_id).toBe("2026-02-14-test-session");
      expect(result!.base_commit).toBe("abc123def");
      expect(result!.phase).toBe("active");
      expect(result!.checkpoint_count).toBe(3);
      expect(result!.files_touched).toEqual(["src/main.ts", "test/main.test.ts"]);
      expect(result!.agent_type).toBe("Claude Code");
      expect(result!.token_usage!.input_tokens).toBe(5000);
      expect(result!.token_usage!.output_tokens).toBe(2000);
      expect(result!.token_usage!.api_call_count).toBe(5);
      expect(result!.worktree_path).toBe("/home/user/project");
    });

    test("normalizes empty phase to idle", () => {
      mkdirSync(sessionsDir, { recursive: true });
      const session = makeSession({ phase: "" as any });
      const filePath = join(sessionsDir, "test.json");
      writeFileSync(filePath, JSON.stringify(session));

      const result = adapter.readSession(filePath);
      expect(result!.phase).toBe("idle");
    });

    test("returns null for invalid JSON", () => {
      mkdirSync(sessionsDir, { recursive: true });
      const filePath = join(sessionsDir, "bad.json");
      writeFileSync(filePath, "not json");

      const result = adapter.readSession(filePath);
      expect(result).toBeNull();
    });

    test("returns null for missing session_id", () => {
      mkdirSync(sessionsDir, { recursive: true });
      const filePath = join(sessionsDir, "no-id.json");
      writeFileSync(filePath, JSON.stringify({ phase: "active" }));

      const result = adapter.readSession(filePath);
      expect(result).toBeNull();
    });

    test("handles session with subagent tokens", () => {
      mkdirSync(sessionsDir, { recursive: true });
      const session = makeSession({
        token_usage: makeTokenUsage({
          input_tokens: 3000,
          output_tokens: 1000,
          subagent_tokens: makeTokenUsage({
            input_tokens: 2000,
            output_tokens: 500,
          }),
        }),
      });
      const filePath = join(sessionsDir, "sub.json");
      writeFileSync(filePath, JSON.stringify(session));

      const result = adapter.readSession(filePath);
      expect(result!.token_usage!.subagent_tokens).toBeDefined();
      expect(result!.token_usage!.subagent_tokens!.input_tokens).toBe(2000);
    });
  });

  describe("processSessionUpdate", () => {
    test("emits TASK_STARTED when phase transitions to active", () => {
      const prev = makeSession({ phase: "idle" });
      const current = makeSession({ phase: "active" });

      adapter.processSessionUpdate(prev, current);

      expect(emitted.length).toBe(1);
      expect(emitted[0].type).toBe("TASK_STARTED");
      expect((emitted[0] as any).agent).toBe("Claude Code");
    });

    test("emits TASK_STARTED when phase transitions to active_committed", () => {
      const prev = makeSession({ phase: "idle" });
      const current = makeSession({ phase: "active_committed" });

      adapter.processSessionUpdate(prev, current);

      expect(emitted.length).toBe(1);
      expect(emitted[0].type).toBe("TASK_STARTED");
    });

    test("emits CHECKPOINT_REACHED when step count increases", () => {
      const prev = makeSession({ phase: "active", checkpoint_count: 1 });
      const current = makeSession({ phase: "active", checkpoint_count: 2 });

      adapter.processSessionUpdate(prev, current);

      const checkpoints = emitted.filter((e) => e.type === "CHECKPOINT_REACHED");
      expect(checkpoints.length).toBe(1);
      expect((checkpoints[0] as any).step).toBe("checkpoint 2");
    });

    test("emits PROGRESS_UPDATE when token usage changes", () => {
      const prev = makeSession({
        phase: "active",
        token_usage: makeTokenUsage({ input_tokens: 1000, output_tokens: 500 }),
      });
      const current = makeSession({
        phase: "active",
        token_usage: makeTokenUsage({ input_tokens: 3000, output_tokens: 1500 }),
      });

      adapter.processSessionUpdate(prev, current);

      const updates = emitted.filter((e) => e.type === "PROGRESS_UPDATE");
      expect(updates.length).toBeGreaterThanOrEqual(1);
      const tokenUpdate = updates.find((e) =>
        (e as any).data.currentStep.includes("tokens:")
      );
      expect(tokenUpdate).toBeDefined();
    });

    test("emits RESOURCE_WARNING when context saturation exceeds 80%", () => {
      const prev = makeSession({
        phase: "active",
        agent_type: "Claude Code",
        token_usage: makeTokenUsage({ input_tokens: 100_000, output_tokens: 50_000 }),
      });
      const current = makeSession({
        phase: "active",
        agent_type: "Claude Code",
        token_usage: makeTokenUsage({ input_tokens: 150_000, output_tokens: 50_000 }),
      });

      adapter.processSessionUpdate(prev, current);

      const warnings = emitted.filter((e) => e.type === "RESOURCE_WARNING");
      expect(warnings.length).toBe(1);
      expect((warnings[0] as any).warning).toContain("Context saturation");
    });

    test("emits PROGRESS_UPDATE when files touched changes", () => {
      const prev = makeSession({
        phase: "active",
        files_touched: ["src/a.ts"],
      });
      const current = makeSession({
        phase: "active",
        files_touched: ["src/a.ts", "src/b.ts"],
      });

      adapter.processSessionUpdate(prev, current);

      const updates = emitted.filter((e) => e.type === "PROGRESS_UPDATE");
      const fileUpdate = updates.find((e) =>
        (e as any).data.currentStep.includes("files touched:")
      );
      expect(fileUpdate).toBeDefined();
    });

    test("emits TASK_COMPLETED when phase transitions to idle from active", () => {
      const prev = makeSession({ phase: "active" });
      const current = makeSession({ phase: "idle" });

      adapter.processSessionUpdate(prev, current);

      const completed = emitted.filter((e) => e.type === "TASK_COMPLETED");
      expect(completed.length).toBe(1);
      expect((completed[0] as any).result).toBe("success");
    });

    test("emits TASK_COMPLETED when phase transitions to ended", () => {
      const prev = makeSession({ phase: "active_committed" });
      const current = makeSession({ phase: "ended" });

      adapter.processSessionUpdate(prev, current);

      const completed = emitted.filter((e) => e.type === "TASK_COMPLETED");
      expect(completed.length).toBe(1);
    });

    test("does not emit TASK_STARTED when phase stays active", () => {
      const prev = makeSession({ phase: "active" });
      const current = makeSession({ phase: "active", checkpoint_count: 1 });

      adapter.processSessionUpdate(prev, current);

      const started = emitted.filter((e) => e.type === "TASK_STARTED");
      expect(started.length).toBe(0);
    });

    test("uses linked task ID when available", () => {
      adapter.linkSessionToTask("2026-02-14-abc123", "task-42");

      const prev = makeSession({ phase: "idle" });
      const current = makeSession({ phase: "active" });

      adapter.processSessionUpdate(prev, current);

      expect(emitted.length).toBe(1);
      expect((emitted[0] as any).taskId).toBe("task-42");
    });

    test("uses expected files for progress estimate", () => {
      adapter.setExpectedFiles("2026-02-14-abc123", 5);
      adapter.linkSessionToTask("2026-02-14-abc123", "task-99");

      const prev = makeSession({ phase: "active", checkpoint_count: 0, files_touched: [] });
      const current = makeSession({ phase: "active", checkpoint_count: 1, files_touched: ["a.ts", "b.ts"] });

      adapter.processSessionUpdate(prev, current);

      const checkpoints = emitted.filter((e) => e.type === "CHECKPOINT_REACHED");
      expect(checkpoints.length).toBe(1);
      // 2 files / 5 expected = 40%
      expect((checkpoints[0] as any).percent).toBe(40);
    });
  });

  describe("getSessionMetrics", () => {
    test("returns null for unknown session", () => {
      const result = adapter.getSessionMetrics("nonexistent");
      expect(result).toBeNull();
    });

    test("calculates metrics correctly", () => {
      mkdirSync(sessionsDir, { recursive: true });
      const session = makeSession({
        session_id: "metrics-test",
        phase: "active",
        checkpoint_count: 3,
        files_touched: ["a.ts", "b.ts", "c.ts"],
        agent_type: "Claude Code",
        token_usage: makeTokenUsage({
          input_tokens: 10_000,
          cache_creation_tokens: 500,
          cache_read_tokens: 2_000,
          output_tokens: 5_000,
          api_call_count: 8,
        }),
        started_at: new Date(Date.now() - 10 * 60_000).toISOString(), // 10 min ago
      });
      const filePath = join(sessionsDir, "metrics-test.json");
      writeFileSync(filePath, JSON.stringify(session));

      // Start watching loads initial state
      adapter.startWatching();

      const metrics = adapter.getSessionMetrics("metrics-test");
      expect(metrics).not.toBeNull();
      expect(metrics!.sessionId).toBe("metrics-test");
      expect(metrics!.phase).toBe("active");
      expect(metrics!.stepCount).toBe(3);
      expect(metrics!.filesTouched).toEqual(["a.ts", "b.ts", "c.ts"]);
      expect(metrics!.totalTokens).toBe(17_500); // 10000+500+2000+5000
      expect(metrics!.tokenBurnRate).toBeGreaterThan(0);
      // Context saturation: 17500/200000 = 0.0875
      expect(metrics!.contextSaturation).toBeCloseTo(0.0875, 3);
      expect(metrics!.elapsedMinutes).toBeGreaterThan(9);
      expect(metrics!.agentType).toBe("Claude Code");

      adapter.stopWatching();
    });

    test("token burn rate accounts for subagent tokens", () => {
      mkdirSync(sessionsDir, { recursive: true });
      const session = makeSession({
        session_id: "burn-rate-test",
        phase: "active",
        token_usage: makeTokenUsage({
          input_tokens: 5000,
          output_tokens: 2000,
          subagent_tokens: makeTokenUsage({
            input_tokens: 3000,
            output_tokens: 1000,
          }),
        }),
        started_at: new Date(Date.now() - 5 * 60_000).toISOString(), // 5 min ago
      });
      writeFileSync(join(sessionsDir, "burn-rate-test.json"), JSON.stringify(session));

      adapter.startWatching();
      const metrics = adapter.getSessionMetrics("burn-rate-test");

      // Total: 5000+0+0+2000 + 3000+0+0+1000 = 11000
      expect(metrics!.totalTokens).toBe(11_000);
      // Burn rate: 11000 / ~5 = ~2200/min
      expect(metrics!.tokenBurnRate).toBeGreaterThan(2000);

      adapter.stopWatching();
    });

    test("context saturation uses Gemini context window for Gemini CLI", () => {
      mkdirSync(sessionsDir, { recursive: true });
      const session = makeSession({
        session_id: "gemini-test",
        agent_type: "Gemini CLI",
        token_usage: makeTokenUsage({ input_tokens: 100_000 }),
      });
      writeFileSync(join(sessionsDir, "gemini-test.json"), JSON.stringify(session));

      adapter.startWatching();
      const metrics = adapter.getSessionMetrics("gemini-test");

      // 100000 / 1_000_000 = 0.1
      expect(metrics!.contextSaturation).toBeCloseTo(0.1, 3);

      adapter.stopWatching();
    });
  });

  describe("linkSessionToTask", () => {
    test("maps session to task and retrieves it", () => {
      adapter.linkSessionToTask("session-1", "task-1");
      expect(adapter.getLinkedTaskId("session-1")).toBe("task-1");
    });

    test("returns undefined for unlinked session", () => {
      expect(adapter.getLinkedTaskId("unknown")).toBeUndefined();
    });
  });

  describe("startWatching / stopWatching", () => {
    test("returns false when sessions directory does not exist", () => {
      const adapterNoDir = new EntireAdapter(eventBus, "/nonexistent/path");
      const result = adapterNoDir.startWatching();
      expect(result).toBe(false);
    });

    test("returns true when sessions directory exists", () => {
      mkdirSync(sessionsDir, { recursive: true });
      const result = adapter.startWatching();
      expect(result).toBe(true);
      adapter.stopWatching();
    });

    test("loads existing sessions on start", () => {
      mkdirSync(sessionsDir, { recursive: true });
      writeFileSync(
        join(sessionsDir, "existing.json"),
        JSON.stringify(makeSession({ session_id: "existing", phase: "active" }))
      );

      adapter.startWatching();

      const metrics = adapter.getSessionMetrics("existing");
      expect(metrics).not.toBeNull();
      expect(metrics!.sessionId).toBe("existing");

      adapter.stopWatching();
    });

    test("skips .tmp files during initial load", () => {
      mkdirSync(sessionsDir, { recursive: true });
      writeFileSync(
        join(sessionsDir, "temp.json.tmp"),
        JSON.stringify(makeSession({ session_id: "temp" }))
      );

      adapter.startWatching();

      const metrics = adapter.getSessionMetrics("temp");
      expect(metrics).toBeNull();

      adapter.stopWatching();
    });

    test("stopWatching clears state", () => {
      mkdirSync(sessionsDir, { recursive: true });
      writeFileSync(
        join(sessionsDir, "cleared.json"),
        JSON.stringify(makeSession({ session_id: "cleared" }))
      );

      adapter.startWatching();
      expect(adapter.getSessionMetrics("cleared")).not.toBeNull();

      adapter.stopWatching();
      expect(adapter.getSessionMetrics("cleared")).toBeNull();
    });
  });

  describe("file watcher integration", () => {
    test("detects new session file and emits TASK_STARTED for active phase", async () => {
      mkdirSync(sessionsDir, { recursive: true });
      adapter.startWatching();

      // Write a new session file
      writeFileSync(
        join(sessionsDir, "new-session.json"),
        JSON.stringify(makeSession({ session_id: "new-session", phase: "active" }))
      );

      // fs.watch delivery is async and timing varies under load — poll instead of fixed sleep
      await waitFor(() => emitted.some((e) => e.type === "TASK_STARTED"));

      const started = emitted.filter((e) => e.type === "TASK_STARTED");
      expect(started.length).toBe(1);
      expect((started[0] as any).taskId).toBe("new-session");

      adapter.stopWatching();
    });

    test("detects session update and emits correct events", async () => {
      mkdirSync(sessionsDir, { recursive: true });

      // Write initial session
      const initialSession = makeSession({ session_id: "update-test", phase: "idle" });
      writeFileSync(join(sessionsDir, "update-test.json"), JSON.stringify(initialSession));

      adapter.startWatching();

      // Update session to active
      const updatedSession = makeSession({ session_id: "update-test", phase: "active" });
      writeFileSync(join(sessionsDir, "update-test.json"), JSON.stringify(updatedSession));

      // fs.watch delivery is async and timing varies under load — poll instead of fixed sleep
      await waitFor(() => emitted.some((e) => e.type === "TASK_STARTED"));

      const started = emitted.filter((e) => e.type === "TASK_STARTED");
      expect(started.length).toBe(1);

      adapter.stopWatching();
    });
  });
});
