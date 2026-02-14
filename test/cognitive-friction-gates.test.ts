import { test, expect, describe } from "bun:test";
import {
  checkCognitiveFriction,
  getGatedAcceptanceAction,
  validateJustification,
  type GateAction,
} from "../src/services/cognitive-friction";
import type { HandoffPayload } from "../src/services/handoff";

const basePayload: HandoffPayload = {
  goal: "Test friction gates",
  acceptance_criteria: ["Tests pass"],
  run_commands: ["bun test"],
  blocked_by: ["none"],
};

describe("getGatedAcceptanceAction", () => {
  describe("auto-accept: low criticality + auto-testable", () => {
    test("low + auto-testable => auto-accept", () => {
      const result = getGatedAcceptanceAction({
        ...basePayload,
        criticality: "low",
        verifiability: "auto-testable",
      });
      expect(result.action).toBe("auto-accept");
      expect(result.requiresJustification).toBe(false);
      expect(result.reason).toContain("auto-acceptance");
    });

    test("low + needs-review => require-acceptance (not auto)", () => {
      const result = getGatedAcceptanceAction({
        ...basePayload,
        criticality: "low",
        verifiability: "needs-review",
      });
      expect(result.action).toBe("require-acceptance");
    });

    test("low + no verifiability => require-acceptance", () => {
      const result = getGatedAcceptanceAction({
        ...basePayload,
        criticality: "low",
      });
      expect(result.action).toBe("require-acceptance");
    });
  });

  describe("require-acceptance: medium criticality (default)", () => {
    test("medium criticality => require-acceptance", () => {
      const result = getGatedAcceptanceAction({
        ...basePayload,
        criticality: "medium",
      });
      expect(result.action).toBe("require-acceptance");
      expect(result.requiresJustification).toBe(false);
    });

    test("no criticality (defaults to medium) => require-acceptance", () => {
      const result = getGatedAcceptanceAction(basePayload);
      expect(result.action).toBe("require-acceptance");
      expect(result.requiresJustification).toBe(false);
    });

    test("medium + auto-testable => require-acceptance (medium overrides)", () => {
      const result = getGatedAcceptanceAction({
        ...basePayload,
        criticality: "medium",
        verifiability: "auto-testable",
      });
      expect(result.action).toBe("require-acceptance");
    });
  });

  describe("require-justification: high + irreversible", () => {
    test("high + irreversible => require-justification", () => {
      const result = getGatedAcceptanceAction({
        ...basePayload,
        criticality: "high",
        reversibility: "irreversible",
      });
      expect(result.action).toBe("require-justification");
      expect(result.requiresJustification).toBe(true);
      expect(result.reason).toContain("justification");
    });

    test("high + reversible => require-acceptance (not justification)", () => {
      const result = getGatedAcceptanceAction({
        ...basePayload,
        criticality: "high",
        reversibility: "reversible",
      });
      expect(result.action).toBe("require-acceptance");
      expect(result.requiresJustification).toBe(false);
    });

    test("high + partial => require-acceptance (only irreversible triggers)", () => {
      const result = getGatedAcceptanceAction({
        ...basePayload,
        criticality: "high",
        reversibility: "partial",
      });
      expect(result.action).toBe("require-acceptance");
    });

    test("high + no reversibility => require-acceptance", () => {
      const result = getGatedAcceptanceAction({
        ...basePayload,
        criticality: "high",
      });
      expect(result.action).toBe("require-acceptance");
    });
  });

  describe("require-elevated-review: critical criticality", () => {
    test("critical => require-elevated-review", () => {
      const result = getGatedAcceptanceAction({
        ...basePayload,
        criticality: "critical",
      });
      expect(result.action).toBe("require-elevated-review");
      expect(result.requiresJustification).toBe(true);
      expect(result.reason).toContain("elevated review");
    });

    test("critical + irreversible => require-elevated-review (critical takes precedence)", () => {
      const result = getGatedAcceptanceAction({
        ...basePayload,
        criticality: "critical",
        reversibility: "irreversible",
      });
      expect(result.action).toBe("require-elevated-review");
    });

    test("critical + auto-testable => require-elevated-review (critical overrides)", () => {
      const result = getGatedAcceptanceAction({
        ...basePayload,
        criticality: "critical",
        verifiability: "auto-testable",
      });
      expect(result.action).toBe("require-elevated-review");
    });
  });

  describe("action hierarchy", () => {
    test("all four actions are distinct", () => {
      const actions: GateAction[] = [];

      actions.push(getGatedAcceptanceAction({
        ...basePayload,
        criticality: "low",
        verifiability: "auto-testable",
      }).action);

      actions.push(getGatedAcceptanceAction({
        ...basePayload,
        criticality: "medium",
      }).action);

      actions.push(getGatedAcceptanceAction({
        ...basePayload,
        criticality: "high",
        reversibility: "irreversible",
      }).action);

      actions.push(getGatedAcceptanceAction({
        ...basePayload,
        criticality: "critical",
      }).action);

      const unique = new Set(actions);
      expect(unique.size).toBe(4);
    });
  });
});

describe("validateJustification", () => {
  test("valid when justification not required", () => {
    const gate = getGatedAcceptanceAction({
      ...basePayload,
      criticality: "low",
      verifiability: "auto-testable",
    });
    const result = validateJustification(gate);
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  test("valid when justification required and provided", () => {
    const gate = getGatedAcceptanceAction({
      ...basePayload,
      criticality: "high",
      reversibility: "irreversible",
    });
    const result = validateJustification(gate, "Reviewed and confirmed safe");
    expect(result.valid).toBe(true);
  });

  test("invalid when justification required but not provided", () => {
    const gate = getGatedAcceptanceAction({
      ...basePayload,
      criticality: "critical",
    });
    const result = validateJustification(gate);
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain("Justification is required");
  });

  test("invalid when justification is empty string", () => {
    const gate = getGatedAcceptanceAction({
      ...basePayload,
      criticality: "high",
      reversibility: "irreversible",
    });
    const result = validateJustification(gate, "");
    expect(result.valid).toBe(false);
  });

  test("invalid when justification is whitespace only", () => {
    const gate = getGatedAcceptanceAction({
      ...basePayload,
      criticality: "high",
      reversibility: "irreversible",
    });
    const result = validateJustification(gate, "   ");
    expect(result.valid).toBe(false);
  });

  test("valid when justification not required even if empty", () => {
    const gate = getGatedAcceptanceAction({
      ...basePayload,
      criticality: "medium",
    });
    const result = validateJustification(gate, "");
    expect(result.valid).toBe(true);
  });
});

describe("checkCognitiveFriction integration with gates", () => {
  test("friction blocking aligns with gate justification requirement", () => {
    const payload: HandoffPayload = {
      ...basePayload,
      criticality: "critical",
      reversibility: "irreversible",
    };

    const friction = checkCognitiveFriction(payload);
    const gate = getGatedAcceptanceAction(payload);

    // Both should require human involvement
    expect(friction.requiresHumanReview).toBe(true);
    expect(gate.requiresJustification).toBe(true);
  });

  test("no friction + auto-testable means gate allows auto-accept", () => {
    const payload: HandoffPayload = {
      ...basePayload,
      criticality: "low",
      verifiability: "auto-testable",
      reversibility: "reversible",
    };

    const friction = checkCognitiveFriction(payload);
    const gate = getGatedAcceptanceAction(payload);

    expect(friction.requiresHumanReview).toBe(false);
    expect(gate.action).toBe("auto-accept");
  });
});
