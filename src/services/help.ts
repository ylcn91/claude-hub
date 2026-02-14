import chalk from "chalk";

// "91" ANSI Shadow art — displayed on startup and help, like Claude Code's mascot
export const MASCOT_LINES = [
  " █████╗   ██╗",
  "██╔══██╗ ███║",
  "╚█████╔╝ ╚██║",
  " ╚═══██║  ██║",
  " █████╔╝  ██║",
  " ╚════╝   ╚═╝",
];

const SHADOW_CHARS = "╔╗╚╝═║";

export function coloredMascot(): string {
  const face = chalk.hex("#89b4fa");  // Catppuccin Blue — block face
  const edge = chalk.hex("#585b70");  // Catppuccin Surface1 — shadow edges
  return MASCOT_LINES.map((line) =>
    [...line].map((ch) =>
      ch === " " ? ch : SHADOW_CHARS.includes(ch) ? edge(ch) : face(ch)
    ).join("")
  ).join("\n");
}

interface CommandHelp {
  usage: string;
  description: string;
  options?: string[];
  examples: string[];
}

const COMMANDS: Record<string, CommandHelp> = {
  add: {
    usage: "ac add <name> [--dir DIR] [--color HEX] [--label LABEL] [--provider TYPE]",
    description: "Add a new Claude account with isolated config directory and shell alias.",
    options: [
      "--dir       Config directory (default: ~/.claude-<name>)",
      "--color     Hex color for TUI display (default: Catppuccin palette)",
      "--label     Display label (default: capitalized name)",
      "--provider  Provider type: claude-code, codex-cli, openhands, gemini-cli",
    ],
    examples: [
      "ac add work",
      "ac add codex --provider codex-cli",
      'ac add review --color "#f38ba8" --label "Code Review"',
    ],
  },
  remove: {
    usage: "ac remove <name> [--purge]",
    description: "Remove an account from agentctl.",
    options: ["--purge  Also delete the config directory on disk"],
    examples: ["ac remove work", "ac remove old-account --purge"],
  },
  launch: {
    usage: "ac launch <name> [dir] [--resume] [--no-window] [--bypass-permissions] [--no-entire]",
    description:
      "Quick-launch a Claude account in a new terminal window with isolated environment.",
    options: [
      "--resume              Resume last session instead of starting fresh",
      "--no-window           Print shell command instead of opening terminal",
      "--bypass-permissions  Skip permission checks on launch",
      "--no-entire           Skip auto-enabling entire monitoring",
    ],
    examples: [
      "ac launch work",
      "ac launch work ~/projects/my-app",
      "ac launch work --resume",
      "ac launch work --no-window  # prints the command to run manually",
    ],
  },
  daemon: {
    usage: "ac daemon <start|stop|status>",
    description:
      "Manage the agentctl daemon. The daemon enables inter-account communication via MCP bridge (handoffs, messages, task updates).",
    examples: [
      "ac daemon start   # start in background",
      "ac daemon status  # check if running",
      "ac daemon stop    # stop the daemon",
    ],
  },
  bridge: {
    usage: "ac bridge --account <name>",
    description:
      "Start MCP bridge for a specific account. This is typically launched automatically by the daemon — you rarely need to run it manually.",
    examples: ["ac bridge --account work"],
  },
  status: {
    usage: "ac status",
    description: "Show a quick overview of all accounts: message counts and quota usage.",
    examples: ["ac status"],
  },
  usage: {
    usage: "ac usage",
    description: "Show detailed usage table with today's activity, total messages, and quota per account.",
    examples: ["ac usage"],
  },
  list: {
    usage: "ac list",
    description: "List all configured accounts with their colors, labels, and config directories.",
    examples: ["ac list"],
  },
  find: {
    usage: "ac find <pattern>",
    description: "Search accounts by name, label, color, or provider.",
    examples: [
      "ac find work",
      "ac find claude-code",
      'ac find "#f38ba8"',
    ],
  },
  search: {
    usage: "ac search <pattern>",
    description: "Search for a pattern across all account working directories using ripgrep.",
    examples: [
      "ac search TODO",
      "ac search 'function\\s+main'",
    ],
  },
  health: {
    usage: "ac health [account]",
    description: "Show health status of all accounts or a specific account.",
    examples: [
      "ac health",
      "ac health work",
    ],
  },
  replay: {
    usage: "ac replay <session-id> [--json]",
    description:
      "Replay an entire.io checkpoint session. Shows a timeline of prompts, responses, and tool calls from the checkpoint transcript.",
    options: ["--json  Output raw JSON instead of formatted timeline"],
    examples: [
      "ac replay a3b2c4d5e6f7",
      "ac replay a3b2c4d5e6f7 --json",
    ],
  },
  "session name": {
    usage: "ac session name <session-id> <name>",
    description: "Assign a human-readable name to a session for easier lookup and search.",
    examples: [
      'ac session name abc123 "Deploy Pipeline Fix"',
      'ac session name def456 "Login Bug Investigation"',
    ],
  },
  sessions: {
    usage: "ac sessions [--search QUERY]",
    description: "List all named sessions, or search sessions by name, tags, or notes.",
    options: [
      "--search  Search sessions by keyword across names, tags, and notes",
    ],
    examples: [
      "ac sessions",
      'ac sessions --search "deploy"',
      'ac sessions --search kubernetes',
    ],
  },
  config: {
    usage: "ac config <set|reload> [args]",
    description: "Update hub configuration values or reload configuration in the running daemon.",
    examples: [
      'ac config set notifications.enabled true',
      'ac config set notifications.events.rateLimit false',
      'ac config reload  # reload config in the running daemon',
    ],
  },
  "rotate-token": {
    usage: "ac rotate-token <name>",
    description: "Generate a new token for an account, invalidating the old one.",
    examples: ["ac rotate-token work"],
  },
  help: {
    usage: "ac help [command]",
    description: "Show help for agentctl or a specific command.",
    examples: ["ac help", "ac help launch", "ac help daemon"],
  },
};

function overview(): string {
  const mascot = coloredMascot();
  const title = chalk.bold("agentctl (ac)") + " — Multi-account AI agent manager\n";

  const sections = [
    {
      header: "Getting Started",
      cmds: [
        ["ac", "Open the TUI dashboard"],
        ["ac add <name>", "Add a new account"],
        ["ac launch <name>", "Launch account in a new terminal"],
        ["ac daemon start", "Start inter-account communication"],
      ],
    },
    {
      header: "Account Management",
      cmds: [
        ["ac list", "List all accounts"],
        ["ac find <pattern>", "Search accounts"],
        ["ac status", "Show account status & quota"],
        ["ac usage", "Detailed usage table"],
        ["ac remove <name>", "Remove an account"],
        ["ac rotate-token <name>", "Rotate account token"],
      ],
    },
    {
      header: "Search & Monitoring",
      cmds: [
        ["ac search <pattern>", "Search code across accounts"],
        ["ac health [account]", "Account health dashboard"],
        ["ac replay <session-id>", "Replay entire.io checkpoint"],
        ["ac sessions [--search Q]", "List or search named sessions"],
        ["ac session name <id> <name>", "Name a session"],
      ],
    },
    {
      header: "Daemon & Communication",
      cmds: [
        ["ac daemon start|stop|status", "Manage the hub daemon"],
        ["ac bridge --account <name>", "MCP bridge (internal)"],
      ],
    },
    {
      header: "Configuration",
      cmds: [
        ["ac config set <key> <val>", "Update config value"],
        ["ac config reload", "Reload config in running daemon"],
        ["ac help [command]", "Show help"],
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
    "\n  Run " + chalk.white("ac") + " with no arguments to open the interactive TUI.\n" +
    "  TUI views: [d]ashboard [l]auncher [u]sage [a]dd [t]asks [m]ail [e]scalation [r]prompts [n]analytics [h]ealth  [Esc] back  [q] quit"
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
