import { existsSync } from "fs";

export interface RunResult {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface AcceptanceResult {
  passed: boolean;
  results: RunResult[];
  summary: string;
}

export function evaluateResults(results: RunResult[]): AcceptanceResult {
  if (results.length === 0) {
    return { passed: true, results: [], summary: "0 commands (vacuous pass)" };
  }

  const total = results.length;
  const failed = results.filter((r) => r.exitCode !== 0);
  const passed = total - failed.length;

  if (failed.length === 0) {
    return { passed: true, results, summary: `${total}/${total} commands passed` };
  }

  const failedNames = failed.map((r) => r.command).join(", ");
  return {
    passed: false,
    results,
    summary: `${passed}/${total} passed, failed: ${failedNames}`,
  };
}

export async function runAcceptanceSuite(
  commands: string[],
  workDir: string,
  opts?: { timeoutMs?: number },
): Promise<AcceptanceResult> {
  if (!existsSync(workDir)) {
    throw new Error(`workDir does not exist: ${workDir}`);
  }

  if (commands.length === 0) {
    return evaluateResults([]);
  }

  const timeoutMs = opts?.timeoutMs ?? 60_000;
  const results: RunResult[] = [];

  for (const command of commands) {
    const start = Date.now();
    const proc = Bun.spawn(["sh", "-c", command], {
      cwd: workDir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const timeoutPromise = new Promise<"timeout">((resolve) =>
      setTimeout(() => resolve("timeout"), timeoutMs),
    );

    const processPromise = proc.exited;
    const race = await Promise.race([processPromise, timeoutPromise]);

    if (race === "timeout") {
      proc.kill();
      results.push({
        command,
        exitCode: -1,
        stdout: "",
        stderr: "Command timed out",
        durationMs: Date.now() - start,
      });
    } else {
      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      results.push({
        command,
        exitCode: proc.exitCode ?? 1,
        stdout,
        stderr,
        durationMs: Date.now() - start,
      });
    }
  }

  return evaluateResults(results);
}
