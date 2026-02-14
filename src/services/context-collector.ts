import { $ } from "bun";

export interface GitContext {
  branch: string;
  recentCommits: string[];
  diff: string;
  changedFiles: string[];
}

export interface CollectedContext {
  git: GitContext;
  collectedAt: string;
  truncated: boolean;
}

const MAX_CONTEXT_CHARS = 50 * 1024; // 50K character cap

export async function collectGitContext(workDir: string): Promise<GitContext> {
  const [branchResult, logResult, diffResult, statusResult] = await Promise.allSettled([
    $`git rev-parse --abbrev-ref HEAD`.cwd(workDir).quiet(),
    $`git log -5 --oneline`.cwd(workDir).quiet(),
    $`git diff HEAD`.cwd(workDir).quiet(),
    $`git status --porcelain`.cwd(workDir).quiet(),
  ]);

  const branch = branchResult.status === "fulfilled"
    ? branchResult.value.stdout.toString().trim()
    : "unknown";

  const recentCommits = logResult.status === "fulfilled"
    ? logResult.value.stdout.toString().trim().split("\n").filter(Boolean)
    : [];

  const diff = diffResult.status === "fulfilled"
    ? diffResult.value.stdout.toString()
    : "";

  const changedFiles = statusResult.status === "fulfilled"
    ? statusResult.value.stdout.toString().trim().split("\n").filter(Boolean).map(l => l.slice(3))
    : [];

  return { branch, recentCommits, diff, changedFiles };
}

export async function collectContext(
  workDir: string,
  opts?: { maxChars?: number },
): Promise<CollectedContext> {
  const maxChars = opts?.maxChars ?? MAX_CONTEXT_CHARS;
  const git = await collectGitContext(workDir);

  let truncated = false;
  const size = JSON.stringify(git).length;

  if (size > maxChars) {
    // Truncate diff first to fit within budget
    const TRUNCATION_SUFFIX = "\n... [diff truncated]";
    const overhead = size - git.diff.length;
    // Subtract suffix length from budget so final output stays within maxChars
    const diffBudget = Math.max(0, maxChars - overhead - TRUNCATION_SUFFIX.length);
    if (diffBudget < git.diff.length) {
      git.diff = git.diff.slice(0, diffBudget) + TRUNCATION_SUFFIX;
      truncated = true;
    }
  }

  return {
    git,
    collectedAt: new Date().toISOString(),
    truncated,
  };
}
