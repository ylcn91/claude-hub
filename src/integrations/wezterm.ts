export function isWezTerm(): boolean {
  return !!process.env.WEZTERM_PANE;
}

export interface WezTermTab {
  accountName: string;
  color: string;
  command: string;
}

// Generate a wezterm CLI command to set the tab title and color
export function setTabTitle(accountName: string): string {
  // Use wezterm cli set-tab-title
  return `wezterm cli set-tab-title "${accountName}"`;
}

// Launch an account in a new WezTerm tab with color-coding
export async function launchInWezTermTab(account: { name: string; color: string; configDir: string }, dir?: string): Promise<void> {
  if (!isWezTerm()) return;

  const configDir = account.configDir.replace(/^~/, process.env.HOME ?? "");
  const cmd = `CLAUDE_CONFIG_DIR=${configDir} claude`;
  const cwd = dir ?? process.env.HOME ?? "/";

  // Spawn new tab via wezterm cli (argument array to prevent shell injection)
  const spawnProc = Bun.spawn(
    ["wezterm", "cli", "spawn", "--cwd", cwd, "--", "bash", "-c", cmd],
    { stdout: "ignore", stderr: "ignore" }
  );
  await spawnProc.exited;

  // Set tab title (argument array to prevent shell injection)
  const titleProc = Bun.spawn(
    ["wezterm", "cli", "set-tab-title", account.name],
    { stdout: "ignore", stderr: "ignore" }
  );
  await titleProc.exited;
}

// Generate workspace preset that launches N accounts in split panes
export function generateWorkspaceConfig(accounts: Array<{ name: string; color: string; configDir: string }>): string {
  // Generate wezterm.lua snippet for workspace preset
  const panes = accounts.map((a) => {
    const configDir = a.configDir.replace(/^~/, process.env.HOME ?? "");
    return `    { args = { "bash", "-c", "CLAUDE_CONFIG_DIR=${configDir} claude" }, set_environment_variables = { CLAUDE_CONFIG_DIR = "${configDir}" } }`;
  });

  return `-- agentctl workspace preset
local workspace = {
  workspace_id = "agentctl",
  tabs = {
${panes.join(",\n")}
  }
}`;
}
