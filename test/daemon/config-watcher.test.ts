import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { ConfigWatcher } from "../../src/daemon/config-watcher";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";

const TEST_DIR = join(import.meta.dir, ".test-config-watcher");
const CONFIG_PATH = join(TEST_DIR, "config.json");

function writeConfig(data: object): void {
  writeFileSync(CONFIG_PATH, JSON.stringify(data));
}

const DEFAULT_CONFIG = {
  schemaVersion: 1,
  accounts: [],
  entire: { autoEnable: true },
  defaults: {
    launchInNewWindow: true,
    quotaPolicy: {
      plan: "max-5x",
      windowMs: 300000,
      estimatedLimit: 45,
      source: "community-estimate",
    },
  },
};

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
  writeConfig(DEFAULT_CONFIG);
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("ConfigWatcher", () => {
  test("constructor creates watcher with defaults", () => {
    const watcher = new ConfigWatcher(() => {}, { configPath: CONFIG_PATH });
    expect(watcher.isWatching()).toBe(false);
    watcher.stop();
  });

  test("start() begins watching", () => {
    const watcher = new ConfigWatcher(() => {}, { configPath: CONFIG_PATH });
    watcher.start();
    expect(watcher.isWatching()).toBe(true);
    watcher.stop();
    expect(watcher.isWatching()).toBe(false);
  });

  test("start() is idempotent", () => {
    const watcher = new ConfigWatcher(() => {}, { configPath: CONFIG_PATH });
    watcher.start();
    watcher.start(); // second call should not throw
    expect(watcher.isWatching()).toBe(true);
    watcher.stop();
  });

  test("reload() loads config and calls handler", async () => {
    let received: any = null;
    const watcher = new ConfigWatcher((config) => {
      received = config;
    }, { configPath: CONFIG_PATH });

    const result = await watcher.reload();
    expect(result).not.toBeNull();
    expect(received).not.toBeNull();
    expect(received.schemaVersion).toBe(1);
    watcher.stop();
  });

  test("reload() returns null when config unchanged", async () => {
    const watcher = new ConfigWatcher(() => {}, { configPath: CONFIG_PATH });

    const first = await watcher.reload();
    expect(first).not.toBeNull();

    const second = await watcher.reload();
    expect(second).toBeNull();
    watcher.stop();
  });

  test("reload() detects config changes", async () => {
    let callCount = 0;
    const watcher = new ConfigWatcher(() => { callCount++; }, { configPath: CONFIG_PATH });

    await watcher.reload();
    expect(callCount).toBe(1);

    // Modify config
    writeConfig({
      ...DEFAULT_CONFIG,
      accounts: [{ name: "test", configDir: "~/.test", color: "#000", label: "Test", provider: "claude-code" }],
    });

    const result = await watcher.reload();
    expect(result).not.toBeNull();
    expect(callCount).toBe(2);
    watcher.stop();
  });

  test("reload() handles invalid config gracefully", async () => {
    let received: any = null;
    const watcher = new ConfigWatcher((config) => { received = config; }, { configPath: CONFIG_PATH });

    // Write garbage
    writeFileSync(CONFIG_PATH, "not valid json{{{");

    const result = await watcher.reload();
    // loadConfig falls back to defaults on invalid JSON
    // so this should still work
    expect(result).toBeDefined();
    watcher.stop();
  });

  test("stop() clears debounce timer", () => {
    const watcher = new ConfigWatcher(() => {}, { configPath: CONFIG_PATH, debounceMs: 10000 });
    watcher.start();
    watcher.stop();
    expect(watcher.isWatching()).toBe(false);
  });

  // --- New tests for code review findings ---

  test("start() when config file does not exist does not throw", () => {
    const missingPath = join(TEST_DIR, "nonexistent-config.json");
    const watcher = new ConfigWatcher(() => {}, { configPath: missingPath });
    // Should not throw, just log an error
    expect(() => watcher.start()).not.toThrow();
    // Watcher should not be watching since file doesn't exist
    expect(watcher.isWatching()).toBe(false);
    watcher.stop();
  });

  test("reload() with invalid config falls back to defaults with correct structure", async () => {
    let received: any = null;
    const watcher = new ConfigWatcher((config) => { received = config; }, { configPath: CONFIG_PATH });

    // Write garbage JSON
    writeFileSync(CONFIG_PATH, "not valid json{{{");

    const result = await watcher.reload();
    // loadConfig falls back to defaults on invalid JSON, so handler should
    // still be called with a valid config that has default values
    expect(result).not.toBeNull();
    expect(received).not.toBeNull();
    // Should have default structure
    expect(received.schemaVersion).toBe(1);
    expect(received.accounts).toEqual([]);
    expect(received.entire.autoEnable).toBe(true);
    expect(received.defaults.launchInNewWindow).toBe(true);
    expect(received.defaults.quotaPolicy).toBeDefined();
    expect(received.defaults.quotaPolicy.plan).toBe("max-5x");
    watcher.stop();
  });
});
