// Council analysis/verification persistence layer
// Stores results so CouncilPanel.tsx can display history

import { atomicRead, acquireLock } from "./file-store";
import { getHubDir } from "../paths";
import { mkdir, rename, writeFile, unlink } from "node:fs/promises";
import { dirname } from "path";
import type { CouncilAnalysis } from "./council";
import type { VerificationResult } from "./verification-council";

const MAX_ANALYSES = 50;
const MAX_VERIFICATIONS = 100;

export interface CouncilCache {
  analyses: CouncilAnalysis[];
}

export interface VerificationCache {
  verifications: VerificationResult[];
}

export function getCouncilCachePath(baseDir?: string): string {
  return `${baseDir ?? getHubDir()}/council-analyses.json`;
}

export function getVerificationCachePath(baseDir?: string): string {
  return `${baseDir ?? getHubDir()}/council-verifications.json`;
}

export async function loadCouncilCache(baseDir?: string): Promise<CouncilCache> {
  const cache = await atomicRead<CouncilCache>(getCouncilCachePath(baseDir));
  if (cache && Array.isArray(cache.analyses)) {
    return cache;
  }
  return { analyses: [] };
}

async function lockedReadWriteJson<T>(
  path: string,
  readFn: () => Promise<T>,
  mutateFn: (data: T) => void,
): Promise<void> {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });

  const lockPath = `${path}.lock`;
  const lock = await acquireLock(lockPath);
  try {
    const data = await readFn();
    mutateFn(data);
    const tmpPath = `${path}.tmp.${process.pid}.${Date.now()}`;
    await writeFile(tmpPath, JSON.stringify(data, null, 2), "utf-8");
    await rename(tmpPath, path);
  } finally {
    await lock.release();
  }
}

export async function appendCouncilAnalysis(
  analysis: CouncilAnalysis,
  baseDir?: string,
): Promise<void> {
  const path = getCouncilCachePath(baseDir);
  await lockedReadWriteJson<CouncilCache>(
    path,
    () => loadCouncilCache(baseDir),
    (cache) => {
      cache.analyses.unshift(analysis);
      if (cache.analyses.length > MAX_ANALYSES) {
        cache.analyses = cache.analyses.slice(0, MAX_ANALYSES);
      }
    },
  );
}

export async function loadVerificationCache(baseDir?: string): Promise<VerificationCache> {
  const cache = await atomicRead<VerificationCache>(getVerificationCachePath(baseDir));
  if (cache && Array.isArray(cache.verifications)) {
    return cache;
  }
  return { verifications: [] };
}

export async function appendVerificationResult(
  result: VerificationResult,
  baseDir?: string,
): Promise<void> {
  const path = getVerificationCachePath(baseDir);
  await lockedReadWriteJson<VerificationCache>(
    path,
    () => loadVerificationCache(baseDir),
    (cache) => {
      cache.verifications.unshift(result);
      if (cache.verifications.length > MAX_VERIFICATIONS) {
        cache.verifications = cache.verifications.slice(0, MAX_VERIFICATIONS);
      }
    },
  );
}
