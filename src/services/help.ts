import chalk from "chalk";

// "91" block art — displayed on startup and help, like Claude Code's mascot
export const MASCOT_LINES = [
  " ▄███▄  ▄█▄",
  " █   █   ██",
  " ▀████   ██",
  "    ██   ██",
  " ████▀  ▀██▀",
];

export function coloredMascot(): string {
  const c = chalk.hex("#89b4fa"); // Catppuccin Blue
  return MASCOT_LINES.map((line) => c(line)).join("\n");
}

interface CommandHelp {
  usage: string;
  description: string;
  options?: string[];
  examples: string[];
}

const COMMANDS: Record<string, CommandHelp> = {
  add: {
    usage: "ch add <name> [--dir DIR] [--color HEX] [--label LABEL] [--provider TYPE]",
    description: "Add a new Claude account with isolated config directory and shell alias.",
    options: [
      "--dir       Config directory (default: ~/.claude-<name>)",
      "--color     Hex color for TUI display (default: Catppuccin palette)",
      "--label     Display label (default: capitalized name)",
      "--provider  Provider type: claude-code, codex-cli, openhands, gemini-cli",
    ],
    examples: [
      "ch add work",
      "ch add codex --provider codex-cli",
      'ch add review --color "#f38ba8" --label "Code Review"',
    ],
  },
  remove: {
    usage: "ch remove <name> [--purge]",
    description: "Remove an account from Claude Hub.",
    options: ["--purge  Also delete the config directory on disk"],
    examples: ["ch remove work", "ch remove old-account --purge"],
  },
  launch: {
    usage: "ch launch <name> [dir] [--resume] [--no-window] [--bypass-permissions] [--no-entire]",
    description:
      "Quick-launch a Claude account in a new terminal window with isolated environment.",
    options: [
      "--resume              Resume last session instead of starting fresh",
      "--no-window           Print shell command instead of opening terminal",
      "--bypass-permissions  Skip permission checks on launch",
      "--no-entire           Skip auto-enabling entire monitoring",
    ],
    examples: [
      "ch launch work",
      "ch launch work ~/projects/my-app",
      "ch launch work --resume",
      "ch launch work --no-window  # prints the command to run manually",
    ],
  },
  daemon: {
    usage: "ch daemon <start|stop|status>",
    description:
      "Manage the Claude Hub daemon. The daemon enables inter-account communication via MCP bridge (handoffs, messages, task updates).",
    examples: [
      "ch daemon start   # start in background",
      "ch daemon status  # check if running",
      "ch daemon stop    # stop the daemon",
    ],
  },
  bridge: {
    usage: "ch bridge --account <name>",
    description:
      "Start MCP bridge for a specific account. This is typically launched automatically by the daemon — you rarely need to run it manually.",
    examples: ["ch bridge --account work"],
  },
  status: {
    usage: "ch status",
    description: "Show a quick overview of all accounts: message counts and quota usage.",
    examples: ["ch status"],
  },
  usage: {
    usage: "ch usage",
    description: "Show detailed usage table with today's activity, total messages, and quota per account.",
    examples: ["ch usage"],
  },
  list: {
    usage: "ch list",
    description: "List all configured accounts with their colors, labels, and config directories.",
    examples: ["ch list"],
  },
  config: {
    usage: "ch config set <key> <value>",
    description: "Update hub configuration values.",
    examples: [
      'ch config set notifications.enabled true',
      'ch config set notifications.events.rateLimit false',
    ],
  },
  "rotate-token": {
    usage: "ch rotate-token <name>",
    description: "Generate a new token for an account, invalidating the old one.",
    examples: ["ch rotate-token work"],
  },
  help: {
    usage: "ch help [command]",
    description: "Show help for Claude Hub or a specific command.",
    examples: ["ch help", "ch help launch", "ch help daemon"],
  },
};

function overview(): string {
  const mascot = coloredMascot();
  const title = chalk.bold("Claude Hub (ch)") + " — Multi-account AI agent manager\n";

  const sections = [
    {
      header: "Getting Started",
      cmds: [
        ["ch", "Open the TUI dashboard"],
        ["ch add <name>", "Add a new account"],
        ["ch launch <name>", "Launch account in a new terminal"],
        ["ch daemon start", "Start inter-account communication"],
      ],
    },
    {
      header: "Account Management",
      cmds: [
        ["ch list", "List all accounts"],
        ["ch status", "Show account status & quota"],
        ["ch usage", "Detailed usage table"],
        ["ch remove <name>", "Remove an account"],
        ["ch rotate-token <name>", "Rotate account token"],
      ],
    },
    {
      header: "Daemon & Communication",
      cmds: [
        ["ch daemon start|stop|status", "Manage the hub daemon"],
        ["ch bridge --account <name>", "MCP bridge (internal)"],
      ],
    },
    {
      header: "Configuration",
      cmds: [
        ["ch config set <key> <val>", "Update config value"],
        ["ch help [command]", "Show help"],
      ],
    },
  ];

  const body = sections
    .map((s) => {
      const header = chalk.yellow.bold(`  ${s.header}`);
      const rows = s.cmds
        .map(([cmd, desc]) => `    ${chalk.cyan(cmd!.padEnd(34))} ${desc}`)
        .join("\n");
      return `${header}\n${rows}`;
    })
    .join("\n\n");

  const tui = chalk.gray(
    "\n  Run " + chalk.white("ch") + " with no arguments to open the interactive TUI.\n" +
    "  TUI keybindings: [j/k] navigate  [Enter] select  [Tab] switch view  [q] quit"
  );

  return `\n${mascot}\n\n${title}\n${body}\n${tui}\n`;
}

function commandDetail(name: string): string {
  const cmd = COMMANDS[name];
  if (!cmd) {
    const available = Object.keys(COMMANDS).join(", ");
    return chalk.red(`Unknown command: ${name}`) + `\nAvailable: ${available}`;
  }

  const lines = [
    "",
    chalk.bold(cmd.usage),
    "",
    `  ${cmd.description}`,
  ];

  if (cmd.options && cmd.options.length > 0) {
    lines.push("", chalk.yellow.bold("  Options:"));
    for (const opt of cmd.options) {
      lines.push(`    ${chalk.gray(opt)}`);
    }
  }

  lines.push("", chalk.yellow.bold("  Examples:"));
  for (const ex of cmd.examples) {
    lines.push(`    ${chalk.cyan("$")} ${ex}`);
  }

  lines.push("");
  return lines.join("\n");
}

export function showHelp(command?: string): string {
  if (command) return commandDetail(command);
  return overview();
}
