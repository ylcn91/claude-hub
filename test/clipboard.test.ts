import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { copyToClipboard, pasteFromClipboard, clearClipboard, loadClipboard } from "../src/services/clipboard";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";

const TEST_DIR = join(import.meta.dir, ".test-clipboard");

let savedAgentctlDir: string | undefined;

beforeEach(() => {
  savedAgentctlDir = process.env.AGENTCTL_DIR;
  process.env.AGENTCTL_DIR = TEST_DIR;
  mkdirSync(TEST_DIR, { recursive: true });
});
afterEach(() => {
  if (savedAgentctlDir === undefined) {
    delete process.env.AGENTCTL_DIR;
  } else {
    process.env.AGENTCTL_DIR = savedAgentctlDir;
  }
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("clipboard", () => {
  test("copy and paste roundtrip", async () => {
    await copyToClipboard("claude", "some context data", "auth code");
    const entries = await pasteFromClipboard(1);
    expect(entries).toHaveLength(1);
    expect(entries[0].content).toBe("some context data");
    expect(entries[0].from).toBe("claude");
    expect(entries[0].label).toBe("auth code");
  });

  test("multiple entries", async () => {
    await copyToClipboard("claude", "first");
    await copyToClipboard("claude-admin", "second");
    const entries = await pasteFromClipboard(2);
    expect(entries).toHaveLength(2);
  });

  test("clear clipboard", async () => {
    await copyToClipboard("claude", "data");
    await clearClipboard();
    const store = await loadClipboard();
    expect(store.entries).toHaveLength(0);
  });

  test("caps at 50 entries", async () => {
    for (let i = 0; i < 55; i++) {
      await copyToClipboard("claude", `entry-${i}`);
    }
    const store = await loadClipboard();
    expect(store.entries.length).toBeLessThanOrEqual(50);
  });
});
