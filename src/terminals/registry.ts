import type { TerminalProfile } from "./types.js";
import { WezTermProfile } from "./wezterm.js";
import { ITermProfile } from "./iterm.js";
import { GnomeTerminalProfile } from "./gnome.js";
import { WindowsTerminalProfile } from "./windows-terminal.js";

export class TerminalRegistry {
  private terminals = new Map<string, TerminalProfile>();

  register(profile: TerminalProfile): void {
    this.terminals.set(profile.id, profile);
  }

  get(id: string): TerminalProfile | undefined {
    return this.terminals.get(id);
  }

  listAll(): TerminalProfile[] {
    return Array.from(this.terminals.values());
  }

  listForPlatform(platform?: string): TerminalProfile[] {
    const p = platform ?? process.platform;
    return this.listAll().filter((t) => t.platform === p || t.platform === "all");
  }

  async detectDefault(): Promise<TerminalProfile | undefined> {
    const candidates = this.listForPlatform();
    for (const terminal of candidates) {
      try {
        if (process.platform === "darwin") {
          // Use Bun.spawn with argument arrays to prevent shell injection
          const mdfindProc = Bun.spawn(
            ["mdfind", `kMDItemCFBundleIdentifier == '${terminal.id}'`],
            { stdout: "pipe", stderr: "ignore" }
          );
          const output = await new Response(mdfindProc.stdout).text();
          await mdfindProc.exited;
          if (mdfindProc.exitCode === 0 && output.trim().length > 0) {
            return terminal;
          }
          continue;
        }
        const whichProc = Bun.spawn(["which", terminal.id], { stdout: "ignore", stderr: "ignore" });
        await whichProc.exited;
        if (whichProc.exitCode === 0) {
          return terminal;
        }
        continue;
      } catch {
        continue;
      }
    }
    return candidates[0];
  }
}

export function createDefaultTerminalRegistry(): TerminalRegistry {
  const registry = new TerminalRegistry();
  registry.register(new WezTermProfile());
  registry.register(new ITermProfile());
  registry.register(new GnomeTerminalProfile());
  registry.register(new WindowsTerminalProfile());
  return registry;
}

export const terminalRegistry = createDefaultTerminalRegistry();
