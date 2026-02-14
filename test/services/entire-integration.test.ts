import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { listCheckpoints, readCheckpoint } from "../../src/services/entire-integration";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { $ } from "bun";

let testDir: string;
let testCounter = 0;

beforeEach(async () => {
  testCounter++;
  testDir = join(import.meta.dir, `.test-entire-int-${process.pid}-${testCounter}`);
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

async function setupOrphanBranch(dir: string, checkpointId: string, metadata: any, transcript?: string) {
  const prefix = checkpointId.slice(0, 2);
  const suffix = checkpointId.slice(2);

  await $`git checkout --orphan entire/checkpoints/v1`.cwd(dir).quiet();
  await $`git rm -rf .`.cwd(dir).quiet();

  const cpDir = join(dir, prefix, suffix);
  const sessionDir = join(cpDir, "0");
  mkdirSync(sessionDir, { recursive: true });

  await Bun.write(join(cpDir, "metadata.json"), JSON.stringify(metadata));
  if (transcript) {
    await Bun.write(join(sessionDir, "full.jsonl"), transcript);
  }

  await $`git add .`.cwd(dir).quiet();
  await $`git commit -m "Checkpoint: ${checkpointId}"`.cwd(dir).quiet();
  await $`git checkout main`.cwd(dir).quiet();
}

describe("listCheckpoints", () => {
  test("returns empty array when no orphan branch exists", async () => {
    const result = await listCheckpoints(testDir);
    expect(result).toEqual([]);
  });

  test("lists checkpoints from orphan branch", async () => {
    await setupOrphanBranch(testDir, "a3b2c4d5e6f7", {
      checkpoint_id: "a3b2c4d5e6f7",
      strategy: "manual-commit",
      branch: "main",
    });

    const result = await listCheckpoints(testDir);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].checkpointId).toBe("a3b2c4d5e6f7");
  });
});

describe("readCheckpoint", () => {
  test("returns null metadata when checkpoint not found", async () => {
    const result = await readCheckpoint(testDir, "nonexistent12");
    expect(result.metadata).toBeNull();
    expect(result.transcript).toEqual([]);
  });

  test("reads metadata from orphan branch", async () => {
    const meta = {
      checkpoint_id: "a1b2c3d4e5f6",
      session_id: "session-uuid-123",
      strategy: "auto-commit",
      branch: "feat/auth",
      files_touched: ["src/auth.ts", "src/login.ts"],
      checkpoints_count: 3,
      token_usage: {
        input_tokens: 1500,
        output_tokens: 800,
        api_call_count: 10,
      },
    };
    await setupOrphanBranch(testDir, "a1b2c3d4e5f6", meta);

    const result = await readCheckpoint(testDir, "a1b2c3d4e5f6");
    expect(result.metadata).not.toBeNull();
    expect(result.metadata!.checkpointId).toBe("a1b2c3d4e5f6");
    expect(result.metadata!.sessionId).toBe("session-uuid-123");
    expect(result.metadata!.strategy).toBe("auto-commit");
    expect(result.metadata!.branch).toBe("feat/auth");
    expect(result.metadata!.filesTouched).toEqual(["src/auth.ts", "src/login.ts"]);
    expect(result.metadata!.checkpointsCount).toBe(3);
    expect(result.metadata!.tokenUsage!.inputTokens).toBe(1500);
    expect(result.metadata!.tokenUsage!.outputTokens).toBe(800);
    expect(result.metadata!.tokenUsage!.apiCallCount).toBe(10);
  });

  test("reads transcript lines from full.jsonl", async () => {
    const transcript = [
      JSON.stringify({ role: "user", content: "Hello" }),
      JSON.stringify({ role: "assistant", content: "Hi there!" }),
    ].join("\n");

    await setupOrphanBranch(testDir, "b1c2d3e4f5a6", {
      checkpoint_id: "b1c2d3e4f5a6",
      strategy: "manual-commit",
    }, transcript);

    const result = await readCheckpoint(testDir, "b1c2d3e4f5a6");
    expect(result.transcript).toHaveLength(2);
    expect(result.transcript[0].parsed.role).toBe("user");
    expect(result.transcript[1].parsed.role).toBe("assistant");
  });

  test("handles metadata with missing optional fields", async () => {
    await setupOrphanBranch(testDir, "c1d2e3f4a5b6", {
      checkpoint_id: "c1d2e3f4a5b6",
    });

    const result = await readCheckpoint(testDir, "c1d2e3f4a5b6");
    expect(result.metadata).not.toBeNull();
    expect(result.metadata!.sessionId).toBe("");
    expect(result.metadata!.strategy).toBe("");
    expect(result.metadata!.branch).toBe("");
    expect(result.metadata!.filesTouched).toEqual([]);
    expect(result.metadata!.tokenUsage).toBeUndefined();
  });

  test("handles unparseable transcript lines gracefully", async () => {
    const transcript = [
      "not valid json",
      JSON.stringify({ role: "user", content: "valid" }),
    ].join("\n");

    await setupOrphanBranch(testDir, "d1e2f3a4b5c6", {
      checkpoint_id: "d1e2f3a4b5c6",
    }, transcript);

    const result = await readCheckpoint(testDir, "d1e2f3a4b5c6");
    expect(result.transcript).toHaveLength(2);
    expect(result.transcript[0].parsed).toBeNull();
    expect(result.transcript[0].raw).toBe("not valid json");
    expect(result.transcript[1].parsed!.role).toBe("user");
  });

  // M6: readCheckpoint with empty checkpointId should return empty
  test("returns empty for empty checkpointId", async () => {
    const result = await readCheckpoint(testDir, "");
    expect(result.metadata).toBeNull();
    expect(result.transcript).toEqual([]);
  });

  // M6: readCheckpoint with very short checkpointId (1 char) should return empty
  test("returns empty for very short checkpointId (1 char)", async () => {
    const result = await readCheckpoint(testDir, "a");
    expect(result.metadata).toBeNull();
    expect(result.transcript).toEqual([]);
  });

  // M6: readCheckpoint with 2-char checkpointId should return empty
  test("returns empty for 2-char checkpointId", async () => {
    const result = await readCheckpoint(testDir, "ab");
    expect(result.metadata).toBeNull();
    expect(result.transcript).toEqual([]);
  });
});

describe("listCheckpoints - additional", () => {
  // Test with non-checkpoint commits on the orphan branch
  test("skips non-checkpoint commits on orphan branch", async () => {
    // Create orphan branch with a non-checkpoint commit first
    await $`git checkout --orphan entire/checkpoints/v1`.cwd(testDir).quiet();
    await $`git rm -rf .`.cwd(testDir).quiet();

    await Bun.write(join(testDir, "readme.txt"), "not a checkpoint");
    await $`git add .`.cwd(testDir).quiet();
    await $`git commit -m "Not a checkpoint commit"`.cwd(testDir).quiet();

    // Then add an actual checkpoint commit
    const cpDir = join(testDir, "ab", "cdef123456");
    const sessionDir = join(cpDir, "0");
    mkdirSync(sessionDir, { recursive: true });
    await Bun.write(join(cpDir, "metadata.json"), JSON.stringify({ checkpoint_id: "abcdef123456" }));
    await Bun.write(join(sessionDir, "full.jsonl"), "");
    await $`git add .`.cwd(testDir).quiet();
    await $`git commit -m "Checkpoint: abcdef123456"`.cwd(testDir).quiet();
    await $`git checkout main`.cwd(testDir).quiet();

    const result = await listCheckpoints(testDir);
    // Should only have the checkpoint commit, not the non-checkpoint one
    expect(result).toHaveLength(1);
    expect(result[0].checkpointId).toBe("abcdef123456");
  });

  // Test with multiple checkpoints
  test("lists multiple checkpoints", async () => {
    // Create orphan branch with two checkpoint commits
    await $`git checkout --orphan entire/checkpoints/v1`.cwd(testDir).quiet();
    await $`git rm -rf .`.cwd(testDir).quiet();

    // First checkpoint
    const cp1Dir = join(testDir, "aa", "bb11cc22dd");
    const session1Dir = join(cp1Dir, "0");
    mkdirSync(session1Dir, { recursive: true });
    await Bun.write(join(cp1Dir, "metadata.json"), JSON.stringify({ checkpoint_id: "aabb11cc22dd" }));
    await Bun.write(join(session1Dir, "full.jsonl"), "");
    await $`git add .`.cwd(testDir).quiet();
    await $`git commit -m "Checkpoint: aabb11cc22dd"`.cwd(testDir).quiet();

    // Second checkpoint
    const cp2Dir = join(testDir, "cc", "dd33ee44ff");
    const session2Dir = join(cp2Dir, "0");
    mkdirSync(session2Dir, { recursive: true });
    await Bun.write(join(cp2Dir, "metadata.json"), JSON.stringify({ checkpoint_id: "ccdd33ee44ff" }));
    await Bun.write(join(session2Dir, "full.jsonl"), "");
    await $`git add .`.cwd(testDir).quiet();
    await $`git commit -m "Checkpoint: ccdd33ee44ff"`.cwd(testDir).quiet();

    await $`git checkout main`.cwd(testDir).quiet();

    const result = await listCheckpoints(testDir);
    expect(result).toHaveLength(2);
    const ids = result.map(r => r.checkpointId);
    expect(ids).toContain("aabb11cc22dd");
    expect(ids).toContain("ccdd33ee44ff");
  });
});
