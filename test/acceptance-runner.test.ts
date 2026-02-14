import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { runAcceptanceSuite, evaluateResults, type RunResult } from "../src/services/acceptance-runner";

const TEST_DIR = `/tmp/acceptance-runner-test-${Date.now()}`;

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("runAcceptanceSuite", () => {
  test("all commands pass", async () => {
    const result = await runAcceptanceSuite(["echo hello", "echo world"], TEST_DIR);
    expect(result.passed).toBe(true);
    expect(result.summary).toContain("2/2");
    expect(result.results).toHaveLength(2);
  });

  test("one command fails", async () => {
    const result = await runAcceptanceSuite(["echo hello", "exit 1", "echo world"], TEST_DIR);
    expect(result.passed).toBe(false);
    expect(result.results).toHaveLength(3);
    expect(result.summary).toContain("failed");
    expect(result.summary).toContain("exit 1");
  });

  test("empty commands", async () => {
    const result = await runAcceptanceSuite([], TEST_DIR);
    expect(result.passed).toBe(true);
    expect(result.summary).toBe("0 commands (vacuous pass)");
    expect(result.results).toHaveLength(0);
  });

  test("single passing command", async () => {
    const result = await runAcceptanceSuite(["echo ok"], TEST_DIR);
    expect(result.passed).toBe(true);
    expect(result.results).toHaveLength(1);
  });

  test("single failing command", async () => {
    const result = await runAcceptanceSuite(["exit 1"], TEST_DIR);
    expect(result.passed).toBe(false);
    expect(result.results).toHaveLength(1);
  });

  test("stdout captured", async () => {
    const result = await runAcceptanceSuite(["echo hello"], TEST_DIR);
    expect(result.results[0].stdout.trim()).toBe("hello");
  });

  test("stderr captured", async () => {
    const result = await runAcceptanceSuite(["echo err >&2"], TEST_DIR);
    expect(result.results[0].stderr.trim()).toBe("err");
  });

  test("invalid workDir throws", async () => {
    expect(
      runAcceptanceSuite(["echo hi"], "/tmp/nonexistent-dir-xyz-999"),
    ).rejects.toThrow("workDir does not exist");
  });

  test("timeout handling", async () => {
    const result = await runAcceptanceSuite(["sleep 10"], TEST_DIR, { timeoutMs: 100 });
    expect(result.passed).toBe(false);
    expect(result.results[0].exitCode).toBe(-1);
    expect(result.results[0].stderr).toContain("timed out");
  });

  test("exit code preserved", async () => {
    const result = await runAcceptanceSuite(["exit 42"], TEST_DIR);
    expect(result.results[0].exitCode).toBe(42);
  });
});

describe("evaluateResults", () => {
  test("empty array returns vacuous pass", () => {
    const result = evaluateResults([]);
    expect(result.passed).toBe(true);
    expect(result.summary).toBe("0 commands (vacuous pass)");
  });

  test("mixed results returns correct summary", () => {
    const results: RunResult[] = [
      { command: "echo ok", exitCode: 0, stdout: "ok\n", stderr: "", durationMs: 10 },
      { command: "bun test", exitCode: 1, stdout: "", stderr: "fail", durationMs: 20 },
      { command: "echo done", exitCode: 0, stdout: "done\n", stderr: "", durationMs: 5 },
    ];
    const result = evaluateResults(results);
    expect(result.passed).toBe(false);
    expect(result.summary).toBe("2/3 passed, failed: bun test");
  });
});
