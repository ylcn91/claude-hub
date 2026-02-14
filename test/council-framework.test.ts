import { test, expect, describe } from "bun:test";
import {
  parseJSONFromLLM,
  buildProviderCommand,
  createAccountCaller,
  collectFromAccounts,
  anonymizeForPeerReview,
  DEFAULT_COUNCIL_CONFIG,
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
});
