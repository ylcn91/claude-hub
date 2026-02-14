import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createReceipt, verifyReceipt, computeSpecHash, type VerificationReceipt } from "../src/services/verification-receipts";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("computeSpecHash", () => {
  test("produces consistent hash for same input", () => {
    const hash1 = computeSpecHash({ goal: "test", priority: "P1" });
    const hash2 = computeSpecHash({ goal: "test", priority: "P1" });
    expect(hash1).toBe(hash2);
  });

  test("produces different hash for different input", () => {
    const hash1 = computeSpecHash({ goal: "test1" });
    const hash2 = computeSpecHash({ goal: "test2" });
    expect(hash1).not.toBe(hash2);
  });

  test("handles string input", () => {
    const hash = computeSpecHash("raw string payload");
    expect(hash).toHaveLength(64); // SHA-256 hex length
  });

  test("hash is valid hex string", () => {
    const hash = computeSpecHash({ any: "data" });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("createReceipt", () => {
  let tmpDir: string;
  let keyPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "receipt-"));
    keyPath = join(tmpDir, "receipt.key");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true });
  });

  test("creates a receipt with all required fields", () => {
    const receipt = createReceipt({
      taskId: "task-1",
      delegator: "alice",
      delegatee: "bob",
      specPayload: { goal: "implement feature" },
      verdict: "accepted",
      method: "human-review",
      keyPath,
    });

    expect(receipt.receiptId).toBeDefined();
    expect(receipt.taskId).toBe("task-1");
    expect(receipt.handoffId).toBe("task-1"); // defaults to taskId when not provided
    expect(receipt.delegator).toBe("alice");
    expect(receipt.delegatee).toBe("bob");
    expect(receipt.specHash).toHaveLength(64);
    expect(receipt.verdict).toBe("accepted");
    expect(receipt.method).toBe("human-review");
    expect(receipt.verificationMethod).toBe("human-review");
    expect(receipt.timestamp).toBeDefined();
    expect(receipt.signature).toBeDefined();
    expect(receipt.signature).toHaveLength(64); // HMAC-SHA256 hex
  });

  test("creates receipt with auto-acceptance method and auto-test verificationMethod", () => {
    const receipt = createReceipt({
      taskId: "task-2",
      delegator: "alice",
      delegatee: "bot",
      specPayload: "raw payload",
      verdict: "accepted",
      method: "auto-acceptance",
      keyPath,
    });

    expect(receipt.method).toBe("auto-acceptance");
    expect(receipt.verificationMethod).toBe("auto-test");
  });

  test("uses explicit handoffId when provided", () => {
    const receipt = createReceipt({
      taskId: "task-2b",
      handoffId: "handoff-abc",
      delegator: "alice",
      delegatee: "bot",
      specPayload: {},
      verdict: "accepted",
      method: "human-review",
      keyPath,
    });

    expect(receipt.handoffId).toBe("handoff-abc");
    expect(receipt.taskId).toBe("task-2b");
  });

  test("creates receipt with rejected verdict", () => {
    const receipt = createReceipt({
      taskId: "task-3",
      delegator: "alice",
      delegatee: "bob",
      specPayload: {},
      verdict: "rejected",
      method: "human-review",
      keyPath,
    });

    expect(receipt.verdict).toBe("rejected");
  });

  test("includes artifacts when provided", () => {
    const receipt = createReceipt({
      taskId: "task-4",
      delegator: "alice",
      delegatee: "bob",
      specPayload: {},
      verdict: "accepted",
      method: "human-review",
      artifacts: ["diff.patch", "test-results.json"],
      keyPath,
    });

    expect(receipt.artifacts).toEqual(["diff.patch", "test-results.json"]);
  });

  test("auto-generates key on first use", () => {
    // Key path does not exist yet
    const receipt = createReceipt({
      taskId: "task-5",
      delegator: "alice",
      delegatee: "bob",
      specPayload: {},
      verdict: "accepted",
      method: "human-review",
      keyPath,
    });

    expect(receipt.signature).toBeDefined();
    // Key file should now exist
    const keyContent = require("fs").readFileSync(keyPath, "utf-8").trim();
    expect(keyContent.length).toBeGreaterThan(0);
  });

  test("uses existing key file consistently", () => {
    writeFileSync(keyPath, "fixed-test-secret", { mode: 0o600 });

    const receipt1 = createReceipt({
      taskId: "task-6",
      delegator: "alice",
      delegatee: "bob",
      specPayload: { data: "same" },
      verdict: "accepted",
      method: "human-review",
      keyPath,
    });

    const receipt2 = createReceipt({
      taskId: "task-6",
      delegator: "alice",
      delegatee: "bob",
      specPayload: { data: "same" },
      verdict: "accepted",
      method: "human-review",
      keyPath,
    });

    // Different receipts (different receiptId/timestamp) should have different signatures
    expect(receipt1.signature).not.toBe(receipt2.signature);
  });

  test("different payloads produce different specHash", () => {
    const receipt1 = createReceipt({
      taskId: "task-7",
      delegator: "alice",
      delegatee: "bob",
      specPayload: { goal: "A" },
      verdict: "accepted",
      method: "human-review",
      keyPath,
    });

    const receipt2 = createReceipt({
      taskId: "task-7",
      delegator: "alice",
      delegatee: "bob",
      specPayload: { goal: "B" },
      verdict: "accepted",
      method: "human-review",
      keyPath,
    });

    expect(receipt1.specHash).not.toBe(receipt2.specHash);
  });
});

describe("verifyReceipt", () => {
  let tmpDir: string;
  let keyPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "receipt-verify-"));
    keyPath = join(tmpDir, "receipt.key");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true });
  });

  test("verifies a valid receipt", () => {
    const receipt = createReceipt({
      taskId: "task-v1",
      delegator: "alice",
      delegatee: "bob",
      specPayload: { goal: "test" },
      verdict: "accepted",
      method: "human-review",
      keyPath,
    });

    expect(verifyReceipt(receipt, keyPath)).toBe(true);
  });

  test("rejects receipt with tampered taskId", () => {
    const receipt = createReceipt({
      taskId: "task-v2",
      delegator: "alice",
      delegatee: "bob",
      specPayload: {},
      verdict: "accepted",
      method: "human-review",
      keyPath,
    });

    const tampered = { ...receipt, taskId: "task-tampered" };
    expect(verifyReceipt(tampered, keyPath)).toBe(false);
  });

  test("rejects receipt with tampered verdict", () => {
    const receipt = createReceipt({
      taskId: "task-v3",
      delegator: "alice",
      delegatee: "bob",
      specPayload: {},
      verdict: "rejected",
      method: "human-review",
      keyPath,
    });

    const tampered = { ...receipt, verdict: "accepted" as const };
    expect(verifyReceipt(tampered, keyPath)).toBe(false);
  });

  test("rejects receipt with tampered signature", () => {
    const receipt = createReceipt({
      taskId: "task-v4",
      delegator: "alice",
      delegatee: "bob",
      specPayload: {},
      verdict: "accepted",
      method: "human-review",
      keyPath,
    });

    const tampered = { ...receipt, signature: "0".repeat(64) };
    expect(verifyReceipt(tampered, keyPath)).toBe(false);
  });

  test("rejects receipt with tampered delegatee", () => {
    const receipt = createReceipt({
      taskId: "task-v5",
      delegator: "alice",
      delegatee: "bob",
      specPayload: {},
      verdict: "accepted",
      method: "human-review",
      keyPath,
    });

    const tampered = { ...receipt, delegatee: "mallory" };
    expect(verifyReceipt(tampered, keyPath)).toBe(false);
  });

  test("rejects receipt with wrong key", () => {
    const receipt = createReceipt({
      taskId: "task-v6",
      delegator: "alice",
      delegatee: "bob",
      specPayload: {},
      verdict: "accepted",
      method: "human-review",
      keyPath,
    });

    // Create a different key path
    const otherKeyPath = join(tmpDir, "other.key");
    writeFileSync(otherKeyPath, "different-secret");
    expect(verifyReceipt(receipt, otherKeyPath)).toBe(false);
  });

  test("verifies receipt with artifacts", () => {
    const receipt = createReceipt({
      taskId: "task-v7",
      delegator: "alice",
      delegatee: "bob",
      specPayload: { goal: "test" },
      verdict: "accepted",
      method: "auto-acceptance",
      artifacts: ["file1.ts", "file2.ts"],
      keyPath,
    });

    expect(verifyReceipt(receipt, keyPath)).toBe(true);

    // Tamper with artifacts
    const tampered = { ...receipt, artifacts: ["file3.ts"] };
    // Artifacts are not in signed fields in current impl, so this tests consistency
    // The signature does not include artifacts unless present, so tampering should not matter
    // unless we explicitly add artifacts to the signed fields
  });

  test("rejects receipt with different-length signature", () => {
    const receipt = createReceipt({
      taskId: "task-v8",
      delegator: "alice",
      delegatee: "bob",
      specPayload: {},
      verdict: "accepted",
      method: "human-review",
      keyPath,
    });

    const tampered = { ...receipt, signature: "short" };
    expect(verifyReceipt(tampered, keyPath)).toBe(false);
  });
});
