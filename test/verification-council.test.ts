import { test, expect, describe } from "bun:test";
import {
  verifyTaskCompletion,
  needsCouncilVerification,
  type ReviewBundle,
  type HandoffPayloadForVerification,
} from "../src/services/verification-council";
import type { LLMCaller } from "../src/services/council";

describe("verification-council", () => {
  const handoffPayload: HandoffPayloadForVerification = {
    goal: "Add user authentication with JWT",
    acceptance_criteria: [
      "Login endpoint returns JWT token",
      "Protected routes require valid token",
      "Tests pass for auth flow",
    ],
  };

  const reviewBundle: ReviewBundle = {
    diff: "diff --git a/src/auth.ts b/src/auth.ts\n+export function login() { ... }",
    testResults: "3 passed, 0 failed",
    filesChanged: ["src/auth.ts", "src/middleware.ts", "test/auth.test.ts"],
    riskNotes: [],
  };

  describe("needsCouncilVerification", () => {
    test("returns true for needs-review", () => {
      expect(needsCouncilVerification("needs-review")).toBe(true);
    });

    test("returns true for subjective", () => {
      expect(needsCouncilVerification("subjective")).toBe(true);
    });

    test("returns false for auto-testable", () => {
      expect(needsCouncilVerification("auto-testable")).toBe(false);
    });

    test("returns false for undefined", () => {
      expect(needsCouncilVerification(undefined)).toBe(false);
    });
  });

  describe("verifyTaskCompletion", () => {
    test("returns ACCEPT when all models agree", async () => {
      const mockCaller: LLMCaller = async (_model, systemPrompt, _userPrompt) => {
        if (systemPrompt.includes("peer reviewer")) {
          return JSON.stringify({ ranking: [0, 1, 2], reasoning: "All reviews are solid" });
        }
        if (systemPrompt.includes("chairman")) {
          return JSON.stringify({
            verdict: "ACCEPT",
            confidence: 0.95,
            notes: ["Clean implementation"],
            reasoning: "All reviewers agree the task is complete",
          });
        }
        // Stage 1 — individual review
        return JSON.stringify({
          verdict: "ACCEPT",
          confidence: 0.9,
          reasoning: "All acceptance criteria are met",
          issues: [],
          strengths: ["Good test coverage", "Clean code"],
        });
      };

      const result = await verifyTaskCompletion(
        "task-123",
        reviewBundle,
        handoffPayload,
        { models: ["model-a", "model-b", "model-c"], chairman: "model-a", llmCaller: mockCaller },
      );

      expect(result.verdict).toBe("ACCEPT");
      expect(result.confidence).toBe(0.95);
      expect(result.notes).toContain("Clean implementation");
      expect(result.individualReviews).toHaveLength(3);
      expect(result.peerEvaluations).toHaveLength(3);
      expect(result.receipt.taskId).toBe("task-123");
      expect(result.receipt.verifier).toBe("council");
      expect(result.receipt.verdict).toBe("ACCEPT");
    });

    test("returns REJECT when chairman rejects", async () => {
      const mockCaller: LLMCaller = async (_model, systemPrompt, _userPrompt) => {
        if (systemPrompt.includes("peer reviewer")) {
          return JSON.stringify({ ranking: [1, 0], reasoning: "Review B is more thorough" });
        }
        if (systemPrompt.includes("chairman")) {
          return JSON.stringify({
            verdict: "REJECT",
            confidence: 0.8,
            notes: ["Missing test for edge case", "No error handling"],
            reasoning: "Acceptance criteria #2 not fully met",
          });
        }
        return JSON.stringify({
          verdict: "REJECT",
          confidence: 0.7,
          reasoning: "Tests incomplete",
          issues: ["Missing edge case test"],
          strengths: ["Good structure"],
        });
      };

      const result = await verifyTaskCompletion(
        "task-456",
        reviewBundle,
        handoffPayload,
        { models: ["model-a", "model-b"], chairman: "model-a", llmCaller: mockCaller },
      );

      expect(result.verdict).toBe("REJECT");
      expect(result.notes).toContain("Missing test for edge case");
      expect(result.receipt.verdict).toBe("REJECT");
    });

    test("returns ACCEPT_WITH_NOTES for mixed reviews", async () => {
      let callCount = 0;
      const mockCaller: LLMCaller = async (_model, systemPrompt, _userPrompt) => {
        if (systemPrompt.includes("peer reviewer")) {
          return JSON.stringify({ ranking: [0, 1], reasoning: "Both are valid" });
        }
        if (systemPrompt.includes("chairman")) {
          return JSON.stringify({
            verdict: "ACCEPT_WITH_NOTES",
            confidence: 0.75,
            notes: ["Consider adding more tests", "Documentation could be improved"],
            reasoning: "Task is complete but has minor gaps",
          });
        }
        callCount++;
        if (callCount % 2 === 0) {
          return JSON.stringify({
            verdict: "ACCEPT",
            confidence: 0.85,
            reasoning: "Looks good",
            issues: [],
            strengths: ["Clean implementation"],
          });
        }
        return JSON.stringify({
          verdict: "REJECT",
          confidence: 0.6,
          reasoning: "Missing docs",
          issues: ["No documentation"],
          strengths: ["Code works"],
        });
      };

      const result = await verifyTaskCompletion(
        "task-789",
        reviewBundle,
        handoffPayload,
        { models: ["model-a", "model-b"], chairman: "model-c", llmCaller: mockCaller },
      );

      expect(result.verdict).toBe("ACCEPT_WITH_NOTES");
      expect(result.confidence).toBe(0.75);
      expect(result.notes).toHaveLength(2);
    });

    test("returns REJECT with zero confidence when all models fail", async () => {
      const mockCaller: LLMCaller = async () => {
        throw new Error("Model unavailable");
      };

      const result = await verifyTaskCompletion(
        "task-fail",
        reviewBundle,
        handoffPayload,
        { models: ["model-a"], chairman: "model-a", llmCaller: mockCaller },
      );

      expect(result.verdict).toBe("REJECT");
      expect(result.confidence).toBe(0);
      expect(result.individualReviews).toHaveLength(0);
      expect(result.notes).toContain("All verification models failed to respond");
    });

    test("throws when no LLM caller provided", async () => {
      await expect(
        verifyTaskCompletion("task-x", reviewBundle, handoffPayload),
      ).rejects.toThrow("Council verification requires an LLM caller");
    });
  });

  describe("receipt generation", () => {
    test("receipt contains correct task ID and verifier", async () => {
      const mockCaller: LLMCaller = async (_model, systemPrompt) => {
        if (systemPrompt.includes("peer reviewer")) {
          return JSON.stringify({ ranking: [0], reasoning: "ok" });
        }
        if (systemPrompt.includes("chairman")) {
          return JSON.stringify({
            verdict: "ACCEPT",
            confidence: 0.9,
            notes: [],
            reasoning: "Good",
          });
        }
        return JSON.stringify({
          verdict: "ACCEPT",
          confidence: 0.9,
          reasoning: "ok",
          issues: [],
          strengths: [],
        });
      };

      const result = await verifyTaskCompletion(
        "task-receipt-test",
        reviewBundle,
        handoffPayload,
        { models: ["model-a"], chairman: "model-a", llmCaller: mockCaller },
      );

      expect(result.receipt.taskId).toBe("task-receipt-test");
      expect(result.receipt.verifier).toBe("council");
      expect(result.receipt.verdict).toBe("ACCEPT");
      expect(result.receipt.timestamp).toBeTruthy();
      expect(result.receipt.specHash).toBeTruthy();
      expect(result.receipt.evidenceHash).toBeTruthy();
      // specHash and evidenceHash should be different (different data)
      expect(result.receipt.specHash).not.toBe(result.receipt.evidenceHash);
    });

    test("specHash is deterministic for same goal+criteria", async () => {
      const mockCaller: LLMCaller = async (_model, systemPrompt) => {
        if (systemPrompt.includes("peer reviewer")) {
          return JSON.stringify({ ranking: [0], reasoning: "ok" });
        }
        if (systemPrompt.includes("chairman")) {
          return JSON.stringify({ verdict: "ACCEPT", confidence: 0.9, notes: [], reasoning: "ok" });
        }
        return JSON.stringify({ verdict: "ACCEPT", confidence: 0.9, reasoning: "ok", issues: [], strengths: [] });
      };

      const r1 = await verifyTaskCompletion(
        "task-1",
        reviewBundle,
        handoffPayload,
        { models: ["m"], chairman: "m", llmCaller: mockCaller },
      );
      const r2 = await verifyTaskCompletion(
        "task-2",
        reviewBundle,
        handoffPayload,
        { models: ["m"], chairman: "m", llmCaller: mockCaller },
      );

      // Same handoff payload should produce the same specHash
      expect(r1.receipt.specHash).toBe(r2.receipt.specHash);
    });
  });

  describe("handles malformed LLM responses", () => {
    test("handles JSON inside markdown fences", async () => {
      const mockCaller: LLMCaller = async (_model, systemPrompt) => {
        if (systemPrompt.includes("peer reviewer")) {
          return "```json\n{\"ranking\": [0], \"reasoning\": \"ok\"}\n```";
        }
        if (systemPrompt.includes("chairman")) {
          return "```\n{\"verdict\": \"ACCEPT\", \"confidence\": 0.8, \"notes\": [], \"reasoning\": \"ok\"}\n```";
        }
        return "```json\n{\"verdict\": \"ACCEPT\", \"confidence\": 0.9, \"reasoning\": \"ok\", \"issues\": [], \"strengths\": []}\n```";
      };

      const result = await verifyTaskCompletion(
        "task-fence",
        reviewBundle,
        handoffPayload,
        { models: ["m"], chairman: "m", llmCaller: mockCaller },
      );

      expect(result.verdict).toBe("ACCEPT");
      expect(result.individualReviews).toHaveLength(1);
    });

    test("normalizes unknown verdicts to REJECT", async () => {
      const mockCaller: LLMCaller = async (_model, systemPrompt) => {
        if (systemPrompt.includes("peer reviewer")) {
          return JSON.stringify({ ranking: [0], reasoning: "ok" });
        }
        if (systemPrompt.includes("chairman")) {
          return JSON.stringify({
            verdict: "MAYBE",
            confidence: 0.5,
            notes: [],
            reasoning: "Not sure",
          });
        }
        return JSON.stringify({
          verdict: "PASS",
          confidence: 0.5,
          reasoning: "ok",
          issues: [],
          strengths: [],
        });
      };

      const result = await verifyTaskCompletion(
        "task-unknown",
        reviewBundle,
        handoffPayload,
        { models: ["m"], chairman: "m", llmCaller: mockCaller },
      );

      // Unknown verdicts normalize to REJECT
      expect(result.verdict).toBe("REJECT");
    });
  });
});
