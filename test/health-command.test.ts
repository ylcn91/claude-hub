import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import type { AccountHealth } from "../src/daemon/health-monitor";

const TEST_DIR = join(import.meta.dir, ".test-health-command");
const TEST_CONFIG = join(TEST_DIR, "config.json");

const origHubDir = process.env.AGENTCTL_DIR;

beforeEach(() => {
  process.env.AGENTCTL_DIR = TEST_DIR;
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  process.env.AGENTCTL_DIR = origHubDir;
  rmSync(TEST_DIR, { recursive: true, force: true });
});

function writeConfig(accounts: any[]) {
  writeFileSync(
    TEST_CONFIG,
    JSON.stringify({
      schemaVersion: 1,
      accounts,
      entire: { autoEnable: true },
      defaults: {
        launchInNewWindow: true,
        quotaPolicy: {
          plan: "max-5x",
          windowMs: 18000000,
          estimatedLimit: 225,
          source: "community-estimate",
        },
      },
    }),
  );
}

describe("healthCommand", () => {
  test("falls back to local HealthMonitor when no socket exists", async () => {
    writeConfig([
      { name: "alice", configDir: TEST_DIR, color: "#89b4fa", label: "Alice", provider: "claude-code" },
    ]);

    const { healthCommand } = await import("../src/services/cli-commands");
    const output = await healthCommand();

    // Should still work and show account info from local HealthMonitor
    expect(output).toContain("alice");
  });

  test("returns message when account is not found", async () => {
    writeConfig([
      { name: "bob", configDir: TEST_DIR, color: "#89b4fa", label: "Bob", provider: "claude-code" },
    ]);

    const { healthCommand } = await import("../src/services/cli-commands");
    const output = await healthCommand("nonexistent");

    expect(output).toContain("not found");
  });

  test("filters by specific account", async () => {
    writeConfig([
      { name: "alice", configDir: TEST_DIR, color: "#89b4fa", label: "Alice", provider: "claude-code" },
      { name: "bob", configDir: TEST_DIR, color: "#a6e3a1", label: "Bob", provider: "claude-code" },
    ]);

    const { healthCommand } = await import("../src/services/cli-commands");
    const output = await healthCommand("alice");

    expect(output).toContain("alice");
    expect(output).not.toContain("bob");
  });

  test("returns no accounts message when config is empty", async () => {
    writeConfig([]);

    const { healthCommand } = await import("../src/services/cli-commands");
    const output = await healthCommand();

    expect(output).toContain("No accounts configured");
  });

  test("uses daemon fetchHealthStatus when socket exists", async () => {
    writeConfig([
      { name: "alice", configDir: TEST_DIR, color: "#89b4fa", label: "Alice", provider: "claude-code" },
    ]);

    // Create a fake socket file so existsSync(getSockPath()) returns true
    const sockPath = join(TEST_DIR, "hub.sock");
    writeFileSync(sockPath, "");

    const daemonStatuses: AccountHealth[] = [
      {
        account: "alice",
        status: "healthy",
        connected: true,
        lastActivity: new Date().toISOString(),
        errorCount: 0,
        rateLimited: false,
        slaViolations: 0,
        updatedAt: new Date().toISOString(),
      },
    ];

    // Mock the health-loader module to return canned daemon data
    mock.module("../src/services/health-loader", () => ({
      fetchHealthStatus: async () => daemonStatuses,
    }));

    const { healthCommand } = await import("../src/services/cli-commands");
    const output = await healthCommand();

    expect(output).toContain("alice");
    expect(output).toContain("healthy");
    expect(output).toContain("connected");
  });

  test("falls back to local monitor when daemon returns empty", async () => {
    writeConfig([
      { name: "bob", configDir: TEST_DIR, color: "#a6e3a1", label: "Bob", provider: "claude-code" },
    ]);

    // Create a fake socket file
    const sockPath = join(TEST_DIR, "hub.sock");
    writeFileSync(sockPath, "");

    // Mock fetchHealthStatus to return empty (daemon has no data)
    mock.module("../src/services/health-loader", () => ({
      fetchHealthStatus: async () => [],
    }));

    const { healthCommand } = await import("../src/services/cli-commands");
    const output = await healthCommand();

    // Should fall through to local HealthMonitor and still show the account
    expect(output).toContain("bob");
  });
});
