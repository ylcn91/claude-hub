import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  scoreAccount,
  rankAccounts,
  type AccountCapability,
} from "../src/services/account-capabilities";
import { CapabilityStore } from "../src/daemon/capability-store";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

function makeCapability(overrides: Partial<AccountCapability> = {}): AccountCapability {
  return {
    accountName: "test-account",
    skills: ["typescript", "testing", "devops"],
    totalTasks: 10,
    acceptedTasks: 9,
    rejectedTasks: 1,
    avgDeliveryMs: 180_000, // 3 min
    lastActiveAt: new Date().toISOString(), // just now
    ...overrides,
  };
}

describe("scoreAccount", () => {
  test("perfect skill match gives full 30 skill points", () => {
    const cap = makeCapability({ skills: ["typescript", "testing"] });
    const result = scoreAccount(cap, ["typescript", "testing"]);
    expect(result.reasons[0]).toContain("2/2");
    expect(result.reasons[0]).toContain("30pts");
  });

  test("partial skill match gives proportional points", () => {
    const cap = makeCapability({ skills: ["typescript"] });
    const result = scoreAccount(cap, ["typescript", "testing", "devops", "react"]);
    expect(result.reasons[0]).toContain("1/4");
    expect(result.reasons[0]).toContain("8pts");
  });

  test("no skill match gives 0 skill points", () => {
    const cap = makeCapability({ skills: ["python"] });
    const result = scoreAccount(cap, ["typescript", "testing"]);
    expect(result.reasons[0]).toContain("0/2");
    expect(result.reasons[0]).toContain("0pts");
  });

  test("empty required skills gives full 30 points", () => {
    const cap = makeCapability();
    const result = scoreAccount(cap, []);
    expect(result.reasons[0]).toContain("no skills required");
    expect(result.reasons[0]).toContain("30pts");
  });

  test("high success rate gives near 20 points", () => {
    const cap = makeCapability({ totalTasks: 100, acceptedTasks: 95, rejectedTasks: 5 });
    const result = scoreAccount(cap, []);
    const successReason = result.reasons.find((r) => r.startsWith("success rate:"));
    expect(successReason).toContain("95%");
    // 95% of 20 = 19
    expect(successReason).toContain("19pts");
  });

  test("zero tasks (cold start) gives neutral 10 points", () => {
    const cap = makeCapability({ totalTasks: 0, acceptedTasks: 0, rejectedTasks: 0 });
    const result = scoreAccount(cap, []);
    const successReason = result.reasons.find((r) => r.startsWith("success rate:"));
    expect(successReason).toContain("no history");
    expect(successReason).toContain("10pts");
  });

  test("fast delivery gives 15 speed points", () => {
    const cap = makeCapability({ avgDeliveryMs: 120_000 }); // 2 min
    const result = scoreAccount(cap, []);
    const speedReason = result.reasons.find((r) => r.startsWith("speed:"));
    expect(speedReason).toContain("15pts");
  });

  test("slow delivery gives low speed points", () => {
    const cap = makeCapability({ avgDeliveryMs: 3_600_000 }); // 60 min
    const result = scoreAccount(cap, []);
    const speedReason = result.reasons.find((r) => r.startsWith("speed:"));
    expect(speedReason).toContain("3pts");
  });

  test("recently active gives 5 recency points", () => {
    const cap = makeCapability({ lastActiveAt: new Date().toISOString() });
    const result = scoreAccount(cap, []);
    const recencyReason = result.reasons.find((r) => r.startsWith("recency:"));
    expect(recencyReason).toContain("5pts");
  });

  test("inactive over 1hr gives low recency points", () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const cap = makeCapability({ lastActiveAt: twoHoursAgo });
    const result = scoreAccount(cap, []);
    const recencyReason = result.reasons.find((r) => r.startsWith("recency:"));
    expect(recencyReason).toContain("1pts");
  });
});

describe("rankAccounts", () => {
  test("sorted descending by score", () => {
    const caps = [
      makeCapability({ accountName: "weak", skills: [], totalTasks: 10, acceptedTasks: 1 }),
      makeCapability({ accountName: "strong", skills: ["ts", "test"], totalTasks: 10, acceptedTasks: 10 }),
    ];
    const ranked = rankAccounts(caps, ["ts", "test"]);
    expect(ranked[0].accountName).toBe("strong");
    expect(ranked[1].accountName).toBe("weak");
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });

  test("excludeAccounts filters correctly", () => {
    const caps = [
      makeCapability({ accountName: "alice" }),
      makeCapability({ accountName: "bob" }),
      makeCapability({ accountName: "carol" }),
    ];
    const ranked = rankAccounts(caps, [], { excludeAccounts: ["bob"] });
    const names = ranked.map((r) => r.accountName);
    expect(names).not.toContain("bob");
    expect(names).toHaveLength(2);
  });

  test("empty capabilities returns empty result", () => {
    const ranked = rankAccounts([], ["typescript"]);
    expect(ranked).toHaveLength(0);
  });
});

describe("CapabilityStore", () => {
  let store: CapabilityStore;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "cap-store-"));
    store = new CapabilityStore(join(tmpDir, "test.db"));
  });

  afterEach(() => {
    store.close();
    rmSync(tmpDir, { recursive: true });
  });

  test("upsert and get round-trip", () => {
    const cap = makeCapability({ accountName: "alice" });
    store.upsert(cap);

    const retrieved = store.get("alice");
    expect(retrieved).not.toBeNull();
    expect(retrieved!.accountName).toBe("alice");
    expect(retrieved!.skills).toEqual(["typescript", "testing", "devops"]);
    expect(retrieved!.totalTasks).toBe(10);
    expect(retrieved!.acceptedTasks).toBe(9);
    expect(retrieved!.rejectedTasks).toBe(1);
    expect(retrieved!.avgDeliveryMs).toBe(180_000);
  });

  test("recordTaskCompletion updates stats correctly", () => {
    store.upsert(
      makeCapability({
        accountName: "alice",
        totalTasks: 10,
        acceptedTasks: 8,
        rejectedTasks: 2,
        avgDeliveryMs: 300_000,
      })
    );

    store.recordTaskCompletion("alice", true, 60_000);

    const updated = store.get("alice")!;
    expect(updated.totalTasks).toBe(11);
    expect(updated.acceptedTasks).toBe(9);
    expect(updated.rejectedTasks).toBe(2);
  });

  test("running average calculation correct", () => {
    store.upsert(
      makeCapability({
        accountName: "bob",
        totalTasks: 4,
        acceptedTasks: 4,
        rejectedTasks: 0,
        avgDeliveryMs: 200_000, // 200s avg over 4 tasks
      })
    );

    // New task takes 100_000ms. New avg = (200_000*4 + 100_000) / 5 = 180_000
    store.recordTaskCompletion("bob", true, 100_000);

    const updated = store.get("bob")!;
    expect(updated.avgDeliveryMs).toBeCloseTo(180_000, 0);
  });

  test("getAll returns all accounts", () => {
    store.upsert(makeCapability({ accountName: "alice" }));
    store.upsert(makeCapability({ accountName: "bob" }));
    store.upsert(makeCapability({ accountName: "carol" }));

    const all = store.getAll();
    expect(all).toHaveLength(3);
    const names = all.map((c) => c.accountName).sort();
    expect(names).toEqual(["alice", "bob", "carol"]);
  });
});
