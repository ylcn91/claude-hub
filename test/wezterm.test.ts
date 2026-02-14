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
      const cmd = setTabTitle("claude-work", "#89b4fa");
      expect(cmd).toBe('wezterm cli set-tab-title "claude-work"');
    });

    test("handles account names with special characters", () => {
      const cmd = setTabTitle("my-admin", "#cba6f7");
      expect(cmd).toBe('wezterm cli set-tab-title "my-admin"');
    });

    test("includes the account name in the command", () => {
      const cmd = setTabTitle("test-account", "#a6e3a1");
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
});
