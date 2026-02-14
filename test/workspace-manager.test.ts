import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { WorkspaceManager, type GitExecutor } from "../src/daemon/workspace-manager";
import { WorkspaceStore } from "../src/daemon/workspace-store";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("WorkspaceManager", () => {
  let store: WorkspaceStore;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ws-mgr-"));
    store = new WorkspaceStore(join(tmpDir, "test.db"));
  });

  afterEach(() => {
    store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  const successGit: GitExecutor = async () => ({
    exitCode: 0,
    stdout: "Preparing worktree",
    stderr: "",
  });

  const failGit: GitExecutor = async () => ({
    exitCode: 128,
    stdout: "",
    stderr: "fatal: branch not found",
  });

  const validReq = {
    repoPath: "/home/user/repo",
    branch: "feature/test",
    ownerAccount: "alice",
  };

  test("prepareWorktree success flow", async () => {
    const mgr = new WorkspaceManager(store, successGit);
    const res = await mgr.prepareWorktree(validReq);

    expect(res.ok).toBe(true);
    expect(res.data).toBeDefined();
    expect(res.data!.status).toBe("ready");
    expect(res.data!.repoPath).toBe("/home/user/repo");
    expect(res.data!.branch).toBe("feature/test");
    expect(res.data!.worktreePath).toBe("/home/user/repo/.worktrees/feature-test");
    expect(res.data!.events).toHaveLength(2);
    expect(res.data!.events[0].type).toBe("workspace_preparing");
    expect(res.data!.events[1].type).toBe("workspace_ready");
  });

  test("prepareWorktree is idempotent", async () => {
    const mgr = new WorkspaceManager(store, successGit);
    const first = await mgr.prepareWorktree(validReq);
    const second = await mgr.prepareWorktree(validReq);

    expect(second.ok).toBe(true);
    expect(second.data!.id).toBe(first.data!.id);
  });

  test("prepareWorktree with git failure results in failed status", async () => {
    const mgr = new WorkspaceManager(store, failGit);
    const res = await mgr.prepareWorktree(validReq);

    expect(res.ok).toBe(false);
    expect(res.error_code).toBe("GIT_ERROR");
    expect(res.data!.status).toBe("failed");
    expect(res.data!.events).toHaveLength(2);
    expect(res.data!.events[1].type).toBe("workspace_failed");
    expect(res.data!.events[1].error).toBe("fatal: branch not found");
  });

  test("cleanupWorkspace removes workspace", async () => {
    const mgr = new WorkspaceManager(store, successGit);
    const created = await mgr.prepareWorktree(validReq);
    const id = created.data!.id;

    const res = await mgr.cleanupWorkspace(id);
    expect(res.ok).toBe(true);

    const ws = await mgr.getWorkspace(id);
    expect(ws).toBeNull();
  });

  test("cleanupWorkspace returns NOT_FOUND for missing id", async () => {
    const mgr = new WorkspaceManager(store, successGit);
    const res = await mgr.cleanupWorkspace("nonexistent-id");
    expect(res.ok).toBe(false);
    expect(res.error_code).toBe("NOT_FOUND");
  });

  test("recoverStaleWorkspaces marks preparing as failed", async () => {
    const mgr = new WorkspaceManager(store, successGit);

    // Manually create a "preparing" workspace (simulating a stale state)
    const now = new Date().toISOString();
    store.create({
      id: "stale-1",
      handoffId: "",
      ownerAccount: "alice",
      repoPath: "/repo",
      branch: "stale-branch",
      worktreePath: "/repo/.worktrees/stale-branch",
      status: "preparing",
      createdAt: now,
      updatedAt: now,
    });

    mgr.recoverStaleWorkspaces();

    const ws = store.getById("stale-1");
    expect(ws).not.toBeNull();
    expect(ws!.status).toBe("failed");
    expect(ws!.events).toHaveLength(1);
    expect(ws!.events[0].error).toBe("Recovered stale workspace");
  });

  test("prepareWorktree rejects invalid request", async () => {
    const mgr = new WorkspaceManager(store, successGit);
    const res = await mgr.prepareWorktree({
      repoPath: "relative/path",
      branch: "",
      ownerAccount: "",
    });

    expect(res.ok).toBe(false);
    expect(res.error_code).toBe("VALIDATION_ERROR");
  });
});
