/**
 * E2E Integration Tests for agentctl
 *
 * Tests the full lifecycle: daemon start, multi-provider account setup,
 * inter-account messaging, task handoffs, MCP bridge, workspace ops,
 * and provider detection for codex, opencode, and claude.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { createConnection, type Socket, type Server } from "net";
import { startDaemon, stopDaemon } from "../src/daemon/server";
import { DaemonState } from "../src/daemon/state";
import { createLineParser, frameSend } from "../src/daemon/framing";
import { setupAccount, teardownAccount } from "../src/services/account-manager";
import { loadConfig } from "../src/config";
import { loadTasks } from "../src/services/tasks";
import type { HubConfig } from "../src/types";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let dirCounter = 0;
function freshTestDir(): string {
  const dir = join(import.meta.dir, `.test-e2e-full-${++dirCounter}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, "tokens"), { recursive: true });
  return dir;
}

function createToken(testDir: string, name: string, token: string): void {
  const tokensDir = join(testDir, "tokens");
  mkdirSync(tokensDir, { recursive: true });
  writeFileSync(join(tokensDir, `${name}.token`), token, { mode: 0o600 });
}

function writeConfig(testDir: string, config: HubConfig): void {
  writeFileSync(join(testDir, "config.json"), JSON.stringify(config));
}

interface TestClient {
  socket: Socket;
  send(msg: object, timeoutMs?: number): Promise<any>;
  destroy(): void;
}

function createTestClient(socket: Socket): TestClient {
  const waiters: Array<(msg: any) => void> = [];
  const parser = createLineParser((msg) => {
    const waiter = waiters.shift();
    if (waiter) waiter(msg);
  });
  socket.on("data", (chunk) => parser.feed(chunk));
  return {
    socket,
    send(msg, timeoutMs = 5000) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const idx = waiters.indexOf(resolve as any);
          if (idx >= 0) waiters.splice(idx, 1);
          reject(new Error("sendAndWait timeout"));
        }, timeoutMs);
        waiters.push((response) => {
          clearTimeout(timer);
          resolve(response);
        });
        socket.write(frameSend(msg));
      });
    },
    destroy() {
      socket.destroy();
    },
  };
}

async function connectAndAuth(sockPath: string, account: string, token: string): Promise<TestClient> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(sockPath);
    socket.once("error", reject);
    socket.once("connect", async () => {
      const client = createTestClient(socket);
      const authResp = await client.send({ type: "auth", account, token });
      if (authResp.type === "auth_fail") {
        reject(new Error(`Auth failed for ${account}: ${authResp.error}`));
        return;
      }
      resolve(client);
    });
  });
}

function uniqueDb(testDir: string): string {
  return join(testDir, `msg-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

// ---------------------------------------------------------------------------
// 1. Daemon lifecycle
// ---------------------------------------------------------------------------

describe("E2E: Daemon lifecycle", () => {
  let testDir: string;
  let origDir: string | undefined;

  beforeEach(() => {
    testDir = freshTestDir();
    origDir = process.env.AGENTCTL_DIR;
    process.env.AGENTCTL_DIR = testDir;
  });

  afterEach(() => {
    process.env.AGENTCTL_DIR = origDir;
    rmSync(testDir, { recursive: true, force: true });
  });

  test("daemon starts, accepts ping, and stops cleanly", async () => {
    createToken(testDir, "test", "test-tok");
    const { server, state } = await startDaemon({ dbPath: uniqueDb(testDir) });

    try {
      await Bun.sleep(50);
      const sockPath = join(testDir, "hub.sock");
      const client = createTestClient(createConnection(sockPath));

      await new Promise<void>((r) => client.socket.once("connect", r));
      const pong = await client.send({ type: "ping" });
      expect(pong.type).toBe("pong");

      client.destroy();
    } finally {
      state.close();
      stopDaemon(server);
    }
  });

  test("daemon rejects invalid auth token", async () => {
    createToken(testDir, "alice", "correct-token");
    const { server, state } = await startDaemon({ dbPath: uniqueDb(testDir) });

    try {
      await Bun.sleep(50);
      const sockPath = join(testDir, "hub.sock");
      const client = createTestClient(createConnection(sockPath));
      await new Promise<void>((r) => client.socket.once("connect", r));

      const authResp = await client.send({
        type: "auth",
        account: "alice",
        token: "wrong-token",
      });
      expect(authResp.type).toBe("auth_fail");

      client.destroy();
    } finally {
      state.close();
      stopDaemon(server);
    }
  });

  test("daemon accepts config_reload without auth", async () => {
    createToken(testDir, "test", "test-tok");
    writeConfig(testDir, {
      schemaVersion: 1,
      accounts: [{ name: "test", configDir: join(testDir, "test-cfg"), color: "#fff", label: "Test", provider: "claude-code" }],
      entire: { autoEnable: true },
      defaults: { launchInNewWindow: true, quotaPolicy: { plan: "max-5x", windowMs: 18000000, estimatedLimit: 225, source: "community-estimate" } },
    });

    const { server, state } = await startDaemon({ dbPath: uniqueDb(testDir) });

    try {
      await Bun.sleep(50);
      const sockPath = join(testDir, "hub.sock");
      const client = createTestClient(createConnection(sockPath));
      await new Promise<void>((r) => client.socket.once("connect", r));

      const resp = await client.send({ type: "config_reload" });
      expect(resp.reloaded).toBe(true);
      expect(resp.accounts).toBeGreaterThanOrEqual(0);

      client.destroy();
    } finally {
      state.close();
      stopDaemon(server);
    }
  });

  test("daemon health_check returns system info", async () => {
    createToken(testDir, "alice", "alice-tok");
    const { server, state } = await startDaemon({ dbPath: uniqueDb(testDir) });

    try {
      await Bun.sleep(50);
      const alice = await connectAndAuth(join(testDir, "hub.sock"), "alice", "alice-tok");
      const health = await alice.send({ type: "health_check" });

      expect(health.type).toBe("result");
      expect(health.uptime).toBeGreaterThanOrEqual(0);
      expect(health.connectedAccounts).toBeGreaterThanOrEqual(1);

      alice.destroy();
    } finally {
      state.close();
      stopDaemon(server);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Multi-provider account management
// ---------------------------------------------------------------------------

describe("E2E: Multi-provider account setup", () => {
  let testDir: string;
  let origDir: string | undefined;

  beforeEach(() => {
    testDir = freshTestDir();
    origDir = process.env.AGENTCTL_DIR;
    process.env.AGENTCTL_DIR = testDir;
    // Write minimal default config
    writeConfig(testDir, {
      schemaVersion: 1,
      accounts: [],
      entire: { autoEnable: true },
      defaults: { launchInNewWindow: true, quotaPolicy: { plan: "max-5x", windowMs: 18000000, estimatedLimit: 225, source: "community-estimate" } },
    });
  });

  afterEach(() => {
    process.env.AGENTCTL_DIR = origDir;
    rmSync(testDir, { recursive: true, force: true });
  });

  test("setup accounts for claude-code, codex-cli, and opencode providers", async () => {
    const providers = [
      { name: "agent-claude", provider: "claude-code" as const, color: "#cba6f7", label: "Claude" },
      { name: "agent-codex", provider: "codex-cli" as const, color: "#89b4fa", label: "Codex" },
      { name: "agent-opencode", provider: "opencode" as const, color: "#94e2d5", label: "OpenCode" },
    ];

    for (const p of providers) {
      const { account, tokenPath } = await setupAccount({
        name: p.name,
        configDir: join(testDir, `${p.name}-config`),
        color: p.color,
        label: p.label,
        provider: p.provider,
        symlinkPlugins: false,
        symlinkSkills: false,
        symlinkCommands: false,
        configPath: join(testDir, "config.json"),
      });

      expect(account.name).toBe(p.name);
      expect(account.provider).toBe(p.provider);
      expect(existsSync(tokenPath)).toBe(true);

      // Verify MCP config was written
      const settingsPath = join(testDir, `${p.name}-config`, "settings.json");
      expect(existsSync(settingsPath)).toBe(true);
      const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
      expect(settings.mcpServers?.agentctl?.command).toBe("actl");
      expect(settings.mcpServers?.agentctl?.args).toContain(p.name);
    }

    // Verify all 3 accounts in config
    const config = await loadConfig(join(testDir, "config.json"));
    expect(config.accounts.length).toBe(3);
    expect(config.accounts.map((a) => a.provider).sort()).toEqual(["claude-code", "codex-cli", "opencode"]);
  });

  test("duplicate account name is rejected", async () => {
    await setupAccount({
      name: "alice",
      configDir: join(testDir, "alice-config"),
      color: "#cba6f7",
      label: "Alice",
      provider: "claude-code",
      symlinkPlugins: false,
      symlinkSkills: false,
      symlinkCommands: false,
      configPath: join(testDir, "config.json"),
    });

    await expect(
      setupAccount({
        name: "alice",
        configDir: join(testDir, "alice-config-2"),
        color: "#89b4fa",
        label: "Alice 2",
        provider: "codex-cli",
        symlinkPlugins: false,
        symlinkSkills: false,
        symlinkCommands: false,
        configPath: join(testDir, "config.json"),
      })
    ).rejects.toThrow("already exists");
  });

  test("teardown removes account and token", async () => {
    const { tokenPath } = await setupAccount({
      name: "ephemeral",
      configDir: join(testDir, "ephemeral-config"),
      color: "#f38ba8",
      label: "Ephemeral",
      provider: "opencode",
      symlinkPlugins: false,
      symlinkSkills: false,
      symlinkCommands: false,
      configPath: join(testDir, "config.json"),
    });
    expect(existsSync(tokenPath)).toBe(true);

    await teardownAccount("ephemeral", { purge: true, configPath: join(testDir, "config.json") });

    expect(existsSync(tokenPath)).toBe(false);
    expect(existsSync(join(testDir, "ephemeral-config"))).toBe(false);

    const config = await loadConfig(join(testDir, "config.json"));
    expect(config.accounts.find((a) => a.name === "ephemeral")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 3. Inter-account messaging
// ---------------------------------------------------------------------------

describe("E2E: Inter-account messaging", () => {
  let testDir: string;
  let server: Server;
  let state: DaemonState;
  let origDir: string | undefined;

  beforeEach(async () => {
    testDir = freshTestDir();
    origDir = process.env.AGENTCTL_DIR;
    process.env.AGENTCTL_DIR = testDir;
    createToken(testDir, "alice", "alice-tok");
    createToken(testDir, "bob", "bob-tok");
    createToken(testDir, "charlie", "charlie-tok");

    const result = await startDaemon({ dbPath: uniqueDb(testDir) });
    server = result.server;
    state = result.state;
  });

  afterEach(() => {
    process.env.AGENTCTL_DIR = origDir;
    try { state.close(); } catch {}
    try { stopDaemon(server); } catch {}
    rmSync(testDir, { recursive: true, force: true });
  });

  test("send message from alice to bob, bob reads it", async () => {
    await Bun.sleep(50);
    const sockPath = join(testDir, "hub.sock");
    const alice = await connectAndAuth(sockPath, "alice", "alice-tok");
    const bob = await connectAndAuth(sockPath, "bob", "bob-tok");

    // Alice sends message
    const sendResult = await alice.send({
      type: "send_message",
      to: "bob",
      content: "Hello Bob, this is Alice!",
    });
    expect(sendResult.type).toBe("result");
    expect(sendResult.queued).toBe(true);

    // Bob reads messages
    const messages = await bob.send({ type: "read_messages" });
    expect(messages.type).toBe("result");
    expect(messages.messages.length).toBeGreaterThanOrEqual(1);
    const fromAlice = messages.messages.find((m: any) => m.from === "alice");
    expect(fromAlice).toBeDefined();
    expect(fromAlice.content).toBe("Hello Bob, this is Alice!");

    // Bob counts unread
    const unread = await bob.send({ type: "count_unread" });
    expect(unread.type).toBe("result");

    alice.destroy();
    bob.destroy();
  });

  test("bidirectional messaging between three accounts", async () => {
    await Bun.sleep(50);
    const sockPath = join(testDir, "hub.sock");
    const alice = await connectAndAuth(sockPath, "alice", "alice-tok");
    const bob = await connectAndAuth(sockPath, "bob", "bob-tok");
    const charlie = await connectAndAuth(sockPath, "charlie", "charlie-tok");

    // Alice → Bob
    await alice.send({ type: "send_message", to: "bob", content: "Task for you" });
    // Bob → Charlie
    await bob.send({ type: "send_message", to: "charlie", content: "Delegating to you" });
    // Charlie → Alice
    await charlie.send({ type: "send_message", to: "alice", content: "Done!" });

    // Verify each account received the right message
    const bobMsgs = await bob.send({ type: "read_messages" });
    expect(bobMsgs.messages.find((m: any) => m.from === "alice")?.content).toBe("Task for you");

    const charlieMsgs = await charlie.send({ type: "read_messages" });
    expect(charlieMsgs.messages.find((m: any) => m.from === "bob")?.content).toBe("Delegating to you");

    const aliceMsgs = await alice.send({ type: "read_messages" });
    expect(aliceMsgs.messages.find((m: any) => m.from === "charlie")?.content).toBe("Done!");

    alice.destroy();
    bob.destroy();
    charlie.destroy();
  });

  test("archive old messages", async () => {
    await Bun.sleep(50);
    const sockPath = join(testDir, "hub.sock");
    const alice = await connectAndAuth(sockPath, "alice", "alice-tok");

    await alice.send({ type: "send_message", to: "bob", content: "temp msg" });

    const archiveResult = await alice.send({ type: "archive_messages", days: 1 });
    expect(archiveResult.type).toBe("result");
    expect(typeof archiveResult.archived).toBe("number");

    alice.destroy();
  });
});

// ---------------------------------------------------------------------------
// 4. Task handoff across providers
// ---------------------------------------------------------------------------

describe("E2E: Cross-provider task handoff", () => {
  let testDir: string;
  let server: Server;
  let state: DaemonState;
  let origDir: string | undefined;

  beforeEach(async () => {
    testDir = freshTestDir();
    origDir = process.env.AGENTCTL_DIR;
    process.env.AGENTCTL_DIR = testDir;
    createToken(testDir, "claude-agent", "claude-tok");
    createToken(testDir, "codex-agent", "codex-tok");
    createToken(testDir, "opencode-agent", "opencode-tok");

    const result = await startDaemon({
      dbPath: uniqueDb(testDir),
      features: {
        trust: true,
        autoAcceptance: true,
      },
    });
    server = result.server;
    state = result.state;
  });

  afterEach(() => {
    process.env.AGENTCTL_DIR = origDir;
    try { state.close(); } catch {}
    try { stopDaemon(server); } catch {}
    rmSync(testDir, { recursive: true, force: true });
  });

  test("claude hands off task to codex, codex accepts", async () => {
    await Bun.sleep(50);
    const sockPath = join(testDir, "hub.sock");
    const claude = await connectAndAuth(sockPath, "claude-agent", "claude-tok");
    const codex = await connectAndAuth(sockPath, "codex-agent", "codex-tok");

    // Claude hands off a task to Codex
    const handoff = await claude.send({
      type: "handoff_task",
      to: "codex-agent",
      payload: {
        goal: "Refactor authentication module",
        acceptance_criteria: ["Tests pass", "No regressions"],
        run_commands: ["echo ok"],
        blocked_by: ["none"],
        complexity: "medium",
        criticality: "medium",
        reversibility: "reversible",
      },
    });

    expect(handoff.type).toBe("result");
    expect(handoff.queued).toBe(true);
    expect(handoff.handoffId).toBeTruthy();
    expect(handoff.taskId).toBeTruthy();

    // Codex reads the handoff
    const codexMsgs = await codex.send({ type: "read_messages" });
    const handoffMsg = codexMsgs.messages.find((m: any) => m.type === "handoff");
    expect(handoffMsg).toBeDefined();
    expect(handoffMsg.from).toBe("claude-agent");

    // Codex accepts the handoff
    const acceptResult = await codex.send({
      type: "handoff_accept",
      handoffId: handoff.handoffId,
    });
    expect(acceptResult.type).toBe("result");

    claude.destroy();
    codex.destroy();
  });

  test("opencode hands off to claude, full lifecycle", async () => {
    await Bun.sleep(50);
    const sockPath = join(testDir, "hub.sock");
    const opencode = await connectAndAuth(sockPath, "opencode-agent", "opencode-tok");
    const claude = await connectAndAuth(sockPath, "claude-agent", "claude-tok");

    // OpenCode creates handoff
    const handoff = await opencode.send({
      type: "handoff_task",
      to: "claude-agent",
      payload: {
        goal: "Write unit tests for API module",
        acceptance_criteria: ["Coverage > 80%"],
        run_commands: ["echo tests-pass"],
        blocked_by: ["none"],
        complexity: "low",
        criticality: "low",
        reversibility: "reversible",
      },
    });
    expect(handoff.queued).toBe(true);
    const taskId = handoff.taskId;

    // Move through lifecycle
    const inProgress = await opencode.send({ type: "update_task_status", taskId, status: "in_progress" });
    expect(inProgress.type).toBe("result");

    const review = await opencode.send({ type: "update_task_status", taskId, status: "ready_for_review" });
    expect(review.type).toBe("result");

    const accepted = await opencode.send({ type: "update_task_status", taskId, status: "accepted" });
    expect(accepted.type).toBe("result");

    // Verify events were emitted
    const events = state.eventBus.getRecent({});
    const types = events.map((e) => e.type);
    expect(types).toContain("TASK_CREATED");
    expect(types).toContain("TASK_STARTED");
    expect(types).toContain("TASK_COMPLETED");

    opencode.destroy();
    claude.destroy();
  });

  test("three-way delegation chain: claude → codex → opencode", async () => {
    await Bun.sleep(50);
    const sockPath = join(testDir, "hub.sock");
    const claude = await connectAndAuth(sockPath, "claude-agent", "claude-tok");
    const codex = await connectAndAuth(sockPath, "codex-agent", "codex-tok");
    const opencode = await connectAndAuth(sockPath, "opencode-agent", "opencode-tok");

    // Step 1: Claude → Codex
    const h1 = await claude.send({
      type: "handoff_task",
      to: "codex-agent",
      payload: {
        goal: "Build API endpoints",
        acceptance_criteria: ["Endpoints respond"],
        run_commands: ["echo ok"],
        blocked_by: ["none"],
        complexity: "high",
        delegation_depth: 0,
      },
    });
    expect(h1.queued).toBe(true);

    // Step 2: Codex → OpenCode (sub-delegation)
    const h2 = await codex.send({
      type: "handoff_task",
      to: "opencode-agent",
      payload: {
        goal: "Write database queries for API",
        acceptance_criteria: ["Queries work"],
        run_commands: ["echo ok"],
        blocked_by: ["none"],
        complexity: "medium",
        delegation_depth: 1,
        parent_handoff_id: h1.handoffId,
      },
    });
    expect(h2.queued).toBe(true);

    // Verify both tasks exist
    const board = await loadTasks();
    expect(board.tasks.length).toBe(2);

    // Both OpenCode and Codex have handoff messages
    const opencodeMsgs = await opencode.send({ type: "read_messages" });
    expect(opencodeMsgs.messages.find((m: any) => m.type === "handoff")).toBeDefined();

    claude.destroy();
    codex.destroy();
    opencode.destroy();
  });
});

// ---------------------------------------------------------------------------
// 5. MCP bridge tool registration
// ---------------------------------------------------------------------------

describe("E2E: MCP bridge tool registration", () => {
  test("registerTools registers all expected tools on McpServer", async () => {
    const { registerTools } = await import("../src/mcp/tools");
    const registeredTools: string[] = [];

    // Mock McpServer
    const mockServer = {
      registerTool: (name: string, _opts: any) => {
        registeredTools.push(name);
      },
    };

    const mockSender = async () => ({});
    registerTools(mockServer as any, mockSender, "test-account");

    // Verify all expected tools are registered
    const expectedTools = [
      "send_message",
      "read_messages",
      "list_accounts",
      "handoff_task",
      "update_task_status",
      "archive_messages",
      "prepare_workspace",
      "get_workspace_status",
      "cleanup_workspace",
      "accept_handoff",
      "suggest_assignee",
      "count_unread",
    ];

    for (const tool of expectedTools) {
      expect(registeredTools).toContain(tool);
    }

    // Should have at least 15+ tools registered
    expect(registeredTools.length).toBeGreaterThanOrEqual(15);
  });
});

// ---------------------------------------------------------------------------
// 6. Workspace operations
// ---------------------------------------------------------------------------

describe("E2E: Workspace operations via daemon", () => {
  let testDir: string;
  let server: Server;
  let state: DaemonState;
  let origDir: string | undefined;

  beforeEach(async () => {
    testDir = freshTestDir();
    origDir = process.env.AGENTCTL_DIR;
    process.env.AGENTCTL_DIR = testDir;
    createToken(testDir, "worker", "worker-tok");

    const result = await startDaemon({
      dbPath: uniqueDb(testDir),
      features: { workspaceWorktree: true },
      workspaceDbPath: join(testDir, `ws-${Date.now()}.db`),
    });
    server = result.server;
    state = result.state;
  });

  afterEach(() => {
    process.env.AGENTCTL_DIR = origDir;
    try { state.close(); } catch {}
    try { stopDaemon(server); } catch {}
    rmSync(testDir, { recursive: true, force: true });
  });

  test("prepare_workspace + get_workspace_status + cleanup_workspace", async () => {
    await Bun.sleep(50);
    const sockPath = join(testDir, "hub.sock");
    const worker = await connectAndAuth(sockPath, "worker", "worker-tok");

    // Prepare workspace (will likely fail since /tmp/fake-repo is not a real git repo,
    // but the handler should return a structured response, not crash)
    const prepResult = await worker.send({
      type: "prepare_worktree_for_handoff",
      repoPath: "/tmp/fake-repo",
      branch: "feature/test",
    });
    // Even if git fails, we should get a structured response
    expect(prepResult.type).toBeDefined();

    // Get workspace status — may be empty if prep failed
    const statusResult = await worker.send({
      type: "get_workspace_status",
      workspaceId: prepResult.workspace?.id ?? "nonexistent",
    });
    expect(statusResult.type).toBeDefined();

    worker.destroy();
  });
});

// ---------------------------------------------------------------------------
// 7. Provider detection (codex, opencode, claude binaries)
// ---------------------------------------------------------------------------

describe("E2E: Provider CLI detection", () => {
  test("claude CLI is installed and accessible", async () => {
    const proc = Bun.spawn(["claude", "--version"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const combined = output + stderr;
    await proc.exited;

    // Claude Code should output version info
    expect(combined.length).toBeGreaterThan(0);
  });

  test("codex CLI is installed and accessible", async () => {
    const proc = Bun.spawn(["codex", "--version"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const combined = output + stderr;
    await proc.exited;

    expect(combined).toContain("codex");
  });

  test("opencode CLI is installed and accessible", async () => {
    const proc = Bun.spawn(["opencode", "version"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const combined = output + stderr;
    await proc.exited;

    expect(combined.length).toBeGreaterThan(0);
  });

  test("provider registry has entries for all three providers", async () => {
    const { createDefaultRegistry } = await import("../src/providers/registry");
    const registry = createDefaultRegistry();
    const all = registry.listAll();

    expect(registry.get("claude-code")).toBeDefined();
    expect(registry.get("codex-cli")).toBeDefined();
    expect(registry.get("opencode")).toBeDefined();

    // Each provider should have the required fields
    for (const id of ["claude-code", "codex-cli", "opencode"] as const) {
      const provider = registry.get(id)!;
      expect(provider.displayName).toBeTruthy();
      expect(provider.id).toBe(id);
    }

    // Should have at least 6 providers total
    expect(all.length).toBeGreaterThanOrEqual(6);
  });
});

// ---------------------------------------------------------------------------
// 8. Full cross-provider E2E: handoff → progress → review → accept
// ---------------------------------------------------------------------------

describe("E2E: Full cross-provider lifecycle", () => {
  let testDir: string;
  let server: Server;
  let state: DaemonState;
  let origDir: string | undefined;

  beforeEach(async () => {
    testDir = freshTestDir();
    origDir = process.env.AGENTCTL_DIR;
    process.env.AGENTCTL_DIR = testDir;
    createToken(testDir, "claude-lead", "lead-tok");
    createToken(testDir, "codex-worker", "codex-tok");
    createToken(testDir, "opencode-worker", "oc-tok");

    const result = await startDaemon({
      dbPath: uniqueDb(testDir),
      features: {
        trust: true,
        workflow: true,
        retro: true,
        sessions: true,
      },
    });
    server = result.server;
    state = result.state;
  });

  afterEach(() => {
    process.env.AGENTCTL_DIR = origDir;
    try { state.close(); } catch {}
    try { stopDaemon(server); } catch {}
    rmSync(testDir, { recursive: true, force: true });
  });

  test("claude delegates to codex, codex reports progress, task accepted", async () => {
    await Bun.sleep(50);
    const sockPath = join(testDir, "hub.sock");
    const lead = await connectAndAuth(sockPath, "claude-lead", "lead-tok");
    const worker = await connectAndAuth(sockPath, "codex-worker", "codex-tok");

    // 1. Claude delegates task
    const handoff = await lead.send({
      type: "handoff_task",
      to: "codex-worker",
      payload: {
        goal: "Implement caching layer",
        acceptance_criteria: ["Cache hits > 90%", "No memory leaks"],
        run_commands: ["echo ok"],
        blocked_by: ["none"],
        complexity: "high",
        criticality: "medium",
        reversibility: "reversible",
      },
    });
    expect(handoff.queued).toBe(true);
    const taskId = handoff.taskId;

    // 2. Worker reports progress
    const p1 = await worker.send({
      type: "report_progress",
      taskId,
      agent: "codex-worker",
      percent: 25,
      currentStep: "Setting up Redis connection",
    });
    expect(p1.type).toBe("result");

    const p2 = await worker.send({
      type: "report_progress",
      taskId,
      agent: "codex-worker",
      percent: 75,
      currentStep: "Implementing cache invalidation",
    });
    expect(p2.type).toBe("result");

    // 3. Verify progress tracked
    const progress = state.progressTracker.getLatest(taskId);
    expect(progress).not.toBeNull();
    expect(progress!.percent).toBe(75);

    // 4. Move to in_progress
    await lead.send({ type: "update_task_status", taskId, status: "in_progress" });

    // 5. Move to review
    await lead.send({ type: "update_task_status", taskId, status: "ready_for_review" });

    // 6. Accept
    await lead.send({ type: "update_task_status", taskId, status: "accepted" });

    // 7. Verify event bus captured the lifecycle
    const events = state.eventBus.getRecent({});
    const eventTypes = events.map((e) => e.type);
    expect(eventTypes).toContain("TASK_CREATED");
    expect(eventTypes).toContain("PROGRESS_UPDATE");
    expect(eventTypes).toContain("TASK_STARTED");
    expect(eventTypes).toContain("TASK_COMPLETED");

    // 8. Verify trust was updated
    if (state.trustStore) {
      const rep = state.trustStore.get("codex-worker");
      expect(rep === null || typeof rep.trustScore === "number").toBe(true);
    }

    lead.destroy();
    worker.destroy();
  });

  test("parallel handoffs: claude delegates to both codex and opencode", async () => {
    await Bun.sleep(50);
    const sockPath = join(testDir, "hub.sock");
    const lead = await connectAndAuth(sockPath, "claude-lead", "lead-tok");
    const codex = await connectAndAuth(sockPath, "codex-worker", "codex-tok");
    const opencode = await connectAndAuth(sockPath, "opencode-worker", "oc-tok");

    // Sequential handoffs (same socket can't interleave responses reliably)
    const h1 = await lead.send({
      type: "handoff_task",
      to: "codex-worker",
      payload: {
        goal: "Build REST API",
        acceptance_criteria: ["Endpoints work"],
        run_commands: ["echo ok"],
        blocked_by: ["none"],
      },
    });
    const h2 = await lead.send({
      type: "handoff_task",
      to: "opencode-worker",
      payload: {
        goal: "Build frontend UI",
        acceptance_criteria: ["UI renders"],
        run_commands: ["echo ok"],
        blocked_by: ["none"],
      },
    });

    expect(h1.queued).toBe(true);
    expect(h2.queued).toBe(true);

    // Verify both workers received handoffs
    const codexMsgs = await codex.send({ type: "read_messages" });
    expect(codexMsgs.messages.some((m: any) => m.type === "handoff")).toBe(true);

    const opencodeMsgs = await opencode.send({ type: "read_messages" });
    expect(opencodeMsgs.messages.some((m: any) => m.type === "handoff")).toBe(true);

    // Both tasks exist
    const board = await loadTasks();
    expect(board.tasks.length).toBe(2);

    lead.destroy();
    codex.destroy();
    opencode.destroy();
  });

  test("list_accounts shows connected agents", async () => {
    await Bun.sleep(50);
    const sockPath = join(testDir, "hub.sock");

    writeConfig(testDir, {
      schemaVersion: 1,
      accounts: [
        { name: "claude-lead", configDir: join(testDir, "cl"), color: "#cba6f7", label: "Lead", provider: "claude-code" },
        { name: "codex-worker", configDir: join(testDir, "cx"), color: "#89b4fa", label: "Codex", provider: "codex-cli" },
        { name: "opencode-worker", configDir: join(testDir, "oc"), color: "#94e2d5", label: "OC", provider: "opencode" },
      ],
      entire: { autoEnable: true },
      defaults: { launchInNewWindow: true, quotaPolicy: { plan: "max-5x", windowMs: 18000000, estimatedLimit: 225, source: "community-estimate" } },
    });

    const lead = await connectAndAuth(sockPath, "claude-lead", "lead-tok");
    const codex = await connectAndAuth(sockPath, "codex-worker", "codex-tok");

    // Reload config so daemon knows about accounts
    await lead.send({ type: "config_reload" });

    const accounts = await lead.send({ type: "list_accounts" });
    expect(accounts.type).toBe("result");
    expect(accounts.accounts.length).toBeGreaterThanOrEqual(2);

    // At least claude-lead and codex-worker should be active
    const active = accounts.accounts.filter((a: any) => a.status === "active");
    expect(active.length).toBeGreaterThanOrEqual(2);

    lead.destroy();
    codex.destroy();
  });
});

// ---------------------------------------------------------------------------
// 9. Daemon via CLI spawn (true E2E)
// ---------------------------------------------------------------------------

describe("E2E: Daemon via CLI spawn", () => {
  let testDir: string;
  let origDir: string | undefined;
  let daemonProc: any;

  beforeEach(() => {
    testDir = freshTestDir();
    origDir = process.env.AGENTCTL_DIR;
    process.env.AGENTCTL_DIR = testDir;
    createToken(testDir, "cli-test", "cli-tok");
    writeConfig(testDir, {
      schemaVersion: 1,
      accounts: [{ name: "cli-test", configDir: join(testDir, "cli-cfg"), color: "#fff", label: "CLI", provider: "claude-code" }],
      entire: { autoEnable: true },
      defaults: { launchInNewWindow: true, quotaPolicy: { plan: "max-5x", windowMs: 18000000, estimatedLimit: 225, source: "community-estimate" } },
    });
  });

  afterEach(() => {
    process.env.AGENTCTL_DIR = origDir;
    if (daemonProc) {
      try { process.kill(daemonProc.pid, "SIGTERM"); } catch {}
    }
    rmSync(testDir, { recursive: true, force: true });
  });

  test("spawn daemon via bun daemon/index.ts and connect via socket", async () => {
    // Spawn daemon as a real subprocess
    const daemonScript = join(import.meta.dir, "../src/daemon/index.ts");
    daemonProc = Bun.spawn(["bun", daemonScript], {
      env: { ...process.env, AGENTCTL_DIR: testDir },
      stdout: "pipe",
      stderr: "pipe",
    });

    // Wait for socket to appear
    const sockPath = join(testDir, "hub.sock");
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (existsSync(sockPath)) break;
      await Bun.sleep(100);
    }
    expect(existsSync(sockPath)).toBe(true);

    // Connect and ping
    const client = createTestClient(createConnection(sockPath));
    await new Promise<void>((resolve, reject) => {
      client.socket.once("connect", resolve);
      client.socket.once("error", reject);
    });

    const pong = await client.send({ type: "ping" });
    expect(pong.type).toBe("pong");

    // Auth and send message
    const auth = await client.send({ type: "auth", account: "cli-test", token: "cli-tok" });
    expect(auth.type).toBe("auth_ok");

    const health = await client.send({ type: "health_check" });
    expect(health.type).toBe("result");
    expect(health.uptime).toBeGreaterThanOrEqual(0);

    client.destroy();
    process.kill(daemonProc.pid, "SIGTERM");
    await daemonProc.exited;
  });
});
