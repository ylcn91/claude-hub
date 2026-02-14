import { mkdir, symlink, unlink, writeFile, readFile, copyFile } from "node:fs/promises";
import { existsSync } from "fs";
import { join, dirname, resolve } from "path";
import { randomBytes } from "crypto";
import { loadConfig, saveConfig, addAccount, removeAccount } from "../config";
import { getTokensDir as getTokensDirFromPaths, assertHomeDir, getHubDir } from "../paths";
import type { AccountConfig, ProviderId } from "../types";

export const CATPPUCCIN_COLORS = [
  { name: "Mauve", hex: "#cba6f7" },
  { name: "Blue", hex: "#89b4fa" },
  { name: "Sapphire", hex: "#74c7ec" },
  { name: "Teal", hex: "#94e2d5" },
  { name: "Green", hex: "#a6e3a1" },
  { name: "Yellow", hex: "#f9e2af" },
  { name: "Peach", hex: "#fab387" },
  { name: "Red", hex: "#f38ba8" },
  { name: "Pink", hex: "#f5c2e7" },
  { name: "Flamingo", hex: "#f2cdcd" },
  { name: "Rosewater", hex: "#f5e0dc" },
  { name: "Lavender", hex: "#b4befe" },
] as const;

export interface SetupAccountOptions {
  name: string;
  configDir: string;
  color: string;
  label: string;
  provider?: ProviderId;
  symlinkPlugins?: boolean;
  symlinkSkills?: boolean;
  symlinkCommands?: boolean;
  addShellAlias?: boolean;
  configPath?: string;
}

function getTokensDir(): string {
  return getTokensDirFromPaths();
}

export const ACCOUNT_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,62}$/;

export function validatePurgePath(dirPath: string): void {
  const resolved = resolve(dirPath);
  const home = assertHomeDir();
  const hubDir = getHubDir();

  // Reject root, home directory itself, or paths with too few components
  const parts = resolved.split("/").filter(Boolean);
  if (parts.length < 3) {
    throw new Error(
      `Refusing to purge '${resolved}': path has too few components and is too broad.`
    );
  }

  if (resolved === "/" || resolved === home) {
    throw new Error(
      `Refusing to purge '${resolved}': cannot delete root or home directory.`
    );
  }

  // Only allow paths strictly under the agentctl base directory (not the root itself)
  if (!resolved.startsWith(hubDir + "/")) {
    throw new Error(
      `Refusing to purge '${resolved}': path is not under the agentctl config directory '${hubDir}'.`
    );
  }
}

export function validateAccountName(name: string): void {
  if (!ACCOUNT_NAME_RE.test(name)) {
    throw new Error(
      `Invalid account name '${name}'. Names must be 1-63 alphanumeric characters, hyphens, or underscores, starting with a letter or digit.`
    );
  }
}

export function generateToken(): string {
  return randomBytes(32).toString("hex");
}

export async function setupAccount(opts: SetupAccountOptions): Promise<{
  account: AccountConfig;
  tokenPath: string;
}> {
  // 0. Validate name and check for duplicates BEFORE any side effects
  validateAccountName(opts.name);
  const config = await loadConfig(opts.configPath);
  if (config.accounts.some((a) => a.name === opts.name)) {
    throw new Error(`Account '${opts.name}' already exists`);
  }

  const expandedDir = opts.configDir.replace(/^~/, assertHomeDir());

  // 1. Create config directory
  await mkdir(expandedDir, { recursive: true });

  // 2. Generate token
  const tokensDir = getTokensDir();
  await mkdir(tokensDir, { recursive: true });
  const token = generateToken();
  const tokenPath = join(tokensDir, `${opts.name}.token`);
  await writeFile(tokenPath, token, { mode: 0o600 });

  // 3. Symlink plugins/skills/commands from ~/.claude
  const defaultClaudeDir = `${assertHomeDir()}/.claude`;
  const symlinks: Array<[string, string]> = [];

  if (opts.symlinkPlugins !== false) symlinks.push(["plugins", "plugins"]);
  if (opts.symlinkSkills !== false) symlinks.push(["skills", "skills"]);
  if (opts.symlinkCommands !== false) symlinks.push(["commands", "commands"]);

  for (const [srcName, destName] of symlinks) {
    const src = join(defaultClaudeDir, srcName);
    const dest = join(expandedDir, destName);
    if (existsSync(src) && !existsSync(dest)) {
      await symlink(src, dest);
    }
  }

  // 4. Add MCP config to settings.json
  await setupMCPConfig(expandedDir, opts.name);

  // 5. Add to hub config
  const account: AccountConfig = {
    name: opts.name,
    configDir: opts.configDir,
    color: opts.color,
    label: opts.label,
    provider: opts.provider ?? "claude-code",
  };

  const updated = addAccount(config, account);
  await saveConfig(updated, opts.configPath);

  return { account, tokenPath };
}

async function setupMCPConfig(configDir: string, accountName: string): Promise<void> {
  const settingsPath = join(configDir, "settings.json");
  let settings: Record<string, any> = {};

  if (existsSync(settingsPath)) {
    try {
      const text = await readFile(settingsPath, "utf-8");
      settings = JSON.parse(text);
    } catch {}
  }

  if (!settings.mcpServers) settings.mcpServers = {};
  settings.mcpServers["agentctl"] = {
    command: "actl",
    args: ["bridge", "--account", accountName],
  };

  await mkdir(dirname(settingsPath), { recursive: true });
  await writeFile(settingsPath, JSON.stringify(settings, null, 2));
}

export async function rotateToken(
  name: string,
  opts?: { configPath?: string }
): Promise<{ newToken: string; tokenPath: string }> {
  validateAccountName(name);
  const config = await loadConfig(opts?.configPath);
  const account = config.accounts.find((a) => a.name === name);
  if (!account) {
    throw new Error(`Account '${name}' not found`);
  }

  // Generate new token
  const newToken = generateToken();
  const tokensDir = getTokensDir();
  await mkdir(tokensDir, { recursive: true });
  const tokenPath = join(tokensDir, `${name}.token`);
  await writeFile(tokenPath, newToken, { mode: 0o600 });

  // Update settings.json MCP config in account's config dir
  const expandedDir = account.configDir.replace(/^~/, assertHomeDir());
  await setupMCPConfig(expandedDir, name);

  return { newToken, tokenPath };
}

export async function teardownAccount(
  name: string,
  opts?: { purge?: boolean; configPath?: string }
): Promise<void> {
  validateAccountName(name);
  const config = await loadConfig(opts?.configPath);
  const account = config.accounts.find((a) => a.name === name);
  if (!account) {
    throw new Error(`Account '${name}' not found`);
  }

  // Remove token
  const tokensDir = getTokensDir();
  const tokenPath = join(tokensDir, `${name}.token`);
  if (existsSync(tokenPath)) {
    await unlink(tokenPath);
  }

  // Purge: remove the config directory (with safety checks)
  if (opts?.purge) {
    const expandedDir = resolve(account.configDir.replace(/^~/, assertHomeDir()));
    validatePurgePath(expandedDir);
    if (existsSync(expandedDir)) {
      const { rm } = await import("node:fs/promises");
      await rm(expandedDir, { recursive: true, force: true });
    }
  }

  // Remove from config
  const updated = removeAccount(config, name);
  await saveConfig(updated, opts?.configPath);
}

export async function addShellAlias(
  name: string,
  configDir: string
): Promise<{ modified: boolean; backupPath: string | null }> {
  const zshrcPath = `${assertHomeDir()}/.zshrc`;
  // Escape configDir for shell safety:
  // 1. Escape for double-quote context (alias body is re-parsed at invocation)
  // 2. Escape for single-quote context (alias definition)
  const escapedForDoubleQuotes = configDir
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\$/g, "\\$")
    .replace(/`/g, "\\`");
  const safeConfigDir = escapedForDoubleQuotes.replace(/'/g, "'\\''");
  const aliasLine = `alias claude-${name}='CLAUDE_CONFIG_DIR="${safeConfigDir}" claude'`;
  const marker = `# agentctl:${name}`;

  let content = "";
  if (existsSync(zshrcPath)) {
    content = await readFile(zshrcPath, "utf-8");
  }

  // Idempotent: don't add if already present
  if (content.includes(marker)) {
    return { modified: false, backupPath: null };
  }

  // Backup before modifying
  const backupPath = `${zshrcPath}.backup.${Date.now()}`;
  if (existsSync(zshrcPath)) {
    await copyFile(zshrcPath, backupPath);
  }

  const addition = `\n${marker}\n${aliasLine}\n`;
  await writeFile(zshrcPath, content + addition);

  return { modified: true, backupPath: existsSync(backupPath) ? backupPath : null };
}
