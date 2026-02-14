// F-11: Cognitive Friction
// Block auto-acceptance for high-criticality irreversible tasks, requiring explicit human confirmation.
// Gated acceptance based on task characteristics with justification tracking.

import type { HandoffPayload } from "./handoff";

export type FrictionLevel = "none" | "warning" | "blocking";
export type GateAction = "auto-accept" | "require-acceptance" | "require-justification" | "require-elevated-review";

export interface FrictionCheck {
  requiresHumanReview: boolean;
  reason?: string;
  frictionLevel: FrictionLevel;
}

export interface GatedAcceptanceResult {
  action: GateAction;
  reason: string;
  requiresJustification: boolean;
}

/**
 * Check whether a handoff payload should trigger cognitive friction
 * (blocking auto-acceptance and requiring human review).
 *
 * Rules:
 * 1. High/critical criticality + irreversible/partial reversibility => blocking
 * 2. Critical criticality alone => warning (requires human)
 * 3. Irreversible + high/critical complexity => warning (requires human)
 * 4. Otherwise => none
 */
export function checkCognitiveFriction(payload: HandoffPayload): FrictionCheck {
  const criticality = payload.criticality;
  const reversibility = payload.reversibility;
  const complexity = payload.complexity;

  // Rule 1: High/critical criticality + limited reversibility => blocking
  if (
    (criticality === "high" || criticality === "critical") &&
    (reversibility === "irreversible" || reversibility === "partial")
  ) {
    return {
      requiresHumanReview: true,
      frictionLevel: "blocking",
      reason: "High-criticality task with limited reversibility requires human review",
    };
  }

  // Rule 2: Critical criticality alone => warning
  if (criticality === "critical") {
    return {
      requiresHumanReview: true,
      frictionLevel: "warning",
      reason: "Critical task requires human confirmation",
    };
  }

  // Rule 3: Irreversible + high/critical complexity => warning
  if (
    reversibility === "irreversible" &&
    (complexity === "high" || complexity === "critical")
  ) {
    return {
      requiresHumanReview: true,
      frictionLevel: "warning",
      reason: "Irreversible task with high complexity requires human review",
    };
  }

  return {
    requiresHumanReview: false,
    frictionLevel: "none",
  };
}

/**
 * Determine the gated acceptance action based on task characteristics.
 *
 * Gate levels:
 * - criticality 'low' + verifiability 'auto-testable' => auto-accept if run_commands pass
 * - criticality 'medium' => require explicit acceptance (default behavior)
 * - criticality 'high' + reversibility 'irreversible' => require justification string
 * - criticality 'critical' => require elevated review
 */
export function getGatedAcceptanceAction(payload: HandoffPayload): GatedAcceptanceResult {
  const criticality = payload.criticality ?? "medium";
  const verifiability = payload.verifiability;
  const reversibility = payload.reversibility;

  // Critical => always require elevated review
  if (criticality === "critical") {
    return {
      action: "require-elevated-review",
      reason: "Critical task requires elevated review before acceptance",
      requiresJustification: true,
    };
  }

  // High + irreversible => require justification
  if (criticality === "high" && reversibility === "irreversible") {
    return {
      action: "require-justification",
      reason: "High-criticality irreversible task requires justification for acceptance",
      requiresJustification: true,
    };
  }

  // Low + auto-testable => auto-accept (if run_commands pass)
  if (criticality === "low" && verifiability === "auto-testable") {
    return {
      action: "auto-accept",
      reason: "Low-criticality auto-testable task eligible for auto-acceptance",
      requiresJustification: false,
    };
  }

  // Default (medium or unspecified) => require explicit acceptance
  return {
    action: "require-acceptance",
    reason: "Task requires explicit acceptance",
    requiresJustification: false,
  };
}

/**
 * Validate that a justification is provided when required by the gate level.
 */
export function validateJustification(
  gateResult: GatedAcceptanceResult,
  justification?: string,
): { valid: boolean; error?: string } {
  if (!gateResult.requiresJustification) {
    return { valid: true };
  }
  if (!justification || justification.trim().length === 0) {
    return {
      valid: false,
      error: `Justification is required for ${gateResult.action}: ${gateResult.reason}`,
    };
  }
  return { valid: true };
}
