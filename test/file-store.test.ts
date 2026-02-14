import { test, expect, beforeEach, afterEach, describe } from "bun:test";
import { join } from "path";
import { existsSync, readFileSync } from "fs";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "os";
import {
  atomicWrite,
  atomicRead,
  acquireLock,
  backupFile,
  cleanTempFiles,
} from "../src/services/file-store";

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "agentctl-test-"));
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

describe("atomicWrite", () => {
  test("writes JSON file atomically", async () => {
    const path = join(testDir, "test.json");
    await atomicWrite(path, { hello: "world", schemaVersion: 1 });
    const data = JSON.parse(readFileSync(path, "utf-8"));
    expect(data.hello).toBe("world");
  });

  test("no temp files left after write", async () => {
    const path = join(testDir, "clean.json");
    await atomicWrite(path, { clean: true });
    const entries = Array.from(new Bun.Glob("*").scanSync(testDir));
    expect(entries).toEqual(["clean.json"]);
  });

  test("10 concurrent writes produce no corruption", async () => {
    const path = join(testDir, "concurrent.json");
    const writes = Array.from({ length: 10 }, (_, i) =>
      atomicWrite(path, { value: i, schemaVersion: 1 })
    );
    await Promise.all(writes);

    const data = JSON.parse(readFileSync(path, "utf-8"));
    expect(data).toHaveProperty("value");
    expect(data).toHaveProperty("schemaVersion", 1);
    expect(data.value).toBeGreaterThanOrEqual(0);
    expect(data.value).toBeLessThan(10);
  });

  test("creates parent directories", async () => {
    const path = join(testDir, "deep", "nested", "dir", "data.json");
    await atomicWrite(path, { ok: true });
    const result = await atomicRead(path);
    expect(result).toEqual({ ok: true });
  });

  test("overwrites existing file", async () => {
    const path = join(testDir, "data.json");
    await atomicWrite(path, { v: 1 });
    await atomicWrite(path, { v: 2 });
    const result = await atomicRead<{ v: number }>(path);
    expect(result?.v).toBe(2);
  });
});

describe("atomicRead", () => {
  test("returns null for non-existent file", async () => {
    const result = await atomicRead(join(testDir, "nope.json"));
    expect(result).toBeNull();
  });

  test("returns null for corrupt JSON", async () => {
    const path = join(testDir, "corrupt.json");
    await Bun.write(path, "not valid json {{{");
    const result = await atomicRead(path);
    expect(result).toBeNull();
  });

  test("returns null for empty file", async () => {
    const path = join(testDir, "empty.json");
    await Bun.write(path, "");
    const result = await atomicRead(path);
    expect(result).toBeNull();
  });
});

describe("acquireLock", () => {
  test("creates and releases lock file", async () => {
    const lockPath = join(testDir, "test.lock");
    const lock = await acquireLock(lockPath);
    expect(existsSync(lockPath)).toBe(true);
    await lock.release();
    expect(existsSync(lockPath)).toBe(false);
  });

  test("stale lock older than TTL is cleaned up", async () => {
    const lockPath = join(testDir, "stale.lock");
    const { mkdir: mkdirAsync, utimes } = await import("node:fs/promises");

    // Create a stale lock directory (simulating a lock that was never released)
    await mkdirAsync(lockPath);

    // Manually backdate the mtime to simulate staleness
    const pastTime = new Date(Date.now() - 20_000);
    await utimes(lockPath, pastTime, pastTime);

    // Should succeed because lock is stale (>10s TTL)
    const lock = await acquireLock(lockPath, { ttlMs: 10_000 });
    expect(existsSync(lockPath)).toBe(true);
    await lock.release();
  });

  test("stale lock file (old format) older than TTL is cleaned up", async () => {
    const lockPath = join(testDir, "stale-file.lock");
    // Create a stale lock as a regular file (old format compatibility)
    await Bun.write(lockPath, JSON.stringify({ pid: 99999, ts: Date.now() - 20_000 }));

    const { utimes } = await import("node:fs/promises");
    const pastTime = new Date(Date.now() - 20_000);
    await utimes(lockPath, pastTime, pastTime);

    // Should succeed because stale file lock is cleaned up
    const lock = await acquireLock(lockPath, { ttlMs: 10_000 });
    expect(existsSync(lockPath)).toBe(true);
    await lock.release();
  });

  test("release is idempotent", async () => {
    const lockPath = join(testDir, "idempotent.lock");
    const lock = await acquireLock(lockPath);
    await lock.release();
    await lock.release(); // Should not throw
  });
});

describe("10 concurrent writes - no corruption", () => {
  test("no temp files left after concurrent writes", async () => {
    const subDir = join(testDir, "concurrent-clean");
    const path = join(subDir, "data.json");

    const writers = Array.from({ length: 10 }, async () => {
      await atomicWrite(path, { ts: Date.now() });
    });
    await Promise.all(writers);

    const entries = await readdir(subDir);
    const tmpFiles = entries.filter((e) => e.includes(".tmp."));
    expect(tmpFiles).toHaveLength(0);
  });
});

describe("backupFile", () => {
  test("creates a versioned backup of existing file", async () => {
    const path = join(testDir, "backup-me.json");
    await atomicWrite(path, { important: true });

    const backupPath = await backupFile(path, 1);
    expect(backupPath).toContain(".backup.v1.");

    const original = await atomicRead(path);
    const backup = await atomicRead(backupPath);
    expect(backup).toEqual(original);
  });
});

describe("cleanTempFiles", () => {
  test("removes temp files from directory", async () => {
    await Bun.write(join(testDir, "data.json"), "{}");
    await Bun.write(join(testDir, "data.json.tmp.123.456"), "partial");
    await Bun.write(join(testDir, "other.json.tmp.789.012"), "partial");

    const cleaned = await cleanTempFiles(testDir);
    expect(cleaned).toBe(2);

    const entries = await readdir(testDir);
    expect(entries.filter((e) => e.includes(".tmp."))).toHaveLength(0);
    expect(entries).toContain("data.json");
  });

  test("returns 0 for empty or non-existent directory", async () => {
    const cleaned = await cleanTempFiles(join(testDir, "nonexistent"));
    expect(cleaned).toBe(0);
  });
});
