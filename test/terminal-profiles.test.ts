import { test, expect, describe } from "bun:test";
import { WezTermProfile } from "../src/terminals/wezterm";
import { ITermProfile } from "../src/terminals/iterm";
import { GnomeTerminalProfile } from "../src/terminals/gnome";
import { WindowsTerminalProfile } from "../src/terminals/windows-terminal";
import { createDefaultTerminalRegistry } from "../src/terminals/registry";

describe("Terminal profiles", () => {
  test("WezTerm builds correct launch command", () => {
    const profile = new WezTermProfile();
    const cmd = profile.buildLaunchCommand("echo hello");
    expect(cmd).toEqual(["open", "-a", "WezTerm", "--", "zsh", "-c", "echo hello"]);
  });

  test("iTerm builds correct launch command", () => {
    const profile = new ITermProfile();
    const cmd = profile.buildLaunchCommand("echo hello");
    expect(cmd).toEqual(["open", "-a", "iTerm", "--", "zsh", "-c", "echo hello"]);
  });

  test("GNOME Terminal builds correct launch command", () => {
    const profile = new GnomeTerminalProfile();
    const cmd = profile.buildLaunchCommand("echo hello");
    expect(cmd).toEqual(["gnome-terminal", "--", "bash", "-c", "echo hello"]);
  });

  test("Windows Terminal builds correct launch command", () => {
    const profile = new WindowsTerminalProfile();
    const cmd = profile.buildLaunchCommand("echo hello");
    expect(cmd).toEqual(["wt", "new-tab", "cmd", "/c", "echo hello"]);
  });

  test("registry has 4 default profiles", () => {
    const reg = createDefaultTerminalRegistry();
    expect(reg.listAll().length).toBe(4);
  });

  test("registry.get returns correct profile", () => {
    const reg = createDefaultTerminalRegistry();
    expect(reg.get("wezterm")?.displayName).toBe("WezTerm");
    expect(reg.get("iterm")?.displayName).toBe("iTerm2");
  });

  test("listForPlatform filters by platform", () => {
    const reg = createDefaultTerminalRegistry();
    const darwin = reg.listForPlatform("darwin");
    expect(darwin.every((t) => t.platform === "darwin" || t.platform === "all")).toBe(true);
  });

  describe("command injection safety", () => {
    test("detectDefault uses Bun.spawn with argument arrays (no shell interpolation)", async () => {
      const src = await Bun.file(
        new URL("../src/terminals/registry.ts", import.meta.url).pathname
      ).text();
      // Must use Bun.spawn for mdfind and which, not Bun.$``
      expect(src).toContain('Bun.spawn(');
      expect(src).toContain('"mdfind"');
      expect(src).toContain('"which"');
      expect(src).not.toContain("Bun.$`");
    });

    test("terminal IDs with shell metacharacters are safe in argument arrays", () => {
      const reg = createDefaultTerminalRegistry();
      // Register a terminal with a dangerous ID
      const dangerousIds = [
        '$(whoami)',
        '`rm -rf /`',
        'test; echo pwned',
        'foo && cat /etc/passwd',
      ];
      for (const id of dangerousIds) {
        // Since detectDefault passes terminal.id as an argument array element to Bun.spawn,
        // shell metacharacters are never interpreted. Verify registration works.
        expect(() => {
          reg.register({
            id,
            displayName: "Test",
            platform: "darwin",
            buildLaunchCommand: (cmd: string) => [cmd],
          });
        }).not.toThrow();
        expect(reg.get(id)?.id).toBe(id);
      }
    });
  });
});
