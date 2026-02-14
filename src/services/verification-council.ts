// Phase 6: Council as Verification Panel
// Multi-LLM verification of task completion via council consensus

import {
  parseJSONFromLLM,
  collectFromAccounts,
  anonymizeForPeerReview,
} from "./council-framework";
import type { LLMCaller, CouncilServiceConfig } from "./council-framework";
import { computeSpecHash } from "./verification-receipts";

export type VerificationVerdict = "ACCEPT" | "REJECT" | "ACCEPT_WITH_NOTES";

export interface VerificationReceipt {
  taskId: string;
  verifier: "council";
  verdict: VerificationVerdict;
  timestamp: string;
  specHash: string;
  evidenceHash: string;
}

export interface VerificationReview {
  account: string;
  verdict: VerificationVerdict;
  confidence: number;
  reasoning: string;
  issues: string[];
  strengths: string[];
}

export interface PeerEvaluation {
  reviewer: string;
  ranking: number[];
  reasoning: string;
}

export interface VerificationResult {
  verdict: VerificationVerdict;
  confidence: number;
  notes: string[];
  receipt: VerificationReceipt;
  individualReviews: VerificationReview[];
  peerEvaluations: PeerEvaluation[];
  chairmanReasoning: string;
}

export interface ReviewBundle {
  diff?: string;
  testResults?: string;
  filesChanged?: string[];
  riskNotes?: string[];
}

export interface HandoffPayloadForVerification {
  goal: string;
  acceptance_criteria: string[];
  verifiability?: "auto-testable" | "needs-review" | "subjective";
}

const VERIFICATION_STAGE1_PROMPT = `You are a code review expert verifying task completion. You will be given:
1. The task goal and acceptance criteria
2. A review bundle containing diffs, test results, and risk notes

Evaluate whether the task has been completed successfully. Respond with a JSON object:
- verdict: "ACCEPT" | "REJECT" | "ACCEPT_WITH_NOTES"
- confidence: number (0-1)
- reasoning: string (brief explanation)
- issues: string[] (problems found, empty if none)
- strengths: string[] (good aspects of the work)

Respond ONLY with valid JSON, no other text.`;

const VERIFICATION_STAGE2_PROMPT = `You are a peer reviewer evaluating task verification reviews. You will see multiple anonymized reviews (labeled Review A, Review B, etc.). Rank them from most thorough/accurate to least.

Respond with a JSON object:
- ranking: number[] (indices 0-based, sorted best-to-worst)
- reasoning: string

Respond ONLY with valid JSON, no other text.`;

const VERIFICATION_STAGE3_PROMPT = `You are the chairman of a verification council. You have received individual reviews and peer rankings for a task completion verification.

Produce a final verdict. Consider:
- The majority view across reviewers
- The quality of reasoning (weighted by peer rankings)
- Whether issues raised are genuine blockers or minor notes

Respond with a JSON object:
- verdict: "ACCEPT" | "REJECT" | "ACCEPT_WITH_NOTES"
- confidence: number (0-1)
- notes: string[] (actionable notes for the task author)
- reasoning: string (explanation of the final verdict)

Respond ONLY with valid JSON, no other text.`;

/**
 * Determine if a task needs council verification based on its verifiability level.
 */
export function needsCouncilVerification(
  verifiability?: "auto-testable" | "needs-review" | "subjective",
): boolean {
  return verifiability === "needs-review" || verifiability === "subjective";
}

/**
 * Run multi-LLM council verification on a completed task.
 *
 * Stage 1: Multiple LLMs independently review the diff against goal + acceptance criteria
 * Stage 2: Anonymized peer review of evaluations
 * Stage 3: Chairman produces final verdict
 */
export async function verifyTaskCompletion(
  taskId: string,
  reviewBundle: ReviewBundle,
  handoffPayload: HandoffPayloadForVerification,
  config?: Partial<CouncilServiceConfig> & { llmCaller?: LLMCaller },
): Promise<VerificationResult> {
  const members = config?.members ?? [];
  const chairman = config?.chairman ?? "";

  const llmCaller = config?.llmCaller;
  if (!llmCaller) {
    throw new Error("Council verification requires an LLM caller");
  }

  // Build context for reviewers
  const taskContext = buildTaskContext(handoffPayload, reviewBundle);

  // Stage 1: Collect independent reviews
  const individualReviews = await stage1_collectReviews(members, llmCaller, taskContext);

  if (individualReviews.length === 0) {
    const receipt = createVerificationReceipt(taskId, "REJECT", handoffPayload, reviewBundle);
    return {
      verdict: "REJECT",
      confidence: 0,
      notes: ["All verification accounts failed to respond"],
      receipt,
      individualReviews: [],
      peerEvaluations: [],
      chairmanReasoning: "Unable to verify — all accounts failed",
    };
  }

  // Stage 2: Peer review of evaluations
  const peerEvaluations = await stage2_peerReview(members, llmCaller, taskContext, individualReviews);

  // Stage 3: Chairman synthesis
  const synthesis = await stage3_chairmanVerdict(chairman, llmCaller, taskContext, individualReviews, peerEvaluations);

  const receipt = createVerificationReceipt(taskId, synthesis.verdict, handoffPayload, reviewBundle);

  return {
    verdict: synthesis.verdict,
    confidence: synthesis.confidence,
    notes: synthesis.notes,
    receipt,
    individualReviews,
    peerEvaluations,
    chairmanReasoning: synthesis.reasoning,
  };
}

function buildTaskContext(
  handoffPayload: HandoffPayloadForVerification,
  reviewBundle: ReviewBundle,
): string {
  const parts: string[] = [
    `Task Goal: ${handoffPayload.goal}`,
    `Acceptance Criteria:\n${handoffPayload.acceptance_criteria.map((c, i) => `  ${i + 1}. ${c}`).join("\n")}`,
  ];

  if (reviewBundle.diff) {
    parts.push(`Diff:\n${reviewBundle.diff}`);
  }
  if (reviewBundle.testResults) {
    parts.push(`Test Results:\n${reviewBundle.testResults}`);
  }
  if (reviewBundle.filesChanged?.length) {
    parts.push(`Files Changed: ${reviewBundle.filesChanged.join(", ")}`);
  }
  if (reviewBundle.riskNotes?.length) {
    parts.push(`Risk Notes:\n${reviewBundle.riskNotes.map((n) => `  - ${n}`).join("\n")}`);
  }

  return parts.join("\n\n");
}

async function stage1_collectReviews(
  accounts: string[],
  llmCaller: LLMCaller,
  taskContext: string,
): Promise<VerificationReview[]> {
  return collectFromAccounts(accounts, async (account) => {
    const response = await llmCaller(account, VERIFICATION_STAGE1_PROMPT, taskContext);
    const parsed = parseJSONFromLLM(response);
    if (!parsed) {
      throw new Error(`Failed to parse verification response from ${account}`);
    }
    return {
      account,
      verdict: normalizeVerdict(parsed.verdict),
      confidence: parsed.confidence ?? 0.5,
      reasoning: parsed.reasoning ?? "",
      issues: parsed.issues ?? [],
      strengths: parsed.strengths ?? [],
    } as VerificationReview;
  });
}

async function stage2_peerReview(
  accounts: string[],
  llmCaller: LLMCaller,
  taskContext: string,
  reviews: VerificationReview[],
): Promise<PeerEvaluation[]> {
  const anonymized = anonymizeForPeerReview(
    reviews.map((r) => ({
      fields: {
        Verdict: r.verdict,
        Confidence: String(r.confidence),
        Reasoning: r.reasoning,
        Issues: r.issues.length > 0 ? r.issues : ["none"],
        Strengths: r.strengths.length > 0 ? r.strengths : ["none"],
      },
    })),
    "Review",
  );

  const userPrompt = `${taskContext}\n\nHere are the verification reviews to evaluate:\n\n${anonymized}`;

  return collectFromAccounts(accounts, async (account) => {
    const response = await llmCaller(account, VERIFICATION_STAGE2_PROMPT, userPrompt);
    const parsed = parseJSONFromLLM(response);
    if (!parsed) {
      throw new Error(`Failed to parse peer review from ${account}`);
    }
    return {
      reviewer: account,
      ranking: parsed.ranking ?? [],
      reasoning: parsed.reasoning ?? "",
    } as PeerEvaluation;
  });
}

async function stage3_chairmanVerdict(
  chairman: string,
  llmCaller: LLMCaller,
  taskContext: string,
  reviews: VerificationReview[],
  peerEvals: PeerEvaluation[],
): Promise<{ verdict: VerificationVerdict; confidence: number; notes: string[]; reasoning: string }> {
  const reviewsText = reviews
    .map((r, i) => {
      return `Review ${i + 1} (${r.account}):\n- Verdict: ${r.verdict}\n- Confidence: ${r.confidence}\n- Reasoning: ${r.reasoning}\n- Issues: ${r.issues.join("; ") || "none"}\n- Strengths: ${r.strengths.join("; ") || "none"}`;
    })
    .join("\n\n");

  const peersText = peerEvals
    .map((p) => `Reviewer ${p.reviewer}: Ranking [${p.ranking.join(", ")}] — ${p.reasoning}`)
    .join("\n");

  const userPrompt = `${taskContext}\n\nIndividual Reviews:\n${reviewsText}\n\nPeer Rankings:\n${peersText}`;

  const response = await llmCaller(chairman, VERIFICATION_STAGE3_PROMPT, userPrompt);
  const parsed = parseJSONFromLLM(response);
  if (!parsed) {
    throw new Error("Failed to parse chairman verification verdict");
  }

  return {
    verdict: normalizeVerdict(parsed.verdict),
    confidence: parsed.confidence ?? 0.5,
    notes: parsed.notes ?? [],
    reasoning: parsed.reasoning ?? "",
  };
}

function normalizeVerdict(raw: string | undefined): VerificationVerdict {
  if (!raw) return "REJECT";
  const upper = raw.toUpperCase().trim();
  if (upper === "ACCEPT") return "ACCEPT";
  if (upper === "ACCEPT_WITH_NOTES") return "ACCEPT_WITH_NOTES";
  return "REJECT";
}

function createVerificationReceipt(
  taskId: string,
  verdict: VerificationVerdict,
  handoffPayload: HandoffPayloadForVerification,
  reviewBundle: ReviewBundle,
): VerificationReceipt {
  const specHash = computeSpecHash({
    goal: handoffPayload.goal,
    acceptance_criteria: handoffPayload.acceptance_criteria,
  });
  const evidenceHash = computeSpecHash(reviewBundle);

  return {
    taskId,
    verifier: "council",
    verdict,
    timestamp: new Date().toISOString(),
    specHash,
    evidenceHash,
  };
}
