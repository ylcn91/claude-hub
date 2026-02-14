// F-13: Delegation Depth Limits
// Enforce maximum delegation depth to prevent accountability vacuums.

import type { HandoffPayload } from "./handoff";

export interface DelegationDepthConfig {
  maxDepth: number;
  requireReauthAbove?: number;
}

export const DEFAULT_DELEGATION_DEPTH_CONFIG: DelegationDepthConfig = {
  maxDepth: 3,
};

export interface DelegationDepthCheck {
  allowed: boolean;
  currentDepth: number;
  maxDepth: number;
  requiresReauthorization: boolean;
  reason?: string;
}

/**
 * Check whether a handoff payload's delegation_depth is within allowed limits.
 *
 * - If delegation_depth >= maxDepth: blocked, requires human re-authorization
 * - If delegation_depth >= maxDepth - 1: allowed but warns (approaching limit)
 * - If parent_handoff_id provided but no delegation_depth: treats depth as 0
 */
export function checkDelegationDepth(
  payload: HandoffPayload,
  config?: Partial<DelegationDepthConfig>,
): DelegationDepthCheck {
  const maxDepth = config?.maxDepth ?? DEFAULT_DELEGATION_DEPTH_CONFIG.maxDepth;
  const currentDepth = payload.delegation_depth ?? 0;

  if (currentDepth >= maxDepth) {
    return {
      allowed: false,
      currentDepth,
      maxDepth,
      requiresReauthorization: true,
      reason: `Delegation depth ${currentDepth} exceeds maximum allowed depth of ${maxDepth}. Human re-authorization required.`,
    };
  }

  if (currentDepth >= maxDepth - 1) {
    return {
      allowed: true,
      currentDepth,
      maxDepth,
      requiresReauthorization: false,
      reason: `Approaching delegation depth limit (${currentDepth}/${maxDepth}). Next delegation will require human re-authorization.`,
    };
  }

  return {
    allowed: true,
    currentDepth,
    maxDepth,
    requiresReauthorization: false,
  };
}

/**
 * Compute the next delegation depth based on parent handoff.
 * If a parent_handoff_id is referenced and a parentDepth is known, returns parentDepth + 1.
 */
export function computeNextDepth(parentDepth?: number): number {
  return (parentDepth ?? 0) + 1;
}
