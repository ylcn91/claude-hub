import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { $ } from "bun";
import { join } from "path";
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from "fs";
import { createConnection } from "net";
import { loadConfig, saveConfig, addAccount } from "../src/config";
import { ClaudeCodeProvider } from "../src/providers/claude-code";
import { startDaemon, stopDaemon, verifyAccountToken } from "../src/daemon/server";
import { DaemonState } from "../src/daemon/state";
import { atomicWrite, atomicRead } from "../src/services/file-store";
import { AutoLauncher, type AutoLaunchPolicy } from "../src/daemon/auto-launcher";
import type { Server } from "net";

const TEST_DIR = join(import.meta.dir, ".test-integration");
const CLI_PATH = join(import.meta.dir, "..", "src", "cli.tsx");

let intDbCounter = 0;
function uniqueDbPath(dir: string): string {
  return join(dir, `test-${++intDbCounter}-${Date.now()}.db`);
}

const origHubDir = process.env.CLAUDE_HUB_DIR;

beforeAll(() => {
  process.env.CLAUDE_HUB_DIR = TEST_DIR;
  mkdirSync(TEST_DIR, { recursive: true });
});

afterAll(() => {
  process.env.CLAUDE_HUB_DIR = origHubDir;
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("CLI integration", () => {
  test("ch --help shows usage", async () => {
    const result = await $`bun ${CLI_PATH} --help`.env({ ...process.env, CLAUDE_HUB_DIR: TEST_DIR }).quiet().nothrow();
    const output = result.stdout.toString();
    expect(output).toContain("Claude Hub");
    expect(output).toContain("ch");
  });

  test("ch add creates account", async () => {
    const configDir = join(TEST_DIR, "accounts", "test-work");
    const result = await $`bun ${CLI_PATH} add test-work --dir ${configDir} --color '#89b4fa' --label Work`
      .env({ ...process.env, CLAUDE_HUB_DIR: TEST_DIR })
      .quiet()
      .nothrow();

    const output = result.stdout.toString();
    expect(output).toContain("Account 'test-work' created");
    expect(existsSync(configDir)).toBe(true);

    // Token should exist
    const tokenPath = join(TEST_DIR, "tokens", "test-work.token");
    expect(existsSync(tokenPath)).toBe(true);

    // Config should have the account
    const config = JSON.parse(readFileSync(join(TEST_DIR, "config.json"), "utf-8"));
    expect(config.accounts.some((a: any) => a.name === "test-work")).toBe(true);
  });

  test("ch list shows accounts", async () => {
    const result = await $`bun ${CLI_PATH} list`
      .env({ ...process.env, CLAUDE_HUB_DIR: TEST_DIR })
      .quiet()
      .nothrow();
    const output = result.stdout.toString();
    expect(output).toContain("test-work");
    expect(output).toContain("Work");
  });

  test("ch status shows account status", async () => {
    const result = await $`bun ${CLI_PATH} status`
      .env({ ...process.env, CLAUDE_HUB_DIR: TEST_DIR })
      .quiet()
      .nothrow();
    const output = result.stdout.toString();
    expect(output).toContain("test-work");
  });

  test("ch usage shows usage table", async () => {
    const result = await $`bun ${CLI_PATH} usage`
      .env({ ...process.env, CLAUDE_HUB_DIR: TEST_DIR })
      .quiet()
      .nothrow();
    const output = result.stdout.toString();
    expect(output).toContain("Account");
    expect(output).toContain("Today");
    expect(output).toContain("test-work");
  });

  test("ch add rejects duplicate", async () => {
    const result = await $`bun ${CLI_PATH} add test-work --dir /tmp/dup --color '#ff0000' --label Dup`
      .env({ ...process.env, CLAUDE_HUB_DIR: TEST_DIR })
      .quiet()
      .nothrow();
    expect(result.exitCode).not.toBe(0);
    const stderr = result.stderr.toString();
    expect(stderr).toContain("already exists");
  });

  test("ch remove removes account", async () => {
    const result = await $`bun ${CLI_PATH} remove test-work`
      .env({ ...process.env, CLAUDE_HUB_DIR: TEST_DIR })
      .quiet()
      .nothrow();
    const output = result.stdout.toString();
    expect(output).toContain("Account 'test-work' removed");

    // Config should no longer have the account
    const config = JSON.parse(readFileSync(join(TEST_DIR, "config.json"), "utf-8"));
    expect(config.accounts.some((a: any) => a.name === "test-work")).toBe(false);
  });

  test("ch list shows no accounts after removal", async () => {
    const result = await $`bun ${CLI_PATH} list`
      .env({ ...process.env, CLAUDE_HUB_DIR: TEST_DIR })
      .quiet()
      .nothrow();
    const output = result.stdout.toString();
    expect(output).toContain("No accounts configured");
  });
});

describe("package.json", () => {
  test("bin.ch points to cli.tsx", () => {
    const pkg = JSON.parse(readFileSync(join(import.meta.dir, "..", "package.json"), "utf-8"));
    expect(pkg.bin?.ch).toBe("./src/cli.tsx");
  });
});

// --- Task #15: Integration tests ---

describe("config load/save round-trip", () => {
  const configPath = join(TEST_DIR, "roundtrip-config.json");

  afterAll(() => {
    try { rmSync(configPath, { force: true }); } catch {}
  });

  test("saves config and reloads with identical data", async () => {
    const config = await loadConfig(configPath);
    const withAccount = addAccount(config, {
      name: "integration-roundtrip",
      configDir: "/tmp/roundtrip",
      color: "#fab387",
      label: "Roundtrip",
      provider: "claude-code",
    });
    await saveConfig(withAccount, configPath);

    const reloaded = await loadConfig(configPath);
    expect(reloaded.schemaVersion).toBe(1);
    expect(reloaded.accounts).toHaveLength(1);
    expect(reloaded.accounts[0].name).toBe("integration-roundtrip");
    expect(reloaded.accounts[0].color).toBe("#fab387");
    expect(reloaded.accounts[0].label).toBe("Roundtrip");
    expect(reloaded.defaults.quotaPolicy.plan).toBe("max-5x");
  });

  test("round-trip preserves all default fields", async () => {
    const config = await loadConfig(configPath);
    expect(config.entire.autoEnable).toBe(true);
    expect(config.defaults.launchInNewWindow).toBe(true);
    expect(config.defaults.quotaPolicy.source).toBe("community-estimate");
    expect(config.defaults.quotaPolicy.estimatedLimit).toBe(225);
    expect(config.defaults.quotaPolicy.windowMs).toBe(5 * 60 * 60 * 1000);
  });
});

describe("stats parsing from fixtures", () => {
  const provider = new ClaudeCodeProvider();
  const fixturesDir = join(import.meta.dir, "fixtures");

  test("parses sample stats file with correct totals", async () => {
    const stats = await provider.parseStatsFromFile(
      join(fixturesDir, "stats-cache-sample.json"),
      "2026-02-12"
    );
    expect(stats.totalSessions).toBe(192);
    expect(stats.totalMessages).toBe(56139);
  });

  test("extracts today activity from fixture", async () => {
    const stats = await provider.parseStatsFromFile(
      join(fixturesDir, "stats-cache-sample.json"),
      "2026-02-12"
    );
    expect(stats.todayActivity).not.toBeNull();
    expect(stats.todayActivity!.messageCount).toBe(1508);
    expect(stats.todayActivity!.sessionCount).toBe(13);
    expect(stats.todayActivity!.toolCallCount).toBe(222);
  });

  test("extracts weekly activity from fixture", async () => {
    const stats = await provider.parseStatsFromFile(
      join(fixturesDir, "stats-cache-sample.json"),
      "2026-02-12"
    );
    expect(stats.weeklyActivity.length).toBeGreaterThan(0);
    expect(stats.weeklyActivity[0].date).toBe("2026-02-12");
    expect(stats.weeklyActivity[0].messageCount).toBe(1508);
  });

  test("extracts model usage from fixture", async () => {
    const stats = await provider.parseStatsFromFile(
      join(fixturesDir, "stats-cache-sample.json"),
      "2026-02-12"
    );
    expect(stats.modelUsage["claude-opus-4-6"]).toBeDefined();
    expect(stats.modelUsage["claude-opus-4-6"].inputTokens).toBe(46827);
    expect(stats.modelUsage["claude-opus-4-6"].outputTokens).toBe(202570);
  });

  test("returns null todayActivity for non-matching reference date", async () => {
    const stats = await provider.parseStatsFromFile(
      join(fixturesDir, "stats-cache-sample.json"),
      "2099-01-01"
    );
    expect(stats.todayActivity).toBeNull();
  });
});

describe("daemon start/stop lifecycle", () => {
  const daemonDir = join(TEST_DIR, "daemon-lifecycle");
  let server: Server;
  let daemonState: DaemonState;
  let originalHubDir: string | undefined;

  beforeEach(() => {
    originalHubDir = process.env.CLAUDE_HUB_DIR;
    process.env.CLAUDE_HUB_DIR = daemonDir;
    mkdirSync(join(daemonDir, "tokens"), { recursive: true });
    mkdirSync(join(daemonDir, "messages"), { recursive: true });
  });

  afterEach(() => {
    process.env.CLAUDE_HUB_DIR = originalHubDir;
    try { if (daemonState) daemonState.close(); } catch {}
    try { if (server) stopDaemon(server); } catch {}
    rmSync(daemonDir, { recursive: true, force: true });
  });

  test("daemon starts on unix socket and accepts connections", async () => {
    const result = startDaemon({ dbPath: uniqueDbPath(daemonDir) });
    server = result.server;
    daemonState = result.state;

    const sockPath = join(daemonDir, "hub.sock");
    expect(existsSync(sockPath)).toBe(true);

    // Verify PID file was written
    const pidPath = join(daemonDir, "daemon.pid");
    // Wait briefly for listen callback
    await Bun.sleep(50);
    expect(existsSync(pidPath)).toBe(true);
    const pid = parseInt(readFileSync(pidPath, "utf-8").trim(), 10);
    expect(pid).toBe(process.pid);

    // Verify we can connect
    const connected = await new Promise<boolean>((resolve) => {
      const client = createConnection(sockPath, () => {
        client.destroy();
        resolve(true);
      });
      client.on("error", () => resolve(false));
    });
    expect(connected).toBe(true);
  });

  test("daemon stops cleanly and removes socket", async () => {
    const result = startDaemon({ dbPath: uniqueDbPath(daemonDir) });
    server = result.server;
    daemonState = result.state;
    const sockPath = join(daemonDir, "hub.sock");

    await Bun.sleep(50);
    expect(existsSync(sockPath)).toBe(true);

    daemonState.close();
    daemonState = null as any;
    stopDaemon(server);
    // After stop, socket should be cleaned up
    expect(existsSync(sockPath)).toBe(false);
    // Mark server as stopped so afterEach doesn't try to stop again
    server = null as any;
  });

  test("daemon state tracks connected accounts after start", async () => {
    const result = startDaemon({ dbPath: uniqueDbPath(daemonDir) });
    server = result.server;
    daemonState = result.state;

    expect(result.state).toBeDefined();
    expect(result.state.getConnectedAccounts()).toEqual([]);
    result.state.connectAccount("test-acct", "tok");
    expect(result.state.getConnectedAccounts()).toEqual(["test-acct"]);
  });
});

describe("bridge connect + message send/receive through daemon", () => {
  const bridgeDir = join(TEST_DIR, "bridge-test");
  let server: Server;
  let state: DaemonState;
  let originalHubDir: string | undefined;

  beforeEach(() => {
    originalHubDir = process.env.CLAUDE_HUB_DIR;
    process.env.CLAUDE_HUB_DIR = bridgeDir;
    mkdirSync(join(bridgeDir, "tokens"), { recursive: true });
    mkdirSync(join(bridgeDir, "messages"), { recursive: true });

    // Create token files for test accounts
    writeFileSync(join(bridgeDir, "tokens", "alice.token"), "alice-secret");
    writeFileSync(join(bridgeDir, "tokens", "bob.token"), "bob-secret");

    const result = startDaemon({ dbPath: uniqueDbPath(bridgeDir) });
    server = result.server;
    state = result.state;
  });

  afterEach(() => {
    process.env.CLAUDE_HUB_DIR = originalHubDir;
    try { state.close(); } catch {}
    try { stopDaemon(server); } catch {}
    rmSync(bridgeDir, { recursive: true, force: true });
  });

  function connectAndAuth(account: string, token: string): Promise<ReturnType<typeof createConnection>> {
    const sockPath = join(bridgeDir, "hub.sock");
    return new Promise((resolve, reject) => {
      const client = createConnection(sockPath, () => {
        client.write(JSON.stringify({ type: "auth", account, token }) + "\n");
      });
      client.once("data", (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === "auth_ok") {
          resolve(client);
        } else {
          client.destroy();
          reject(new Error(`Auth failed: ${msg.error}`));
        }
      });
      client.on("error", reject);
    });
  }

  function sendAndReceive(client: ReturnType<typeof createConnection>, msg: object): Promise<any> {
    return new Promise((resolve) => {
      client.once("data", (data) => resolve(JSON.parse(data.toString())));
      client.write(JSON.stringify(msg) + "\n");
    });
  }

  test("alice sends message to bob, bob reads it", async () => {
    await Bun.sleep(50); // wait for socket

    const alice = await connectAndAuth("alice", "alice-secret");
    const bob = await connectAndAuth("bob", "bob-secret");

    // Alice sends message to Bob
    const sendResult = await sendAndReceive(alice, {
      type: "send_message",
      to: "bob",
      content: "Hello Bob from integration test!",
    });
    expect(sendResult.queued).toBe(true);
    expect(sendResult.delivered).toBe(true); // Bob is connected

    // Bob reads messages
    const readResult = await sendAndReceive(bob, { type: "read_messages" });
    expect(readResult.messages).toHaveLength(1);
    expect(readResult.messages[0].content).toBe("Hello Bob from integration test!");
    expect(readResult.messages[0].from).toBe("alice");

    // Second read returns empty (messages are marked read)
    const readResult2 = await sendAndReceive(bob, { type: "read_messages" });
    expect(readResult2.messages).toHaveLength(0);

    alice.destroy();
    bob.destroy();
  });

  test("list_accounts shows connected clients", async () => {
    await Bun.sleep(50);

    const alice = await connectAndAuth("alice", "alice-secret");

    const listResult = await sendAndReceive(alice, { type: "list_accounts" });
    expect(listResult.accounts.length).toBeGreaterThanOrEqual(1);
    expect(listResult.accounts.some((a: any) => a.name === "alice")).toBe(true);

    alice.destroy();
  });

  test("handoff_task is delivered and persisted", async () => {
    await Bun.sleep(50);

    const alice = await connectAndAuth("alice", "alice-secret");

    const handoffPayload = {
      goal: "Deploy the auth module",
      acceptance_criteria: ["Auth endpoints respond correctly"],
      run_commands: ["bun test"],
      blocked_by: ["none"],
    };
    const handoffResult = await sendAndReceive(alice, {
      type: "handoff_task",
      to: "bob",
      payload: handoffPayload,
      context: { branch: "feat/auth", projectDir: "/projects/webapp" },
    });
    expect(handoffResult.queued).toBe(true);
    expect(handoffResult.handoffId).toBeDefined();
    expect(handoffResult.handoffId.length).toBeGreaterThan(0);

    // Verify in state
    const handoffs = state.getHandoffs("bob");
    expect(handoffs).toHaveLength(1);
    expect(handoffs[0].content).toBe(JSON.stringify(handoffPayload));
    expect(handoffs[0].type).toBe("handoff");

    alice.destroy();
  });
});

describe("10 concurrent atomic writes produce no data corruption", () => {
  const writeDir = join(TEST_DIR, "concurrent-writes");

  beforeEach(() => {
    mkdirSync(writeDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(writeDir, { recursive: true, force: true });
  });

  test("all concurrent writes complete without corruption", async () => {
    const filePath = join(writeDir, "concurrent.json");
    const writes = Array.from({ length: 10 }, (_, i) =>
      atomicWrite(filePath, { value: i, schemaVersion: 1, writer: `writer-${i}` })
    );
    await Promise.all(writes);

    const data = await atomicRead<{ value: number; schemaVersion: number; writer: string }>(filePath);
    expect(data).not.toBeNull();
    expect(data!.schemaVersion).toBe(1);
    expect(data!.value).toBeGreaterThanOrEqual(0);
    expect(data!.value).toBeLessThan(10);
    // Verify JSON is well-formed by re-reading raw
    const raw = readFileSync(filePath, "utf-8");
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  test("no temp files remain after concurrent writes", async () => {
    const filePath = join(writeDir, "clean.json");
    const writes = Array.from({ length: 10 }, (_, i) =>
      atomicWrite(filePath, { val: i })
    );
    await Promise.all(writes);

    const entries = Array.from(new Bun.Glob("*").scanSync(writeDir));
    const tmpFiles = entries.filter((e) => e.includes(".tmp."));
    expect(tmpFiles).toHaveLength(0);
  });

  test("concurrent writes to config file preserve structure", async () => {
    const configPath = join(writeDir, "config.json");
    const baseConfig = await loadConfig(configPath);

    const writes = Array.from({ length: 10 }, (_, i) => {
      const config = {
        ...baseConfig,
        accounts: [
          {
            name: `account-${i}`,
            configDir: `/tmp/acct-${i}`,
            color: "#cba6f7",
            label: `Acct ${i}`,
            provider: "claude-code" as const,
          },
        ],
      };
      return saveConfig(config, configPath);
    });
    await Promise.all(writes);

    const result = await loadConfig(configPath);
    expect(result.schemaVersion).toBe(1);
    expect(result.accounts).toHaveLength(1);
    // The last writer wins, but structure must be valid
    expect(result.accounts[0].name).toMatch(/^account-\d$/);
  });
});

describe("token auth: invalid token is rejected by daemon", () => {
  const authDir = join(TEST_DIR, "auth-test");
  let server: Server;
  let authState: DaemonState;
  let originalHubDir: string | undefined;

  beforeEach(() => {
    originalHubDir = process.env.CLAUDE_HUB_DIR;
    process.env.CLAUDE_HUB_DIR = authDir;
    mkdirSync(join(authDir, "tokens"), { recursive: true });
    mkdirSync(join(authDir, "messages"), { recursive: true });
    writeFileSync(join(authDir, "tokens", "valid-acct.token"), "correct-token");

    const result = startDaemon({ dbPath: uniqueDbPath(authDir) });
    server = result.server;
    authState = result.state;
  });

  afterEach(() => {
    process.env.CLAUDE_HUB_DIR = originalHubDir;
    try { authState.close(); } catch {}
    try { stopDaemon(server); } catch {}
    rmSync(authDir, { recursive: true, force: true });
  });

  test("valid token authenticates successfully", async () => {
    await Bun.sleep(50);
    const sockPath = join(authDir, "hub.sock");

    const result = await new Promise<any>((resolve, reject) => {
      const client = createConnection(sockPath, () => {
        client.write(JSON.stringify({ type: "auth", account: "valid-acct", token: "correct-token" }) + "\n");
      });
      client.once("data", (data) => {
        const msg = JSON.parse(data.toString());
        client.destroy();
        resolve(msg);
      });
      client.on("error", reject);
    });

    expect(result.type).toBe("auth_ok");
  });

  test("invalid token is rejected with auth_fail", async () => {
    await Bun.sleep(50);
    const sockPath = join(authDir, "hub.sock");

    const result = await new Promise<any>((resolve, reject) => {
      const client = createConnection(sockPath, () => {
        client.write(JSON.stringify({ type: "auth", account: "valid-acct", token: "wrong-token" }) + "\n");
      });
      client.once("data", (data) => {
        const msg = JSON.parse(data.toString());
        client.destroy();
        resolve(msg);
      });
      client.on("error", reject);
    });

    expect(result.type).toBe("auth_fail");
    expect(result.error).toContain("Invalid token");
  });

  test("nonexistent account token is rejected", async () => {
    await Bun.sleep(50);
    const sockPath = join(authDir, "hub.sock");

    const result = await new Promise<any>((resolve, reject) => {
      const client = createConnection(sockPath, () => {
        client.write(JSON.stringify({ type: "auth", account: "ghost", token: "any-token" }) + "\n");
      });
      client.once("data", (data) => {
        const msg = JSON.parse(data.toString());
        client.destroy();
        resolve(msg);
      });
      client.on("error", reject);
    });

    expect(result.type).toBe("auth_fail");
  });

  test("verifyAccountToken utility works correctly", () => {
    expect(verifyAccountToken("valid-acct", "correct-token")).toBe(true);
    expect(verifyAccountToken("valid-acct", "wrong")).toBe(false);
    expect(verifyAccountToken("nonexistent", "any")).toBe(false);
  });
});

describe("self-handoff is blocked by auto-launcher", () => {
  const policy: AutoLaunchPolicy = {
    maxSpawnsPerMinute: 5,
    deduplicationWindowMs: 30_000,
    selfHandoffBlocked: true,
    circuitBreaker: {
      failureThreshold: 3,
      cooldownMs: 5 * 60 * 1000,
    },
  };

  test("self-handoff from account to itself is blocked", () => {
    const launcher = new AutoLauncher(policy);
    const decision = launcher.canLaunch("claude-work", "claude-work");
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("self-handoff");
  });

  test("cross-account handoff is allowed", () => {
    const launcher = new AutoLauncher(policy);
    const decision = launcher.canLaunch("claude-work", "claude-admin");
    expect(decision.allowed).toBe(true);
  });

  test("self-handoff with selfHandoffBlocked=false is allowed", () => {
    const permissive = new AutoLauncher({ ...policy, selfHandoffBlocked: false });
    const decision = permissive.canLaunch("claude-work", "claude-work");
    expect(decision.allowed).toBe(true);
  });

  test("full integration: self-handoff blocked even after successful spawns", () => {
    const launcher = new AutoLauncher(policy);
    launcher.recordSpawn("claude-admin");
    launcher.expireDedupForTest("claude-admin");
    launcher.expireRateLimitForTest();

    // Self-handoff is still blocked regardless of spawn history
    const decision = launcher.canLaunch("claude-work", "claude-work");
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("self-handoff");
  });
});
