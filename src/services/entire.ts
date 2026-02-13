import { $ } from "bun";

export interface EntireCheckpoint {
  checkpointId: string;
  sessionId: string;
  branch: string;
  filesTouched: string[];
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
    apiCallCount: number;
  };
  createdAt?: string;
}

export async function isEntireInstalled(): Promise<boolean> {
  try {
    await $`which entire`.quiet();
    return true;
  } catch {
    return false;
  }
}

export async function isEntireEnabled(repoDir: string): Promise<boolean> {
  try {
    const result = await $`entire status`.cwd(repoDir).quiet();
    return result.stdout.toString().includes("enabled");
  } catch {
    return false;
  }
}

export function parseCheckpointMetadata(raw: any): EntireCheckpoint {
  if (!raw || typeof raw !== "object") {
    return {
      checkpointId: "",
      sessionId: "",
      branch: "",
      filesTouched: [],
      tokenUsage: { inputTokens: 0, outputTokens: 0, apiCallCount: 0 },
    };
  }
  return {
    checkpointId: raw.checkpoint_id ?? "",
    sessionId: raw.session_id ?? "",
    branch: raw.branch ?? "",
    filesTouched: Array.isArray(raw.files_touched) ? raw.files_touched : [],
    tokenUsage: {
      inputTokens: raw.token_usage?.input_tokens ?? 0,
      outputTokens: raw.token_usage?.output_tokens ?? 0,
      apiCallCount: raw.token_usage?.api_call_count ?? 0,
    },
    createdAt: raw.created_at,
  };
}

// Primary: read directly from git orphan branch
export async function readCheckpointsFromGit(repoDir: string): Promise<EntireCheckpoint[]> {
  try {
    const result = await $`git ls-tree --name-only entire/checkpoints/v1`.cwd(repoDir).quiet();
    const stdout = result.stdout.toString().trim();
    if (!stdout) return [];

    const dirs = stdout.split("\n");
    const checkpoints: EntireCheckpoint[] = [];

    for (const dir of dirs.slice(-10)) {
      const subResult = await $`git ls-tree --name-only entire/checkpoints/v1:${dir}`.cwd(repoDir).quiet();
      const subs = subResult.stdout.toString().trim().split("\n");

      for (const sub of subs) {
        try {
          const metaResult = await $`git show entire/checkpoints/v1:${dir}/${sub}/metadata.json`.cwd(repoDir).quiet();
          const meta = JSON.parse(metaResult.stdout.toString());
          checkpoints.push(parseCheckpointMetadata(meta));
        } catch { /* skip unreadable checkpoints */ }
      }
    }

    return checkpoints;
  } catch {
    return [];
  }
}

// Fallback: shell out to entire CLI
export async function readCheckpointsFromCLI(repoDir: string): Promise<EntireCheckpoint[]> {
  try {
    await $`entire explain --short --no-pager`.cwd(repoDir).quiet().timeout(10_000);
    return [];
  } catch {
    return [];
  }
}

// Combined: git primary, CLI fallback
export async function getEntireCheckpoints(repoDir: string): Promise<EntireCheckpoint[]> {
  try {
    const fromGit = await readCheckpointsFromGit(repoDir);
    if (fromGit.length > 0) return fromGit;
  } catch { /* fall through */ }

  try {
    return await readCheckpointsFromCLI(repoDir);
  } catch {
    return [];
  }
}

// Destructive operations - delegate to CLI with safety checks
export async function enableEntire(repoDir: string): Promise<{ success: boolean; error?: string }> {
  try {
    const status = await $`git status --porcelain`.cwd(repoDir).quiet();
    if (status.stdout.toString().trim()) {
      return { success: false, error: "Working directory is dirty. Commit or stash changes first." };
    }
  } catch (e: any) {
    return { success: false, error: `Not a git repository: ${e.message}` };
  }

  try {
    await $`entire enable --agent claude-code`.cwd(repoDir).quiet();
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}
