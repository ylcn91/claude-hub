import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { join } from "path";
import { mkdirSync, rmSync } from "fs";
import { loadConfig, saveConfig, setConfigValue } from "../src/config";

const TEST_DIR = join(import.meta.dir, ".test-config-notifications");

beforeAll(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterAll(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("notifications config round-trip", () => {
  const configPath = join(TEST_DIR, "config.json");

  test("notifications survive save -> load round-trip", async () => {
    const config = await loadConfig(configPath);
    config.notifications = {
      enabled: true,
      events: {
        rateLimit: true,
        handoffReceived: true,
        messageReceived: false,
      },
      muteList: ["noisy-account"],
    };
    await saveConfig(config, configPath);

    const reloaded = await loadConfig(configPath);
    expect(reloaded.notifications).toBeDefined();
    expect(reloaded.notifications!.enabled).toBe(true);
    expect(reloaded.notifications!.events.rateLimit).toBe(true);
    expect(reloaded.notifications!.events.handoffReceived).toBe(true);
    expect(reloaded.notifications!.events.messageReceived).toBe(false);
    expect(reloaded.notifications!.muteList).toEqual(["noisy-account"]);
  });

  test("setConfigValue preserves existing notifications", async () => {
    const oldPath = join(TEST_DIR, "config-setval.json");
    const config = await loadConfig(oldPath);
    config.notifications = {
      enabled: true,
      events: { rateLimit: true, handoffReceived: true, messageReceived: true },
    };
    await saveConfig(config, oldPath);

    const origDir = process.env.AGENTCTL_DIR;
    process.env.AGENTCTL_DIR = TEST_DIR;

    // Save with proper name for setConfigValue
    const setValConfigPath = join(TEST_DIR, "config.json");
    await saveConfig(config, setValConfigPath);

    await setConfigValue("defaults.launchInNewWindow", "false");

    const reloaded = await loadConfig(setValConfigPath);
    expect(reloaded.defaults.launchInNewWindow).toBe(false);
    expect(reloaded.notifications).toBeDefined();
    expect(reloaded.notifications!.enabled).toBe(true);

    process.env.AGENTCTL_DIR = origDir;
  });

  test("config without notifications loads cleanly", async () => {
    const emptyPath = join(TEST_DIR, "empty-config.json");
    const config = await loadConfig(emptyPath);
    expect(config.notifications).toBeUndefined();
  });
});
