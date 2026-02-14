import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
  loadCouncilCache,
  appendCouncilAnalysis,
  loadVerificationCache,
  appendVerificationResult,
  getCouncilCachePath,
  getVerificationCachePath,
} from "../src/services/council-store";
import type { CouncilAnalysis } from "../src/services/council";
import type { VerificationResult } from "../src/services/verification-council";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "council-store-test-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

function makeAnalysis(overrides: Partial<CouncilAnalysis> = {}): CouncilAnalysis {
  return {
    taskGoal: overrides.taskGoal ?? "Build a REST API",
    timestamp: overrides.timestamp ?? new Date().toISOString(),
    individualAnalyses: overrides.individualAnalyses ?? [
      {
        account: "claude-1",
        complexity: "medium",
        estimatedDurationMinutes: 45,
        requiredSkills: ["typescript", "testing"],
        recommendedApproach: "TDD",
        risks: ["scope creep"],
        suggestedProvider: "claude-code",
      },
    ],
    peerRankings: overrides.peerRankings ?? [
      { reviewer: "claude-1", ranking: [0], reasoning: "Good" },
    ],
    aggregateRankings: overrides.aggregateRankings ?? [
      { account: "claude-1", averageRank: 1, rankCount: 1 },
    ],
    synthesis: overrides.synthesis ?? {
      chairman: "claude-1",
      consensusComplexity: "medium",
      consensusDurationMinutes: 40,
      consensusSkills: ["typescript"],
      recommendedApproach: "TDD approach",
      recommendedProvider: "claude-code",
      confidence: 0.85,
    },
  };
}

function makeVerificationResult(overrides: Partial<VerificationResult> = {}): VerificationResult {
  return {
    verdict: overrides.verdict ?? "ACCEPT",
    confidence: overrides.confidence ?? 0.9,
    notes: overrides.notes ?? ["Well done"],
    receipt: overrides.receipt ?? {
      taskId: "task-1",
      verifier: "council",
      verdict: "ACCEPT",
      timestamp: new Date().toISOString(),
      specHash: "abc123",
      evidenceHash: "def456",
    },
    individualReviews: overrides.individualReviews ?? [
      {
        account: "claude-1",
        verdict: "ACCEPT",
        confidence: 0.9,
        reasoning: "All criteria met",
        issues: [],
        strengths: ["Clean code"],
      },
    ],
    peerEvaluations: overrides.peerEvaluations ?? [
      { reviewer: "claude-1", ranking: [0], reasoning: "Thorough" },
    ],
    chairmanReasoning: overrides.chairmanReasoning ?? "Consensus reached",
  };
}

describe("council cache path functions", () => {
  test("getCouncilCachePath uses provided baseDir", () => {
    const path = getCouncilCachePath("/tmp/test");
    expect(path).toBe("/tmp/test/council-analyses.json");
  });

  test("getVerificationCachePath uses provided baseDir", () => {
    const path = getVerificationCachePath("/tmp/test");
    expect(path).toBe("/tmp/test/council-verifications.json");
  });
});

describe("council analysis persistence", () => {
  test("loadCouncilCache returns empty analyses when file does not exist", async () => {
    const cache = await loadCouncilCache(tempDir);
    expect(cache.analyses).toEqual([]);
  });

  test("appendCouncilAnalysis writes and loadCouncilCache reads it back", async () => {
    const analysis = makeAnalysis({ taskGoal: "Implement auth" });

    await appendCouncilAnalysis(analysis, tempDir);

    const cache = await loadCouncilCache(tempDir);
    expect(cache.analyses).toHaveLength(1);
    expect(cache.analyses[0].taskGoal).toBe("Implement auth");
    expect(cache.analyses[0].synthesis.chairman).toBe("claude-1");
    expect(cache.analyses[0].synthesis.confidence).toBe(0.85);
    expect(cache.analyses[0].individualAnalyses).toHaveLength(1);
  });

  test("multiple analyses accumulate in history", async () => {
    await appendCouncilAnalysis(makeAnalysis({ taskGoal: "Task A" }), tempDir);
    await appendCouncilAnalysis(makeAnalysis({ taskGoal: "Task B" }), tempDir);
    await appendCouncilAnalysis(makeAnalysis({ taskGoal: "Task C" }), tempDir);

    const cache = await loadCouncilCache(tempDir);
    expect(cache.analyses).toHaveLength(3);
    // Most recent first (unshift order)
    expect(cache.analyses[0].taskGoal).toBe("Task C");
    expect(cache.analyses[1].taskGoal).toBe("Task B");
    expect(cache.analyses[2].taskGoal).toBe("Task A");
  });

  test("analyses are capped at 50 entries", async () => {
    for (let i = 0; i < 55; i++) {
      await appendCouncilAnalysis(makeAnalysis({ taskGoal: `Task ${i}` }), tempDir);
    }

    const cache = await loadCouncilCache(tempDir);
    expect(cache.analyses).toHaveLength(50);
    // Most recent should be Task 54 (the last appended)
    expect(cache.analyses[0].taskGoal).toBe("Task 54");
    // Oldest retained should be Task 5 (55 - 50 = 5)
    expect(cache.analyses[49].taskGoal).toBe("Task 5");
  });

  test("persisted analysis has all expected fields", async () => {
    const analysis = makeAnalysis({
      taskGoal: "Full field test",
      individualAnalyses: [
        {
          account: "alpha",
          complexity: "high",
          estimatedDurationMinutes: 90,
          requiredSkills: ["ts", "react", "sql"],
          recommendedApproach: "Microservices",
          risks: ["Complexity", "Timeline"],
          suggestedProvider: "claude-code",
        },
        {
          account: "beta",
          complexity: "medium",
          estimatedDurationMinutes: 60,
          requiredSkills: ["ts", "react"],
          recommendedApproach: "Monolith",
          risks: ["Scaling"],
        },
      ],
      peerRankings: [
        { reviewer: "alpha", ranking: [0, 1], reasoning: "Alpha better" },
        { reviewer: "beta", ranking: [1, 0], reasoning: "Beta better" },
      ],
      aggregateRankings: [
        { account: "alpha", averageRank: 1.5, rankCount: 2 },
        { account: "beta", averageRank: 1.5, rankCount: 2 },
      ],
      synthesis: {
        chairman: "alpha",
        consensusComplexity: "high",
        consensusDurationMinutes: 75,
        consensusSkills: ["ts", "react", "sql"],
        recommendedApproach: "Hybrid approach",
        recommendedProvider: "claude-code",
        confidence: 0.78,
        dissenting_views: ["Beta disagreed on complexity"],
      },
    });

    await appendCouncilAnalysis(analysis, tempDir);

    const cache = await loadCouncilCache(tempDir);
    const stored = cache.analyses[0];
    expect(stored.taskGoal).toBe("Full field test");
    expect(stored.individualAnalyses).toHaveLength(2);
    expect(stored.individualAnalyses[0].account).toBe("alpha");
    expect(stored.individualAnalyses[1].requiredSkills).toEqual(["ts", "react"]);
    expect(stored.peerRankings).toHaveLength(2);
    expect(stored.aggregateRankings).toHaveLength(2);
    expect(stored.synthesis.dissenting_views).toContain("Beta disagreed on complexity");
    expect(stored.synthesis.confidence).toBe(0.78);
  });

  test("handles corrupt cache file gracefully", async () => {
    // Write invalid JSON to the cache file
    const cachePath = getCouncilCachePath(tempDir);
    await Bun.write(cachePath, "not valid json{{{");

    // Should return empty rather than crash
    const cache = await loadCouncilCache(tempDir);
    expect(cache.analyses).toEqual([]);
  });

  test("handles cache file with wrong shape gracefully", async () => {
    const cachePath = getCouncilCachePath(tempDir);
    await Bun.write(cachePath, JSON.stringify({ foo: "bar" }));

    const cache = await loadCouncilCache(tempDir);
    expect(cache.analyses).toEqual([]);
  });

  test("can append after reading corrupt file", async () => {
    const cachePath = getCouncilCachePath(tempDir);
    await Bun.write(cachePath, "corrupt data!!!");

    // Append should recover and write cleanly
    await appendCouncilAnalysis(makeAnalysis({ taskGoal: "Recovery test" }), tempDir);

    const cache = await loadCouncilCache(tempDir);
    expect(cache.analyses).toHaveLength(1);
    expect(cache.analyses[0].taskGoal).toBe("Recovery test");
  });
});

describe("verification result persistence", () => {
  test("loadVerificationCache returns empty when file does not exist", async () => {
    const cache = await loadVerificationCache(tempDir);
    expect(cache.verifications).toEqual([]);
  });

  test("appendVerificationResult writes and reads back correctly", async () => {
    const result = makeVerificationResult({ verdict: "ACCEPT", confidence: 0.95 });

    await appendVerificationResult(result, tempDir);

    const cache = await loadVerificationCache(tempDir);
    expect(cache.verifications).toHaveLength(1);
    expect(cache.verifications[0].verdict).toBe("ACCEPT");
    expect(cache.verifications[0].confidence).toBe(0.95);
    expect(cache.verifications[0].receipt.taskId).toBe("task-1");
  });

  test("multiple verifications accumulate in history", async () => {
    await appendVerificationResult(
      makeVerificationResult({ verdict: "ACCEPT", confidence: 0.9 }),
      tempDir,
    );
    await appendVerificationResult(
      makeVerificationResult({ verdict: "REJECT", confidence: 0.6 }),
      tempDir,
    );
    await appendVerificationResult(
      makeVerificationResult({ verdict: "ACCEPT_WITH_NOTES", confidence: 0.75 }),
      tempDir,
    );

    const cache = await loadVerificationCache(tempDir);
    expect(cache.verifications).toHaveLength(3);
    // Most recent first
    expect(cache.verifications[0].verdict).toBe("ACCEPT_WITH_NOTES");
    expect(cache.verifications[1].verdict).toBe("REJECT");
    expect(cache.verifications[2].verdict).toBe("ACCEPT");
  });

  test("verifications are capped at 100 entries", async () => {
    for (let i = 0; i < 105; i++) {
      await appendVerificationResult(
        makeVerificationResult({
          chairmanReasoning: `Reasoning ${i}`,
        }),
        tempDir,
      );
    }

    const cache = await loadVerificationCache(tempDir);
    expect(cache.verifications).toHaveLength(100);
    expect(cache.verifications[0].chairmanReasoning).toBe("Reasoning 104");
  });

  test("handles corrupt verification cache gracefully", async () => {
    const cachePath = getVerificationCachePath(tempDir);
    await Bun.write(cachePath, "{{{{not json}}}");

    const cache = await loadVerificationCache(tempDir);
    expect(cache.verifications).toEqual([]);
  });

  test("persisted verification has full individual reviews", async () => {
    const result = makeVerificationResult({
      individualReviews: [
        {
          account: "reviewer-1",
          verdict: "ACCEPT",
          confidence: 0.9,
          reasoning: "Solid work",
          issues: [],
          strengths: ["Good tests", "Clean code"],
        },
        {
          account: "reviewer-2",
          verdict: "ACCEPT_WITH_NOTES",
          confidence: 0.7,
          reasoning: "Mostly good",
          issues: ["Missing edge case"],
          strengths: ["Good structure"],
        },
      ],
    });

    await appendVerificationResult(result, tempDir);

    const cache = await loadVerificationCache(tempDir);
    const stored = cache.verifications[0];
    expect(stored.individualReviews).toHaveLength(2);
    expect(stored.individualReviews[0].strengths).toContain("Good tests");
    expect(stored.individualReviews[1].issues).toContain("Missing edge case");
  });
});

describe("concurrent persistence", () => {
  test("parallel appends do not lose data", async () => {
    // Append 5 analyses concurrently
    const promises = Array.from({ length: 5 }, (_, i) =>
      appendCouncilAnalysis(makeAnalysis({ taskGoal: `Parallel ${i}` }), tempDir)
    );
    await Promise.all(promises);

    const cache = await loadCouncilCache(tempDir);
    // All 5 should be present (atomicWrite uses locking)
    expect(cache.analyses).toHaveLength(5);
    const goals = cache.analyses.map((a) => a.taskGoal).sort();
    expect(goals).toEqual([
      "Parallel 0",
      "Parallel 1",
      "Parallel 2",
      "Parallel 3",
      "Parallel 4",
    ]);
  });
});
