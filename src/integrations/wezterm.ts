export function isWezTerm(): boolean {
  return !!process.env.WEZTERM_PANE;
}

export interface WezTermTab {
  accountName: string;
  color: string;
  command: string;
}

// Generate a wezterm CLI command to set the tab title and color
export function setTabTitle(accountName: string, color: string): string {
  // Use wezterm cli set-tab-title
  return `wezterm cli set-tab-title "${accountName}"`;
}

// Launch an account in a new WezTerm tab with color-coding
export async function launchInWezTermTab(account: { name: string; color: string; configDir: string }, dir?: string): Promise<void> {
  if (!isWezTerm()) return;

  const configDir = account.configDir.replace(/^~/, process.env.HOME ?? "");
  const cmd = `CLAUDE_CONFIG_DIR=${configDir} claude`;
  const cwd = dir ?? process.env.HOME ?? "/";

  // Spawn new tab via wezterm cli
  await Bun.$`wezterm cli spawn --cwd ${cwd} -- bash -c ${cmd}`.quiet();

  // Set tab title
  await Bun.$`wezterm cli set-tab-title ${account.name}`.quiet();
}

// Generate workspace preset that launches N accounts in split panes
export function generateWorkspaceConfig(accounts: Array<{ name: string; color: string; configDir: string }>): string {
  // Generate wezterm.lua snippet for workspace preset
  const panes = accounts.map((a, i) => {
    const configDir = a.configDir.replace(/^~/, process.env.HOME ?? "");
    return `    { args = { "bash", "-c", "CLAUDE_CONFIG_DIR=${configDir} claude" }, set_environment_variables = { CLAUDE_CONFIG_DIR = "${configDir}" } }`;
  });

  return `-- Claude Hub workspace preset
local workspace = {
  workspace_id = "claude-hub",
  tabs = {
${panes.join(",\n")}
  }
}`;
}
