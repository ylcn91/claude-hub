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
    usage: "actl add <name> [--dir DIR] [--color HEX] [--label LABEL] [--provider TYPE]",
    description: "Add a new Claude account with isolated config directory and shell alias.",
    options: [
      "--dir       Config directory (default: ~/.claude-<name>)",
      "--color     Hex color for TUI display (default: Catppuccin palette)",
      "--label     Display label (default: capitalized name)",
      "--provider  Provider type: claude-code, codex-cli, openhands, gemini-cli, opencode, cursor-agent",
    ],
    examples: [
      "actl add work",
      "actl add codex --provider codex-cli",
      'actl add review --color "#f38ba8" --label "Code Review"',
    ],
  },
  remove: {
    usage: "actl remove <name> [--purge]",
    description: "Remove an account from agentctl.",
    options: ["--purge  Also delete the config directory on disk"],
    examples: ["actl remove work", "actl remove old-account --purge"],
  },
  launch: {
    usage: "actl launch <name> [dir] [--resume] [--no-window] [--bypass-permissions] [--no-entire]",
    description:
      "Quick-launch a Claude account in a new terminal window with isolated environment.",
    options: [
      "--resume              Resume last session instead of starting fresh",
      "--no-window           Print shell command instead of opening terminal",
      "--bypass-permissions  Skip permission checks on launch",
      "--no-entire           Skip auto-enabling entire monitoring",
    ],
    examples: [
      "actl launch work",
      "actl launch work ~/projects/my-app",
      "actl launch work --resume",
      "actl launch work --no-window  # prints the command to run manually",
    ],
  },
  daemon: {
    usage: "actl daemon <start|stop|status>",
    description:
      "Manage the agentctl daemon. The daemon enables inter-account communication via MCP bridge (handoffs, messages, task updates).",
    examples: [
      "actl daemon start   # start in background",
      "actl daemon status  # check if running",
      "actl daemon stop    # stop the daemon",
    ],
  },
  bridge: {
    usage: "actl bridge --account <name>",
    description:
      "Start MCP bridge for a specific account. This is typically launched automatically by the daemon — you rarely need to run it manually.",
    examples: ["actl bridge --account work"],
  },
  status: {
    usage: "actl status",
    description: "Show a quick overview of all accounts: message counts and quota usage.",
    examples: ["actl status"],
  },
  usage: {
    usage: "actl usage",
    description: "Show detailed usage table with today's activity, total messages, and quota per account.",
    examples: ["actl usage"],
  },
  list: {
    usage: "actl list",
    description: "List all configured accounts with their colors, labels, and config directories.",
    examples: ["actl list"],
  },
  find: {
    usage: "actl find <pattern>",
    description: "Search accounts by name, label, color, or provider.",
    examples: [
      "actl find work",
      "actl find claude-code",
      'actl find "#f38ba8"',
    ],
  },
  search: {
    usage: "actl search <pattern>",
    description: "Search for a pattern across all account working directories using ripgrep.",
    examples: [
      "actl search TODO",
      "actl search 'function\\s+main'",
    ],
  },
  health: {
    usage: "actl health [account]",
    description: "Show health status of all accounts or a specific account.",
    examples: [
      "actl health",
      "actl health work",
    ],
  },
  replay: {
    usage: "actl replay <session-id> [--json]",
    description:
      "Replay an entire.io checkpoint session. Shows a timeline of prompts, responses, and tool calls from the checkpoint transcript.",
    options: ["--json  Output raw JSON instead of formatted timeline"],
    examples: [
      "actl replay a3b2c4d5e6f7",
      "actl replay a3b2c4d5e6f7 --json",
    ],
  },
  "session name": {
    usage: "actl session name <session-id> <name>",
    description: "Assign a human-readable name to a session for easier lookup and search.",
    examples: [
      'actl session name abc123 "Deploy Pipeline Fix"',
      'actl session name def456 "Login Bug Investigation"',
    ],
  },
  sessions: {
    usage: "actl sessions [--search QUERY]",
    description: "List all named sessions, or search sessions by name, tags, or notes.",
    options: [
      "--search  Search sessions by keyword across names, tags, and notes",
    ],
    examples: [
      "actl sessions",
      'actl sessions --search "deploy"',
      'actl sessions --search kubernetes',
    ],
  },
  config: {
    usage: "actl config <set|reload> [args]",
    description: "Update hub configuration values or reload configuration in the running daemon.",
    examples: [
      'actl config set notifications.enabled true',
      'actl config set notifications.events.rateLimit false',
      'actl config reload  # reload config in the running daemon',
    ],
  },
  "rotate-token": {
    usage: "actl rotate-token <name>",
    description: "Generate a new token for an account, invalidating the old one.",
    examples: ["actl rotate-token work"],
  },
  help: {
    usage: "actl help [command]",
    description: "Show help for agentctl or a specific command.",
    examples: ["actl help", "actl help launch", "actl help daemon"],
  },
};

function overview(): string {
  const mascot = coloredMascot();
  const title = chalk.bold("agentctl (actl)") + " — Multi-account AI agent manager\n";

  const sections = [
    {
      header: "Getting Started",
      cmds: [
        ["actl", "Open the TUI dashboard"],
        ["actl add <name>", "Add a new account"],
        ["actl launch <name>", "Launch account in a new terminal"],
        ["actl daemon start", "Start inter-account communication"],
      ],
    },
    {
      header: "Account Management",
      cmds: [
        ["actl list", "List all accounts"],
        ["actl find <pattern>", "Search accounts"],
        ["actl status", "Show account status & quota"],
        ["actl usage", "Detailed usage table"],
        ["actl remove <name>", "Remove an account"],
        ["actl rotate-token <name>", "Rotate account token"],
      ],
    },
    {
      header: "Search & Monitoring",
      cmds: [
        ["actl search <pattern>", "Search code across accounts"],
        ["actl health [account]", "Account health dashboard"],
        ["actl replay <session-id>", "Replay entire.io checkpoint"],
        ["actl sessions [--search Q]", "List or search named sessions"],
        ["actl session name <id> <name>", "Name a session"],
      ],
    },
    {
      header: "Daemon & Communication",
      cmds: [
        ["actl daemon start|stop|status", "Manage the hub daemon"],
        ["actl bridge --account <name>", "MCP bridge (internal)"],
      ],
    },
    {
      header: "Configuration",
      cmds: [
        ["actl config set <key> <val>", "Update config value"],
        ["actl config reload", "Reload config in running daemon"],
        ["actl help [command]", "Show help"],
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
    "\n  Run " + chalk.white("actl") + " with no arguments to open the interactive TUI.\n" +
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
