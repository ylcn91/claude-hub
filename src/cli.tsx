#!/usr/bin/env bun
import React from "react";
import { render } from "ink";
import meow from "meow";
import { App } from "./app.js";

const cli = meow(
  `
  Usage
    $ ch                    Open TUI dashboard
    $ ch daemon start       Start hub daemon
    $ ch daemon stop        Stop hub daemon
    $ ch bridge --account   MCP bridge (internal)
    $ ch status             Show account status
    $ ch list               List accounts

  Options
    --account  Account name (for bridge mode)
`,
  {
    importMeta: import.meta,
    flags: {
      account: { type: "string" },
    },
  }
);

const [command, subcommand] = cli.input;

if (command === "daemon" && subcommand === "start") {
  await import("./daemon/index.js");
} else if (command === "daemon" && subcommand === "stop") {
  const { stopDaemonByPid } = await import("./daemon/server.js");
  stopDaemonByPid();
} else if (command === "bridge" && cli.flags.account) {
  // MCP bridge - will be connected when mcp/bridge.ts exists
  console.log(`Bridge mode for account: ${cli.flags.account} (not yet implemented)`);
} else if (command === "status") {
  // Quick status - will be implemented in Task 13
  console.log("Status command not yet implemented. Use TUI: ch");
} else if (command === "list") {
  // List accounts - will be implemented in Task 13
  console.log("List command not yet implemented. Use TUI: ch");
} else {
  // Default: TUI mode
  render(<App />);
}
