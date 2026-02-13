import { describe, test, expect } from "bun:test";
import { GeminiCliProvider } from "../src/providers/gemini-cli";
import { ProviderRegistry } from "../src/providers/registry";
import type { Account, LaunchOpts } from "../src/providers/types";

describe("GeminiCliProvider", () => {
  const provider = new GeminiCliProvider();

  test("has correct id and displayName", () => {
    expect(provider.id).toBe("gemini-cli");
    expect(provider.displayName).toBe("Gemini CLI");
    expect(provider.supportsEntire).toBe(false);
  });

  test("builds launch command with GEMINI_HOME env", () => {
    const account: Account = {
      name: "gemini-work",
      configDir: "~/.gemini-work",
      provider: "gemini-cli",
    };
    const opts: LaunchOpts = { dir: "/projects/app" };
    const cmd = provider.buildLaunchCommand(account, opts);
    expect(cmd[0]).toContain("GEMINI_HOME=");
    expect(cmd).toContain("gemini");
    expect(cmd).toContain("--dir");
    expect(cmd).toContain("/projects/app");
  });

  test("builds launch command without dir", () => {
    const account: Account = {
      name: "gemini-default",
      configDir: "~/.gemini",
      provider: "gemini-cli",
    };
    const cmd = provider.buildLaunchCommand(account, {});
    expect(cmd).toContain("gemini");
    expect(cmd).not.toContain("--dir");
  });

  test("getUsageSource returns filesystem type with empty data", async () => {
    const account: Account = {
      name: "gemini-test",
      configDir: "/tmp/gemini-test",
      provider: "gemini-cli",
    };
    const source = provider.getUsageSource(account);
    expect(source.type).toBe("filesystem");
    const data = await source.read();
    expect(data.totalSessions).toBe(0);
    expect(data.totalMessages).toBe(0);
    expect(data.dailyActivity).toEqual([]);
    expect(data.modelUsage).toEqual({});
  });

  test("getQuotaPolicy returns unknown type", () => {
    const policy = provider.getQuotaPolicy();
    expect(policy.type).toBe("unknown");
    const estimate = policy.estimateRemaining(
      { totalSessions: 0, totalMessages: 0, dailyActivity: [], dailyModelTokens: [], modelUsage: {} },
      { recentMessageCount: 100, estimatedLimit: 200 }
    );
    expect(estimate.percent).toBe(-1);
    expect(estimate.confidence).toBe("none");
  });

  test("parseStatsFromFile returns empty stats", async () => {
    const stats = await provider.parseStatsFromFile("/nonexistent");
    expect(stats.totalSessions).toBe(0);
    expect(stats.totalMessages).toBe(0);
    expect(stats.todayActivity).toBeNull();
    expect(stats.todayTokens).toBeNull();
    expect(stats.weeklyActivity).toEqual([]);
    expect(stats.modelUsage).toEqual({});
  });

  test("estimateQuota returns unknown", () => {
    const estimate = provider.estimateQuota(100, {
      plan: "unknown",
      estimatedLimit: 0,
      windowMs: 3600000,
      source: "community-estimate",
    });
    expect(estimate.percent).toBe(-1);
    expect(estimate.confidence).toBe("none");
  });

  test("can be registered in ProviderRegistry", () => {
    const registry = new ProviderRegistry();
    registry.register(provider);
    expect(registry.get("gemini-cli")).toBe(provider);
    expect(registry.listIds()).toContain("gemini-cli");
  });
});
