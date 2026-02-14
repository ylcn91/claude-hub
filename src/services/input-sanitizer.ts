// F-12: Input Sanitization
// Harden handoff field validation against injection attacks.

export interface SanitizationError {
  field: string;
  message: string;
  severity: "block" | "warn";
}

export interface SanitizationResult {
  safe: boolean;
  errors: SanitizationError[];
  warnings: SanitizationError[];
}

// Max length limits
const MAX_GOAL_LENGTH = 10_000;
const MAX_CRITERIA_ITEM_LENGTH = 2_000;
const MAX_RUN_COMMAND_LENGTH = 1_000;

// Shell injection patterns for run_commands
const SHELL_INJECTION_PATTERNS: { pattern: RegExp; description: string }[] = [
  { pattern: /`[^`]+`/, description: "backtick command substitution" },
  { pattern: /\$\(/, description: "$() command substitution" },
  { pattern: /\$\{/, description: "${} variable expansion" },
  { pattern: /;\s*rm\b/, description: "command chaining with rm" },
  { pattern: /&&\s*curl\b/, description: "command chaining with curl" },
  { pattern: /&&\s*wget\b/, description: "command chaining with wget" },
  { pattern: /\|\s*bash\b/, description: "pipe to bash" },
  { pattern: /\|\s*sh\b/, description: "pipe to sh" },
  { pattern: /\|\s*zsh\b/, description: "pipe to zsh" },
  { pattern: /\$\(wget\b/, description: "$() with wget" },
  { pattern: /\$\(curl\b/, description: "$() with curl" },
  { pattern: />\s*\/etc\//, description: "redirect to /etc/" },
  { pattern: />\s*\/dev\//, description: "redirect to /dev/" },
  { pattern: /;\s*chmod\s+[0-7]{3,4}\b/, description: "command chaining with chmod" },
  { pattern: /;\s*sudo\b/, description: "command chaining with sudo" },
  { pattern: /;\s*mkfs\b/, description: "command chaining with mkfs" },
  { pattern: /;\s*dd\b/, description: "command chaining with dd" },
  { pattern: />\s*~\/\.\w+/, description: "redirect to hidden dotfile" },
];

// Path traversal patterns
const PATH_TRAVERSAL_PATTERNS: { pattern: RegExp; description: string }[] = [
  { pattern: /\.\.\//, description: "relative path traversal (../)" },
  { pattern: /\.\.\\/, description: "relative path traversal (..\\)" },
  { pattern: /\x00/, description: "null byte in path" },
  // eslint-disable-next-line no-control-regex
  { pattern: /[\x01-\x1f\x7f]/, description: "control character in path" },
];

// System prompt override patterns
const PROMPT_OVERRIDE_PATTERNS: { pattern: RegExp; description: string }[] = [
  { pattern: /ignore\s+(?:all\s+)?previous\s+instructions/i, description: "prompt override: ignore previous instructions" },
  { pattern: /(?:^|\n)\s*system\s*:/im, description: "prompt override: system: prefix" },
  { pattern: /you\s+are\s+now\s+(?:a|an)\b/i, description: "prompt override: identity reassignment" },
  { pattern: /forget\s+(?:all\s+)?your\s+instructions/i, description: "prompt override: forget instructions" },
  { pattern: /disregard\s+(?:all\s+)?(?:previous|prior|above)\s+(?:instructions|prompts|rules)/i, description: "prompt override: disregard instructions" },
  { pattern: /new\s+instructions?\s*:/i, description: "prompt override: new instructions" },
  { pattern: /override\s+(?:system|safety)\s+(?:prompt|instructions|rules)/i, description: "prompt override: override system" },
];

// Control characters regex (null bytes, ANSI escapes, C0/C1 control chars except \n, \r, \t)
// Match ANSI sequences first (longer patterns), then single control chars
const CONTROL_CHARS_RE = /\x1b\[[0-9;]*[A-Za-z]|\x1b\].*?\x07|[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;

/**
 * Strip control characters and ANSI escape sequences from a string.
 * Preserves newlines (\n), carriage returns (\r), and tabs (\t).
 */
export function stripControlChars(input: string): string {
  return input.replace(CONTROL_CHARS_RE, "");
}

/**
 * Check a single run_command for shell injection patterns.
 */
function checkShellInjection(command: string, index: number): SanitizationError[] {
  const errors: SanitizationError[] = [];
  for (const { pattern, description } of SHELL_INJECTION_PATTERNS) {
    if (pattern.test(command)) {
      errors.push({
        field: `run_commands[${index}]`,
        message: `Potential shell injection detected: ${description}`,
        severity: "block",
      });
    }
  }
  return errors;
}

/**
 * Check a path string for traversal attacks.
 */
function checkPathTraversal(value: string, field: string): SanitizationError[] {
  const errors: SanitizationError[] = [];
  for (const { pattern, description } of PATH_TRAVERSAL_PATTERNS) {
    if (pattern.test(value)) {
      errors.push({
        field,
        message: `Path traversal detected: ${description}`,
        severity: "block",
      });
    }
  }
  return errors;
}

/**
 * Check text for system prompt override attempts.
 */
function checkPromptOverride(text: string, field: string): SanitizationError[] {
  const warnings: SanitizationError[] = [];
  for (const { pattern, description } of PROMPT_OVERRIDE_PATTERNS) {
    if (pattern.test(text)) {
      warnings.push({
        field,
        message: `${description}`,
        severity: "warn",
      });
    }
  }
  return warnings;
}

/**
 * Sanitize the full handoff payload. Call before validateHandoff().
 *
 * Returns { safe, errors, warnings }:
 * - safe=false if any "block" severity errors found
 * - warnings contain "warn" severity items (prompt override attempts)
 */
export function sanitizeHandoffPayload(payload: unknown): SanitizationResult {
  const errors: SanitizationError[] = [];
  const warnings: SanitizationError[] = [];

  if (!payload || typeof payload !== "object") {
    return { safe: true, errors: [], warnings: [] };
  }

  const obj = payload as Record<string, unknown>;

  // 1. Max length enforcement
  if (typeof obj.goal === "string" && obj.goal.length > MAX_GOAL_LENGTH) {
    errors.push({
      field: "goal",
      message: `goal exceeds maximum length of ${MAX_GOAL_LENGTH} characters (got ${obj.goal.length})`,
      severity: "block",
    });
  }

  if (Array.isArray(obj.acceptance_criteria)) {
    for (let i = 0; i < obj.acceptance_criteria.length; i++) {
      const item = obj.acceptance_criteria[i];
      if (typeof item === "string" && item.length > MAX_CRITERIA_ITEM_LENGTH) {
        errors.push({
          field: `acceptance_criteria[${i}]`,
          message: `acceptance criterion exceeds maximum length of ${MAX_CRITERIA_ITEM_LENGTH} characters (got ${item.length})`,
          severity: "block",
        });
      }
    }
  }

  if (Array.isArray(obj.run_commands)) {
    for (let i = 0; i < obj.run_commands.length; i++) {
      const cmd = obj.run_commands[i];
      if (typeof cmd === "string" && cmd.length > MAX_RUN_COMMAND_LENGTH) {
        errors.push({
          field: `run_commands[${i}]`,
          message: `run command exceeds maximum length of ${MAX_RUN_COMMAND_LENGTH} characters (got ${cmd.length})`,
          severity: "block",
        });
      }
    }
  }

  // 2. Shell injection detection in run_commands
  if (Array.isArray(obj.run_commands)) {
    for (let i = 0; i < obj.run_commands.length; i++) {
      const cmd = obj.run_commands[i];
      if (typeof cmd === "string") {
        errors.push(...checkShellInjection(cmd, i));
      }
    }
  }

  // 3. Path traversal detection in context fields
  const ctx = obj.context as Record<string, unknown> | undefined;
  if (ctx && typeof ctx === "object") {
    if (typeof ctx.projectDir === "string") {
      errors.push(...checkPathTraversal(ctx.projectDir, "context.projectDir"));
    }
    if (typeof ctx.branch === "string") {
      errors.push(...checkPathTraversal(ctx.branch, "context.branch"));
    }
  }

  // Also check parent_handoff_id for control chars
  if (typeof obj.parent_handoff_id === "string") {
    // eslint-disable-next-line no-control-regex
    if (/[\x00-\x1f\x7f]/.test(obj.parent_handoff_id)) {
      errors.push({
        field: "parent_handoff_id",
        message: "parent_handoff_id contains control characters",
        severity: "block",
      });
    }
  }

  // 4. System prompt override detection in text fields
  if (typeof obj.goal === "string") {
    warnings.push(...checkPromptOverride(obj.goal, "goal"));
  }

  if (Array.isArray(obj.acceptance_criteria)) {
    for (let i = 0; i < obj.acceptance_criteria.length; i++) {
      const item = obj.acceptance_criteria[i];
      if (typeof item === "string") {
        warnings.push(...checkPromptOverride(item, `acceptance_criteria[${i}]`));
      }
    }
  }

  // 5. Control character stripping is applied in sanitizeStringFields()

  const safe = errors.length === 0;
  return { safe, errors, warnings };
}

/**
 * Strip control characters from all string fields in the payload, mutating it in place.
 * Returns the same object for convenience.
 */
export function sanitizeStringFields(payload: Record<string, unknown>): Record<string, unknown> {
  if (typeof payload.goal === "string") {
    payload.goal = stripControlChars(payload.goal);
  }

  if (Array.isArray(payload.acceptance_criteria)) {
    payload.acceptance_criteria = payload.acceptance_criteria.map(
      (item: unknown) => (typeof item === "string" ? stripControlChars(item) : item)
    );
  }

  if (Array.isArray(payload.run_commands)) {
    payload.run_commands = payload.run_commands.map(
      (cmd: unknown) => (typeof cmd === "string" ? stripControlChars(cmd) : cmd)
    );
  }

  if (Array.isArray(payload.blocked_by)) {
    payload.blocked_by = payload.blocked_by.map(
      (b: unknown) => (typeof b === "string" ? stripControlChars(b) : b)
    );
  }

  if (typeof payload.parent_handoff_id === "string") {
    payload.parent_handoff_id = stripControlChars(payload.parent_handoff_id);
  }

  return payload;
}
