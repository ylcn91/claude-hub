import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { mkdirSync, rmSync } from "fs";
import { analyzeRisks } from "../src/services/review-bundle";
import { saveBundle, getBundle, deleteBundle, listBundles, sanitizeTaskId } from "../src/services/review-bundle-store";
import type { ReviewBundle } from "../src/services/review-bundle";

const TEST_DIR = join(import.meta.dir, ".test-review-bundle");

let savedAgentctlDir: string | undefined;

beforeEach(() => {
  savedAgentctlDir = process.env.AGENTCTL_DIR;
  process.env.AGENTCTL_DIR = TEST_DIR;
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  if (savedAgentctlDir === undefined) {
    delete process.env.AGENTCTL_DIR;
  } else {
    process.env.AGENTCTL_DIR = savedAgentctlDir;
  }
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("analyzeRisks", () => {
  test("detects config change", () => {
    const stat = ` src/config.json | 5 ++---
 1 file changed, 2 insertions(+), 3 deletions(-)`;
    const risks = analyzeRisks(stat);
    expect(risks.some((r) => r.category === "config-change")).toBe(true);
    expect(risks.find((r) => r.category === "config-change")?.severity).toBe("medium");
  });

  test("detects yaml config change", () => {
    const stat = ` deploy/settings.yaml | 10 ++++------
 1 file changed, 4 insertions(+), 6 deletions(-)`;
    const risks = analyzeRisks(stat);
    expect(risks.some((r) => r.category === "config-change")).toBe(true);
  });

  test("detects .env config change", () => {
    const stat = ` .env.example | 2 ++
 1 file changed, 2 insertions(+), 0 deletions(-)`;
    const risks = analyzeRisks(stat);
    expect(risks.some((r) => r.category === "config-change")).toBe(true);
  });

  test("detects dependency change for package.json", () => {
    const stat = ` package.json | 2 +-
 1 file changed, 1 insertion(+), 1 deletion(-)`;
    const risks = analyzeRisks(stat);
    expect(risks.some((r) => r.category === "new-dependency")).toBe(true);
    expect(risks.find((r) => r.category === "new-dependency")?.severity).toBe("high");
  });

  test("detects dependency change for bun.lock", () => {
    const stat = ` bun.lock | 50 ++++++++++++++++++++------------------------------
 1 file changed, 20 insertions(+), 30 deletions(-)`;
    const risks = analyzeRisks(stat);
    expect(risks.some((r) => r.category === "new-dependency")).toBe(true);
  });

  test("detects schema change for .sql files", () => {
    const stat = ` db/schema.sql | 15 +++++++++++++++
 1 file changed, 15 insertions(+), 0 deletions(-)`;
    const risks = analyzeRisks(stat);
    expect(risks.some((r) => r.category === "schema-change")).toBe(true);
    expect(risks.find((r) => r.category === "schema-change")?.severity).toBe("high");
  });

  test("detects schema change for migration files", () => {
    const stat = ` src/migrations/001_add_users.ts | 30 ++++++++++++++++++++++++++++++
 1 file changed, 30 insertions(+), 0 deletions(-)`;
    const risks = analyzeRisks(stat);
    expect(risks.some((r) => r.category === "schema-change")).toBe(true);
  });

  test("detects high severity large change (>500 lines)", () => {
    const stat = ` src/big.ts | 600 ${"+" .repeat(300)}
 1 file changed, 400 insertions(+), 200 deletions(-)`;
    const risks = analyzeRisks(stat);
    const largeRisk = risks.find((r) => r.category === "large-change");
    expect(largeRisk).toBeDefined();
    expect(largeRisk?.severity).toBe("high");
  });

  test("detects medium severity large change (>200 lines)", () => {
    const stat = ` src/medium.ts | 250 ${"+" .repeat(125)}
 1 file changed, 150 insertions(+), 100 deletions(-)`;
    const risks = analyzeRisks(stat);
    const largeRisk = risks.find((r) => r.category === "large-change");
    expect(largeRisk).toBeDefined();
    expect(largeRisk?.severity).toBe("medium");
  });

  test("no large change risk for small diffs", () => {
    const stat = ` src/small.ts | 5 ++---
 1 file changed, 2 insertions(+), 3 deletions(-)`;
    const risks = analyzeRisks(stat);
    expect(risks.some((r) => r.category === "large-change")).toBe(false);
  });

  test("detects test gap", () => {
    const stat = ` src/services/auth.ts | 20 ++++++++++++++++++++
 1 file changed, 20 insertions(+), 0 deletions(-)`;
    const risks = analyzeRisks(stat);
    expect(risks.some((r) => r.category === "test-gap")).toBe(true);
    expect(risks.find((r) => r.category === "test-gap")?.severity).toBe("medium");
  });

  test("no test gap when test file also changed", () => {
    const stat = ` src/services/auth.ts      | 20 ++++++++++++++++++++
 src/services/auth.test.ts | 15 +++++++++++++++
 2 files changed, 35 insertions(+), 0 deletions(-)`;
    const risks = analyzeRisks(stat);
    expect(risks.some((r) => r.category === "test-gap")).toBe(false);
  });

  test("returns empty array when no risks found", () => {
    const stat = ` src/utils/helper.test.ts | 5 ++---
 1 file changed, 2 insertions(+), 3 deletions(-)`;
    const risks = analyzeRisks(stat);
    expect(risks).toEqual([]);
  });
});

describe("review-bundle-store", () => {
  function makeBundleFixture(taskId: string): ReviewBundle {
    return {
      taskId,
      generatedAt: new Date().toISOString(),
      gitDiff: {
        summary: " src/app.ts | 5 ++---\n 1 file changed, 2 insertions(+), 3 deletions(-)",
        filesChanged: 1,
        insertions: 2,
        deletions: 3,
      },
      riskNotes: [],
    };
  }

  test("save and get round-trip", async () => {
    const bundle = makeBundleFixture("task-001");
    await saveBundle(bundle);
    const loaded = await getBundle("task-001");
    expect(loaded).not.toBeNull();
    expect(loaded?.taskId).toBe("task-001");
    expect(loaded?.gitDiff.filesChanged).toBe(1);
  });

  test("getBundle returns null for missing task", async () => {
    const result = await getBundle("nonexistent");
    expect(result).toBeNull();
  });

  test("deleteBundle removes stored bundle", async () => {
    const bundle = makeBundleFixture("task-002");
    await saveBundle(bundle);
    const deleted = deleteBundle("task-002");
    expect(deleted).toBe(true);
    const result = await getBundle("task-002");
    expect(result).toBeNull();
  });

  test("deleteBundle returns false for missing task", () => {
    const deleted = deleteBundle("nonexistent");
    expect(deleted).toBe(false);
  });

  test("listBundles returns task IDs", async () => {
    await saveBundle(makeBundleFixture("task-a"));
    await saveBundle(makeBundleFixture("task-b"));
    await saveBundle(makeBundleFixture("task-c"));
    const ids = listBundles();
    expect(ids.sort()).toEqual(["task-a", "task-b", "task-c"]);
  });

  test("listBundles returns empty array when no bundles", () => {
    const ids = listBundles();
    expect(ids).toEqual([]);
  });
});

describe("sanitizeTaskId", () => {
  test("allows valid alphanumeric taskId", () => {
    expect(sanitizeTaskId("task-001")).toBe("task-001");
    expect(sanitizeTaskId("my_task_2")).toBe("my_task_2");
    expect(sanitizeTaskId("TASK123")).toBe("TASK123");
  });

  test("rejects path traversal with ../", () => {
    expect(() => sanitizeTaskId("../etc/passwd")).toThrow("Invalid taskId");
  });

  test("rejects path traversal with /", () => {
    expect(() => sanitizeTaskId("foo/bar")).toThrow("Invalid taskId");
  });

  test("rejects path traversal with backslash", () => {
    expect(() => sanitizeTaskId("foo\\bar")).toThrow("Invalid taskId");
  });

  test("rejects null bytes", () => {
    expect(() => sanitizeTaskId("task\0id")).toThrow("Invalid taskId");
  });

  test("rejects empty string", () => {
    expect(() => sanitizeTaskId("")).toThrow("Invalid taskId");
  });

  test("rejects dots only", () => {
    expect(() => sanitizeTaskId("..")).toThrow("Invalid taskId");
  });

  test("rejects spaces", () => {
    expect(() => sanitizeTaskId("task id")).toThrow("Invalid taskId");
  });
});

describe("review-bundle-store path traversal protection", () => {
  test("getBundle rejects path traversal", () => {
    expect(() => getBundle("../../etc/passwd")).toThrow("Invalid taskId");
  });

  test("saveBundle rejects path traversal", () => {
    const malicious = makeBundleFixture("../../../etc/passwd");
    expect(() => saveBundle(malicious)).toThrow("Invalid taskId");
  });

  test("deleteBundle rejects path traversal", () => {
    expect(() => deleteBundle("../secret")).toThrow("Invalid taskId");
  });

  function makeBundleFixture(taskId: string): ReviewBundle {
    return {
      taskId,
      generatedAt: new Date().toISOString(),
      gitDiff: {
        summary: " src/app.ts | 5 ++---\n 1 file changed, 2 insertions(+), 3 deletions(-)",
        filesChanged: 1,
        insertions: 2,
        deletions: 3,
      },
      riskNotes: [],
    };
  }
});
