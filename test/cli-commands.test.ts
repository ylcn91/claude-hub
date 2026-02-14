import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { statusCommand, usageCommand, listCommand } from "../src/services/cli-commands";

const TEST_DIR = join(import.meta.dir, ".test-cli-commands");
const TEST_CONFIG = join(TEST_DIR, "config.json");

const origHubDir = process.env.AGENTCTL_DIR;

beforeEach(() => {
  process.env.AGENTCTL_DIR = TEST_DIR;
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  process.env.AGENTCTL_DIR = origHubDir;
  rmSync(TEST_DIR, { recursive: true, force: true });
});

function writeConfig(accounts: any[]) {
  writeFileSync(
    TEST_CONFIG,
    JSON.stringify({
      schemaVersion: 1,
      accounts,
      entire: { autoEnable: true },
      defaults: {
        launchInNewWindow: true,
        quotaPolicy: {
          plan: "max-5x",
          windowMs: 18000000,
          estimatedLimit: 225,
          source: "community-estimate",
        },
      },
    })
  );
}

function writeStatsCache(configDir: string, todayMsgs: number) {
  const today = new Date().toISOString().split("T")[0];
  const statsPath = join(configDir, "stats-cache.json");
  writeFileSync(
    statsPath,
    JSON.stringify({
      totalSessions: 5,
      totalMessages: 42,
      dailyActivity: [{ date: today, messageCount: todayMsgs, sessionCount: 1, toolCallCount: 0 }],
      dailyModelTokens: [],
      modelUsage: {},
    })
  );
}

describe("statusCommand", () => {
  test("shows message for no accounts", async () => {
    const output = await statusCommand(TEST_CONFIG);
    expect(output).toContain("No accounts configured");
  });

  test("shows one-line per account", async () => {
    const dir1 = join(TEST_DIR, "acct1");
    const dir2 = join(TEST_DIR, "acct2");
    mkdirSync(dir1, { recursive: true });
    mkdirSync(dir2, { recursive: true });
    writeStatsCache(dir1, 10);
    writeStatsCache(dir2, 5);

    writeConfig([
      { name: "work", configDir: dir1, color: "#89b4fa", label: "Work", provider: "claude-code" },
      { name: "personal", configDir: dir2, color: "#a6e3a1", label: "Personal", provider: "claude-code" },
    ]);

    const output = await statusCommand(TEST_CONFIG);
    expect(output).toContain("work");
    expect(output).toContain("personal");
    expect(output).toContain("10 msgs today");
    expect(output).toContain("5 msgs today");
  });
});

describe("usageCommand", () => {
  test("shows message for no accounts", async () => {
    const output = await usageCommand(TEST_CONFIG);
    expect(output).toContain("No accounts configured");
  });

  test("shows formatted usage table", async () => {
    const dir = join(TEST_DIR, "usage-acct");
    mkdirSync(dir, { recursive: true });
    writeStatsCache(dir, 15);

    writeConfig([
      { name: "main", configDir: dir, color: "#cba6f7", label: "Main", provider: "claude-code" },
    ]);

    const output = await usageCommand(TEST_CONFIG);
    expect(output).toContain("Account");
    expect(output).toContain("Today");
    expect(output).toContain("Total");
    expect(output).toContain("Quota");
    expect(output).toContain("main");
    expect(output).toContain("15");
    expect(output).toContain("42");
  });
});

describe("listCommand", () => {
  test("shows message for no accounts", async () => {
    const output = await listCommand(TEST_CONFIG);
    expect(output).toContain("No accounts configured");
  });

  test("lists accounts with names and dirs", async () => {
    writeConfig([
      { name: "work", configDir: "~/.claude-work", color: "#89b4fa", label: "Work", provider: "claude-code" },
      { name: "admin", configDir: "~/.claude-admin", color: "#f38ba8", label: "Admin", provider: "claude-code" },
    ]);

    const output = await listCommand(TEST_CONFIG);
    expect(output).toContain("work");
    expect(output).toContain("admin");
    expect(output).toContain("Work");
    expect(output).toContain("Admin");
    expect(output).toContain("~/.claude-work");
    expect(output).toContain("~/.claude-admin");
  });
});
