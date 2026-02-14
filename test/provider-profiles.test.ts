import { test, expect, describe } from "bun:test";
import {
  calculateProviderFit,
  getProviderProfile,
  getAllProviderIds,
} from "../src/services/provider-profiles";

describe("getProviderProfile", () => {
  test("returns profile for claude-code", () => {
    const profile = getProviderProfile("claude-code");
    expect(profile).toBeDefined();
    expect(profile!.id).toBe("claude-code");
    expect(profile!.name).toBe("Claude Code");
    expect(profile!.contextWindow).toBe(200_000);
    expect(profile!.strengths).toContain("typescript");
    expect(profile!.strengths).toContain("refactoring");
    expect(profile!.strengths).toContain("testing");
    expect(profile!.strengths).toContain("architecture");
    expect(profile!.strengths).toContain("debugging");
  });

  test("returns profile for gemini-cli with 1M context", () => {
    const profile = getProviderProfile("gemini-cli");
    expect(profile).toBeDefined();
    expect(profile!.contextWindow).toBe(1_000_000);
    expect(profile!.strengths).toContain("python");
    expect(profile!.strengths).toContain("data-analysis");
    expect(profile!.strengths).toContain("multimodal");
  });

  test("returns profile for codex-cli", () => {
    const profile = getProviderProfile("codex-cli");
    expect(profile).toBeDefined();
    expect(profile!.contextWindow).toBe(200_000);
    expect(profile!.strengths).toContain("code-generation");
    expect(profile!.strengths).toContain("rapid-prototyping");
    expect(profile!.strengths).toContain("multi-file");
  });

  test("returns profile for openhands", () => {
    const profile = getProviderProfile("openhands");
    expect(profile).toBeDefined();
    expect(profile!.strengths).toContain("full-stack");
    expect(profile!.strengths).toContain("docker");
    expect(profile!.strengths).toContain("infrastructure");
  });

  test("returns profile for opencode", () => {
    const profile = getProviderProfile("opencode");
    expect(profile).toBeDefined();
    expect(profile!.strengths).toContain("go");
    expect(profile!.strengths).toContain("rust");
    expect(profile!.strengths).toContain("systems-programming");
    expect(profile!.strengths).toContain("performance");
  });

  test("returns profile for cursor-agent with 128k context", () => {
    const profile = getProviderProfile("cursor-agent");
    expect(profile).toBeDefined();
    expect(profile!.contextWindow).toBe(128_000);
    expect(profile!.strengths).toContain("frontend");
    expect(profile!.strengths).toContain("react");
    expect(profile!.strengths).toContain("css");
    expect(profile!.strengths).toContain("ui-design");
  });

  test("returns undefined for unknown provider", () => {
    expect(getProviderProfile("unknown-provider")).toBeUndefined();
  });

  test("returns undefined for empty string", () => {
    expect(getProviderProfile("")).toBeUndefined();
  });
});

describe("calculateProviderFit", () => {
  test("returns 100 when all skills match", () => {
    const fit = calculateProviderFit("claude-code", ["typescript", "testing"]);
    expect(fit).toBe(100);
  });

  test("returns 50 when half skills match", () => {
    const fit = calculateProviderFit("claude-code", ["typescript", "python"]);
    expect(fit).toBe(50);
  });

  test("returns 0 when no skills match", () => {
    const fit = calculateProviderFit("claude-code", ["python", "data-analysis"]);
    expect(fit).toBe(0);
  });

  test("returns 50 (neutral) when no skills are required", () => {
    const fit = calculateProviderFit("claude-code", []);
    expect(fit).toBe(50);
  });

  test("returns 0 for unknown provider", () => {
    const fit = calculateProviderFit("unknown", ["typescript"]);
    expect(fit).toBe(0);
  });

  test("returns correct proportion for partial match", () => {
    // gemini-cli: python, data-analysis, research, documentation, multimodal
    const fit = calculateProviderFit("gemini-cli", ["python", "data-analysis", "typescript"]);
    // 2/3 match = 67%
    expect(fit).toBe(67);
  });

  test("handles single skill match", () => {
    const fit = calculateProviderFit("opencode", ["go"]);
    expect(fit).toBe(100);
  });

  test("handles single skill no match", () => {
    const fit = calculateProviderFit("opencode", ["typescript"]);
    expect(fit).toBe(0);
  });
});

describe("getAllProviderIds", () => {
  test("returns all 6 provider IDs", () => {
    const ids = getAllProviderIds();
    expect(ids).toHaveLength(6);
    expect(ids).toContain("claude-code");
    expect(ids).toContain("gemini-cli");
    expect(ids).toContain("codex-cli");
    expect(ids).toContain("openhands");
    expect(ids).toContain("opencode");
    expect(ids).toContain("cursor-agent");
  });
});
