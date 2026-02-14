import { join } from "node:path";
import { mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { atomicRead, atomicWrite } from "./file-store";
import { getReviewBundlesDir } from "../paths";
import type { ReviewBundle } from "./review-bundle";

const SAFE_TASK_ID_RE = /^[a-zA-Z0-9_-]+$/;

export function sanitizeTaskId(taskId: string): string {
  if (
    !taskId ||
    !SAFE_TASK_ID_RE.test(taskId) ||
    taskId.includes("\0")
  ) {
    throw new Error(
      `Invalid taskId '${taskId}'. Only alphanumeric characters, dashes, and underscores are allowed.`
    );
  }
  return taskId;
}

function getBundlesDir(): string {
  return getReviewBundlesDir();
}

export async function saveBundle(bundle: ReviewBundle): Promise<void> {
  sanitizeTaskId(bundle.taskId);
  const dir = getBundlesDir();
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, `${bundle.taskId}.json`);
  await atomicWrite(filePath, bundle);
}

export async function getBundle(taskId: string): Promise<ReviewBundle | null> {
  sanitizeTaskId(taskId);
  const filePath = join(getBundlesDir(), `${taskId}.json`);
  return atomicRead<ReviewBundle>(filePath);
}

export function deleteBundle(taskId: string): boolean {
  sanitizeTaskId(taskId);
  const filePath = join(getBundlesDir(), `${taskId}.json`);
  try {
    unlinkSync(filePath);
    return true;
  } catch {
    return false;
  }
}

export function listBundles(): string[] {
  const dir = getBundlesDir();
  try {
    const entries = readdirSync(dir);
    return entries
      .filter((e) => e.endsWith(".json"))
      .map((e) => e.replace(/\.json$/, ""));
  } catch {
    return [];
  }
}
