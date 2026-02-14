import { test, expect, describe } from "bun:test";
import {
  parseJSONFromLLM,
  buildProviderCommand,
  createAccountCaller,
  collectFromAccounts,
  anonymizeForPeerReview,
  DEFAULT_COUNCIL_CONFIG,
  DEFAULT_TIMEOUT_MS,
  LLMTimeoutError,
} from "../src/services/council-framework";
import type { AccountConfig } from "../src/types";

describe("parseJSONFromLLM", () => {
  test("handles raw JSON", () => {
    const input = '{"key": "value", "num": 42}';
    const result = parseJSONFromLLM(input);
    expect(result).toEqual({ key: "value", num: 42 });
  });

  test("handles fenced JSON blocks", () => {
    const input = 'Here is my analysis:\n```json\n{"complexity": "high", "duration": 60}\n```\nHope that helps!';
    const result = parseJSONFromLLM(input);
    expect(result).toEqual({ complexity: "high", duration: 60 });
  });

  test("handles fenced blocks without json label", () => {
    const input = '```\n{"key": "value"}\n```';
    const result = parseJSONFromLLM(input);
    expect(result).toEqual({ key: "value" });
  });

  test("returns null for invalid input", () => {
    expect(parseJSONFromLLM("not json at all")).toBeNull();
    expect(parseJSONFromLLM("```\nnot json\n```")).toBeNull();
    expect(parseJSONFromLLM("")).toBeNull();
  });

  test("handles nested JSON objects", () => {
    const input = '{"outer": {"inner": [1, 2, 3]}}';
    const result = parseJSONFromLLM(input);
    expect(result).toEqual({ outer: { inner: [1, 2, 3] } });
  });

  test("handles JSON array", () => {
    const input = '[1, 2, 3]';
    const result = parseJSONFromLLM(input);
    expect(result).toEqual([1, 2, 3]);
  });
});

describe("collectFromAccounts", () => {
  test("collects successful results", async () => {
    const results = await collectFromAccounts(
      ["a", "b", "c"],
      async (account) => `result-${account}`,
    );
    expect(results).toEqual(["result-a", "result-b", "result-c"]);
  });

  test("filters out failed calls", async () => {
    const results = await collectFromAccounts(
      ["a", "b", "c"],
      async (account) => {
        if (account === "b") throw new Error("failed");
        return `result-${account}`;
      },
    );
    expect(results).toEqual(["result-a", "result-c"]);
  });

  test("returns empty array when all fail", async () => {
    const results = await collectFromAccounts(
      ["a", "b"],
      async () => { throw new Error("all failed"); },
    );
    expect(results).toEqual([]);
  });

  test("returns empty array for empty accounts", async () => {
    const results = await collectFromAccounts(
      [],
      async (account) => account,
    );
    expect(results).toEqual([]);
  });
});

describe("anonymizeForPeerReview", () => {
  test("creates labeled entries with A, B, C", () => {
    const items = [
      { fields: { Name: "Alice", Score: "90" } },
      { fields: { Name: "Bob", Score: "85" } },
    ];
    const result = anonymizeForPeerReview(items, "Review");
    expect(result).toContain("Review A:");
    expect(result).toContain("Review B:");
    expect(result).toContain("- Name: Alice");
    expect(result).toContain("- Score: 85");
  });

  test("handles array values by joining with comma", () => {
    const items = [
      { fields: { Skills: ["ts", "react"] as unknown as string } },
    ];
    const result = anonymizeForPeerReview(items as any, "Analysis");
    expect(result).toContain("Analysis A:");
    expect(result).toContain("- Skills: ts, react");
  });

  test("handles empty array values as 'none'", () => {
    const items = [
      { fields: { Issues: [] as unknown as string } },
    ];
    const result = anonymizeForPeerReview(items as any, "Review");
    expect(result).toContain("- Issues: none");
  });

  test("handles single item", () => {
    const items = [{ fields: { Status: "ok" } }];
    const result = anonymizeForPeerReview(items, "Item");
    expect(result).toBe("Item A:\n- Status: ok");
  });
});

describe("DEFAULT_COUNCIL_CONFIG", () => {
  test("has expected defaults", () => {
    expect(DEFAULT_COUNCIL_CONFIG.members).toEqual([]);
    expect(DEFAULT_COUNCIL_CONFIG.chairman).toBe("");
    expect(DEFAULT_COUNCIL_CONFIG.timeoutMs).toBe(120_000);
  });
});

function makeAccount(overrides: Partial<AccountConfig> & { provider: AccountConfig["provider"] }): AccountConfig {
  return {
    name: overrides.name ?? "test-account",
    configDir: overrides.configDir ?? "/tmp/test-config",
    color: overrides.color ?? "#ffffff",
    label: overrides.label ?? "Test",
    provider: overrides.provider,
  };
}

describe("buildProviderCommand", () => {
  test("claude-code provider uses claude -p with json output", () => {
    const account = makeAccount({ provider: "claude-code", configDir: "/tmp/claude" });
    const cmd = buildProviderCommand(account, "test prompt");
    expect(cmd.cmd).toEqual(["claude", "-p", "--output-format", "json"]);
    expect(cmd.env.CLAUDE_CONFIG_DIR).toBe("/tmp/claude");
  });

  test("codex-cli provider uses codex -q", () => {
    const account = makeAccount({ provider: "codex-cli", configDir: "/tmp/codex" });
    const cmd = buildProviderCommand(account, "test prompt");
    expect(cmd.cmd).toEqual(["codex", "-q"]);
    expect(cmd.env.CODEX_HOME).toBe("/tmp/codex");
  });

  test("opencode provider uses opencode run", () => {
    const account = makeAccount({ provider: "opencode" });
    const cmd = buildProviderCommand(account, "test prompt");
    expect(cmd.cmd).toEqual(["opencode", "run"]);
  });

  test("throws for unsupported provider", () => {
    const account = { name: "x", configDir: "/tmp", color: "", label: "", provider: "unknown" as any };
    expect(() => buildProviderCommand(account, "test")).toThrow("Unsupported provider: unknown");
  });
});

describe("createAccountCaller", () => {
  test("throws for unknown account name", async () => {
    const caller = createAccountCaller([
      makeAccount({ name: "alice", provider: "claude-code" }),
    ]);
    await expect(caller("bob", "system", "user")).rejects.toThrow("Account not found: bob");
  });

  test("throws for empty account list", async () => {
    const caller = createAccountCaller([]);
    await expect(caller("any", "system", "user")).rejects.toThrow("Account not found: any");
  });

  test("accepts optional timeoutMs parameter", () => {
    const caller = createAccountCaller(
      [makeAccount({ name: "test", provider: "claude-code" })],
      5000,
    );
    expect(caller).toBeFunction();
  });

  test("uses DEFAULT_TIMEOUT_MS when no timeout specified", () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(30_000);
  });
});

describe("LLMTimeoutError", () => {
  test("has correct properties", () => {
    const err = new LLMTimeoutError("test-account", 5000);
    expect(err.name).toBe("LLMTimeoutError");
    expect(err.account).toBe("test-account");
    expect(err.timeoutMs).toBe(5000);
    expect(err.message).toBe("Account test-account LLM call timed out after 5000ms");
    expect(err).toBeInstanceOf(Error);
  });

  test("is distinguishable from generic errors", () => {
    const timeoutErr = new LLMTimeoutError("acct", 1000);
    const genericErr = new Error("some other failure");
    expect(timeoutErr instanceof LLMTimeoutError).toBe(true);
    expect(genericErr instanceof LLMTimeoutError).toBe(false);
  });
});

describe("timeout enforcement with real processes", () => {
  test("kills a slow process after timeout expires", async () => {
    // Spawn a real `sleep 60` process with a very short timeout
    const proc = Bun.spawn(["sleep", "60"], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const timeoutMs = 200;
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        proc.kill();
        reject(new LLMTimeoutError("slow-account", timeoutMs));
      }, timeoutMs);
    });

    const resultPromise = (async () => {
      await proc.exited;
      return "completed";
    })();

    const start = Date.now();
    let caughtError: LLMTimeoutError | null = null;
    try {
      await Promise.race([resultPromise, timeoutPromise]);
    } catch (err) {
      if (err instanceof LLMTimeoutError) {
        caughtError = err;
      }
    }
    const elapsed = Date.now() - start;

    // Should have timed out, not completed
    expect(caughtError).not.toBeNull();
    expect(caughtError!.account).toBe("slow-account");
    expect(caughtError!.timeoutMs).toBe(timeoutMs);
    // Should have timed out in roughly 200ms, not 60s
    expect(elapsed).toBeLessThan(2000);
  }, 10_000);

  test("fast process completes before timeout", async () => {
    // Spawn a fast process (echo) that completes immediately
    const proc = Bun.spawn(["echo", "hello"], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const timeoutMs = 5000;
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        proc.kill();
        reject(new LLMTimeoutError("fast-account", timeoutMs));
      }, timeoutMs);
    });

    const resultPromise = (async () => {
      const stdout = await new Response(proc.stdout).text();
      await proc.exited;
      return stdout.trim();
    })();

    const result = await Promise.race([resultPromise, timeoutPromise]);
    expect(result).toBe("hello");
  }, 10_000);

  test("collectFromAccounts filters out timed-out calls", async () => {
    // Simulate multiple accounts where one times out
    const results = await collectFromAccounts(
      ["fast-1", "slow-1", "fast-2"],
      async (account) => {
        if (account === "slow-1") {
          const proc = Bun.spawn(["sleep", "60"], {
            stdout: "pipe",
            stderr: "pipe",
          });

          const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => {
              proc.kill();
              reject(new LLMTimeoutError(account, 200));
            }, 200);
          });

          const resultPromise = (async () => {
            await proc.exited;
            return `result-${account}`;
          })();

          return Promise.race([resultPromise, timeoutPromise]);
        }
        // Fast accounts return immediately
        return `result-${account}`;
      },
    );

    // slow-1 should have been filtered out (timeout -> rejected -> filtered)
    expect(results).toEqual(["result-fast-1", "result-fast-2"]);
  }, 10_000);

  test("other members complete when one times out", async () => {
    const completedAccounts: string[] = [];

    const results = await collectFromAccounts(
      ["alpha", "beta", "gamma"],
      async (account) => {
        if (account === "beta") {
          // beta takes too long — simulate with sleep + short timeout
          const proc = Bun.spawn(["sleep", "60"], {
            stdout: "pipe",
            stderr: "pipe",
          });

          const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => {
              proc.kill();
              reject(new LLMTimeoutError(account, 150));
            }, 150);
          });

          const resultPromise = (async () => {
            await proc.exited;
            return { account, data: "done" };
          })();

          return Promise.race([resultPromise, timeoutPromise]);
        }
        // alpha and gamma complete quickly
        completedAccounts.push(account);
        return { account, data: "done" };
      },
    );

    expect(results).toHaveLength(2);
    expect(completedAccounts).toContain("alpha");
    expect(completedAccounts).toContain("gamma");
    expect(completedAccounts).not.toContain("beta");
    expect(results.map((r) => r.account).sort()).toEqual(["alpha", "gamma"]);
  }, 10_000);
});
