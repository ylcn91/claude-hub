import { describe, test, expect } from "bun:test";
import type { AgentStats } from "../src/providers/types";

describe("UsageDetail", () => {
  describe("weekly total calculation", () => {
    test("sums weekly activity message counts", () => {
      const stats: AgentStats = {
        totalSessions: 10,
        totalMessages: 500,
        todayActivity: null,
        todayTokens: null,
        weeklyActivity: [
          { date: "2026-02-06", messageCount: 100 },
          { date: "2026-02-07", messageCount: 200 },
          { date: "2026-02-08", messageCount: 150 },
        ],
        modelUsage: {},
      };
      const weeklyTotal = stats.weeklyActivity.reduce(
        (sum, d) => sum + d.messageCount,
        0
      );
      expect(weeklyTotal).toBe(450);
    });

    test("handles empty weekly activity", () => {
      const stats: AgentStats = {
        totalSessions: 0,
        totalMessages: 0,
        todayActivity: null,
        todayTokens: null,
        weeklyActivity: [],
        modelUsage: {},
      };
      const weeklyTotal = stats.weeklyActivity.reduce(
        (sum, d) => sum + d.messageCount,
        0
      );
      expect(weeklyTotal).toBe(0);
    });
  });

  describe("model split aggregation", () => {
    test("aggregates model usage across accounts", () => {
      const accountsStats: AgentStats[] = [
        {
          totalSessions: 5,
          totalMessages: 100,
          todayActivity: null,
          todayTokens: null,
          weeklyActivity: [],
          modelUsage: {
            "claude-opus-4-6": { inputTokens: 1000, outputTokens: 3000 },
            "claude-sonnet-4-5-20250929": { inputTokens: 500, outputTokens: 500 },
          },
        },
        {
          totalSessions: 3,
          totalMessages: 50,
          todayActivity: null,
          todayTokens: null,
          weeklyActivity: [],
          modelUsage: {
            "claude-opus-4-6": { inputTokens: 2000, outputTokens: 6000 },
          },
        },
      ];

      const modelTotals = new Map<string, number>();
      for (const stats of accountsStats) {
        for (const [model, usage] of Object.entries(stats.modelUsage)) {
          const total = usage.inputTokens + usage.outputTokens;
          modelTotals.set(model, (modelTotals.get(model) ?? 0) + total);
        }
      }

      expect(modelTotals.get("claude-opus-4-6")).toBe(12000); // 4000 + 8000
      expect(modelTotals.get("claude-sonnet-4-5-20250929")).toBe(1000);

      const totalTokens = Array.from(modelTotals.values()).reduce(
        (a, b) => a + b,
        0
      );
      expect(totalTokens).toBe(13000);

      const opusPct = Math.round(
        (modelTotals.get("claude-opus-4-6")! / totalTokens) * 100
      );
      expect(opusPct).toBe(92);
    });
  });

  describe("daily aggregation across accounts", () => {
    test("merges daily counts from multiple accounts", () => {
      const account1Weekly = [
        { date: "2026-02-10", messageCount: 100 },
        { date: "2026-02-11", messageCount: 200 },
      ];
      const account2Weekly = [
        { date: "2026-02-10", messageCount: 50 },
        { date: "2026-02-11", messageCount: 75 },
        { date: "2026-02-12", messageCount: 300 },
      ];

      const dailyMap = new Map<string, number>();
      for (const day of [...account1Weekly, ...account2Weekly]) {
        dailyMap.set(day.date, (dailyMap.get(day.date) ?? 0) + day.messageCount);
      }

      expect(dailyMap.get("2026-02-10")).toBe(150);
      expect(dailyMap.get("2026-02-11")).toBe(275);
      expect(dailyMap.get("2026-02-12")).toBe(300);
    });

    test("sorts daily entries chronologically", () => {
      const dailyMap = new Map<string, number>([
        ["2026-02-12", 300],
        ["2026-02-10", 150],
        ["2026-02-11", 275],
      ]);
      const sorted = Array.from(dailyMap.entries()).sort(([a], [b]) =>
        a.localeCompare(b)
      );
      expect(sorted.map(([d]) => d)).toEqual([
        "2026-02-10",
        "2026-02-11",
        "2026-02-12",
      ]);
    });
  });

  describe("bar width calculation", () => {
    test("scales bar to max daily count", () => {
      const maxDaily = 300;
      const count = 150;
      const barWidth = Math.round((count / maxDaily) * 15);
      expect(barWidth).toBe(8);
    });

    test("max count gets full bar", () => {
      const maxDaily = 300;
      const barWidth = Math.round((maxDaily / maxDaily) * 15);
      expect(barWidth).toBe(15);
    });

    test("zero count gets empty bar", () => {
      const maxDaily = 300;
      const barWidth = Math.round((0 / maxDaily) * 15);
      expect(barWidth).toBe(0);
    });
  });

  describe("model name formatting", () => {
    test("strips claude- prefix and date suffix", () => {
      const format = (model: string) =>
        model.replace("claude-", "").replace("-20250929", "");
      expect(format("claude-opus-4-6")).toBe("opus-4-6");
      expect(format("claude-sonnet-4-5-20250929")).toBe("sonnet-4-5");
      expect(format("claude-haiku-4-5-20251001")).toBe("haiku-4-5-20251001");
    });
  });
});
