import type { RetroStore, RetroSession } from "./retro-store";
import type { ActivityStore } from "./activity-store";
import type { EntireAdapter } from "./entire-adapter";

export interface EntireRetroEvidence {
  participant: string;
  sessionId: string;
  totalTokens: number;
  tokenBurnRate: number;
  filesModified: number;
  checkpointCount: number;
  durationMinutes: number;
}

export interface RetroReview {
  author: string;
  whatWentWell: string[];
  whatDidntWork: string[];
  suggestions: string[];
  agentPerformanceNotes: Record<string, string>;
  submittedAt: string;
}

export interface RetroDocument {
  title: string;
  workflowName: string;
  duration: string;
  participants: string[];
  keyDecisions: Array<{ decision: string; rationale: string; outcome: string }>;
  whatWorked: string[];
  whatDidntWork: string[];
  actionableLearnings: string[];
  agentHighlights: Record<string, string>;
  deltaFromPastRetros: string[];
  generatedAt: string;
  generatedBy: string;
}

export class RetroEngine {
  private collectionTimeouts = new Map<string, Timer>();
  private readonly COLLECTION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
  private entireAdapter?: EntireAdapter;
  private entireMonitoringEnabled: boolean;

  constructor(
    private store: RetroStore,
    private activityStore: ActivityStore | undefined,
    private knowledgeStore?: any,
    opts?: { entireAdapter?: EntireAdapter; entireMonitoringEnabled?: boolean },
  ) {
    this.entireAdapter = opts?.entireAdapter;
    this.entireMonitoringEnabled = opts?.entireMonitoringEnabled ?? false;
  }

  startRetro(workflowRunId: string, participants: string[], chairman?: string): RetroSession {
    const selectedChairman = chairman ?? participants[0];
    const session = this.store.createSession(workflowRunId, participants, selectedChairman);

    // Query timeline from activityStore
    this.activityStore?.getByWorkflow(workflowRunId);

    // Set collection timeout
    const timer = setTimeout(() => {
      this.handleCollectionTimeout(session.id);
    }, this.COLLECTION_TIMEOUT_MS);
    this.collectionTimeouts.set(session.id, timer);

    // Emit retro_started activity event
    this.activityStore?.emit({
      type: "retro_started",
      timestamp: new Date().toISOString(),
      account: "system",
      workflowRunId,
      metadata: { retroId: session.id, chairman: selectedChairman, participants },
    });

    return session;
  }

  submitReview(retroId: string, review: RetroReview): { collected: number; total: number; allCollected: boolean } {
    const session = this.store.getSession(retroId);
    if (!session) throw new Error(`Retro session '${retroId}' not found`);

    this.store.addReview(retroId, {
      retroId,
      author: review.author,
      whatWentWell: review.whatWentWell,
      whatDidntWork: review.whatDidntWork,
      suggestions: review.suggestions,
      agentPerformanceNotes: review.agentPerformanceNotes,
      submittedAt: review.submittedAt,
    });

    const collected = this.store.getReviewCount(retroId);
    const total = session.participants.length;
    const allCollected = collected >= total;

    if (allCollected || collected >= 2) {
      const timer = this.collectionTimeouts.get(retroId);
      if (timer) {
        clearTimeout(timer);
        this.collectionTimeouts.delete(retroId);
      }
    }

    return { collected, total, allCollected };
  }

  aggregate(retroId: string): { themes: { whatWorked: string[]; whatDidntWork: string[]; topSuggestions: string[] } } {
    const reviews = this.store.getReviews(retroId);

    const whatWorked: string[] = [];
    const whatDidntWork: string[] = [];
    const allSuggestions: string[] = [];

    for (const review of reviews) {
      whatWorked.push(...review.whatWentWell);
      whatDidntWork.push(...review.whatDidntWork);
      allSuggestions.push(...review.suggestions);
    }

    // Deduplicate suggestions (case-insensitive)
    const seen = new Set<string>();
    const topSuggestions: string[] = [];
    for (const suggestion of allSuggestions) {
      const key = suggestion.toLowerCase().trim();
      if (!seen.has(key)) {
        seen.add(key);
        topSuggestions.push(suggestion);
      }
    }

    this.store.updateSessionStatus(retroId, "aggregating");
    this.store.updateSessionStatus(retroId, "synthesizing");

    return { themes: { whatWorked, whatDidntWork, topSuggestions } };
  }

  async completeSynthesis(retroId: string, document: RetroDocument): Promise<void> {
    this.store.storeDocument(retroId, JSON.stringify(document), document.generatedBy);

    // Meta-learning: index retro document in knowledge store
    if (this.knowledgeStore) {
      try {
        const learnings = [
          ...document.actionableLearnings,
          ...document.deltaFromPastRetros,
        ].filter(Boolean);

        this.knowledgeStore.index({
          category: "retro" as any,
          title: document.title || `Retro: ${document.workflowName}`,
          content: learnings.join("\n"),
          tags: ["retro", document.workflowName],
          sourceId: retroId,
        });
      } catch {
        // Best-effort meta-learning
      }
    }

    this.store.updateSessionStatus(retroId, "complete", new Date().toISOString());

    // Emit retro_completed activity event
    const session = this.store.getSession(retroId);
    this.activityStore?.emit({
      type: "retro_completed",
      timestamp: new Date().toISOString(),
      account: "system",
      workflowRunId: session?.workflowRunId,
      metadata: { retroId },
    });
  }

  async getPastLearnings(): Promise<string[]> {
    if (!this.knowledgeStore) return [];
    try {
      const results = this.knowledgeStore.search("retro", "retro" as any, 5);
      return results.map((r: any) => r.entry?.content ?? r.content ?? r.snippet ?? "");
    } catch {
      return [];
    }
  }

  getSession(retroId: string): RetroSession | null {
    return this.store.getSession(retroId);
  }

  getDocument(retroId: string): RetroDocument | null {
    const raw = this.store.getDocument(retroId);
    if (!raw) return null;
    return JSON.parse(raw.content);
  }

  /**
   * Collect objective metrics from entire.io sessions linked to a workflow run.
   * Feature gated: only runs when entireMonitoringEnabled is true and an adapter is set.
   */
  collectEntireEvidence(_workflowRunId: string, participantSessionMap: Map<string, string>): EntireRetroEvidence[] {
    if (!this.entireMonitoringEnabled || !this.entireAdapter) {
      return [];
    }

    const evidence: EntireRetroEvidence[] = [];

    for (const [participant, sessionId] of participantSessionMap) {
      const metrics = this.entireAdapter.getSessionMetrics(sessionId);
      if (!metrics) continue;

      evidence.push({
        participant,
        sessionId,
        totalTokens: metrics.totalTokens,
        tokenBurnRate: metrics.tokenBurnRate,
        filesModified: metrics.filesTouched.length,
        checkpointCount: metrics.stepCount,
        durationMinutes: metrics.elapsedMinutes,
      });
    }

    return evidence;
  }

  handleCollectionTimeout(retroId: string): void {
    this.collectionTimeouts.delete(retroId);
    const count = this.store.getReviewCount(retroId);
    if (count >= 2) {
      this.aggregate(retroId);
    } else if (count === 1) {
      this.store.updateSessionStatus(retroId, "complete", new Date().toISOString());
    } else {
      this.store.updateSessionStatus(retroId, "failed");
    }
  }
}
