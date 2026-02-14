import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { WorkspaceStore } from "../src/daemon/workspace-store";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("WorkspaceStore", () => {
  let store: WorkspaceStore;
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ws-store-"));
    dbPath = join(tmpDir, "test.db");
    store = new WorkspaceStore(dbPath);
  });

  afterEach(() => {
    store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  const makeWorkspace = (overrides: Record<string, any> = {}) => ({
    id: crypto.randomUUID(),
    handoffId: "",
    ownerAccount: "alice",
    repoPath: "/home/user/repo",
    branch: "main",
    worktreePath: "/home/user/repo/.worktrees/main",
    status: "preparing" as const,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  });

  test("create and getById round-trip", () => {
    const ws = makeWorkspace();
    store.create(ws);

    const result = store.getById(ws.id);
    expect(result).not.toBeNull();
    expect(result!.id).toBe(ws.id);
    expect(result!.ownerAccount).toBe("alice");
    expect(result!.repoPath).toBe("/home/user/repo");
    expect(result!.branch).toBe("main");
    expect(result!.status).toBe("preparing");
    expect(result!.events).toHaveLength(0);
  });

  test("getActiveByKey returns active, not failed", () => {
    const active = makeWorkspace({ status: "ready" as const });
    const failed = makeWorkspace({
      id: crypto.randomUUID(),
      status: "failed" as const,
    });
    store.create(active);
    store.create(failed);

    const result = store.getActiveByKey("/home/user/repo", "main");
    expect(result).not.toBeNull();
    expect(result!.id).toBe(active.id);
    expect(result!.status).toBe("ready");
  });

  test("updateStatus changes status", () => {
    const oldTime = new Date(Date.now() - 5000).toISOString();
    const ws = makeWorkspace({ createdAt: oldTime, updatedAt: oldTime });
    store.create(ws);

    store.updateStatus(ws.id, "ready");
    const result = store.getById(ws.id);
    expect(result!.status).toBe("ready");
    expect(result!.updatedAt).not.toBe(oldTime);
  });

  test("addEvent adds events to workspace", () => {
    const ws = makeWorkspace();
    store.create(ws);

    store.addEvent(ws.id, {
      type: "workspace_preparing",
      timestamp: new Date().toISOString(),
      to: "preparing",
    });
    store.addEvent(ws.id, {
      type: "workspace_ready",
      timestamp: new Date().toISOString(),
      from: "preparing",
      to: "ready",
    });

    const result = store.getById(ws.id);
    expect(result!.events).toHaveLength(2);
    expect(result!.events[0].type).toBe("workspace_preparing");
    expect(result!.events[1].type).toBe("workspace_ready");
    expect(result!.events[1].from).toBe("preparing");
    expect(result!.events[1].to).toBe("ready");
  });

  test("delete removes workspace and events", () => {
    const ws = makeWorkspace();
    store.create(ws);
    store.addEvent(ws.id, {
      type: "workspace_preparing",
      timestamp: new Date().toISOString(),
      to: "preparing",
    });

    store.delete(ws.id);
    expect(store.getById(ws.id)).toBeNull();
  });

  test("close and reopen preserves data", () => {
    const ws = makeWorkspace();
    store.create(ws);
    store.addEvent(ws.id, {
      type: "workspace_preparing",
      timestamp: new Date().toISOString(),
      to: "preparing",
    });

    store.close();
    store = new WorkspaceStore(dbPath);

    const result = store.getById(ws.id);
    expect(result).not.toBeNull();
    expect(result!.id).toBe(ws.id);
    expect(result!.events).toHaveLength(1);
  });

  test("getByStatus returns matching workspaces", () => {
    store.create(makeWorkspace({ id: "a", status: "preparing" as const }));
    store.create(makeWorkspace({ id: "b", status: "ready" as const, branch: "dev" }));
    store.create(makeWorkspace({ id: "c", status: "preparing" as const, branch: "feat" }));

    const preparing = store.getByStatus("preparing");
    expect(preparing).toHaveLength(2);
    expect(preparing.map((w) => w.id).sort()).toEqual(["a", "c"]);
  });
});
