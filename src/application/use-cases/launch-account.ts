import { loadConfig } from "../../config.js";
import { registry } from "../../providers/index.js";
import { terminalRegistry } from "../../terminals/registry.js";
import { isEntireInstalled, enableEntire, resumeCheckpoint } from "../../services/entire.js";
import { buildShellCommand } from "../../services/shell-quote.js";
import type { Account } from "../../providers/types.js";

export interface LaunchAccountOpts {
  dir?: string;
  resume?: boolean;
  bypassPermissions?: boolean;
  noEntire?: boolean;
  noWindow?: boolean;
  checkpointId?: string;
  terminalId?: string;
  onStatus?: (msg: string) => void;
}

export interface LaunchResult {
  success: boolean;
  shellCmd: string;
  terminalName?: string;
  error?: string;
}

export async function launchAccount(
  accountName: string,
  opts: LaunchAccountOpts = {}
): Promise<LaunchResult> {
  const config = await loadConfig();
  const accountConfig = config.accounts.find(
    (a) => a.name.toLowerCase() === accountName.toLowerCase()
  );
  if (!accountConfig) {
    return { success: false, shellCmd: "", error: `Account '${accountName}' not found. Run: ch list` };
  }

  const resolvedDir = opts.dir ?? process.cwd();
  const { assertHomeDir } = await import("../../paths.js");
  const configDir = accountConfig.configDir.replace(/^~/, assertHomeDir());
  const status = opts.onStatus ?? (() => {});

  // Resume from checkpoint
  if (opts.checkpointId) {
    status(`Resuming from checkpoint ${opts.checkpointId.slice(0, 8)}...`);
    const result = await resumeCheckpoint(resolvedDir, opts.checkpointId);
    if (!result.success) {
      return { success: false, shellCmd: "", error: `Resume failed: ${result.error}` };
    }
  }

  // Auto-enable Entire
  if (!opts.noEntire && config.entire.autoEnable) {
    const installed = await isEntireInstalled();
    if (installed) {
      status("Checking Entire...");
      const result = await enableEntire(resolvedDir);
      if (!result.success && result.error && !result.error.includes("already")) {
        status(`Entire: ${result.error}`);
      }
    }
  }

  // Build launch command
  const account: Account = { name: accountConfig.name, configDir, provider: accountConfig.provider };
  const provider = registry.getOrDefault(accountConfig.provider);
  const cmd = provider.buildLaunchCommand(account, {
    dir: resolvedDir,
    resume: opts.resume,
    bypassPermissions: opts.bypassPermissions,
  });

  const shellCmd = buildShellCommand(cmd);

  const noWindow = opts.noWindow ?? !config.defaults.launchInNewWindow;
  if (noWindow) {
    return { success: true, shellCmd };
  }

  // Launch in terminal — prefer explicit terminalId, then platform default
  const terminal = (opts.terminalId ? terminalRegistry.get(opts.terminalId) : undefined)
    ?? terminalRegistry.listForPlatform()[0];
  if (!terminal) {
    return { success: false, shellCmd, error: "No terminal profile found for this platform" };
  }

  try {
    const launchCmd = terminal.buildLaunchCommand(shellCmd);
    const proc = Bun.spawn(launchCmd, { stdout: "ignore", stderr: "ignore" });
    await proc.exited;
    return { success: true, shellCmd, terminalName: terminal.displayName };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { success: false, shellCmd, error: `Failed to open terminal: ${message}` };
  }
}
