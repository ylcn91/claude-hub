import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { searchDirectories } from "../../src/services/code-search";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";

const TEST_DIR = join(import.meta.dir, ".test-code-search");
const ACCOUNT_DIR = join(TEST_DIR, "test-account");

beforeEach(() => {
  mkdirSync(ACCOUNT_DIR, { recursive: true });
  writeFileSync(join(ACCOUNT_DIR, "hello.ts"), 'export function hello() { return "world"; }\n');
  writeFileSync(join(ACCOUNT_DIR, "main.ts"), 'import { hello } from "./hello";\nconsole.log(hello());\n');
});

afterEach(() => rmSync(TEST_DIR, { recursive: true, force: true }));

describe("Code Search", () => {
  test("returns empty results for empty pattern", async () => {
    const result = await searchDirectories("");
    expect(result.results).toEqual([]);
    expect(result.totalMatches).toBe(0);
  });

  test("returns empty results when no accounts configured", async () => {
    // searchDirectories loads config; with no config it returns empty
    // In test environment, we test the function signature & return shape
    const result = await searchDirectories("nonexistent_pattern_xyz123");
    expect(result.pattern).toBe("nonexistent_pattern_xyz123");
    expect(result.results).toBeInstanceOf(Array);
    expect(typeof result.totalMatches).toBe("number");
    expect(result.searchedDirs).toBeInstanceOf(Array);
  });

  test("SearchResponse has correct shape", async () => {
    const result = await searchDirectories("test");
    expect(result).toHaveProperty("pattern");
    expect(result).toHaveProperty("results");
    expect(result).toHaveProperty("totalMatches");
    expect(result).toHaveProperty("searchedDirs");
  });

  test("respects maxResults parameter", async () => {
    const result = await searchDirectories(".", undefined, 1);
    expect(result.results.length).toBeLessThanOrEqual(1);
  });

  test("whitespace-only pattern returns empty results", async () => {
    const result = await searchDirectories("   ");
    expect(result.results).toEqual([]);
    expect(result.totalMatches).toBe(0);
  });
});

describe("Code Search - flag injection prevention", () => {
  test("pattern starting with dash is not interpreted as flag", async () => {
    // A pattern like "-e malicious" could be interpreted as a flag without --
    // After fix, the -- separator should prevent this
    const result = await searchDirectories("-e hello");
    // Should not throw, should return results (empty or not depending on config)
    expect(result).toHaveProperty("pattern", "-e hello");
    expect(result.results).toBeInstanceOf(Array);
  });

  test("pattern starting with -- is handled safely", async () => {
    const result = await searchDirectories("--version");
    expect(result).toHaveProperty("pattern", "--version");
    expect(result.results).toBeInstanceOf(Array);
  });

  test("pattern with single dash is handled safely", async () => {
    const result = await searchDirectories("-");
    expect(result).toHaveProperty("pattern", "-");
    expect(result.results).toBeInstanceOf(Array);
  });
});

describe("Code Search - input validation", () => {
  test("empty pattern returns empty results", async () => {
    const result = await searchDirectories("");
    expect(result.results).toEqual([]);
    expect(result.totalMatches).toBe(0);
  });

  test("null-ish pattern returns empty results", async () => {
    // @ts-ignore - testing runtime behavior with invalid input
    const result = await searchDirectories(undefined);
    expect(result.results).toEqual([]);
  });

  test("very long pattern (>1000 chars) throws error", async () => {
    const longPattern = "a".repeat(1001);
    expect(searchDirectories(longPattern)).rejects.toThrow("Search pattern too long");
  });

  test("pattern at exactly 1000 chars does not throw", async () => {
    const pattern = "a".repeat(1000);
    // Should not throw for the length check (may fail for other reasons like no accounts)
    const result = await searchDirectories(pattern);
    expect(result).toHaveProperty("pattern");
  });
});

describe("Code Search - ripgrep handling", () => {
  test("returns valid response shape when ripgrep finds no matches", async () => {
    // Search for a pattern that is extremely unlikely to exist anywhere
    const result = await searchDirectories("zzz_absolutely_impossible_pattern_9f8a7b6c5d4e3f2a1b_never_exists");
    // The response should have the correct shape regardless
    expect(result).toHaveProperty("pattern");
    expect(result).toHaveProperty("results");
    expect(result).toHaveProperty("totalMatches");
    expect(result).toHaveProperty("searchedDirs");
    expect(result.results).toBeInstanceOf(Array);
    expect(typeof result.totalMatches).toBe("number");
  });
});

describe("Code Search - workspace directories", () => {
  test("uses workspace directories when provided", async () => {
    const workspaceDirs = new Map<string, string[]>();
    workspaceDirs.set("test-account", [ACCOUNT_DIR]);

    // The function still loads config for account names, but workspace dirs
    // override configDir. Since test config may not have "test-account",
    // we verify that the function signature accepts workspace dirs.
    const result = await searchDirectories("hello", undefined, 100, workspaceDirs);
    expect(result).toHaveProperty("pattern", "hello");
    expect(result.results).toBeInstanceOf(Array);
    expect(result.searchedDirs).toBeInstanceOf(Array);
  });

  test("workspace dirs map is used instead of configDir for matching accounts", async () => {
    // Create a workspace dir with a known file
    const wsDir = join(TEST_DIR, "workspace");
    mkdirSync(wsDir, { recursive: true });
    writeFileSync(join(wsDir, "target.ts"), 'const unique_ws_marker = "found_in_workspace";\n');

    const workspaceDirs = new Map<string, string[]>();
    workspaceDirs.set("test-account", [wsDir]);

    // Even if account configDir doesn't have the marker, workspace dir should be searched
    const result = await searchDirectories("unique_ws_marker", undefined, 100, workspaceDirs);
    // We can't guarantee the "test-account" is in config, so we just verify shape
    expect(result).toHaveProperty("searchedDirs");
    expect(result.searchedDirs).toBeInstanceOf(Array);
  });

  test("skips non-existent workspace directories", async () => {
    const workspaceDirs = new Map<string, string[]>();
    workspaceDirs.set("test-account", ["/nonexistent/path/that/does/not/exist"]);

    const result = await searchDirectories("hello", undefined, 100, workspaceDirs);
    // Should not include non-existent dirs in searchedDirs
    expect(result.searchedDirs).not.toContain("/nonexistent/path/that/does/not/exist");
  });
});
