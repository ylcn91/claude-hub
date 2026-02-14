import { $ } from "bun";

export interface CheckpointListEntry {
  checkpointId: string;
  /** Session ID extracted from git trailer; empty string if not available. */
  sessionId: string;
  createdAt: string;
  message: string;
}

export interface CheckpointMetadata {
  checkpointId: string;
  sessionId: string;
  strategy: string;
  branch: string;
  filesTouched: string[];
  checkpointsCount: number;
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    apiCallCount: number;
  };
  sessions?: Array<{
    metadata: string;
    transcript: string;
  }>;
}

export interface TranscriptLine {
  raw: string;
  parsed: Record<string, unknown> | null;
}

/**
 * List checkpoints from the entire/checkpoints/v1 orphan branch.
 * Parses git log for "Checkpoint: <id>" subjects.
 * Uses a single git log command with a delimiter to avoid fragile line-pair parsing.
 */
export async function listCheckpoints(repoPath: string): Promise<CheckpointListEntry[]> {
  const DELIMITER = "---CHECKPOINT_DELIM---";
  try {
    const logResult = await $`git log entire/checkpoints/v1 --format=%s${DELIMITER}%aI${DELIMITER}`.cwd(repoPath).quiet();
    const stdout = logResult.stdout.toString().trim();
    if (!stdout) return [];

    // Split by delimiter; each record is "subject<DELIM>date<DELIM>"
    const records = stdout.split(DELIMITER + "\n").filter(Boolean);

    const entries: CheckpointListEntry[] = [];
    for (const record of records) {
      const parts = record.split(DELIMITER);
      const subject = parts[0]?.trim();
      const date = parts[1]?.trim();

      if (!subject) continue;

      // Parse "Checkpoint: <id>" subject format
      const match = subject.match(/^Checkpoint:\s+(\w+)/);
      if (match) {
        const checkpointId = match[1];
        entries.push({
          checkpointId,
          sessionId: "",
          createdAt: date ?? "",
          message: subject,
        });
      }
    }

    return entries;
  } catch (err) {
    // Log error for debugging; branch-not-found is expected in repos without checkpoints
    const message = err instanceof Error ? err.message : String(err);
    const isExpected =
      message.includes("unknown revision") ||
      message.includes("bad default revision") ||
      message.includes("exit code 128"); // git returns 128 when ref is not found
    if (!isExpected) {
      console.error("[listCheckpoints]", message);
    }
    return [];
  }
}

/**
 * Read checkpoint data from the entire/checkpoints/v1 orphan branch.
 * Path structure: <id[:2]>/<id[2:]>/metadata.json
 */
export async function readCheckpoint(
  repoPath: string,
  checkpointId: string,
): Promise<{ metadata: CheckpointMetadata | null; transcript: TranscriptLine[] }> {
  // Validate checkpointId: must be at least 3 chars to form prefix/suffix path
  if (!checkpointId || checkpointId.length < 3) {
    return { metadata: null, transcript: [] };
  }

  const prefix = checkpointId.slice(0, 2);
  const suffix = checkpointId.slice(2);
  const basePath = `${prefix}/${suffix}`;

  // Read root metadata.json
  let metadata: CheckpointMetadata | null = null;
  try {
    const metaResult = await $`git show entire/checkpoints/v1:${basePath}/metadata.json`.cwd(repoPath).quiet();
    const raw = JSON.parse(metaResult.stdout.toString());
    if (typeof raw === "object" && raw !== null) {
      metadata = {
        checkpointId: raw.checkpoint_id ?? checkpointId,
        sessionId: raw.session_id ?? "",
        strategy: raw.strategy ?? "",
        branch: raw.branch ?? "",
        filesTouched: Array.isArray(raw.files_touched) ? raw.files_touched : [],
        checkpointsCount: raw.checkpoints_count ?? 0,
        tokenUsage: raw.token_usage ? {
          inputTokens: raw.token_usage.input_tokens ?? 0,
          outputTokens: raw.token_usage.output_tokens ?? 0,
          apiCallCount: raw.token_usage.api_call_count ?? 0,
        } : undefined,
        sessions: Array.isArray(raw.sessions) ? raw.sessions : undefined,
      };
    }
  } catch {
    // Checkpoint not found
  }

  // Read full.jsonl from first session (index 0)
  const transcript: TranscriptLine[] = [];
  try {
    const jsonlResult = await $`git show entire/checkpoints/v1:${basePath}/0/full.jsonl`.cwd(repoPath).quiet();
    const lines = jsonlResult.stdout.toString().trim().split("\n").filter(Boolean);
    for (const line of lines) {
      let parsed: Record<string, unknown> | null = null;
      try {
        const obj = JSON.parse(line);
        // Runtime type guard: parsed must be a non-null object
        if (typeof obj === "object" && obj !== null && !Array.isArray(obj)) {
          parsed = obj as Record<string, unknown>;
        }
      } catch { /* keep raw */ }
      transcript.push({ raw: line, parsed });
    }
  } catch {
    // No transcript available
  }

  return { metadata, transcript };
}
