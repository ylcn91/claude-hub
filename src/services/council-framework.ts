// Shared framework for council pipelines (analysis + verification)
// Extracts the common 3-stage pattern: collect -> peer rank -> chairman synthesize

import type { AccountConfig } from "../types";

// ── Types ──

export type LLMCaller = (account: string, systemPrompt: string, userPrompt: string) => Promise<string>;

export interface CouncilServiceConfig {
  members: string[];  // account names from config.accounts
  chairman: string;   // account name
  timeoutMs?: number;
}

export const DEFAULT_COUNCIL_CONFIG: CouncilServiceConfig = {
  members: [],
  chairman: "",
  timeoutMs: 120_000,
};

// ── JSON Parsing ──

export function parseJSONFromLLM(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    // Try extracting from markdown fenced blocks
    const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (fenceMatch) {
      try {
        return JSON.parse(fenceMatch[1].trim());
      } catch {
        return null;
      }
    }
    return null;
  }
}

// ── Provider Commands ──

interface ProviderCommand {
  cmd: string[];
  env: Record<string, string>;
  parseOutput: (stdout: string) => string;
}

export function buildProviderCommand(account: AccountConfig, _prompt: string): ProviderCommand {
  const baseEnv: Record<string, string> = {};

  switch (account.provider) {
    case "claude-code":
      return {
        cmd: ["claude", "-p", "--output-format", "json"],
        env: { ...baseEnv, CLAUDE_CONFIG_DIR: account.configDir },
        parseOutput: (stdout: string) => {
          try {
            const json = JSON.parse(stdout);
            return json.result ?? stdout;
          } catch {
            return stdout;
          }
        },
      };
    case "codex-cli":
      return {
        cmd: ["codex", "-q"],
        env: { ...baseEnv, CODEX_HOME: account.configDir },
        parseOutput: (stdout: string) => stdout,
      };
    case "opencode":
      return {
        cmd: ["opencode", "run"],
        env: baseEnv,
        parseOutput: (stdout: string) => stdout,
      };
    case "cursor-agent":
      return {
        cmd: ["agent"],
        env: baseEnv,
        parseOutput: (stdout: string) => stdout,
      };
    case "gemini-cli":
      return {
        cmd: ["gemini"],
        env: baseEnv,
        parseOutput: (stdout: string) => stdout,
      };
    case "openhands":
      return {
        cmd: ["openhands"],
        env: baseEnv,
        parseOutput: (stdout: string) => stdout,
      };
    default:
      throw new Error(`Unsupported provider: ${account.provider}`);
  }
}

export const DEFAULT_TIMEOUT_MS = 30_000;

export class LLMTimeoutError extends Error {
  public readonly account: string;
  public readonly timeoutMs: number;

  constructor(account: string, timeoutMs: number) {
    super(`Account ${account} LLM call timed out after ${timeoutMs}ms`);
    this.name = "LLMTimeoutError";
    this.account = account;
    this.timeoutMs = timeoutMs;
  }
}

export function createAccountCaller(accounts: AccountConfig[], timeoutMs?: number): LLMCaller {
  const accountMap = new Map<string, AccountConfig>();
  for (const acc of accounts) {
    accountMap.set(acc.name, acc);
  }

  const effectiveTimeout = timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return async (accountName: string, systemPrompt: string, userPrompt: string): Promise<string> => {
    const account = accountMap.get(accountName);
    if (!account) {
      throw new Error(`Account not found: ${accountName}`);
    }

    const prompt = `${systemPrompt}\n\n${userPrompt}`;
    const { cmd, env, parseOutput } = buildProviderCommand(account, prompt);

    const proc = Bun.spawn(cmd, {
      stdin: new Response(prompt).body,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, ...env },
    });

    let timerId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timerId = setTimeout(() => {
        proc.kill();
        reject(new LLMTimeoutError(accountName, effectiveTimeout));
      }, effectiveTimeout);
    });

    const resultPromise = (async () => {
      const stdout = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;

      if (exitCode !== 0) {
        const stderr = await new Response(proc.stderr).text();
        throw new Error(`Account ${accountName} CLI exited with code ${exitCode}: ${stderr.slice(0, 500)}`);
      }

      return parseOutput(stdout.trim());
    })();

    try {
      return await Promise.race([resultPromise, timeoutPromise]);
    } finally {
      clearTimeout(timerId);
    }
  };
}

// ── Pipeline Utilities ──

const LABELS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/**
 * Run LLM calls in parallel across accounts, collecting successful results.
 * Failed calls are silently filtered out (Promise.allSettled pattern).
 */
export async function collectFromAccounts<T>(
  accounts: string[],
  fn: (account: string) => Promise<T>,
): Promise<T[]> {
  const results = await Promise.allSettled(accounts.map(fn));
  const fulfilled: T[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") {
      fulfilled.push(r.value);
    }
  }
  return fulfilled;
}

/**
 * Format items with anonymized labels (A, B, C...) for peer review prompts.
 */
export function anonymizeForPeerReview(
  items: { fields: Record<string, string | string[]> }[],
  labelPrefix: string,
): string {
  return items
    .map((item, i) => {
      const lines = Object.entries(item.fields).map(([key, value]) => {
        const formatted = Array.isArray(value) ? value.join(", ") || "none" : value;
        return `- ${key}: ${formatted}`;
      });
      return `${labelPrefix} ${LABELS[i]}:\n${lines.join("\n")}`;
    })
    .join("\n\n");
}
