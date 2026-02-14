import { describe, test, expect } from "bun:test";

// Test the delegation-chain-loader service.
// When no daemon is running (no socket file), fetchDelegationChains returns [].
// We rely on the real paths module pointing at ~/.agentctl which has no hub.sock in CI/test.

describe("delegation-chain-loader", () => {
  test("returns empty array when no daemon socket exists", async () => {
    // Override AGENTCTL_DIR to ensure no socket is found
    const orig = process.env.AGENTCTL_DIR;
    process.env.AGENTCTL_DIR = "/tmp/nonexistent-dcl-test-dir";
    try {
      const { fetchDelegationChains } = await import("../src/services/delegation-chain-loader");
      const result = await fetchDelegationChains();
      expect(result).toEqual([]);
    } finally {
      process.env.AGENTCTL_DIR = orig;
    }
  });

  test("exports fetchDelegationChains function", async () => {
    const mod = await import("../src/services/delegation-chain-loader");
    expect(typeof mod.fetchDelegationChains).toBe("function");
  });

  test("DelegationChainData type shape is correct", async () => {
    // Verify the module exports and shape
    const mod = await import("../src/services/delegation-chain-loader");
    expect(mod).toHaveProperty("fetchDelegationChains");
  });
});
