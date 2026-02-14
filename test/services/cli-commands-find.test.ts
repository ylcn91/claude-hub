import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { findCommand } from "../../src/services/cli-commands";

const TEST_DIR = join(import.meta.dir, ".test-cli-find");
const TEST_CONFIG = join(TEST_DIR, "config.json");

const origHubDir = process.env.CLAUDE_HUB_DIR;

beforeEach(() => {
  process.env.CLAUDE_HUB_DIR = TEST_DIR;
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  process.env.CLAUDE_HUB_DIR = origHubDir;
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

const ACCOUNTS = [
  { name: "work", configDir: "~/.claude-work", color: "#89b4fa", label: "Work", provider: "claude-code" },
  { name: "review", configDir: "~/.claude-review", color: "#f38ba8", label: "Code Review", provider: "claude-code" },
  { name: "codex", configDir: "~/.claude-codex", color: "#a6e3a1", label: "Codex", provider: "codex-cli" },
];

describe("findCommand", () => {
  test("finds account by name", async () => {
    writeConfig(ACCOUNTS);
    const result = await findCommand("work", TEST_CONFIG);
    expect(result).toContain("work");
    expect(result).not.toContain("codex");
  });

  test("finds account by label", async () => {
    writeConfig(ACCOUNTS);
    const result = await findCommand("Code Review", TEST_CONFIG);
    expect(result).toContain("review");
  });

  test("finds account by provider", async () => {
    writeConfig(ACCOUNTS);
    const result = await findCommand("codex-cli", TEST_CONFIG);
    expect(result).toContain("codex");
    expect(result).not.toContain("work");
  });

  test("finds account by color", async () => {
    writeConfig(ACCOUNTS);
    const result = await findCommand("#f38ba8", TEST_CONFIG);
    expect(result).toContain("review");
  });

  test("case insensitive search", async () => {
    writeConfig(ACCOUNTS);
    const result = await findCommand("WORK", TEST_CONFIG);
    expect(result).toContain("work");
  });

  test("partial match works", async () => {
    writeConfig(ACCOUNTS);
    const result = await findCommand("wor", TEST_CONFIG);
    expect(result).toContain("work");
  });

  test("returns no match message when nothing found", async () => {
    writeConfig(ACCOUNTS);
    const result = await findCommand("nonexistent", TEST_CONFIG);
    expect(result).toContain('No accounts matching "nonexistent"');
  });

  test("returns add message when no accounts configured", async () => {
    writeConfig([]);
    const result = await findCommand("anything", TEST_CONFIG);
    expect(result).toContain("No accounts configured");
  });

  test("matches multiple accounts", async () => {
    writeConfig(ACCOUNTS);
    const result = await findCommand("claude-code", TEST_CONFIG);
    // Both work and review use claude-code provider
    expect(result).toContain("work");
    expect(result).toContain("review");
  });

  // --- New tests for code review findings ---

  test("findCommand with empty string matches all accounts", async () => {
    writeConfig(ACCOUNTS);
    const result = await findCommand("", TEST_CONFIG);
    // Empty string .includes("") is always true, so all accounts match
    expect(result).toContain("work");
    expect(result).toContain("review");
    expect(result).toContain("codex");
  });

  test("findCommand with regex-like pattern is treated as literal", async () => {
    writeConfig(ACCOUNTS);
    // ".*" should be treated as a literal string (uses .includes(), not regex)
    const result = await findCommand(".*", TEST_CONFIG);
    // No account name/label/color/provider contains the literal ".*"
    expect(result).toContain("No accounts matching");
  });
});
