import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// ─── paths.ts ────────────────────────────────────────────────────────

describe("paths module", () => {
  const originalHome = process.env.HOME;
  const originalHubDir = process.env.CLAUDE_HUB_DIR;

  afterEach(() => {
    process.env.HOME = originalHome;
    if (originalHubDir) process.env.CLAUDE_HUB_DIR = originalHubDir;
    else delete process.env.CLAUDE_HUB_DIR;
  });

  test("assertHomeDir throws when HOME is unset", async () => {
    const { assertHomeDir } = await import("../src/paths");
    delete process.env.HOME;
    expect(() => assertHomeDir()).toThrow("HOME environment variable is not set");
  });

  test("getHubDir uses CLAUDE_HUB_DIR when set", async () => {
    const { getHubDir } = await import("../src/paths");
    process.env.CLAUDE_HUB_DIR = "/custom/hub";
    expect(getHubDir()).toBe("/custom/hub");
  });

  test("getHubDir falls back to HOME/.claude-hub", async () => {
    const { getHubDir } = await import("../src/paths");
    delete process.env.CLAUDE_HUB_DIR;
    process.env.HOME = "/test-home";
    expect(getHubDir()).toBe("/test-home/.claude-hub");
  });

  test("all path functions derive from getHubDir", async () => {
    const paths = await import("../src/paths");
    process.env.CLAUDE_HUB_DIR = "/hub";
    expect(paths.getSockPath()).toBe("/hub/hub.sock");
    expect(paths.getPidPath()).toBe("/hub/daemon.pid");
    expect(paths.getTokensDir()).toBe("/hub/tokens");
    expect(paths.getConfigPath()).toBe("/hub/config.json");
    expect(paths.getMessagesDbPath()).toBe("/hub/messages.db");
    expect(paths.getWorkspacesDbPath()).toBe("/hub/workspaces.db");
    expect(paths.getCapabilitiesDbPath()).toBe("/hub/capabilities.db");
    expect(paths.getDaemonLogPath()).toBe("/hub/daemon.log");
    expect(paths.getTasksPath()).toBe("/hub/tasks.json");
  });
});

// ─── base-store.ts ───────────────────────────────────────────────────

describe("BaseStore", () => {
  test("creates a database with WAL mode", async () => {
    const { BaseStore } = await import("../src/daemon/base-store");
    const dbPath = join(tmpdir(), `test-base-store-${Date.now()}.db`);

    class TestStore extends BaseStore {
      protected createTables(): void {
        this.db.exec("CREATE TABLE IF NOT EXISTS test (id TEXT PRIMARY KEY)");
      }
    }

    const store = new TestStore(dbPath);
    const result = store["db"].query("PRAGMA journal_mode").get() as { journal_mode: string };
    expect(result.journal_mode).toBe("wal");
    store.close();
    rmSync(dbPath, { force: true });
  });

  test("close() closes the database", async () => {
    const { BaseStore } = await import("../src/daemon/base-store");
    const dbPath = join(tmpdir(), `test-base-store-close-${Date.now()}.db`);

    class TestStore extends BaseStore {
      protected createTables(): void {}
    }

    const store = new TestStore(dbPath);
    store.close();
    expect(() => store["db"].query("SELECT 1").get()).toThrow();
    rmSync(dbPath, { force: true });
  });
});

// ─── workspace.ts branch validation ─────────────────────────────────

describe("isValidBranch", () => {
  let isValidBranch: (branch: string) => boolean;

  beforeEach(async () => {
    const mod = await import("../src/services/workspace");
    isValidBranch = mod.isValidBranch;
  });

  test("accepts simple branch names", () => {
    expect(isValidBranch("main")).toBe(true);
    expect(isValidBranch("develop")).toBe(true);
    expect(isValidBranch("feature-123")).toBe(true);
  });

  test("accepts namespaced branches with /", () => {
    expect(isValidBranch("feature/my-feature")).toBe(true);
    expect(isValidBranch("hotfix/v1.2.3")).toBe(true);
  });

  test("rejects path traversal with ..", () => {
    expect(isValidBranch("../etc/passwd")).toBe(false);
    expect(isValidBranch("feature/../exploit")).toBe(false);
  });

  test("rejects leading /", () => {
    expect(isValidBranch("/absolute")).toBe(false);
  });

  test("rejects leading -", () => {
    expect(isValidBranch("-bad-flag")).toBe(false);
  });

  test("rejects segments starting with .", () => {
    expect(isValidBranch(".hidden")).toBe(false);
    expect(isValidBranch("feature/.hidden")).toBe(false);
  });

  test("rejects empty string", () => {
    expect(isValidBranch("")).toBe(false);
  });

  test("rejects branches exceeding 200 chars", () => {
    expect(isValidBranch("a".repeat(201))).toBe(false);
    expect(isValidBranch("a".repeat(200))).toBe(true);
  });

  test("rejects empty segments from double //", () => {
    expect(isValidBranch("feature//branch")).toBe(false);
  });
});

// ─── daemon server.ts hardening ──────────────────────────────────────

describe("daemon server hardening", () => {
  const testDir = join(tmpdir(), `hub-hardening-${Date.now()}`);
  const tokensDir = join(testDir, "tokens");

  beforeEach(() => {
    mkdirSync(tokensDir, { recursive: true });
    process.env.CLAUDE_HUB_DIR = testDir;
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    delete process.env.CLAUDE_HUB_DIR;
  });

  test("verifyAccountToken is async and validates correctly", async () => {
    const { verifyAccountToken } = await import("../src/daemon/server");
    writeFileSync(join(tokensDir, "test-acct.token"), "secret-token-123\n");

    const valid = await verifyAccountToken("test-acct", "secret-token-123");
    expect(valid).toBe(true);

    const invalid = await verifyAccountToken("test-acct", "wrong");
    expect(invalid).toBe(false);

    const missing = await verifyAccountToken("nonexistent", "any");
    expect(missing).toBe(false);
  });

  test("verifyAccountToken rejects unsafe account names", async () => {
    const { verifyAccountToken } = await import("../src/daemon/server");
    expect(await verifyAccountToken("../etc/passwd", "token")).toBe(false);
    expect(await verifyAccountToken("", "token")).toBe(false);
    expect(await verifyAccountToken("a".repeat(64), "token")).toBe(false);
  });

  test("daemon starts and stops cleanly", async () => {
    const { startDaemon, stopDaemon } = await import("../src/daemon/server");
    const sockPath = join(testDir, `test-${Date.now()}.sock`);
    const { server, state, watchdog } = startDaemon({
      dbPath: ":memory:",
      sockPath,
    });
    expect(server.listening).toBe(true);
    stopDaemon(server, sockPath, watchdog);
  });
});

// ─── config schema validation ────────────────────────────────────────

describe("config schema validation", () => {
  const testDir = join(tmpdir(), `hub-config-${Date.now()}`);

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
    process.env.CLAUDE_HUB_DIR = testDir;
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    delete process.env.CLAUDE_HUB_DIR;
  });

  test("loadConfig returns defaults for nonexistent file", async () => {
    const { loadConfig } = await import("../src/config");
    const config = await loadConfig(join(testDir, "nonexistent.json"));
    expect(config.schemaVersion).toBe(1);
    expect(config.accounts).toEqual([]);
  });

  test("loadConfig returns defaults for invalid config", async () => {
    const { loadConfig } = await import("../src/config");
    const configPath = join(testDir, "bad-config.json");
    writeFileSync(configPath, JSON.stringify({
      schemaVersion: "not-a-number",
      accounts: "not-an-array",
    }));
    const config = await loadConfig(configPath);
    expect(config.schemaVersion).toBe(1);
    expect(config.accounts).toEqual([]);
  });

  test("loadConfig accepts valid config", async () => {
    const { loadConfig } = await import("../src/config");
    const { DEFAULT_CONFIG } = await import("../src/types");
    const configPath = join(testDir, "good-config.json");
    writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG));
    const config = await loadConfig(configPath);
    expect(config.schemaVersion).toBe(1);
  });
});

// ─── store refactoring ───────────────────────────────────────────────

describe("stores extend BaseStore", () => {
  test("MessageStore extends BaseStore", async () => {
    const { MessageStore } = await import("../src/daemon/message-store");
    const { BaseStore } = await import("../src/daemon/base-store");
    const store = new MessageStore(":memory:");
    expect(store instanceof BaseStore).toBe(true);
    store.close();
  });

  test("WorkspaceStore extends BaseStore", async () => {
    const { WorkspaceStore } = await import("../src/daemon/workspace-store");
    const { BaseStore } = await import("../src/daemon/base-store");
    const store = new WorkspaceStore(":memory:");
    expect(store instanceof BaseStore).toBe(true);
    store.close();
  });

  test("CapabilityStore extends BaseStore", async () => {
    const { CapabilityStore } = await import("../src/daemon/capability-store");
    const { BaseStore } = await import("../src/daemon/base-store");
    const store = new CapabilityStore(":memory:");
    expect(store instanceof BaseStore).toBe(true);
    store.close();
  });

  test("KnowledgeStore extends BaseStore", async () => {
    const { KnowledgeStore } = await import("../src/daemon/knowledge-store");
    const { BaseStore } = await import("../src/daemon/base-store");
    const store = new KnowledgeStore(":memory:");
    expect(store instanceof BaseStore).toBe(true);
    store.close();
  });
});
