// F-10: Non-repudiable Verification Receipts
// Paper ref: Section 4.7 (Verification & Accountability)

import { createHmac } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";
import { getReceiptKeyPath } from "../paths";

export interface VerificationReceipt {
  receiptId: string;
  taskId: string;
  handoffId: string;
  delegator: string;
  delegatee: string;
  specHash: string;
  verdict: "accepted" | "rejected";
  method: "auto-acceptance" | "human-review";
  verificationMethod: "auto-test" | "human-review" | "council-review";
  artifacts?: string[];
  timestamp: string;
  signature: string;
}

export function computeSpecHash(payload: unknown): string {
  const data = typeof payload === "string" ? payload : JSON.stringify(payload);
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(data);
  return hasher.digest("hex");
}

function getOrCreateSecret(keyPath?: string): string {
  const path = keyPath ?? getReceiptKeyPath();
  if (existsSync(path)) {
    return readFileSync(path, "utf-8").trim();
  }
  // Auto-generate key on first use
  const secret = crypto.randomUUID() + "-" + crypto.randomUUID();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, secret, { mode: 0o600 });
  return secret;
}

function signReceipt(receipt: Omit<VerificationReceipt, "signature">, secret: string): string {
  // Sort fields alphabetically and sign
  const fields: Record<string, unknown> = {
    delegatee: receipt.delegatee,
    delegator: receipt.delegator,
    handoffId: receipt.handoffId,
    method: receipt.method,
    receiptId: receipt.receiptId,
    specHash: receipt.specHash,
    taskId: receipt.taskId,
    timestamp: receipt.timestamp,
    verificationMethod: receipt.verificationMethod,
    verdict: receipt.verdict,
  };
  if (receipt.artifacts && receipt.artifacts.length > 0) {
    fields.artifacts = receipt.artifacts;
  }
  const payload = JSON.stringify(fields);
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export function createReceipt(params: {
  taskId: string;
  handoffId?: string;
  delegator: string;
  delegatee: string;
  specPayload: unknown;
  verdict: "accepted" | "rejected";
  method: "auto-acceptance" | "human-review";
  artifacts?: string[];
  keyPath?: string;
}): VerificationReceipt {
  const secret = getOrCreateSecret(params.keyPath);
  const verificationMethod: VerificationReceipt["verificationMethod"] =
    params.method === "auto-acceptance" ? "auto-test" : "human-review";
  const receipt: Omit<VerificationReceipt, "signature"> = {
    receiptId: crypto.randomUUID(),
    taskId: params.taskId,
    handoffId: params.handoffId ?? params.taskId,
    delegator: params.delegator,
    delegatee: params.delegatee,
    specHash: computeSpecHash(params.specPayload),
    verdict: params.verdict,
    method: params.method,
    verificationMethod,
    artifacts: params.artifacts,
    timestamp: new Date().toISOString(),
  };

  const signature = signReceipt(receipt, secret);
  return { ...receipt, signature };
}

export function verifyReceipt(receipt: VerificationReceipt, keyPath?: string): boolean {
  const secret = getOrCreateSecret(keyPath);
  const { signature, ...rest } = receipt;
  const expected = signReceipt(rest, secret);
  // Constant-time comparison
  if (signature.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < signature.length; i++) {
    mismatch |= signature.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}
