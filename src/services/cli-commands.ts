import chalk from "chalk";
import { loadConfig } from "../config";
import { loadDashboardData } from "../application/use-cases/load-dashboard-data.js";
import { launchAccount } from "../application/use-cases/launch-account.js";

export async function statusCommand(configPath?: string): Promise<string> {
  const data = await loadDashboardData(configPath);

  if (data.accounts.length === 0) {
    return "No accounts configured. Run: ch add <name>";
  }

  const lines = data.accounts.map((s) => {
    const name = chalk.hex(s.account.color).bold(s.account.name);
    const msgs = s.stats.todayActivity?.messageCount ?? 0;
    const label = s.quota.percent >= 0 ? s.quota.label : "unknown";
    return `${name}  ${msgs} msgs today  ${label}`;
  });

  return lines.join("\n");
}

export async function usageCommand(configPath?: string): Promise<string> {
  const data = await loadDashboardData(configPath);

  if (data.accounts.length === 0) {
    return "No accounts configured. Run: ch add <name>";
  }

  const header = `${"Account".padEnd(20)} ${"Today".padEnd(8)} ${"Total".padEnd(10)} ${"Quota".padEnd(20)}`;
  const divider = "-".repeat(header.length);

  const rows = data.accounts.map((s) => {
    const name = s.account.name.padEnd(20);
    const today = String(s.stats.todayActivity?.messageCount ?? 0).padEnd(8);
    const total = String(s.stats.totalMessages).padEnd(10);
    const quota = s.quota.percent >= 0 ? s.quota.label : "unknown";
    return `${name} ${today} ${total} ${quota.padEnd(20)}`;
  });

  return [header, divider, ...rows].join("\n");
}

export async function listCommand(configPath?: string): Promise<string> {
  const config = await loadConfig(configPath);

  if (config.accounts.length === 0) {
    return "No accounts configured. Run: ch add <name>";
  }

  const lines = config.accounts.map((a) => {
    const dot = chalk.hex(a.color)("\u25CF");
    const name = chalk.bold(a.name);
    const dir = chalk.gray(a.configDir);
    return `${dot} ${name} (${a.label}) ${dir}`;
  });

  return lines.join("\n");
}

export async function findCommand(pattern: string, configPath?: string): Promise<string> {
  const config = await loadConfig(configPath);

  if (config.accounts.length === 0) {
    return "No accounts configured. Run: ch add <name>";
  }

  const lower = pattern.toLowerCase();
  const matches = config.accounts.filter((a) => {
    return (
      a.name.toLowerCase().includes(lower) ||
      a.label.toLowerCase().includes(lower) ||
      a.color.toLowerCase().includes(lower) ||
      a.provider.toLowerCase().includes(lower)
    );
  });

  if (matches.length === 0) {
    return `No accounts matching "${pattern}"`;
  }

  const lines = matches.map((a) => {
    const dot = chalk.hex(a.color)("\u25CF");
    const name = chalk.bold(a.name);
    const dir = chalk.gray(a.configDir);
    return `${dot} ${name} (${a.label}) [${a.provider}] ${dir}`;
  });

  return lines.join("\n");
}

export async function searchCommand(pattern: string): Promise<string> {
  const { searchDirectories } = await import("./code-search.js");
  const result = await searchDirectories(pattern);

  if (result.results.length === 0) {
    return `No matches found for "${pattern}" across ${result.searchedDirs.length} directories.`;
  }

  // Group results by account
  const grouped = new Map<string, typeof result.results>();
  for (const r of result.results) {
    const existing = grouped.get(r.account) ?? [];
    existing.push(r);
    grouped.set(r.account, existing);
  }

  const lines: string[] = [];
  for (const [account, matches] of grouped) {
    lines.push(chalk.bold.cyan(`\n  ${account}`) + chalk.gray(` (${matches.length} matches)`));
    for (const m of matches.slice(0, 10)) {
      const filePath = chalk.gray(m.file);
      const lineNum = chalk.yellow(`:${m.line}`);
      lines.push(`    ${filePath}${lineNum}  ${m.content.trim()}`);
    }
    if (matches.length > 10) {
      lines.push(chalk.gray(`    ... and ${matches.length - 10} more`));
    }
  }

  lines.push(chalk.gray(`\n  ${result.totalMatches} total matches across ${result.searchedDirs.length} directories`));
  return lines.join("\n");
}

export async function healthCommand(account?: string): Promise<string> {
  const { HealthMonitor } = await import("../daemon/health-monitor.js");
  const config = await loadConfig();
  const monitor = new HealthMonitor();
  const statuses = monitor.getStatuses(config.accounts.map((a) => a.name));

  const filtered = account
    ? statuses.filter((s) => s.account === account)
    : statuses;

  if (filtered.length === 0) {
    return account ? `Account "${account}" not found.` : "No accounts configured.";
  }

  const lines = filtered.map((s) => {
    const colorFn = s.status === "healthy" ? chalk.green : s.status === "degraded" ? chalk.yellow : chalk.red;
    const dot = colorFn("\u25CF");
    const name = chalk.bold(s.account);
    const statusLabel = colorFn(s.status);
    const detail = s.connected ? "connected" : "disconnected";
    return `${dot} ${name}  ${statusLabel}  ${chalk.gray(detail)}  errors: ${s.errorCount}`;
  });

  return lines.join("\n");
}

export async function launchCommand(
  accountName: string,
  dir?: string,
  opts?: { resume?: boolean; noWindow?: boolean; bypassPermissions?: boolean; noEntire?: boolean }
): Promise<string> {
  const result = await launchAccount(accountName, {
    dir,
    resume: opts?.resume,
    noWindow: opts?.noWindow,
    bypassPermissions: opts?.bypassPermissions,
    noEntire: opts?.noEntire,
  });

  if (!result.success) {
    throw new Error(result.error ?? "Launch failed");
  }

  if (opts?.noWindow) {
    return result.shellCmd;
  }

  return `Launched ${accountName} in ${result.terminalName ?? "terminal"} (dir: ${dir ?? process.cwd()})`;
}

export async function replayCommand(
  sessionId: string,
  opts?: { json?: boolean; repoPath?: string },
): Promise<string> {
  const repoPath = opts?.repoPath ?? process.cwd();
  const { readCheckpoint } = await import("./entire-integration.js");
  const { buildTimeline } = await import("./replay.js");

  // Read checkpoint once and pass transcript to buildTimeline to avoid double read
  const { metadata, transcript } = await readCheckpoint(repoPath, sessionId);
  if (!metadata) {
    return `Checkpoint '${sessionId}' not found in ${repoPath}`;
  }

  const timeline = await buildTimeline(repoPath, sessionId, transcript);

  if (opts?.json) {
    return JSON.stringify({ metadata, timeline }, null, 2);
  }

  const lines: string[] = [];
  lines.push(chalk.bold(`Replay: ${metadata.checkpointId}`));
  lines.push(`  Branch: ${metadata.branch || "(unknown)"}`);
  lines.push(`  Strategy: ${metadata.strategy || "(unknown)"}`);
  lines.push(`  Files: ${metadata.filesTouched.join(", ") || "(none)"}`);
  if (metadata.tokenUsage) {
    lines.push(`  Tokens: ${metadata.tokenUsage.inputTokens} in / ${metadata.tokenUsage.outputTokens} out (${metadata.tokenUsage.apiCallCount} calls)`);
  }
  lines.push("");
  lines.push(chalk.yellow.bold("Timeline:"));

  for (const event of timeline) {
    const prefix = event.type === "prompt"
      ? chalk.cyan("[prompt]")
      : event.type === "tool_call"
        ? chalk.magenta(`[tool: ${event.toolName ?? "unknown"}]`)
        : chalk.green("[response]");

    const content = event.content.length > 200
      ? event.content.slice(0, 200) + "..."
      : event.content;

    lines.push(`  ${prefix} ${content}`);
  }

  if (timeline.length === 0) {
    lines.push("  (no events found)");
  }

  return lines.join("\n");
}
