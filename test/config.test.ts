import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { loadConfig, saveConfig, migrateConfig, addAccount, removeAccount } from "../src/config";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";

const TEST_DIR = join(import.meta.dir, ".test-config");
const TEST_CONFIG = join(TEST_DIR, "config.json");

let savedAgentctlDir: string | undefined;

beforeEach(() => {
  savedAgentctlDir = process.env.AGENTCTL_DIR;
  process.env.AGENTCTL_DIR = TEST_DIR;
  mkdirSync(TEST_DIR, { recursive: true });
  mkdirSync(join(TEST_DIR, "tokens"), { recursive: true });
});

afterEach(() => {
  if (savedAgentctlDir === undefined) {
    delete process.env.AGENTCTL_DIR;
  } else {
    process.env.AGENTCTL_DIR = savedAgentctlDir;
  }
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("loadConfig", () => {
  test("returns default config when no file exists", async () => {
    const config = await loadConfig(TEST_CONFIG);
    expect(config.schemaVersion).toBe(1);
    expect(config.accounts).toEqual([]);
  });

  test("loads existing config", async () => {
    writeFileSync(TEST_CONFIG, JSON.stringify({
      schemaVersion: 1,
      accounts: [{ name: "test", configDir: "~/.claude-test", color: "#cba6f7", label: "Test", provider: "claude-code" }],
      entire: { autoEnable: true },
      defaults: { launchInNewWindow: true, quotaPolicy: { plan: "max-5x", windowMs: 18000000, estimatedLimit: 225, source: "community-estimate" } },
    }));
    const config = await loadConfig(TEST_CONFIG);
    expect(config.accounts).toHaveLength(1);
    expect(config.accounts[0].name).toBe("test");
  });

  test("tolerates unknown fields without crashing", async () => {
    writeFileSync(TEST_CONFIG, JSON.stringify({
      schemaVersion: 1,
      accounts: [],
      entire: { autoEnable: true },
      defaults: { launchInNewWindow: true, quotaPolicy: { plan: "max-5x", windowMs: 18000000, estimatedLimit: 225, source: "community-estimate" } },
      unknownField: "should not crash",
    }));
    const config = await loadConfig(TEST_CONFIG);
    expect(config.schemaVersion).toBe(1);
  });
});

describe("addAccount", () => {
  test("adds account to config", async () => {
    const config = await loadConfig(TEST_CONFIG);
    const updated = addAccount(config, {
      name: "claude-work",
      configDir: "~/.claude-work",
      color: "#74c7ec",
      label: "Work",
      provider: "claude-code",
    });
    expect(updated.accounts).toHaveLength(1);
    expect(updated.accounts[0].name).toBe("claude-work");
  });

  test("rejects duplicate account name", () => {
    const config = {
      ...( { schemaVersion: 1, accounts: [{ name: "claude", configDir: "~/.claude", color: "#cba6f7", label: "Default", provider: "claude-code" as const }], entire: { autoEnable: true }, defaults: { launchInNewWindow: true, quotaPolicy: { plan: "max-5x" as const, windowMs: 18000000, estimatedLimit: 225, source: "community-estimate" as const } } }),
    };
    expect(() => addAccount(config, { name: "claude", configDir: "~/.claude2", color: "#f00", label: "Dup", provider: "claude-code" }))
      .toThrow("Account 'claude' already exists");
  });
});

describe("removeAccount", () => {
  test("removes account by name", () => {
    const config = {
      schemaVersion: 1,
      accounts: [
        { name: "claude", configDir: "~/.claude", color: "#cba6f7", label: "Default", provider: "claude-code" as const },
        { name: "claude-admin", configDir: "~/.claude-admin", color: "#f38ba8", label: "Admin", provider: "claude-code" as const },
      ],
      entire: { autoEnable: true },
      defaults: { launchInNewWindow: true, quotaPolicy: { plan: "max-5x" as const, windowMs: 18000000, estimatedLimit: 225, source: "community-estimate" as const } },
    };
    const updated = removeAccount(config, "claude-admin");
    expect(updated.accounts).toHaveLength(1);
    expect(updated.accounts[0].name).toBe("claude");
  });
});

describe("saveConfig + loadConfig roundtrip", () => {
  test("saves and reloads config correctly", async () => {
    const config = await loadConfig(TEST_CONFIG);
    const updated = addAccount(config, {
      name: "roundtrip",
      configDir: "~/.claude-roundtrip",
      color: "#a6e3a1",
      label: "Roundtrip",
      provider: "claude-code",
    });
    await saveConfig(updated, TEST_CONFIG);

    const reloaded = await loadConfig(TEST_CONFIG);
    expect(reloaded.accounts).toHaveLength(1);
    expect(reloaded.accounts[0].name).toBe("roundtrip");
    expect(reloaded.accounts[0].color).toBe("#a6e3a1");
    expect(reloaded.schemaVersion).toBe(1);
    expect(reloaded.defaults.quotaPolicy.plan).toBe("max-5x");
  });
});

describe("migrateConfig", () => {
  test("v1 config needs no migration", async () => {
    writeFileSync(TEST_CONFIG, JSON.stringify({ schemaVersion: 1, accounts: [], entire: { autoEnable: true }, defaults: { launchInNewWindow: true, quotaPolicy: { plan: "max-5x", windowMs: 18000000, estimatedLimit: 225, source: "community-estimate" } } }));
    const { migrated, backupPath } = await migrateConfig(TEST_CONFIG);
    expect(migrated).toBe(false);
    expect(backupPath).toBeNull();
  });

  test("v0 config is migrated to v1 with defaults", async () => {
    writeFileSync(TEST_CONFIG, JSON.stringify({
      accounts: [{ name: "old-account", configDir: "~/.claude-old", color: "#cba6f7", label: "Old", provider: "claude-code" }],
    }));
    const { migrated, backupPath } = await migrateConfig(TEST_CONFIG);
    expect(migrated).toBe(true);
    expect(backupPath).not.toBeNull();

    const config = await loadConfig(TEST_CONFIG);
    expect(config.schemaVersion).toBe(1);
    expect(config.accounts).toHaveLength(1);
    expect(config.accounts[0].name).toBe("old-account");
    // Should have defaults merged in
    expect(config.entire.autoEnable).toBe(true);
    expect(config.defaults.launchInNewWindow).toBe(true);
  });

  test("v0 config with missing fields gets defaults", async () => {
    writeFileSync(TEST_CONFIG, JSON.stringify({}));
    const { migrated } = await migrateConfig(TEST_CONFIG);
    expect(migrated).toBe(true);

    const config = await loadConfig(TEST_CONFIG);
    expect(config.schemaVersion).toBe(1);
    expect(config.accounts).toEqual([]);
    expect(config.entire.autoEnable).toBe(true);
    expect(config.defaults.quotaPolicy.plan).toBe("max-5x");
  });

  test("returns no migration for nonexistent file", async () => {
    const { migrated, backupPath } = await migrateConfig(join(TEST_DIR, "nonexistent.json"));
    expect(migrated).toBe(false);
    expect(backupPath).toBeNull();
  });
});

describe("loadConfig edge cases", () => {
  test("tolerates missing entire field", async () => {
    writeFileSync(TEST_CONFIG, JSON.stringify({
      schemaVersion: 1,
      accounts: [],
      defaults: { launchInNewWindow: true, quotaPolicy: { plan: "max-5x", windowMs: 18000000, estimatedLimit: 225, source: "community-estimate" } },
    }));
    const config = await loadConfig(TEST_CONFIG);
    expect(config.entire.autoEnable).toBe(true); // default
  });

  test("tolerates missing defaults field", async () => {
    writeFileSync(TEST_CONFIG, JSON.stringify({
      schemaVersion: 1,
      accounts: [],
      entire: { autoEnable: false },
    }));
    const config = await loadConfig(TEST_CONFIG);
    expect(config.entire.autoEnable).toBe(false);
    expect(config.defaults.launchInNewWindow).toBe(true); // default
    expect(config.defaults.quotaPolicy.plan).toBe("max-5x");
  });

  test("tolerates non-array accounts field", async () => {
    writeFileSync(TEST_CONFIG, JSON.stringify({
      schemaVersion: 1,
      accounts: "not-an-array",
      entire: { autoEnable: true },
      defaults: { launchInNewWindow: true, quotaPolicy: { plan: "max-5x", windowMs: 18000000, estimatedLimit: 225, source: "community-estimate" } },
    }));
    const config = await loadConfig(TEST_CONFIG);
    expect(config.accounts).toEqual([]);
  });

  test("tolerates missing schemaVersion", async () => {
    writeFileSync(TEST_CONFIG, JSON.stringify({
      accounts: [],
      entire: { autoEnable: true },
      defaults: { launchInNewWindow: true, quotaPolicy: { plan: "max-5x", windowMs: 18000000, estimatedLimit: 225, source: "community-estimate" } },
    }));
    const config = await loadConfig(TEST_CONFIG);
    expect(config.schemaVersion).toBe(1); // default
  });
});
