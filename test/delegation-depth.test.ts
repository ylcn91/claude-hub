import { test, expect, describe } from "bun:test";
import { checkDelegationDepth, computeNextDepth, DEFAULT_DELEGATION_DEPTH_CONFIG } from "../src/services/delegation-depth";
import type { HandoffPayload } from "../src/services/handoff";

const basePayload: HandoffPayload = {
  goal: "Test task",
  acceptance_criteria: ["Tests pass"],
  run_commands: ["bun test"],
  blocked_by: ["none"],
};

describe("checkDelegationDepth", () => {
  test("allows depth 0 with default config", () => {
    const result = checkDelegationDepth({ ...basePayload, delegation_depth: 0 });
    expect(result.allowed).toBe(true);
    expect(result.currentDepth).toBe(0);
    expect(result.maxDepth).toBe(3);
    expect(result.requiresReauthorization).toBe(false);
    expect(result.reason).toBeUndefined();
  });

  test("allows depth 1 with default config", () => {
    const result = checkDelegationDepth({ ...basePayload, delegation_depth: 1 });
    expect(result.allowed).toBe(true);
    expect(result.requiresReauthorization).toBe(false);
  });

  test("warns when approaching limit (depth 2 with max 3)", () => {
    const result = checkDelegationDepth({ ...basePayload, delegation_depth: 2 });
    expect(result.allowed).toBe(true);
    expect(result.requiresReauthorization).toBe(false);
    expect(result.reason).toContain("Approaching");
  });

  test("blocks when depth equals maxDepth", () => {
    const result = checkDelegationDepth({ ...basePayload, delegation_depth: 3 });
    expect(result.allowed).toBe(false);
    expect(result.requiresReauthorization).toBe(true);
    expect(result.reason).toContain("exceeds");
    expect(result.reason).toContain("re-authorization");
  });

  test("blocks when depth exceeds maxDepth", () => {
    const result = checkDelegationDepth({ ...basePayload, delegation_depth: 5 });
    expect(result.allowed).toBe(false);
    expect(result.requiresReauthorization).toBe(true);
  });

  test("treats undefined delegation_depth as 0", () => {
    const result = checkDelegationDepth(basePayload);
    expect(result.allowed).toBe(true);
    expect(result.currentDepth).toBe(0);
  });

  test("respects custom maxDepth", () => {
    const result = checkDelegationDepth(
      { ...basePayload, delegation_depth: 2 },
      { maxDepth: 2 },
    );
    expect(result.allowed).toBe(false);
    expect(result.maxDepth).toBe(2);
  });

  test("warns at custom maxDepth - 1", () => {
    const result = checkDelegationDepth(
      { ...basePayload, delegation_depth: 4 },
      { maxDepth: 5 },
    );
    expect(result.allowed).toBe(true);
    expect(result.reason).toContain("Approaching");
  });

  test("blocks at custom maxDepth", () => {
    const result = checkDelegationDepth(
      { ...basePayload, delegation_depth: 5 },
      { maxDepth: 5 },
    );
    expect(result.allowed).toBe(false);
  });

  test("allows depth 0 with maxDepth 1", () => {
    const result = checkDelegationDepth(
      { ...basePayload, delegation_depth: 0 },
      { maxDepth: 1 },
    );
    expect(result.allowed).toBe(true);
    expect(result.reason).toContain("Approaching");
  });

  test("blocks depth 1 with maxDepth 1", () => {
    const result = checkDelegationDepth(
      { ...basePayload, delegation_depth: 1 },
      { maxDepth: 1 },
    );
    expect(result.allowed).toBe(false);
  });

  test("returns correct check shape", () => {
    const result = checkDelegationDepth({ ...basePayload, delegation_depth: 1 });
    expect(typeof result.allowed).toBe("boolean");
    expect(typeof result.currentDepth).toBe("number");
    expect(typeof result.maxDepth).toBe("number");
    expect(typeof result.requiresReauthorization).toBe("boolean");
  });
});

describe("computeNextDepth", () => {
  test("increments from 0", () => {
    expect(computeNextDepth(0)).toBe(1);
  });

  test("increments from 2", () => {
    expect(computeNextDepth(2)).toBe(3);
  });

  test("treats undefined as 0", () => {
    expect(computeNextDepth(undefined)).toBe(1);
  });

  test("increments from 5", () => {
    expect(computeNextDepth(5)).toBe(6);
  });
});

describe("DEFAULT_DELEGATION_DEPTH_CONFIG", () => {
  test("has maxDepth of 3", () => {
    expect(DEFAULT_DELEGATION_DEPTH_CONFIG.maxDepth).toBe(3);
  });
});
