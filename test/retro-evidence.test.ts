import { test, expect, describe, beforeEach } from "bun:test";
import { RetroEngine } from "../src/services/retro-engine";
import type { EntireAdapter, EntireSessionMetrics } from "../src/services/entire-adapter";
import type { RetroStore, RetroSession } from "../src/services/retro-store";

// Mock RetroStore
function createMockStore(): RetroStore {
  const sessions = new Map<string, RetroSession>();
  const reviews = new Map<string, any[]>();
  return {
    createSession: (workflowRunId: string, participants: string[], chairman: string) => {
      const session: RetroSession = {
        id: crypto.randomUUID(),
        workflowRunId,
        status: "collecting",
        participants,
        chairman,
        startedAt: new Date().toISOString(),
      };
      sessions.set(session.id, session);
      reviews.set(session.id, []);
      return session;
    },
    getSession: (id: string) => sessions.get(id) ?? null,
    updateSessionStatus: () => {},
    addReview: (retroId: string, review: any) => {
      reviews.get(retroId)?.push(review);
      return { id: crypto.randomUUID(), ...review };
    },
    getReviews: (retroId: string) => reviews.get(retroId) ?? [],
    getReviewCount: (retroId: string) => (reviews.get(retroId) ?? []).length,
    storeDocument: () => ({ id: "doc-1", retroId: "", content: "", generatedAt: "", generatedBy: "" }),
    getDocument: () => null,
    listSessions: () => [],
  } as unknown as RetroStore;
}

// Mock EntireAdapter
function createMockAdapter(metricsMap: Map<string, EntireSessionMetrics>): EntireAdapter {
  return {
    getSessionMetrics: (sessionId: string) => metricsMap.get(sessionId) ?? null,
    linkSessionToTask: () => {},
    setExpectedFiles: () => {},
    getLinkedTaskId: () => undefined,
    startWatching: () => true,
    stopWatching: () => {},
  } as unknown as EntireAdapter;
}

function createMockActivityStore() {
  return {
    emit: () => {},
    getByWorkflow: () => [],
  } as any;
}

describe("retro-evidence (entire.io)", () => {
  let store: RetroStore;
  let activityStore: any;

  beforeEach(() => {
    store = createMockStore();
    activityStore = createMockActivityStore();
  });

  describe("collectEntireEvidence", () => {
    test("returns empty when entireMonitoringEnabled is false", () => {
      const engine = new RetroEngine(store, activityStore, undefined, {
        entireMonitoringEnabled: false,
      });

      const participantMap = new Map([["alice", "session-1"]]);
      const evidence = engine.collectEntireEvidence("wf-run-1", participantMap);
      expect(evidence).toEqual([]);
    });

    test("returns empty when no adapter is provided", () => {
      const engine = new RetroEngine(store, activityStore, undefined, {
        entireMonitoringEnabled: true,
        // no adapter
      });

      const participantMap = new Map([["alice", "session-1"]]);
      const evidence = engine.collectEntireEvidence("wf-run-1", participantMap);
      expect(evidence).toEqual([]);
    });

    test("collects evidence from entire.io sessions", () => {
      const metricsMap = new Map<string, EntireSessionMetrics>();
      metricsMap.set("session-alice", {
        sessionId: "session-alice",
        phase: "ended",
        stepCount: 5,
        filesTouched: ["src/auth.ts", "src/middleware.ts", "test/auth.test.ts"],
        totalTokens: 50000,
        tokenBurnRate: 1250,
        contextSaturation: 0.25,
        progressEstimate: 100,
        elapsedMinutes: 40,
        agentType: "Claude Code",
      });
      metricsMap.set("session-bob", {
        sessionId: "session-bob",
        phase: "ended",
        stepCount: 3,
        filesTouched: ["src/db.ts"],
        totalTokens: 30000,
        tokenBurnRate: 2000,
        contextSaturation: 0.15,
        progressEstimate: 100,
        elapsedMinutes: 15,
        agentType: "Claude Code",
      });

      const adapter = createMockAdapter(metricsMap);
      const engine = new RetroEngine(store, activityStore, undefined, {
        entireAdapter: adapter,
        entireMonitoringEnabled: true,
      });

      const participantMap = new Map([
        ["alice", "session-alice"],
        ["bob", "session-bob"],
      ]);

      const evidence = engine.collectEntireEvidence("wf-run-1", participantMap);

      expect(evidence).toHaveLength(2);

      const aliceEvidence = evidence.find((e) => e.participant === "alice")!;
      expect(aliceEvidence.sessionId).toBe("session-alice");
      expect(aliceEvidence.totalTokens).toBe(50000);
      expect(aliceEvidence.tokenBurnRate).toBe(1250);
      expect(aliceEvidence.filesModified).toBe(3);
      expect(aliceEvidence.checkpointCount).toBe(5);
      expect(aliceEvidence.durationMinutes).toBe(40);

      const bobEvidence = evidence.find((e) => e.participant === "bob")!;
      expect(bobEvidence.sessionId).toBe("session-bob");
      expect(bobEvidence.totalTokens).toBe(30000);
      expect(bobEvidence.filesModified).toBe(1);
      expect(bobEvidence.checkpointCount).toBe(3);
      expect(bobEvidence.durationMinutes).toBe(15);
    });

    test("skips participants with no matching session metrics", () => {
      const metricsMap = new Map<string, EntireSessionMetrics>();
      metricsMap.set("session-alice", {
        sessionId: "session-alice",
        phase: "ended",
        stepCount: 2,
        filesTouched: ["src/index.ts"],
        totalTokens: 10000,
        tokenBurnRate: 500,
        contextSaturation: 0.05,
        progressEstimate: 100,
        elapsedMinutes: 20,
        agentType: "Claude Code",
      });
      // No metrics for "session-bob"

      const adapter = createMockAdapter(metricsMap);
      const engine = new RetroEngine(store, activityStore, undefined, {
        entireAdapter: adapter,
        entireMonitoringEnabled: true,
      });

      const participantMap = new Map([
        ["alice", "session-alice"],
        ["bob", "session-bob"],
        ["charlie", "session-charlie"],
      ]);

      const evidence = engine.collectEntireEvidence("wf-run-1", participantMap);

      expect(evidence).toHaveLength(1);
      expect(evidence[0].participant).toBe("alice");
    });

    test("returns empty array for empty participant map", () => {
      const adapter = createMockAdapter(new Map());
      const engine = new RetroEngine(store, activityStore, undefined, {
        entireAdapter: adapter,
        entireMonitoringEnabled: true,
      });

      const evidence = engine.collectEntireEvidence("wf-run-1", new Map());
      expect(evidence).toEqual([]);
    });
  });

  describe("RetroEngine still works without entire.io", () => {
    test("startRetro and submitReview work without entire adapter", () => {
      const engine = new RetroEngine(store, activityStore);

      const session = engine.startRetro("wf-1", ["alice", "bob"], "alice");
      expect(session.status).toBe("collecting");
      expect(session.participants).toEqual(["alice", "bob"]);

      const result = engine.submitReview(session.id, {
        author: "alice",
        whatWentWell: ["good collaboration"],
        whatDidntWork: ["slow builds"],
        suggestions: ["use caching"],
        agentPerformanceNotes: { bob: "fast" },
        submittedAt: new Date().toISOString(),
      });

      expect(result.collected).toBe(1);
      expect(result.total).toBe(2);
      expect(result.allCollected).toBe(false);
    });

    test("aggregate works without entire adapter", () => {
      const engine = new RetroEngine(store, activityStore);
      const session = engine.startRetro("wf-2", ["alice"]);

      engine.submitReview(session.id, {
        author: "alice",
        whatWentWell: ["smooth deployment"],
        whatDidntWork: ["unclear requirements"],
        suggestions: ["better specs"],
        agentPerformanceNotes: {},
        submittedAt: new Date().toISOString(),
      });

      const agg = engine.aggregate(session.id);
      expect(agg.themes.whatWorked).toContain("smooth deployment");
      expect(agg.themes.whatDidntWork).toContain("unclear requirements");
      expect(agg.themes.topSuggestions).toContain("better specs");
    });
  });
});
