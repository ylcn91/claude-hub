export interface HandoffPayload {
  goal: string;
  acceptance_criteria: string[];
  run_commands: string[];
  blocked_by: string[];
}

export interface HandoffValidationError {
  field: string;
  message: string;
}

export function validateHandoff(payload: unknown): { valid: true; payload: HandoffPayload } | { valid: false; errors: HandoffValidationError[] } {
  const errors: HandoffValidationError[] = [];
  const obj = payload as Record<string, unknown> | null | undefined;

  if (!obj?.goal || typeof obj.goal !== "string" || obj.goal.trim() === "") {
    errors.push({ field: "goal", message: "goal is required and cannot be empty" });
  }

  if (!Array.isArray(obj?.acceptance_criteria) || obj.acceptance_criteria.length === 0) {
    errors.push({ field: "acceptance_criteria", message: "at least 1 acceptance criterion is required" });
  } else if (obj.acceptance_criteria.some((c: unknown) => typeof c !== "string" || (c as string).trim() === "")) {
    errors.push({ field: "acceptance_criteria", message: "all acceptance criteria must be non-empty strings" });
  }

  if (!Array.isArray(obj?.run_commands) || obj.run_commands.length === 0) {
    errors.push({ field: "run_commands", message: "at least 1 run command is required" });
  } else if (obj.run_commands.some((c: unknown) => typeof c !== "string" || (c as string).trim() === "")) {
    errors.push({ field: "run_commands", message: "all run commands must be non-empty strings" });
  }

  if (!Array.isArray(obj?.blocked_by) || obj.blocked_by.length === 0) {
    errors.push({ field: "blocked_by", message: "blocked_by is required (use [\"none\"] if no blockers)" });
  } else if (obj.blocked_by.some((b: unknown) => typeof b !== "string" || (b as string).trim() === "")) {
    errors.push({ field: "blocked_by", message: "all blocked_by entries must be non-empty strings" });
  }

  if (errors.length > 0) return { valid: false, errors };
  return {
    valid: true,
    payload: {
      goal: obj!.goal as string,
      acceptance_criteria: obj!.acceptance_criteria as string[],
      run_commands: obj!.run_commands as string[],
      blocked_by: obj!.blocked_by as string[],
    },
  };
}
