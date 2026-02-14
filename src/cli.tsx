#!/usr/bin/env bun
import React from "react";
import { render } from "ink";
import meow from "meow";
import { App } from "./app.js";

const cli = meow(
  `
  Usage
    $ actl                    Open TUI dashboard
    $ actl add <name>         Add new account
    $ actl remove <name>      Remove account
    $ actl rotate-token <name> Rotate account token
    $ actl daemon start       Start hub daemon
    $ actl daemon stop        Stop hub daemon
    $ actl daemon status      Show daemon status
    $ actl bridge --account   MCP bridge (internal)
    $ actl launch <name> [dir]  Quick-launch account
    $ actl config set <key> <value>  Set config value
    $ actl status             Show account status
    $ actl usage              Show usage table
    $ actl list               List accounts
    $ actl replay <session-id> Replay entire.io checkpoint

  Options
    --account  Account name (for bridge mode)
    --dir      Config directory (for add)
    --color    Hex color (for add)
    --label    Display label (for add)
    --purge    Remove config directory (for remove)
    --resume   Resume last session (for launch)
    --no-window  Print command instead of opening WezTerm (for launch)
    --bypass-permissions  Skip permission checks (for launch)
    --no-entire  Skip auto-enabling entire (for launch)
    --provider  Provider type (claude-code, codex-cli, openhands, gemini-cli, opencode, cursor-agent)
`,
  {
    importMeta: import.meta,
    autoHelp: false,
    flags: {
      help: { type: "boolean", default: false },
      account: { type: "string" },
      dir: { type: "string" },
      color: { type: "string" },
      label: { type: "string" },
      purge: { type: "boolean", default: false },
      resume: { type: "boolean", default: false },
      noWindow: { type: "boolean", default: false },
      bypassPermissions: { type: "boolean", default: false },
      noEntire: { type: "boolean", default: false },
      provider: { type: "string" },
      json: { type: "boolean", default: false },
      search: { type: "string" },
    },
  }
);

// Route --help to our custom help (with 91 art)
if (cli.flags.help) {
  const { showHelp } = await import("./services/help.js");
  console.log(showHelp());
  process.exit(0);
}

const [command, subcommand] = cli.input;

if (command === "daemon" && subcommand === "start") {
  const { ensureDaemonRunning } = await import("./mcp/bridge.js");
  try {
    await ensureDaemonRunning();
    console.log("agentctl daemon started (background)");
  } catch (e: any) {
    console.error(`Failed to start daemon: ${e.message}`);
    process.exit(1);
  }
} else if (command === "daemon" && subcommand === "status") {
  const { daemonStatusCommand } = await import("./daemon/server.js");
  console.log(daemonStatusCommand());
} else if (command === "daemon" && subcommand === "stop") {
  const { stopDaemonByPid } = await import("./daemon/server.js");
  stopDaemonByPid();
} else if (command === "daemon" && subcommand === "supervise") {
  const { startSupervisor } = await import("./daemon/supervisor.js");
  const { getSockPath } = await import("./paths.js");
  const DAEMON_SOCK = getSockPath();
  const daemonScript = new URL("./daemon/index.ts", import.meta.url).pathname;
  const supervisor = startSupervisor({ sockPath: DAEMON_SOCK, daemonScript });
  console.log("agentctl daemon supervisor started");
  process.on("SIGINT", async () => { await supervisor.stop(); process.exit(0); });
  process.on("SIGTERM", async () => { await supervisor.stop(); process.exit(0); });
} else if (command === "add") {
  const name = subcommand;
  if (!name) {
    console.error("Usage: actl add <name>");
    process.exit(1);
  }
  const { setupAccount, addShellAlias, CATPPUCCIN_COLORS } = await import("./services/account-manager.js");
  const { PROVIDER_IDS } = await import("./types.js");
  const dir = cli.flags.dir ?? `~/.claude-${name}`;
  const color = cli.flags.color ?? CATPPUCCIN_COLORS[0].hex;
  const label = cli.flags.label ?? name.charAt(0).toUpperCase() + name.slice(1);
  const providerFlag = cli.flags.provider;
  if (providerFlag && !PROVIDER_IDS.includes(providerFlag as any)) {
    console.error(`Invalid provider: ${providerFlag}. Valid: ${PROVIDER_IDS.join(", ")}`);
    process.exit(1);
  }
  try {
    const { account, tokenPath } = await setupAccount({
      name, configDir: dir, color, label,
      provider: (providerFlag as any) ?? "claude-code",
    });
    console.log(`Account '${name}' created.`);
    console.log(`  Config dir: ${dir}`);
    console.log(`  Token: ${tokenPath}`);
    const aliasResult = await addShellAlias(name, dir);
    if (aliasResult.modified) {
      console.log(`  Shell alias added to .zshrc`);
    }
  } catch (e: any) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
} else if (command === "remove") {
  const name = subcommand;
  if (!name) {
    console.error("Usage: actl remove <name>");
    process.exit(1);
  }
  const { teardownAccount } = await import("./services/account-manager.js");
  try {
    await teardownAccount(name, { purge: cli.flags.purge });
    console.log(`Account '${name}' removed.${cli.flags.purge ? " Config directory purged." : ""}`);
  } catch (e: any) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
} else if (command === "rotate-token") {
  const name = subcommand;
  if (!name) {
    console.error("Usage: actl rotate-token <name>");
    process.exit(1);
  }
  const { rotateToken } = await import("./services/account-manager.js");
  try {
    const { tokenPath } = await rotateToken(name);
    console.log(`Token rotated for account '${name}'.`);
    console.log(`  New token: ${tokenPath}`);
  } catch (e: any) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
} else if (command === "bridge" && cli.flags.account) {
  const { startBridge } = await import("./mcp/bridge.js");
  try {
    await startBridge(cli.flags.account);
  } catch (e: any) {
    console.error(`Bridge error: ${e.message}`);
    process.exit(1);
  }
} else if (command === "launch") {
  const name = subcommand;
  if (!name) {
    console.error("Usage: actl launch <name> [dir]");
    process.exit(1);
  }
  const dir = cli.input[2]; // optional third positional arg
  const { launchCommand } = await import("./services/cli-commands.js");
  try {
    const result = await launchCommand(name, dir, {
      resume: cli.flags.resume,
      noWindow: cli.flags.noWindow,
      bypassPermissions: cli.flags.bypassPermissions,
      noEntire: cli.flags.noEntire,
    });
    console.log(result);
  } catch (e: any) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
} else if (command === "status") {
  const { statusCommand } = await import("./services/cli-commands.js");
  console.log(await statusCommand());
} else if (command === "usage") {
  const { usageCommand } = await import("./services/cli-commands.js");
  console.log(await usageCommand());
} else if (command === "list") {
  const { listCommand } = await import("./services/cli-commands.js");
  console.log(await listCommand());
} else if (command === "find") {
  const pattern = subcommand;
  if (!pattern) {
    console.error("Usage: actl find <pattern>");
    process.exit(1);
  }
  const { findCommand } = await import("./services/cli-commands.js");
  console.log(await findCommand(pattern));
} else if (command === "config" && subcommand === "reload") {
  const { connect } = await import("net");
  const { existsSync } = await import("fs");
  const { getSockPath } = await import("./paths.js");
  const { createLineParser, generateRequestId, frameSend } = await import("./daemon/framing.js");
  const sockPath = getSockPath();
  if (!existsSync(sockPath)) {
    console.error("Daemon not running (no socket). Start with: actl daemon start");
    process.exit(1);
  }
  try {
    const result = await new Promise<{ reloaded: boolean; accounts: number }>((resolve, reject) => {
      const timeout = setTimeout(() => {
        try { socket.destroy(); } catch {}
        reject(new Error("Daemon did not respond within 2s"));
      }, 2000);

      const pending = new Map<string, { resolve: Function }>();

      const socket = connect(sockPath, () => {
        // config_reload uses ping (unauthenticated) pattern — but the daemon
        // requires auth for config_reload.  Use a simple ping-based approach:
        // Send a ping first, then config_reload after pong.
        const reloadId = generateRequestId();
        pending.set(reloadId, {
          resolve: (msg: any) => {
            clearTimeout(timeout);
            socket.end();
            if (msg.type === "error") {
              reject(new Error(msg.error));
            } else {
              resolve({ reloaded: msg.reloaded ?? true, accounts: msg.accounts ?? 0 });
            }
          },
        });
        socket.write(frameSend({ type: "config_reload", requestId: reloadId }));
      });

      const parser = createLineParser((msg: any) => {
        if (msg.requestId && pending.has(msg.requestId)) {
          const entry = pending.get(msg.requestId)!;
          pending.delete(msg.requestId);
          entry.resolve(msg);
        }
      });

      socket.on("data", (data: Buffer) => parser.feed(data));
      socket.on("error", (err: Error) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
    console.log(`Config reloaded via daemon (${result.accounts} accounts)`);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`Error: ${message}`);
    process.exit(1);
  }
} else if (command === "config" && subcommand === "set") {
  const key = cli.input[2];
  const val = cli.input[3];
  if (!key || val === undefined) {
    console.error("Usage: actl config set <key> <value>");
    process.exit(1);
  }
  const { setConfigValue } = await import("./config.js");
  try {
    const { oldValue, newValue } = await setConfigValue(key, val);
    console.log(`${key}: ${JSON.stringify(oldValue)} → ${JSON.stringify(newValue)}`);
  } catch (e: any) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
} else if (command === "search") {
  const pattern = subcommand;
  if (!pattern) {
    console.error("Usage: actl search <pattern>");
    process.exit(1);
  }
  const { searchCommand } = await import("./services/cli-commands.js");
  try {
    console.log(await searchCommand(pattern));
  } catch (e: any) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
} else if (command === "health") {
  const { healthCommand } = await import("./services/cli-commands.js");
  try {
    console.log(await healthCommand(subcommand));
  } catch (e: any) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
} else if (command === "replay") {
  const sessionId = subcommand;
  if (!sessionId) {
    console.error("Usage: actl replay <session-id> [--json]");
    process.exit(1);
  }
  const { replayCommand } = await import("./services/cli-commands.js");
  try {
    console.log(await replayCommand(sessionId, { json: cli.flags.json }));
  } catch (e: any) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
} else if (command === "session" && subcommand === "name") {
  const sessionId = cli.input[2];
  const name = cli.input[3];
  if (!sessionId || !name) {
    console.error("Usage: actl session name <session-id> <name>");
    process.exit(1);
  }
  const { SessionStore } = await import("./daemon/session-store.js");
  const { getSessionsDbPath } = await import("./paths.js");
  const store = new SessionStore(getSessionsDbPath());
  try {
    const session = store.nameSession(sessionId, name, { account: cli.flags.account ?? "local" });
    console.log(`Session ${sessionId} named: "${session.name}"`);
  } finally {
    store.close();
  }
} else if (command === "sessions") {
  const { SessionStore } = await import("./daemon/session-store.js");
  const { getSessionsDbPath } = await import("./paths.js");
  const store = new SessionStore(getSessionsDbPath());
  try {
    if (cli.flags.search) {
      const results = store.search(cli.flags.search);
      if (results.length === 0) {
        console.log(`No sessions matching "${cli.flags.search}"`);
      } else {
        for (const r of results) {
          console.log(`${r.session.id}  ${r.session.name}  (${r.session.account})  ${r.session.startedAt}`);
        }
      }
    } else {
      const sessions = store.list();
      if (sessions.length === 0) {
        console.log("No named sessions. Use: actl session name <id> <name>");
      } else {
        for (const s of sessions) {
          console.log(`${s.id}  ${s.name}  (${s.account})  ${s.startedAt}`);
        }
      }
    }
  } finally {
    store.close();
  }
} else if (command === "help") {
  const { showHelp } = await import("./services/help.js");
  console.log(showHelp(subcommand));
} else {
  // Default: TUI mode
  render(<App />);
}
