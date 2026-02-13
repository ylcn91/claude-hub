import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { DaemonState } from "../src/daemon/state";
import { WorkspaceStore } from "../src/daemon/workspace-store";
import { WorkspaceManager, type GitExecutor } from "../src/daemon/workspace-manager";
import { CapabilityStore } from "../src/daemon/capability-store";
import {
  loadTasks,
  saveTasks,
  addTask,
  updateTaskStatus,
  submitForReview,
  acceptTask,
  rejectTask,
} from "../src/services/tasks";
import { runAcceptanceSuite } from "../src/services/acceptance-runner";
import { rankAccounts } from "../src/services/account-capabilities";
import { checkStaleTasks, formatEscalationMessage, DEFAULT_SLA_CONFIG } from "../src/services/sla-engine";

const TEST_DIR = join(import.meta.dir, ".test-e2e");
const TASKS_PATH = join(TEST_DIR, "tasks.json");

let dbCounter = 0;
function uniqueDbPath(prefix: string): string {
  return join(TEST_DIR, `${prefix}-${++dbCounter}-${Date.now()}.db`);
}

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
  process.env.CLAUDE_HUB_DIR = TEST_DIR;
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  delete process.env.CLAUDE_HUB_DIR;
});

describe("E2E: Full handoff → workspace → review → reject → accept → cleanup", () => {
  test("complete task lifecycle with workspace and acceptance", async () => {
    // Setup stores with mock git executor
    const gitLog: string[][] = [];
    const mockGit: GitExecutor = async (args, _cwd) => {
      gitLog.push(args);
      return { exitCode: 0, stdout: "ok", stderr: "" };
    };

    const wsStore = new WorkspaceStore(uniqueDbPath("ws"));
    const wsManager = new WorkspaceManager(wsStore, mockGit);
    const capStore = new CapabilityStore(uniqueDbPath("cap"));

    // Register Alice and Bob capabilities
    capStore.upsert({
      accountName: "alice",
      skills: ["typescript", "testing"],
      totalTasks: 10,
      acceptedTasks: 9,
      rejectedTasks: 1,
      avgDeliveryMs: 5 * 60_000,
      lastActiveAt: new Date().toISOString(),
    });
    capStore.upsert({
      accountName: "bob",
      skills: ["typescript", "devops"],
      totalTasks: 5,
      acceptedTasks: 3,
      rejectedTasks: 2,
      avgDeliveryMs: 20 * 60_000,
      lastActiveAt: new Date().toISOString(),
    });

    // Step 1: Route task — suggest best assignee
    const scores = rankAccounts(
      capStore.getAll(),
      ["typescript", "testing"]
    );
    expect(scores.length).toBe(2);
    expect(scores[0].accountName).toBe("alice"); // Better skill match + success rate

    // Step 2: Create task and assign to Alice
    let board = await loadTasks(TASKS_PATH);
    board = addTask(board, "Implement feature X", "bob", { priority: "P1", tags: ["typescript"] });
    const taskId = board.tasks[0].id;
    await saveTasks(board, TASKS_PATH);

    // Step 3: Move to in_progress
    board = updateTaskStatus(board, taskId, "in_progress");
    await saveTasks(board, TASKS_PATH);
    expect(board.tasks[0].status).toBe("in_progress");

    // Step 4: Prepare workspace
    const wsResult = await wsManager.prepareWorktree({
      repoPath: "/tmp/test-repo",
      branch: "feature/x",
      ownerAccount: "bob",
      handoffId: "handoff-123",
    });
    expect(wsResult.ok).toBe(true);
    expect(wsResult.data!.status).toBe("ready");
    expect(wsResult.data!.branch).toBe("feature/x");
    expect(gitLog[0]).toEqual(["worktree", "add", "/tmp/test-repo/.worktrees/feature-x", "feature/x"]);

    // Step 5: Idempotent workspace — same request returns same workspace
    const wsResult2 = await wsManager.prepareWorktree({
      repoPath: "/tmp/test-repo",
      branch: "feature/x",
      ownerAccount: "bob",
    });
    expect(wsResult2.ok).toBe(true);
    expect(wsResult2.data!.id).toBe(wsResult.data!.id);

    // Step 6: Submit for review with workspace context
    board = submitForReview(board, taskId, {
      workspacePath: wsResult.data!.worktreePath,
      branch: "feature/x",
      workspaceId: wsResult.data!.id,
    });
    await saveTasks(board, TASKS_PATH);
    expect(board.tasks[0].status).toBe("ready_for_review");
    expect(board.tasks[0].workspaceContext!.workspacePath).toBe("/tmp/test-repo/.worktrees/feature-x");

    // Step 7: Run acceptance suite — simulate failure
    const failDir = join(TEST_DIR, "work-fail");
    mkdirSync(failDir);
    const failResult = await runAcceptanceSuite(["echo ok", "exit 1"], failDir);
    expect(failResult.passed).toBe(false);
    expect(failResult.summary).toContain("failed");

    // Step 8: Reject task based on failed acceptance
    board = rejectTask(board, taskId, failResult.summary);
    await saveTasks(board, TASKS_PATH);
    expect(board.tasks[0].status).toBe("in_progress"); // Back to in_progress

    // Step 9: Fix and resubmit
    board = submitForReview(board, taskId, {
      workspacePath: wsResult.data!.worktreePath,
      branch: "feature/x",
      workspaceId: wsResult.data!.id,
    });
    await saveTasks(board, TASKS_PATH);

    // Step 10: Run acceptance suite — simulate success
    const passDir = join(TEST_DIR, "work-pass");
    mkdirSync(passDir);
    const passResult = await runAcceptanceSuite(["echo ok", "echo done"], passDir);
    expect(passResult.passed).toBe(true);

    // Step 11: Accept task
    board = acceptTask(board, taskId);
    await saveTasks(board, TASKS_PATH);
    expect(board.tasks[0].status).toBe("accepted");

    // Verify cleanup_queued event was added (since task had workspace context)
    const cleanupEvent = board.tasks[0].events.find((e) => e.type === "cleanup_queued");
    expect(cleanupEvent).toBeDefined();

    // Step 12: Cleanup workspace
    const cleanupResult = await wsManager.cleanupWorkspace(wsResult.data!.id);
    expect(cleanupResult.ok).toBe(true);

    // Verify workspace is gone
    const deleted = await wsManager.getWorkspace(wsResult.data!.id);
    expect(deleted).toBeNull();

    // Verify full event trail
    const events = board.tasks[0].events;
    const statusChanges = events.filter((e) => e.type === "status_changed");
    expect(statusChanges.length).toBeGreaterThanOrEqual(4);

    // Record completion in capability store
    capStore.recordTaskCompletion("bob", true, 10 * 60_000);
    const bobCap = capStore.get("bob");
    expect(bobCap!.totalTasks).toBe(6);
    expect(bobCap!.acceptedTasks).toBe(4);

    // Cleanup
    wsStore.close();
    capStore.close();
  });

  test("SLA detects stale tasks", async () => {
    let board = await loadTasks(TASKS_PATH);
    board = addTask(board, "Stale task", "alice");
    const taskId = board.tasks[0].id;
    board = updateTaskStatus(board, taskId, "in_progress");
    await saveTasks(board, TASKS_PATH);

    // Check with a "now" that's 35 minutes after task creation
    const now = new Date(Date.now() + 35 * 60 * 1000);
    const escalations = checkStaleTasks(board.tasks, DEFAULT_SLA_CONFIG, now);
    expect(escalations.length).toBe(1);
    expect(escalations[0].action).toBe("ping");
    expect(escalations[0].taskId).toBe(taskId);

    const message = formatEscalationMessage(escalations[0]);
    expect(message).toContain("Stale task");
    expect(message).toContain("in_progress");
  });

  test("DaemonState initializes workspace and capability stores", () => {
    const state = new DaemonState(uniqueDbPath("msg"));
    state.initWorkspace(uniqueDbPath("ws"));
    state.initCapabilities(uniqueDbPath("cap"));

    expect(state.workspaceManager).toBeDefined();
    expect(state.workspaceStore).toBeDefined();
    expect(state.capabilityStore).toBeDefined();

    state.close();
  });

  test("feature flags control store initialization", () => {
    const state = new DaemonState(uniqueDbPath("msg"));

    // Without init calls, stores are undefined
    expect(state.workspaceManager).toBeUndefined();
    expect(state.capabilityStore).toBeUndefined();

    state.close();
  });

  test("workspace git failure produces failed status", async () => {
    const failGit: GitExecutor = async () => ({
      exitCode: 128,
      stdout: "",
      stderr: "fatal: not a git repository",
    });

    const store = new WorkspaceStore(uniqueDbPath("ws"));
    const manager = new WorkspaceManager(store, failGit);

    const result = await manager.prepareWorktree({
      repoPath: "/tmp/not-a-repo",
      branch: "main",
      ownerAccount: "test",
    });

    expect(result.ok).toBe(false);
    expect(result.error_code).toBe("GIT_ERROR");
    expect(result.data!.status).toBe("failed");

    // After failure, a new prepare should be allowed (not idempotent on failed)
    const failGit2: GitExecutor = async () => ({
      exitCode: 0,
      stdout: "ok",
      stderr: "",
    });
    const manager2 = new WorkspaceManager(store, failGit2);
    const result2 = await manager2.prepareWorktree({
      repoPath: "/tmp/not-a-repo",
      branch: "main",
      ownerAccount: "test",
    });
    expect(result2.ok).toBe(true);
    expect(result2.data!.status).toBe("ready");

    store.close();
  });

  test("stale workspace recovery on restart", () => {
    const store = new WorkspaceStore(uniqueDbPath("ws"));
    // Manually insert a "preparing" workspace to simulate daemon crash
    store.create({
      id: "stale-ws-1",
      handoffId: "",
      ownerAccount: "test",
      repoPath: "/tmp/repo",
      branch: "stale-branch",
      worktreePath: "/tmp/repo/.worktrees/stale-branch",
      status: "preparing",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const mockGit: GitExecutor = async () => ({ exitCode: 0, stdout: "", stderr: "" });
    const manager = new WorkspaceManager(store, mockGit);

    // Recovery should mark stale "preparing" as "failed"
    manager.recoverStaleWorkspaces();
    const ws = store.getById("stale-ws-1");
    expect(ws!.status).toBe("failed");

    store.close();
  });
});
