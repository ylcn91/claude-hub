#!/usr/bin/env bun
import React from "react";
import { render } from "ink";
import meow from "meow";
import { App } from "./app.js";

const cli = meow(
  `
  Usage
    $ ch                    Open TUI dashboard
    $ ch add <name>         Add new account
    $ ch remove <name>      Remove account
    $ ch rotate-token <name> Rotate account token
    $ ch daemon start       Start hub daemon
    $ ch daemon stop        Stop hub daemon
    $ ch daemon status      Show daemon status
    $ ch bridge --account   MCP bridge (internal)
    $ ch launch <name> [dir]  Quick-launch account
    $ ch config set <key> <value>  Set config value
    $ ch status             Show account status
    $ ch usage              Show usage table
    $ ch list               List accounts

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
    --provider  Provider type (claude-code, codex-cli, openhands, gemini-cli)
`,
  {
    importMeta: import.meta,
    flags: {
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
    },
  }
);

const [command, subcommand] = cli.input;

if (command === "daemon" && subcommand === "start") {
  const { ensureDaemonRunning } = await import("./mcp/bridge.js");
  try {
    await ensureDaemonRunning();
    console.log("Claude Hub daemon started (background)");
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
} else if (command === "add") {
  const name = subcommand;
  if (!name) {
    console.error("Usage: ch add <name>");
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
    console.error("Usage: ch remove <name>");
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
    console.error("Usage: ch rotate-token <name>");
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
    console.error("Usage: ch launch <name> [dir]");
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
} else if (command === "config" && subcommand === "set") {
  const key = cli.input[2];
  const val = cli.input[3];
  if (!key || val === undefined) {
    console.error("Usage: ch config set <key> <value>");
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
} else if (command === "help") {
  const { showHelp } = await import("./services/help.js");
  console.log(showHelp(subcommand));
} else {
  // Default: TUI mode
  render(<App />);
}
