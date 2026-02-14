import { test, expect, describe } from "bun:test";
import { checkCognitiveFriction } from "../src/services/cognitive-friction";
import type { HandoffPayload } from "../src/services/handoff";

const basePayload: HandoffPayload = {
  goal: "Test task",
  acceptance_criteria: ["Tests pass"],
  run_commands: ["bun test"],
  blocked_by: ["none"],
};

describe("checkCognitiveFriction", () => {
  describe("blocking: high/critical criticality + limited reversibility", () => {
    test("high criticality + irreversible => blocking", () => {
      const result = checkCognitiveFriction({
        ...basePayload,
        criticality: "high",
        reversibility: "irreversible",
      });
      expect(result.requiresHumanReview).toBe(true);
      expect(result.frictionLevel).toBe("blocking");
      expect(result.reason).toContain("human review");
    });

    test("high criticality + partial => blocking", () => {
      const result = checkCognitiveFriction({
        ...basePayload,
        criticality: "high",
        reversibility: "partial",
      });
      expect(result.requiresHumanReview).toBe(true);
      expect(result.frictionLevel).toBe("blocking");
    });

    test("critical criticality + irreversible => blocking", () => {
      const result = checkCognitiveFriction({
        ...basePayload,
        criticality: "critical",
        reversibility: "irreversible",
      });
      expect(result.requiresHumanReview).toBe(true);
      expect(result.frictionLevel).toBe("blocking");
    });

    test("critical criticality + partial => blocking", () => {
      const result = checkCognitiveFriction({
        ...basePayload,
        criticality: "critical",
        reversibility: "partial",
      });
      expect(result.requiresHumanReview).toBe(true);
      expect(result.frictionLevel).toBe("blocking");
    });
  });

  describe("warning: critical criticality alone", () => {
    test("critical criticality + reversible => warning", () => {
      const result = checkCognitiveFriction({
        ...basePayload,
        criticality: "critical",
        reversibility: "reversible",
      });
      // Rule 1 does not match (reversible), so falls through to rule 2
      // But rule 1 actually matches critical + reversible? No, it requires irreversible/partial.
      // So rule 2 matches: critical alone => warning
      expect(result.requiresHumanReview).toBe(true);
      expect(result.frictionLevel).toBe("warning");
      expect(result.reason).toContain("Critical task");
    });

    test("critical criticality + no reversibility set => warning", () => {
      const result = checkCognitiveFriction({
        ...basePayload,
        criticality: "critical",
      });
      expect(result.requiresHumanReview).toBe(true);
      expect(result.frictionLevel).toBe("warning");
    });
  });

  describe("warning: irreversible + high/critical complexity", () => {
    test("irreversible + high complexity => warning", () => {
      const result = checkCognitiveFriction({
        ...basePayload,
        reversibility: "irreversible",
        complexity: "high",
      });
      expect(result.requiresHumanReview).toBe(true);
      expect(result.frictionLevel).toBe("warning");
      expect(result.reason).toContain("Irreversible");
    });

    test("irreversible + critical complexity => warning", () => {
      const result = checkCognitiveFriction({
        ...basePayload,
        reversibility: "irreversible",
        complexity: "critical",
      });
      expect(result.requiresHumanReview).toBe(true);
      expect(result.frictionLevel).toBe("warning");
    });

    test("irreversible + low complexity => none", () => {
      const result = checkCognitiveFriction({
        ...basePayload,
        reversibility: "irreversible",
        complexity: "low",
      });
      expect(result.requiresHumanReview).toBe(false);
      expect(result.frictionLevel).toBe("none");
    });

    test("irreversible + medium complexity => none", () => {
      const result = checkCognitiveFriction({
        ...basePayload,
        reversibility: "irreversible",
        complexity: "medium",
      });
      expect(result.requiresHumanReview).toBe(false);
      expect(result.frictionLevel).toBe("none");
    });
  });

  describe("no friction cases", () => {
    test("no criticality or reversibility => none", () => {
      const result = checkCognitiveFriction(basePayload);
      expect(result.requiresHumanReview).toBe(false);
      expect(result.frictionLevel).toBe("none");
      expect(result.reason).toBeUndefined();
    });

    test("low criticality + reversible => none", () => {
      const result = checkCognitiveFriction({
        ...basePayload,
        criticality: "low",
        reversibility: "reversible",
      });
      expect(result.requiresHumanReview).toBe(false);
      expect(result.frictionLevel).toBe("none");
    });

    test("medium criticality + reversible => none", () => {
      const result = checkCognitiveFriction({
        ...basePayload,
        criticality: "medium",
        reversibility: "reversible",
      });
      expect(result.requiresHumanReview).toBe(false);
      expect(result.frictionLevel).toBe("none");
    });

    test("medium criticality + partial => none", () => {
      const result = checkCognitiveFriction({
        ...basePayload,
        criticality: "medium",
        reversibility: "partial",
      });
      expect(result.requiresHumanReview).toBe(false);
      expect(result.frictionLevel).toBe("none");
    });

    test("high criticality + reversible => none", () => {
      const result = checkCognitiveFriction({
        ...basePayload,
        criticality: "high",
        reversibility: "reversible",
      });
      expect(result.requiresHumanReview).toBe(false);
      expect(result.frictionLevel).toBe("none");
    });

    test("low criticality + irreversible => none (no complexity set)", () => {
      const result = checkCognitiveFriction({
        ...basePayload,
        criticality: "low",
        reversibility: "irreversible",
      });
      expect(result.requiresHumanReview).toBe(false);
      expect(result.frictionLevel).toBe("none");
    });
  });

  describe("return shape", () => {
    test("returns FrictionCheck structure", () => {
      const result = checkCognitiveFriction(basePayload);
      expect(typeof result.requiresHumanReview).toBe("boolean");
      expect(typeof result.frictionLevel).toBe("string");
      expect(["none", "warning", "blocking"]).toContain(result.frictionLevel);
    });

    test("blocking result includes reason", () => {
      const result = checkCognitiveFriction({
        ...basePayload,
        criticality: "critical",
        reversibility: "irreversible",
      });
      expect(result.reason).toBeDefined();
      expect(typeof result.reason).toBe("string");
    });

    test("none result has no reason", () => {
      const result = checkCognitiveFriction(basePayload);
      expect(result.reason).toBeUndefined();
    });
  });
});
