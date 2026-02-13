import { describe, test, expect, beforeEach } from "bun:test";
import { AutoLauncher, type AutoLaunchPolicy } from "../src/daemon/auto-launcher";

const DEFAULT_POLICY: AutoLaunchPolicy = {
  maxSpawnsPerMinute: 2,
  deduplicationWindowMs: 30_000,
  selfHandoffBlocked: true,
  circuitBreaker: {
    failureThreshold: 3,
    cooldownMs: 5 * 60 * 1000,
  },
};

describe("AutoLauncher", () => {
  let launcher: AutoLauncher;

  beforeEach(() => {
    launcher = new AutoLauncher(DEFAULT_POLICY);
  });

  test("blocks self-handoff", () => {
    const result = launcher.canLaunch("claude-work", "claude-work");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("self-handoff");
  });

  test("allows handoff to different account", () => {
    const result = launcher.canLaunch("claude-work", "claude-admin");
    expect(result.allowed).toBe(true);
  });

  test("rate limit triggers after maxSpawnsPerMinute", () => {
    // Record 2 spawns (the max)
    launcher.recordSpawn("claude-admin");
    launcher.recordSpawn("claude-ops");

    const result = launcher.canLaunch("claude-work", "claude-deploy");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("rate limit");
  });

  test("rate limit resets after window expires", () => {
    // Record spawns in the past by manipulating internal state
    launcher.recordSpawn("claude-admin");
    launcher.recordSpawn("claude-ops");

    // Expire the rate limit window
    launcher.expireRateLimitForTest();

    const result = launcher.canLaunch("claude-work", "claude-deploy");
    expect(result.allowed).toBe(true);
  });

  test("deduplication blocks same target within window", () => {
    launcher.recordSpawn("claude-admin");

    const result = launcher.canLaunch("claude-work", "claude-admin");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("dedup");
  });

  test("deduplication allows same target after window expires", () => {
    launcher.recordSpawn("claude-admin");

    // Expire dedup window
    launcher.expireDedupForTest("claude-admin");

    const result = launcher.canLaunch("claude-work", "claude-admin");
    expect(result.allowed).toBe(true);
  });

  test("circuit breaker opens after failure threshold", () => {
    launcher.recordFailure("claude-admin");
    launcher.recordFailure("claude-admin");
    launcher.recordFailure("claude-admin");

    const result = launcher.canLaunch("claude-work", "claude-admin");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("circuit breaker");
  });

  test("circuit breaker allows after cooldown", () => {
    launcher.recordFailure("claude-admin");
    launcher.recordFailure("claude-admin");
    launcher.recordFailure("claude-admin");

    // Expire circuit breaker cooldown
    launcher.expireCircuitBreakerForTest("claude-admin");

    const result = launcher.canLaunch("claude-work", "claude-admin");
    expect(result.allowed).toBe(true);
  });

  test("circuit breaker resets failure count on successful spawn", () => {
    launcher.recordFailure("claude-admin");
    launcher.recordFailure("claude-admin");
    // 2 failures, not yet at threshold

    launcher.recordSpawn("claude-admin"); // success resets failures

    // Expire the dedup so we can check canLaunch
    launcher.expireDedupForTest("claude-admin");
    // Expire rate limit in case
    launcher.expireRateLimitForTest();

    launcher.recordFailure("claude-admin"); // 1 failure after reset
    const result = launcher.canLaunch("claude-work", "claude-admin");
    expect(result.allowed).toBe(true); // only 1 failure, threshold is 3
  });

  test("self-handoff allowed when policy disables it", () => {
    const permissive = new AutoLauncher({ ...DEFAULT_POLICY, selfHandoffBlocked: false });
    const result = permissive.canLaunch("claude-work", "claude-work");
    expect(result.allowed).toBe(true);
  });
});
