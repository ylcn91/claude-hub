// F-01: Enriched Handoff Contract Schema
// Paper ref: Section 2.2 (Task Characteristics), Section 4.1 (Task Decomposition)

import { sanitizeHandoffPayload, sanitizeStringFields, type SanitizationResult } from "./input-sanitizer";

export type ComplexityLevel = "low" | "medium" | "high" | "critical";
export type CriticalityLevel = "low" | "medium" | "high" | "critical";
export type UncertaintyLevel = "low" | "medium" | "high";
export type VerifiabilityLevel = "auto-testable" | "needs-review" | "subjective";
export type ReversibilityLevel = "reversible" | "partial" | "irreversible";
export type SubjectivityLevel = "objective" | "mixed" | "subjective";
export type AutonomyLevel = "strict" | "standard" | "open-ended";
export type MonitoringLevel = "outcome-only" | "periodic" | "continuous";

export interface VerificationPolicy {
  mode: "auto" | "strict" | "human-required";
  artifacts?: { type: string; validator: string }[];
}

export interface HandoffPayload {
  // Core fields (required)
  goal: string;
  acceptance_criteria: string[];
  run_commands: string[];
  blocked_by: string[];

  // Task Characteristics (Paper §2.2) — all optional for backward compatibility
  complexity?: ComplexityLevel;
  criticality?: CriticalityLevel;
  uncertainty?: UncertaintyLevel;
  estimated_duration_minutes?: number;
  estimated_cost?: number;
  verifiability?: VerifiabilityLevel;
  reversibility?: ReversibilityLevel;
  contextuality?: "low" | "medium" | "high";
  subjectivity?: SubjectivityLevel;
  required_skills?: string[];
  resource_requirements?: string[];

  // Delegation Intelligence (Paper §4.2)
  autonomy_level?: AutonomyLevel;
  monitoring_level?: MonitoringLevel;
  verification_policy?: VerificationPolicy;

  // Delegation chain tracking (Paper §5.2)
  delegation_depth?: number;
  parent_handoff_id?: string;
}

export interface HandoffValidationError {
  field: string;
  message: string;
}

const VALID_COMPLEXITY: ComplexityLevel[] = ["low", "medium", "high", "critical"];
const VALID_CRITICALITY: CriticalityLevel[] = ["low", "medium", "high", "critical"];
const VALID_UNCERTAINTY: UncertaintyLevel[] = ["low", "medium", "high"];
const VALID_VERIFIABILITY: VerifiabilityLevel[] = ["auto-testable", "needs-review", "subjective"];
const VALID_REVERSIBILITY: ReversibilityLevel[] = ["reversible", "partial", "irreversible"];
const VALID_SUBJECTIVITY: SubjectivityLevel[] = ["objective", "mixed", "subjective"];
const VALID_AUTONOMY: AutonomyLevel[] = ["strict", "standard", "open-ended"];
const VALID_MONITORING: MonitoringLevel[] = ["outcome-only", "periodic", "continuous"];

function validateEnum(value: unknown, field: string, valid: string[], errors: HandoffValidationError[]): void {
  if (value !== undefined && (typeof value !== "string" || !valid.includes(value))) {
    errors.push({ field, message: `${field} must be one of: ${valid.join(", ")}` });
  }
}

export function validateHandoff(payload: unknown): { valid: true; payload: HandoffPayload; sanitization?: SanitizationResult } | { valid: false; errors: HandoffValidationError[] } {
  const errors: HandoffValidationError[] = [];
  const obj = payload as Record<string, unknown> | null | undefined;

  // F-12: Input sanitization — run before structural validation
  let sanitizationResult: SanitizationResult | undefined;
  if (obj && typeof obj === "object") {
    sanitizationResult = sanitizeHandoffPayload(obj);
    if (!sanitizationResult.safe) {
      return {
        valid: false,
        errors: sanitizationResult.errors.map(e => ({ field: e.field, message: e.message })),
      };
    }
    // Strip control characters from string fields
    sanitizeStringFields(obj);
  }

  // Required fields
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

  // Optional enriched fields — validate only when present
  if (obj) {
    validateEnum(obj.complexity, "complexity", VALID_COMPLEXITY, errors);
    validateEnum(obj.criticality, "criticality", VALID_CRITICALITY, errors);
    validateEnum(obj.uncertainty, "uncertainty", VALID_UNCERTAINTY, errors);
    validateEnum(obj.verifiability, "verifiability", VALID_VERIFIABILITY, errors);
    validateEnum(obj.reversibility, "reversibility", VALID_REVERSIBILITY, errors);
    validateEnum(obj.subjectivity, "subjectivity", VALID_SUBJECTIVITY, errors);
    validateEnum(obj.autonomy_level, "autonomy_level", VALID_AUTONOMY, errors);
    validateEnum(obj.monitoring_level, "monitoring_level", VALID_MONITORING, errors);

    if (obj.estimated_duration_minutes !== undefined && (typeof obj.estimated_duration_minutes !== "number" || obj.estimated_duration_minutes < 0)) {
      errors.push({ field: "estimated_duration_minutes", message: "estimated_duration_minutes must be a non-negative number" });
    }

    if (obj.estimated_cost !== undefined && (typeof obj.estimated_cost !== "number" || obj.estimated_cost < 0)) {
      errors.push({ field: "estimated_cost", message: "estimated_cost must be a non-negative number" });
    }

    if (obj.delegation_depth !== undefined && (typeof obj.delegation_depth !== "number" || obj.delegation_depth < 0 || !Number.isInteger(obj.delegation_depth))) {
      errors.push({ field: "delegation_depth", message: "delegation_depth must be a non-negative integer" });
    }

    if (obj.required_skills !== undefined) {
      if (!Array.isArray(obj.required_skills) || obj.required_skills.some((s: unknown) => typeof s !== "string")) {
        errors.push({ field: "required_skills", message: "required_skills must be an array of strings" });
      }
    }

    if (obj.resource_requirements !== undefined) {
      if (!Array.isArray(obj.resource_requirements) || obj.resource_requirements.some((s: unknown) => typeof s !== "string")) {
        errors.push({ field: "resource_requirements", message: "resource_requirements must be an array of strings" });
      }
    }
  }

  if (errors.length > 0) return { valid: false, errors };

  // Build validated payload, preserving optional enriched fields when present
  const validated: HandoffPayload = {
    goal: obj!.goal as string,
    acceptance_criteria: obj!.acceptance_criteria as string[],
    run_commands: obj!.run_commands as string[],
    blocked_by: obj!.blocked_by as string[],
  };

  // Copy optional enriched fields
  if (obj!.complexity !== undefined) validated.complexity = obj!.complexity as ComplexityLevel;
  if (obj!.criticality !== undefined) validated.criticality = obj!.criticality as CriticalityLevel;
  if (obj!.uncertainty !== undefined) validated.uncertainty = obj!.uncertainty as UncertaintyLevel;
  if (obj!.estimated_duration_minutes !== undefined) validated.estimated_duration_minutes = obj!.estimated_duration_minutes as number;
  if (obj!.estimated_cost !== undefined) validated.estimated_cost = obj!.estimated_cost as number;
  if (obj!.verifiability !== undefined) validated.verifiability = obj!.verifiability as VerifiabilityLevel;
  if (obj!.reversibility !== undefined) validated.reversibility = obj!.reversibility as ReversibilityLevel;
  if (obj!.contextuality !== undefined) validated.contextuality = obj!.contextuality as "low" | "medium" | "high";
  if (obj!.subjectivity !== undefined) validated.subjectivity = obj!.subjectivity as SubjectivityLevel;
  if (obj!.required_skills !== undefined) validated.required_skills = obj!.required_skills as string[];
  if (obj!.resource_requirements !== undefined) validated.resource_requirements = obj!.resource_requirements as string[];
  if (obj!.autonomy_level !== undefined) validated.autonomy_level = obj!.autonomy_level as AutonomyLevel;
  if (obj!.monitoring_level !== undefined) validated.monitoring_level = obj!.monitoring_level as MonitoringLevel;
  if (obj!.verification_policy !== undefined) validated.verification_policy = obj!.verification_policy as VerificationPolicy;
  if (obj!.delegation_depth !== undefined) validated.delegation_depth = obj!.delegation_depth as number;
  if (obj!.parent_handoff_id !== undefined) validated.parent_handoff_id = obj!.parent_handoff_id as string;

  const result: { valid: true; payload: HandoffPayload; sanitization?: SanitizationResult } = { valid: true, payload: validated };
  if (sanitizationResult && sanitizationResult.warnings.length > 0) {
    result.sanitization = sanitizationResult;
  }
  return result;
}
