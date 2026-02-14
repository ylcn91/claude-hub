import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { collectGitContext, collectContext } from "../../src/services/context-collector";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { $ } from "bun";

let testDir: string;
let testCounter = 0;

beforeEach(async () => {
  testCounter++;
  testDir = join(import.meta.dir, `.test-ctx-${process.pid}-${testCounter}`);
  mkdirSync(testDir, { recursive: true });
  await $`git init`.cwd(testDir).quiet();
  await $`git config user.email "test@test.com"`.cwd(testDir).quiet();
  await $`git config user.name "Test"`.cwd(testDir).quiet();
  await Bun.write(join(testDir, "file.txt"), "hello\n");
  await $`git add .`.cwd(testDir).quiet();
  await $`git commit -m "initial commit"`.cwd(testDir).quiet();
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe("collectGitContext", () => {
  test("returns branch name", async () => {
    const ctx = await collectGitContext(testDir);
    expect(ctx.branch).toBeDefined();
    expect(typeof ctx.branch).toBe("string");
    expect(ctx.branch.length).toBeGreaterThan(0);
  });

  test("returns recent commits", async () => {
    const ctx = await collectGitContext(testDir);
    expect(ctx.recentCommits).toBeInstanceOf(Array);
    expect(ctx.recentCommits.length).toBeGreaterThan(0);
    expect(ctx.recentCommits[0]).toContain("initial commit");
  });

  test("returns diff for uncommitted changes", async () => {
    await Bun.write(join(testDir, "file.txt"), "hello\nworld\n");
    const ctx = await collectGitContext(testDir);
    expect(ctx.diff).toContain("+world");
  });

  test("returns empty diff when no changes", async () => {
    const ctx = await collectGitContext(testDir);
    expect(ctx.diff).toBe("");
  });

  test("returns changed files from git status", async () => {
    await Bun.write(join(testDir, "newfile.txt"), "new");
    const ctx = await collectGitContext(testDir);
    expect(ctx.changedFiles).toContain("newfile.txt");
  });

  test("returns empty changedFiles when clean", async () => {
    const ctx = await collectGitContext(testDir);
    expect(ctx.changedFiles).toEqual([]);
  });
});

describe("collectContext", () => {
  test("wraps git context with metadata", async () => {
    const result = await collectContext(testDir);
    expect(result.git).toBeDefined();
    expect(result.collectedAt).toBeDefined();
    expect(typeof result.truncated).toBe("boolean");
  });

  test("truncated is false for small diffs", async () => {
    await Bun.write(join(testDir, "file.txt"), "small change\n");
    const result = await collectContext(testDir);
    expect(result.truncated).toBe(false);
  });

  test("truncates diff when exceeding maxChars", async () => {
    const bigContent = "x".repeat(60_000) + "\n";
    await Bun.write(join(testDir, "file.txt"), bigContent);
    const result = await collectContext(testDir, { maxChars: 1024 });
    expect(result.truncated).toBe(true);
    expect(result.git.diff).toContain("[diff truncated]");
    expect(JSON.stringify(result).length).toBeLessThan(2048);
  });

  test("respects custom maxChars", async () => {
    const bigContent = "y".repeat(5000) + "\n";
    await Bun.write(join(testDir, "file.txt"), bigContent);
    const result = await collectContext(testDir, { maxChars: 500 });
    expect(result.truncated).toBe(true);
  });

  test("default maxChars is 50K characters", async () => {
    const result = await collectContext(testDir);
    expect(result.truncated).toBe(false);
  });

  // M2 fix: truncation suffix should be accounted for in the budget
  test("truncation suffix is accounted for in budget", async () => {
    const bigContent = "z".repeat(10_000) + "\n";
    await Bun.write(join(testDir, "file.txt"), bigContent);
    const result = await collectContext(testDir, { maxChars: 500 });
    expect(result.truncated).toBe(true);
    // The total serialized size of git context should be <= maxChars
    const serializedSize = JSON.stringify(result.git).length;
    expect(serializedSize).toBeLessThanOrEqual(500);
  });

  // Test exact boundary condition (context size = maxChars exactly)
  test("does not truncate when context size equals maxChars exactly", async () => {
    // First measure the baseline overhead without diff
    const baseline = await collectContext(testDir);
    // No diff for clean repo
    expect(baseline.truncated).toBe(false);
    const exactSize = JSON.stringify(baseline.git).length;
    // Setting maxChars to exact size should NOT truncate
    const result = await collectContext(testDir, { maxChars: exactSize });
    expect(result.truncated).toBe(false);
  });

  // Test with non-ASCII content - verifies chars vs bytes behavior
  test("uses character count (not byte count) for truncation budget", async () => {
    // Multi-byte characters: each emoji is 1-2 chars but 4 bytes in UTF-8
    const emojiContent = "\u{1F600}".repeat(2000) + "\n"; // 2000 emoji chars
    await Bun.write(join(testDir, "file.txt"), emojiContent);
    const result = await collectContext(testDir, { maxChars: 500 });
    expect(result.truncated).toBe(true);
    // The budget is in characters (JSON.stringify().length), not bytes
    const serializedSize = JSON.stringify(result.git).length;
    expect(serializedSize).toBeLessThanOrEqual(500);
  });
});
