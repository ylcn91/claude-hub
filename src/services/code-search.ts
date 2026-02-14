import { loadConfig } from "../config";
import { existsSync } from "fs";

export interface SearchResult {
  account: string;
  file: string;
  line: number;
  content: string;
}

export interface SearchResponse {
  pattern: string;
  results: SearchResult[];
  totalMatches: number;
  searchedDirs: string[];
}

const MAX_PATTERN_LENGTH = 1000;

/**
 * Check if ripgrep is available on the system.
 */
async function isRipgrepAvailable(): Promise<boolean> {
  try {
    const proc = Bun.spawn(["rg", "--version"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc.exited;
    return proc.exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Search across account working directories using ripgrep.
 * Results are grouped by account.
 *
 * @param pattern - Search pattern (regex). Must be non-empty and <= 1000 chars.
 * @param targets - Optional account names to limit search to.
 * @param maxResults - Maximum number of results to return (default 100).
 * @param workspaceDirs - Optional map of account name -> directory paths to search.
 *   When provided, these directories are used instead of configDir from the config.
 */
export async function searchDirectories(
  pattern: string,
  targets?: string[],
  maxResults: number = 100,
  workspaceDirs?: Map<string, string[]>,
): Promise<SearchResponse> {
  if (!pattern || pattern.trim() === "") {
    return { pattern, results: [], totalMatches: 0, searchedDirs: [] };
  }

  if (pattern.length > MAX_PATTERN_LENGTH) {
    throw new Error(`Search pattern too long (${pattern.length} chars, max ${MAX_PATTERN_LENGTH})`);
  }

  // Check ripgrep availability before attempting search
  if (!await isRipgrepAvailable()) {
    throw new Error("ripgrep (rg) is not installed or not found in PATH. Install it with: brew install ripgrep");
  }

  const config = await loadConfig();
  const accounts = targets && targets.length > 0
    ? config.accounts.filter((a) => targets.includes(a.name))
    : config.accounts;

  const searchedDirs: string[] = [];
  const results: SearchResult[] = [];

  for (const account of accounts) {
    // Use workspace directories if provided, otherwise fall back to configDir
    let dirs: string[];
    if (workspaceDirs && workspaceDirs.has(account.name)) {
      dirs = workspaceDirs.get(account.name)!;
    } else {
      // Fallback: use configDir (but this searches config, not working dirs)
      const dir = account.configDir.replace(/^~/, process.env.HOME ?? "~");
      dirs = [dir];
    }

    for (const dir of dirs) {
      if (!existsSync(dir)) continue;
      searchedDirs.push(dir);

      try {
        // Use -- separator before pattern to prevent flag injection
        const proc = Bun.spawn(
          ["rg", "--json", "--max-count", String(maxResults), "--no-heading", "--", pattern, dir],
          { stdout: "pipe", stderr: "pipe" },
        );
        const output = await new Response(proc.stdout).text();
        const exitCode = await proc.exited;

        // rg exit code 1 = no matches (not an error), 2+ = actual error
        if (exitCode >= 2) {
          const stderr = await new Response(proc.stderr).text();
          throw new Error(`ripgrep failed with exit code ${exitCode}: ${stderr.trim()}`);
        }

        for (const line of output.split("\n")) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line);
            if (parsed.type === "match" && parsed.data?.submatches) {
              results.push({
                account: account.name,
                file: parsed.data.path?.text ?? "",
                line: parsed.data.line_number ?? 0,
                content: parsed.data.lines?.text?.trimEnd() ?? "",
              });
            }
          } catch {
            // Skip non-JSON lines
          }
          if (results.length >= maxResults) break;
        }
      } catch (err: any) {
        // Re-throw meaningful errors (ripgrep not installed, pattern too long, etc.)
        if (err.message?.includes("ripgrep")) throw err;
        // For other failures (e.g., spawn errors), wrap with context
        throw new Error(`Code search failed in ${dir}: ${err.message}`);
      }

      if (results.length >= maxResults) break;
    }

    if (results.length >= maxResults) break;
  }

  return {
    pattern,
    results: results.slice(0, maxResults),
    totalMatches: results.length,
    searchedDirs,
  };
}
