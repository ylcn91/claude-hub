import { test, expect, describe } from "bun:test";
import {
  checkDelegationDepth,
  computeNextDepth,
  DEFAULT_DELEGATION_DEPTH_CONFIG,
  type DelegationDepthCheck,
} from "../src/services/delegation-depth";
import type { HandoffPayload } from "../src/services/handoff";

const basePayload: HandoffPayload = {
  goal: "Test delegation chain",
  acceptance_criteria: ["Chain is enforced"],
  run_commands: ["bun test"],
  blocked_by: ["none"],
};

describe("delegation chain enforcement", () => {
  describe("depth tracking with parent_handoff_id", () => {
    test("allows depth 0 even with parent_handoff_id", () => {
      const result = checkDelegationDepth({
        ...basePayload,
        delegation_depth: 0,
        parent_handoff_id: "parent-123",
      });
      expect(result.allowed).toBe(true);
      expect(result.currentDepth).toBe(0);
    });

    test("tracks depth through chain", () => {
      // Simulate a chain: original -> depth 1 -> depth 2
      const depth0 = checkDelegationDepth({
        ...basePayload,
        delegation_depth: 0,
      });
      expect(depth0.allowed).toBe(true);

      const depth1 = checkDelegationDepth({
        ...basePayload,
        delegation_depth: computeNextDepth(0),
        parent_handoff_id: "handoff-0",
      });
      expect(depth1.allowed).toBe(true);
      expect(depth1.currentDepth).toBe(1);

      const depth2 = checkDelegationDepth({
        ...basePayload,
        delegation_depth: computeNextDepth(1),
        parent_handoff_id: "handoff-1",
      });
      expect(depth2.allowed).toBe(true);
      expect(depth2.currentDepth).toBe(2);
      expect(depth2.reason).toContain("Approaching");

      // Depth 3 should be blocked
      const depth3 = checkDelegationDepth({
        ...basePayload,
        delegation_depth: computeNextDepth(2),
        parent_handoff_id: "handoff-2",
      });
      expect(depth3.allowed).toBe(false);
      expect(depth3.currentDepth).toBe(3);
      expect(depth3.requiresReauthorization).toBe(true);
    });
  });

  describe("rejection with clear error", () => {
    test("includes max depth in error message", () => {
      const result = checkDelegationDepth(
        { ...basePayload, delegation_depth: 5 },
        { maxDepth: 5 },
      );
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("5");
      expect(result.reason).toContain("re-authorization");
    });

    test("includes current depth in error message", () => {
      const result = checkDelegationDepth(
        { ...basePayload, delegation_depth: 3 },
      );
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("3");
    });
  });

  describe("config-driven maxDepth", () => {
    test("defaults to maxDepth 3", () => {
      expect(DEFAULT_DELEGATION_DEPTH_CONFIG.maxDepth).toBe(3);
    });

    test("respects maxDepth of 1 (strict)", () => {
      const result = checkDelegationDepth(
        { ...basePayload, delegation_depth: 1 },
        { maxDepth: 1 },
      );
      expect(result.allowed).toBe(false);
    });

    test("respects maxDepth of 10 (lenient)", () => {
      const result = checkDelegationDepth(
        { ...basePayload, delegation_depth: 9 },
        { maxDepth: 10 },
      );
      expect(result.allowed).toBe(true);
      expect(result.reason).toContain("Approaching");
    });

    test("depth exactly at limit is blocked", () => {
      for (const maxDepth of [1, 2, 3, 5, 10]) {
        const result = checkDelegationDepth(
          { ...basePayload, delegation_depth: maxDepth },
          { maxDepth },
        );
        expect(result.allowed).toBe(false);
        expect(result.maxDepth).toBe(maxDepth);
      }
    });

    test("depth one below limit is allowed with warning", () => {
      for (const maxDepth of [1, 2, 3, 5, 10]) {
        const result = checkDelegationDepth(
          { ...basePayload, delegation_depth: maxDepth - 1 },
          { maxDepth },
        );
        expect(result.allowed).toBe(true);
        expect(result.reason).toContain("Approaching");
      }
    });
  });

  describe("computeNextDepth chain computation", () => {
    test("builds correct chain from 0", () => {
      let depth = 0;
      for (let i = 1; i <= 5; i++) {
        depth = computeNextDepth(depth);
        expect(depth).toBe(i);
      }
    });

    test("undefined parent depth starts at 1", () => {
      expect(computeNextDepth(undefined)).toBe(1);
    });
  });

  describe("DelegationDepthCheck shape", () => {
    test("check result has all required fields", () => {
      const result = checkDelegationDepth(basePayload);
      expect("allowed" in result).toBe(true);
      expect("currentDepth" in result).toBe(true);
      expect("maxDepth" in result).toBe(true);
      expect("requiresReauthorization" in result).toBe(true);
    });

    test("blocked check always has reason", () => {
      const result = checkDelegationDepth(
        { ...basePayload, delegation_depth: 3 },
      );
      expect(result.allowed).toBe(false);
      expect(result.reason).toBeDefined();
      expect(typeof result.reason).toBe("string");
      expect(result.reason!.length).toBeGreaterThan(0);
    });

    test("normal allowed check has no reason", () => {
      const result = checkDelegationDepth(
        { ...basePayload, delegation_depth: 0 },
      );
      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });
  });
});
