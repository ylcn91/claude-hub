import { describe, test, expect } from "bun:test";
import { OpenHandsProvider } from "../src/providers/openhands";
import { ProviderRegistry } from "../src/providers/registry";
import type { Account, LaunchOpts } from "../src/providers/types";

describe("OpenHandsProvider", () => {
  const provider = new OpenHandsProvider();

  test("has correct id and displayName", () => {
    expect(provider.id).toBe("openhands");
    expect(provider.displayName).toBe("OpenHands");
    expect(provider.supportsEntire).toBe(false);
  });

  test("builds launch command with OPENHANDS_HOME env", () => {
    const account: Account = {
      name: "oh-work",
      configDir: "~/.openhands-work",
      provider: "openhands",
    };
    const opts: LaunchOpts = { dir: "/projects/app" };
    const cmd = provider.buildLaunchCommand(account, opts);
    expect(cmd[0]).toContain("OPENHANDS_HOME=");
    expect(cmd).toContain("openhands");
    expect(cmd).toContain("--dir");
    expect(cmd).toContain("/projects/app");
  });

  test("builds launch command without dir", () => {
    const account: Account = {
      name: "oh-default",
      configDir: "~/.openhands",
      provider: "openhands",
    };
    const cmd = provider.buildLaunchCommand(account, {});
    expect(cmd).toContain("openhands");
    expect(cmd).not.toContain("--dir");
  });

  test("getUsageSource returns filesystem type with empty data", async () => {
    const account: Account = {
      name: "oh-test",
      configDir: "/tmp/oh-test",
      provider: "openhands",
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
    expect(registry.get("openhands")).toBe(provider);
    expect(registry.listIds()).toContain("openhands");
  });
});
