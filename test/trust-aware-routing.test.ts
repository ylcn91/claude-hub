import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  scoreAccount,
  rankAccounts,
  type AccountCapability,
} from "../src/services/account-capabilities";
import { CapabilityStore } from "../src/daemon/capability-store";
import { TrustStore } from "../src/daemon/trust-store";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

function makeCapability(overrides: Partial<AccountCapability> = {}): AccountCapability {
  return {
    accountName: "test-account",
    skills: ["typescript", "testing"],
    totalTasks: 10,
    acceptedTasks: 9,
    rejectedTasks: 1,
    avgDeliveryMs: 180_000,
    lastActiveAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("trust-aware scoreAccount", () => {
  test("high trust score contributes more points than low trust", () => {
    const highTrust = makeCapability({ accountName: "alice", trustScore: 90 });
    const lowTrust = makeCapability({ accountName: "bob", trustScore: 20 });

    const highResult = scoreAccount(highTrust, ["typescript"]);
    const lowResult = scoreAccount(lowTrust, ["typescript"]);

    expect(highResult.score).toBeGreaterThan(lowResult.score);
    // Check trust reason is present
    const highTrustReason = highResult.reasons.find((r) => r.includes("trust:"));
    const lowTrustReason = lowResult.reasons.find((r) => r.includes("trust:"));
    expect(highTrustReason).toBeDefined();
    expect(lowTrustReason).toBeDefined();
  });

  test("missing trust score gives neutral 5 points", () => {
    const cap = makeCapability({ trustScore: undefined });
    const result = scoreAccount(cap, []);
    const trustReason = result.reasons.find((r) => r.includes("trust:"));
    expect(trustReason).toContain("neutral");
    expect(trustReason).toContain("5pts");
  });

  test("perfect trust score (100) gives 10 points", () => {
    const cap = makeCapability({ trustScore: 100 });
    const result = scoreAccount(cap, []);
    const trustReason = result.reasons.find((r) => r.includes("trust:"));
    expect(trustReason).toContain("10pts");
  });

  test("zero trust score gives 0 points", () => {
    const cap = makeCapability({ trustScore: 0 });
    const result = scoreAccount(cap, []);
    const trustReason = result.reasons.find((r) => r.includes("trust:"));
    expect(trustReason).toContain("0pts");
  });
});

describe("trust-aware rankAccounts", () => {
  test("trust score influences ranking order", () => {
    const caps = [
      makeCapability({
        accountName: "high-trust",
        skills: ["typescript"],
        trustScore: 95,
        totalTasks: 10,
        acceptedTasks: 9,
        rejectedTasks: 1,
      }),
      makeCapability({
        accountName: "low-trust",
        skills: ["typescript"],
        trustScore: 10,
        totalTasks: 10,
        acceptedTasks: 9,
        rejectedTasks: 1,
      }),
    ];

    const ranked = rankAccounts(caps, ["typescript"]);
    expect(ranked[0].accountName).toBe("high-trust");
    expect(ranked[1].accountName).toBe("low-trust");
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });

  test("trust enrichment from TrustStore integrates with capabilities", () => {
    // Simulate what the suggest_assignee handler does
    const caps = [
      makeCapability({ accountName: "alice" }),
      makeCapability({ accountName: "bob" }),
    ];

    // Simulate trust enrichment
    const trustScores: Record<string, number> = {
      alice: 85,
      bob: 30,
    };
    for (const cap of caps) {
      const score = trustScores[cap.accountName];
      if (score !== undefined) {
        cap.trustScore = score;
      }
    }

    const ranked = rankAccounts(caps, ["typescript"]);
    // Alice should rank higher due to better trust
    expect(ranked[0].accountName).toBe("alice");
  });
});

describe("providerType in CapabilityStore", () => {
  let store: CapabilityStore;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "cap-trust-"));
    store = new CapabilityStore(join(tmpDir, "test.db"));
  });

  afterEach(() => {
    store.close();
    rmSync(tmpDir, { recursive: true });
  });

  test("upsert and retrieve providerType", () => {
    const cap = makeCapability({
      accountName: "alice",
      providerType: "claude-code",
    });
    store.upsert(cap);

    const retrieved = store.get("alice");
    expect(retrieved).not.toBeNull();
    expect(retrieved!.providerType).toBe("claude-code");
  });

  test("providerType is undefined when not set", () => {
    const cap = makeCapability({ accountName: "bob" });
    store.upsert(cap);

    const retrieved = store.get("bob");
    expect(retrieved).not.toBeNull();
    expect(retrieved!.providerType).toBeUndefined();
  });

  test("getAll returns providerType for all accounts", () => {
    store.upsert(makeCapability({ accountName: "alice", providerType: "claude-code" }));
    store.upsert(makeCapability({ accountName: "bob", providerType: "gemini-cli" }));
    store.upsert(makeCapability({ accountName: "carol" }));

    const all = store.getAll();
    expect(all).toHaveLength(3);

    const alice = all.find((c) => c.accountName === "alice");
    const bob = all.find((c) => c.accountName === "bob");
    const carol = all.find((c) => c.accountName === "carol");

    expect(alice!.providerType).toBe("claude-code");
    expect(bob!.providerType).toBe("gemini-cli");
    expect(carol!.providerType).toBeUndefined();
  });

  test("providerType survives upsert update", () => {
    store.upsert(makeCapability({
      accountName: "alice",
      providerType: "claude-code",
    }));

    // Update with new provider type
    store.upsert(makeCapability({
      accountName: "alice",
      providerType: "gemini-cli",
    }));

    const retrieved = store.get("alice");
    expect(retrieved!.providerType).toBe("gemini-cli");
  });
});

describe("provider-aware scoring", () => {
  test("providerType influences score via provider fit points", () => {
    const claudeAgent = makeCapability({
      accountName: "claude-agent",
      providerType: "claude-code",
      skills: ["typescript", "refactoring"],
    });

    const genericAgent = makeCapability({
      accountName: "generic-agent",
      skills: ["typescript", "refactoring"],
    });

    // Score with skills that match claude-code's strengths
    const claudeScore = scoreAccount(claudeAgent, ["typescript", "refactoring"]);
    const genericScore = scoreAccount(genericAgent, ["typescript", "refactoring"]);

    // Claude agent should score higher due to provider fit
    expect(claudeScore.score).toBeGreaterThan(genericScore.score);

    // Check provider fit reason present
    const claudeFit = claudeScore.reasons.find((r) => r.includes("provider fit:"));
    expect(claudeFit).toBeDefined();
    expect(claudeFit).toContain("strengths");
  });

  test("mismatched provider type gives lower fit score", () => {
    const pythonAgent = makeCapability({
      accountName: "python-agent",
      providerType: "gemini-cli",
      skills: ["typescript", "testing"],
    });

    // Gemini-cli strengths are: python, data-analysis, research, documentation, multimodal
    // Requesting typescript skills should not match gemini strengths
    const score = scoreAccount(pythonAgent, ["typescript", "testing"]);
    const fitReason = score.reasons.find((r) => r.includes("provider fit:"));
    expect(fitReason).toBeDefined();
    // 0 of 2 strengths match
    expect(fitReason).toContain("0/2");
  });
});

describe("end-to-end trust + capability + provider integration", () => {
  let capStore: CapabilityStore;
  let trustStore: TrustStore;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "e2e-trust-cap-"));
    capStore = new CapabilityStore(join(tmpDir, "cap.db"));
    trustStore = new TrustStore(join(tmpDir, "trust.db"));
  });

  afterEach(() => {
    capStore.close();
    trustStore.close();
    rmSync(tmpDir, { recursive: true });
  });

  test("suggest_assignee flow: enriches capabilities with trust before ranking", () => {
    // Set up capability data
    capStore.upsert(makeCapability({
      accountName: "alice",
      skills: ["typescript", "testing"],
      providerType: "claude-code",
    }));
    capStore.upsert(makeCapability({
      accountName: "bob",
      skills: ["typescript", "testing"],
      providerType: "codex-cli",
    }));

    // Set up trust data
    trustStore.recordOutcome("alice", "completed", 10);
    trustStore.recordOutcome("alice", "completed", 8);
    trustStore.recordOutcome("alice", "completed", 12);
    trustStore.recordOutcome("bob", "completed", 10);
    trustStore.recordOutcome("bob", "failed");
    trustStore.recordOutcome("bob", "rejected");

    // Simulate the handler's enrichment logic
    const capabilities = capStore.getAll();
    for (const cap of capabilities) {
      const rep = trustStore.get(cap.accountName);
      if (rep) {
        cap.trustScore = rep.trustScore;
      }
    }

    const ranked = rankAccounts(capabilities, ["typescript", "testing"]);

    // Alice should rank higher: better trust, claude-code provider fit
    expect(ranked[0].accountName).toBe("alice");
    expect(ranked[1].accountName).toBe("bob");

    // Both should have trust scores injected
    const aliceCap = capabilities.find((c) => c.accountName === "alice");
    const bobCap = capabilities.find((c) => c.accountName === "bob");
    expect(aliceCap!.trustScore).toBeDefined();
    expect(bobCap!.trustScore).toBeDefined();
    expect(aliceCap!.trustScore!).toBeGreaterThan(bobCap!.trustScore!);
  });
});
