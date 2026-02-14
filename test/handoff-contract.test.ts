import { test, expect, describe } from "bun:test";
import { validateHandoff } from "../src/services/handoff";

const validPayload = {
  goal: "Implement structured handoff contract",
  acceptance_criteria: ["Validation passes for valid payloads", "Errors returned for invalid payloads"],
  run_commands: ["bun test"],
  blocked_by: ["none"],
};

describe("validateHandoff", () => {
  test("valid payload passes validation", () => {
    const result = validateHandoff(validPayload);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.payload).toEqual(validPayload);
    }
  });

  test("missing goal fails", () => {
    const { goal, ...rest } = validPayload;
    const result = validateHandoff(rest);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toEqual([{ field: "goal", message: "goal is required and cannot be empty" }]);
    }
  });

  test("empty goal fails", () => {
    const result = validateHandoff({ ...validPayload, goal: "" });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0].field).toBe("goal");
    }
  });

  test("whitespace-only goal fails", () => {
    const result = validateHandoff({ ...validPayload, goal: "   " });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0].field).toBe("goal");
    }
  });

  test("missing acceptance_criteria fails", () => {
    const { acceptance_criteria, ...rest } = validPayload;
    const result = validateHandoff(rest);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toEqual([{ field: "acceptance_criteria", message: "at least 1 acceptance criterion is required" }]);
    }
  });

  test("empty acceptance_criteria array fails", () => {
    const result = validateHandoff({ ...validPayload, acceptance_criteria: [] });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0].field).toBe("acceptance_criteria");
    }
  });

  test("empty string in acceptance_criteria fails", () => {
    const result = validateHandoff({ ...validPayload, acceptance_criteria: ["valid", ""] });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0].field).toBe("acceptance_criteria");
      expect(result.errors[0].message).toBe("all acceptance criteria must be non-empty strings");
    }
  });

  test("missing run_commands fails", () => {
    const { run_commands, ...rest } = validPayload;
    const result = validateHandoff(rest);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toEqual([{ field: "run_commands", message: "at least 1 run command is required" }]);
    }
  });

  test("empty run_commands array fails", () => {
    const result = validateHandoff({ ...validPayload, run_commands: [] });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0].field).toBe("run_commands");
    }
  });

  test("empty string in run_commands fails", () => {
    const result = validateHandoff({ ...validPayload, run_commands: ["bun test", ""] });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0].field).toBe("run_commands");
      expect(result.errors[0].message).toBe("all run commands must be non-empty strings");
    }
  });

  test("missing blocked_by fails", () => {
    const { blocked_by, ...rest } = validPayload;
    const result = validateHandoff(rest);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toEqual([{ field: "blocked_by", message: "blocked_by is required (use [\"none\"] if no blockers)" }]);
    }
  });

  test("empty blocked_by array fails", () => {
    const result = validateHandoff({ ...validPayload, blocked_by: [] });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0].field).toBe("blocked_by");
    }
  });

  test('blocked_by with ["none"] passes', () => {
    const result = validateHandoff({ ...validPayload, blocked_by: ["none"] });
    expect(result.valid).toBe(true);
  });

  test("blocked_by with empty string fails", () => {
    const result = validateHandoff({ ...validPayload, blocked_by: ["task-1", ""] });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0].field).toBe("blocked_by");
      expect(result.errors[0].message).toBe("all blocked_by entries must be non-empty strings");
    }
  });

  test("full valid payload returns correct shape", () => {
    const payload = {
      goal: "Deploy feature X",
      acceptance_criteria: ["Tests pass", "No regressions"],
      run_commands: ["bun test", "bun run build"],
      blocked_by: ["task-42"],
    };
    const result = validateHandoff(payload);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.payload.goal).toBe("Deploy feature X");
      expect(result.payload.acceptance_criteria).toHaveLength(2);
      expect(result.payload.run_commands).toHaveLength(2);
      expect(result.payload.blocked_by).toEqual(["task-42"]);
    }
  });

  test("multiple missing fields returns multiple errors", () => {
    const result = validateHandoff({});
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.length).toBe(4);
      const fields = result.errors.map((e) => e.field);
      expect(fields).toContain("goal");
      expect(fields).toContain("acceptance_criteria");
      expect(fields).toContain("run_commands");
      expect(fields).toContain("blocked_by");
    }
  });

  test("null payload fails gracefully", () => {
    const result = validateHandoff(null);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.length).toBe(4);
    }
  });

  test("undefined payload fails gracefully", () => {
    const result = validateHandoff(undefined);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.length).toBe(4);
    }
  });
});
