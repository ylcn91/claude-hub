import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { existsSync, readFileSync, mkdirSync, rmSync, statSync, writeFileSync } from "fs";
import { mkdir, readFile, symlink } from "node:fs/promises";
import {
  setupAccount,
  teardownAccount,
  addShellAlias,
  generateToken,
  CATPPUCCIN_COLORS,
} from "../src/services/account-manager";

const TEST_DIR = join(import.meta.dir, ".test-accounts");
const TEST_CONFIG = join(TEST_DIR, "config.json");
const TEST_TOKENS = join(TEST_DIR, "tokens");
const TEST_ACCOUNTS_DIR = join(TEST_DIR, "accounts");

// Point env to test dir so config/tokens go to isolated location
const origHubDir = process.env.AGENTCTL_DIR;

beforeEach(() => {
  process.env.AGENTCTL_DIR = TEST_DIR;
  mkdirSync(TEST_DIR, { recursive: true });
  mkdirSync(TEST_TOKENS, { recursive: true });
  mkdirSync(TEST_ACCOUNTS_DIR, { recursive: true });
});

afterEach(() => {
  process.env.AGENTCTL_DIR = origHubDir;
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("generateToken", () => {
  test("generates 64-char hex string (32 bytes)", () => {
    const token = generateToken();
    expect(token).toHaveLength(64);
    expect(/^[0-9a-f]+$/.test(token)).toBe(true);
  });

  test("generates unique tokens", () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).not.toBe(b);
  });
});

describe("CATPPUCCIN_COLORS", () => {
  test("has at least 10 colors", () => {
    expect(CATPPUCCIN_COLORS.length).toBeGreaterThanOrEqual(10);
  });

  test("each color has name and hex", () => {
    for (const c of CATPPUCCIN_COLORS) {
      expect(c.name).toBeTruthy();
      expect(c.hex).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe("setupAccount", () => {
  test("creates config directory", async () => {
    const configDir = join(TEST_ACCOUNTS_DIR, "test-account");
    await setupAccount({
      name: "test",
      configDir,
      color: "#cba6f7",
      label: "Test",
      symlinkPlugins: false,
      symlinkSkills: false,
      symlinkCommands: false,
      addShellAlias: false,
      configPath: TEST_CONFIG,
    });
    expect(existsSync(configDir)).toBe(true);
  });

  test("generates token file with 0600 permissions", async () => {
    const configDir = join(TEST_ACCOUNTS_DIR, "token-test");
    const { tokenPath } = await setupAccount({
      name: "token-test",
      configDir,
      color: "#89b4fa",
      label: "Token",
      symlinkPlugins: false,
      symlinkSkills: false,
      symlinkCommands: false,
      configPath: TEST_CONFIG,
    });
    expect(existsSync(tokenPath)).toBe(true);

    const token = readFileSync(tokenPath, "utf-8");
    expect(token).toHaveLength(64);

    const mode = statSync(tokenPath).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  test("adds account to hub config", async () => {
    const configDir = join(TEST_ACCOUNTS_DIR, "config-test");
    await setupAccount({
      name: "config-test",
      configDir,
      color: "#a6e3a1",
      label: "Config",
      symlinkPlugins: false,
      symlinkSkills: false,
      symlinkCommands: false,
      configPath: TEST_CONFIG,
    });

    const config = JSON.parse(readFileSync(TEST_CONFIG, "utf-8"));
    expect(config.accounts).toHaveLength(1);
    expect(config.accounts[0].name).toBe("config-test");
    expect(config.accounts[0].color).toBe("#a6e3a1");
    expect(config.accounts[0].label).toBe("Config");
  });

  test("sets up MCP config in settings.json", async () => {
    const configDir = join(TEST_ACCOUNTS_DIR, "mcp-test");
    await setupAccount({
      name: "mcp-test",
      configDir,
      color: "#f38ba8",
      label: "MCP",
      symlinkPlugins: false,
      symlinkSkills: false,
      symlinkCommands: false,
      configPath: TEST_CONFIG,
    });

    const settingsPath = join(configDir, "settings.json");
    expect(existsSync(settingsPath)).toBe(true);

    const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    expect(settings.mcpServers).toBeDefined();
    expect(settings.mcpServers["agentctl"]).toEqual({
      command: "ac",
      args: ["bridge", "--account", "mcp-test"],
    });
  });

  test("rejects duplicate account name", async () => {
    const dir1 = join(TEST_ACCOUNTS_DIR, "dup1");
    const dir2 = join(TEST_ACCOUNTS_DIR, "dup2");
    await setupAccount({
      name: "dupe",
      configDir: dir1,
      color: "#cba6f7",
      label: "First",
      symlinkPlugins: false,
      symlinkSkills: false,
      symlinkCommands: false,
      configPath: TEST_CONFIG,
    });

    await expect(
      setupAccount({
        name: "dupe",
        configDir: dir2,
        color: "#89b4fa",
        label: "Second",
        symlinkPlugins: false,
        symlinkSkills: false,
        symlinkCommands: false,
        configPath: TEST_CONFIG,
      })
    ).rejects.toThrow("Account 'dupe' already exists");
  });

  test("creates symlinks when source dirs exist", async () => {
    // Create fake ~/.claude with plugins dir
    const fakeClaudeDir = join(TEST_DIR, "fake-claude");
    const pluginsDir = join(fakeClaudeDir, "plugins");
    mkdirSync(pluginsDir, { recursive: true });

    // Temporarily override HOME
    const origHome = process.env.HOME;
    process.env.HOME = TEST_DIR;

    // Create .claude/plugins in our fake home
    const dotClaudePlugins = join(TEST_DIR, ".claude", "plugins");
    mkdirSync(dotClaudePlugins, { recursive: true });

    const configDir = join(TEST_ACCOUNTS_DIR, "symlink-test");
    try {
      await setupAccount({
        name: "symlink-test",
        configDir,
        color: "#94e2d5",
        label: "Symlink",
        symlinkPlugins: true,
        symlinkSkills: false,
        symlinkCommands: false,
        configPath: TEST_CONFIG,
      });

      const linkedPlugins = join(configDir, "plugins");
      expect(existsSync(linkedPlugins)).toBe(true);
    } finally {
      process.env.HOME = origHome;
    }
  });
});

describe("teardownAccount", () => {
  test("removes account from config and deletes token", async () => {
    const configDir = join(TEST_ACCOUNTS_DIR, "teardown-test");
    const { tokenPath } = await setupAccount({
      name: "teardown",
      configDir,
      color: "#cba6f7",
      label: "Teardown",
      symlinkPlugins: false,
      symlinkSkills: false,
      symlinkCommands: false,
      configPath: TEST_CONFIG,
    });

    expect(existsSync(tokenPath)).toBe(true);

    await teardownAccount("teardown", { configPath: TEST_CONFIG });

    expect(existsSync(tokenPath)).toBe(false);
    const config = JSON.parse(readFileSync(TEST_CONFIG, "utf-8"));
    expect(config.accounts).toHaveLength(0);
  });

  test("purge removes config directory", async () => {
    const configDir = join(TEST_ACCOUNTS_DIR, "purge-test");
    await setupAccount({
      name: "purge",
      configDir,
      color: "#f9e2af",
      label: "Purge",
      symlinkPlugins: false,
      symlinkSkills: false,
      symlinkCommands: false,
      configPath: TEST_CONFIG,
    });

    expect(existsSync(configDir)).toBe(true);

    await teardownAccount("purge", { purge: true, configPath: TEST_CONFIG });

    expect(existsSync(configDir)).toBe(false);
  });

  test("throws for non-existent account", async () => {
    await expect(
      teardownAccount("nonexistent", { configPath: TEST_CONFIG })
    ).rejects.toThrow("Account 'nonexistent' not found");
  });

  test("without purge preserves config directory", async () => {
    const configDir = join(TEST_ACCOUNTS_DIR, "no-purge");
    await setupAccount({
      name: "nopurge",
      configDir,
      color: "#fab387",
      label: "NoPurge",
      symlinkPlugins: false,
      symlinkSkills: false,
      symlinkCommands: false,
      configPath: TEST_CONFIG,
    });

    await teardownAccount("nopurge", { configPath: TEST_CONFIG });

    // Config dir should still exist
    expect(existsSync(configDir)).toBe(true);
  });
});

describe("addShellAlias", () => {
  test("adds alias to .zshrc", async () => {
    const origHome = process.env.HOME;
    process.env.HOME = TEST_DIR;

    try {
      const { modified } = await addShellAlias("work", "~/.claude-work");
      expect(modified).toBe(true);

      const zshrc = readFileSync(join(TEST_DIR, ".zshrc"), "utf-8");
      expect(zshrc).toContain("# agentctl:work");
      expect(zshrc).toContain('alias claude-work=');
    } finally {
      process.env.HOME = origHome;
    }
  });

  test("is idempotent - no duplicate aliases", async () => {
    const origHome = process.env.HOME;
    process.env.HOME = TEST_DIR;

    try {
      await addShellAlias("idem", "~/.claude-idem");
      const { modified } = await addShellAlias("idem", "~/.claude-idem");
      expect(modified).toBe(false);

      const zshrc = readFileSync(join(TEST_DIR, ".zshrc"), "utf-8");
      const count = (zshrc.match(/# agentctl:idem/g) || []).length;
      expect(count).toBe(1);
    } finally {
      process.env.HOME = origHome;
    }
  });

  test("backs up .zshrc before modifying", async () => {
    const origHome = process.env.HOME;
    process.env.HOME = TEST_DIR;

    // Create existing .zshrc
    writeFileSync(join(TEST_DIR, ".zshrc"), "# existing content\n");

    try {
      const { modified, backupPath } = await addShellAlias("backup", "~/.claude-backup");
      expect(modified).toBe(true);
      expect(backupPath).not.toBeNull();
      expect(existsSync(backupPath!)).toBe(true);

      const backup = readFileSync(backupPath!, "utf-8");
      expect(backup).toBe("# existing content\n");
    } finally {
      process.env.HOME = origHome;
    }
  });
});
