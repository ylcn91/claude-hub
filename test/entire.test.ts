import { describe, test, expect } from "bun:test";
import { isEntireInstalled, parseCheckpointMetadata } from "../src/services/entire";

describe("entire integration", () => {
  test("detects if entire CLI is installed", async () => {
    const installed = await isEntireInstalled();
    expect(typeof installed).toBe("boolean");
    // This test is environment-dependent - just verify it returns a boolean
  });

  test("parses checkpoint metadata JSON", () => {
    const raw = {
      checkpoint_id: "732abe6dd3e4",
      session_id: "uuid-123",
      strategy: "manual-commit",
      branch: "feat/auth",
      files_touched: ["src/auth.ts"],
      token_usage: { input_tokens: 163, output_tokens: 8557, api_call_count: 107 },
    };
    const parsed = parseCheckpointMetadata(raw);
    expect(parsed.checkpointId).toBe("732abe6dd3e4");
    expect(parsed.branch).toBe("feat/auth");
    expect(parsed.tokenUsage.outputTokens).toBe(8557);
  });

  test("parseCheckpointMetadata handles missing fields gracefully", () => {
    const parsed = parseCheckpointMetadata({});
    expect(parsed.checkpointId).toBe("");
    expect(parsed.branch).toBe("");
    expect(parsed.tokenUsage.outputTokens).toBe(0);
  });

  test("parseCheckpointMetadata handles null input", () => {
    const parsed = parseCheckpointMetadata(null);
    expect(parsed.checkpointId).toBe("");
  });
});
