import type { AcceptanceResult } from "./acceptance-runner";
import { runAcceptanceSuite } from "./acceptance-runner";

export interface RiskNote {
  category: "large-change" | "config-change" | "new-dependency" | "schema-change" | "test-gap";
  description: string;
  severity: "low" | "medium" | "high";
}

export interface GitDiffSummary {
  summary: string;
  filesChanged: number;
  insertions: number;
  deletions: number;
  fullDiff?: string;
}

export interface ReviewBundle {
  taskId: string;
  generatedAt: string;
  gitDiff: GitDiffSummary;
  testResults?: AcceptanceResult;
  riskNotes: RiskNote[];
}

export async function generateReviewBundle(opts: {
  taskId: string;
  workDir: string;
  baseBranch?: string;
  branch: string;
  runCommands?: string[];
}): Promise<ReviewBundle> {
  const baseBranch = opts.baseBranch ?? "main";

  // Get diff stat summary
  const statProc = Bun.spawn(
    ["git", "diff", "--stat", `${baseBranch}...${opts.branch}`],
    { cwd: opts.workDir, stdout: "pipe", stderr: "pipe" },
  );
  const statExitCode = await statProc.exited;
  if (statExitCode !== 0) {
    const stderr = await new Response(statProc.stderr).text();
    throw new Error(`git diff --stat failed (exit ${statExitCode}): ${stderr}`);
  }
  const summary = await new Response(statProc.stdout).text();

  // Parse last line for stats
  let filesChanged = 0;
  let insertions = 0;
  let deletions = 0;
  const lastLine = summary.trim().split("\n").pop() ?? "";
  const filesMatch = lastLine.match(/(\d+)\s+files?\s+changed/);
  const insMatch = lastLine.match(/(\d+)\s+insertions?\(\+\)/);
  const delMatch = lastLine.match(/(\d+)\s+deletions?\(-\)/);
  if (filesMatch) filesChanged = parseInt(filesMatch[1], 10);
  if (insMatch) insertions = parseInt(insMatch[1], 10);
  if (delMatch) deletions = parseInt(delMatch[1], 10);

  // Get full diff, truncated
  const diffProc = Bun.spawn(
    ["git", "diff", `${baseBranch}...${opts.branch}`],
    { cwd: opts.workDir, stdout: "pipe", stderr: "pipe" },
  );
  const diffExitCode = await diffProc.exited;
  if (diffExitCode !== 0) {
    const stderr = await new Response(diffProc.stderr).text();
    throw new Error(`git diff failed (exit ${diffExitCode}): ${stderr}`);
  }
  let fullDiff = await new Response(diffProc.stdout).text();
  const MAX_DIFF = 50 * 1024;
  if (fullDiff.length > MAX_DIFF) {
    fullDiff = fullDiff.slice(0, MAX_DIFF);
  }

  // Run acceptance suite if commands provided
  let testResults: AcceptanceResult | undefined;
  if (opts.runCommands && opts.runCommands.length > 0) {
    testResults = await runAcceptanceSuite(opts.runCommands, opts.workDir);
  }

  const riskNotes = analyzeRisks(summary, fullDiff);

  return {
    taskId: opts.taskId,
    generatedAt: new Date().toISOString(),
    gitDiff: {
      summary,
      filesChanged,
      insertions,
      deletions,
      fullDiff,
    },
    testResults,
    riskNotes,
  };
}

export function analyzeRisks(diffStat: string, _fullDiff?: string): RiskNote[] {
  const risks: RiskNote[] = [];
  const lines = diffStat.trim().split("\n");

  // Parse file names from diff stat lines (format: " path/to/file | N +--")
  const changedFiles: string[] = [];
  for (const line of lines) {
    const match = line.match(/^\s*(.+?)\s*\|/);
    if (match) {
      changedFiles.push(match[1].trim());
    }
  }

  // config-change: files matching config extensions or containing .env
  for (const file of changedFiles) {
    if (/\.(json|yaml|yml|toml)$/.test(file) || file.includes(".env")) {
      // Skip package.json — handled separately as new-dependency
      if (file === "package.json" || file.endsWith("/package.json")) continue;
      risks.push({
        category: "config-change",
        description: `Configuration file changed: ${file}`,
        severity: "medium",
      });
    }
  }

  // new-dependency: package.json or bun.lock changes
  for (const file of changedFiles) {
    if (
      file === "package.json" ||
      file.endsWith("/package.json") ||
      file === "bun.lock" ||
      file.endsWith("/bun.lock")
    ) {
      risks.push({
        category: "new-dependency",
        description: `Dependency file changed: ${file}`,
        severity: "high",
      });
    }
  }

  // schema-change: .sql files or migration paths
  for (const file of changedFiles) {
    if (/\.sql$/.test(file) || /migration/i.test(file)) {
      risks.push({
        category: "schema-change",
        description: `Schema/migration file changed: ${file}`,
        severity: "high",
      });
    }
  }

  // large-change: total lines changed
  const lastLine = diffStat.trim().split("\n").pop() ?? "";
  let totalLines = 0;
  const insMatch = lastLine.match(/(\d+)\s+insertions?\(\+\)/);
  const delMatch = lastLine.match(/(\d+)\s+deletions?\(-\)/);
  if (insMatch) totalLines += parseInt(insMatch[1], 10);
  if (delMatch) totalLines += parseInt(delMatch[1], 10);

  if (totalLines > 500) {
    risks.push({
      category: "large-change",
      description: `Large change: ${totalLines} lines modified`,
      severity: "high",
    });
  } else if (totalLines > 200) {
    risks.push({
      category: "large-change",
      description: `Moderate change: ${totalLines} lines modified`,
      severity: "medium",
    });
  }

  // test-gap: .ts files without corresponding .test.ts
  const tsFiles = changedFiles.filter(
    (f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.endsWith(".d.ts"),
  );
  const testFiles = new Set(changedFiles.filter((f) => f.endsWith(".test.ts")));

  for (const tsFile of tsFiles) {
    const expectedTest = tsFile.replace(/\.ts$/, ".test.ts");
    if (!testFiles.has(expectedTest)) {
      risks.push({
        category: "test-gap",
        description: `No corresponding test change for: ${tsFile}`,
        severity: "medium",
      });
    }
  }

  return risks;
}
