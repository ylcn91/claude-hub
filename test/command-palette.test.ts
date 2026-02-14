import { test, expect, describe } from "bun:test";

describe("fuzzyMatch", () => {
  test("matches exact string", async () => {
    const { fuzzyMatch } = await import("../src/components/CommandPalette");
    const result = fuzzyMatch("Dashboard", "Dashboard");
    expect(result.matches).toBe(true);
    expect(result.indices).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  test("matches subsequence", async () => {
    const { fuzzyMatch } = await import("../src/components/CommandPalette");
    const result = fuzzyMatch("db", "Dashboard");
    expect(result.matches).toBe(true);
    expect(result.indices).toEqual([0, 4]);
  });

  test("matches case insensitively", async () => {
    const { fuzzyMatch } = await import("../src/components/CommandPalette");
    const result = fuzzyMatch("DASH", "Dashboard");
    expect(result.matches).toBe(true);
    expect(result.indices).toEqual([0, 1, 2, 3]);
  });

  test("returns no match for non-subsequence", async () => {
    const { fuzzyMatch } = await import("../src/components/CommandPalette");
    const result = fuzzyMatch("xyz", "Dashboard");
    expect(result.matches).toBe(false);
  });

  test("empty query matches everything", async () => {
    const { fuzzyMatch } = await import("../src/components/CommandPalette");
    const result = fuzzyMatch("", "Dashboard");
    expect(result.matches).toBe(true);
    expect(result.indices).toEqual([]);
  });

  test("query longer than text does not match", async () => {
    const { fuzzyMatch } = await import("../src/components/CommandPalette");
    const result = fuzzyMatch("DashboardExtra", "Dash");
    expect(result.matches).toBe(false);
  });

  test("matches scattered characters", async () => {
    const { fuzzyMatch } = await import("../src/components/CommandPalette");
    const result = fuzzyMatch("lah", "Launch Account");
    expect(result.matches).toBe(true);
    // l at 0, a at 1, h is not present in Launch Account... let's check
    // "Launch Account" -> l(0) a(1) u(2) n(3) c(4) h(5)
    expect(result.indices[0]).toBe(0); // l
    expect(result.indices[1]).toBe(1); // a
    expect(result.indices[2]).toBe(5); // h
  });
});

describe("COMMANDS list", () => {
  test("contains all expected views", async () => {
    const { COMMANDS } = await import("../src/components/CommandPalette");
    const actions = COMMANDS.map((c) => c.action);

    const expectedViews = [
      "dashboard", "launcher", "usage", "tasks", "inbox",
      "add", "sla", "prompts", "analytics", "workflows",
      "health", "council", "verify", "entire", "chains",
      "tdd", "help", "quit",
    ];

    for (const view of expectedViews) {
      expect(actions).toContain(view);
    }
  });

  test("every command has an id, label, and action", async () => {
    const { COMMANDS } = await import("../src/components/CommandPalette");
    for (const cmd of COMMANDS) {
      expect(cmd.id).toBeTruthy();
      expect(cmd.label).toBeTruthy();
      expect(cmd.action).toBeTruthy();
    }
  });

  test("command count is 19", async () => {
    const { COMMANDS } = await import("../src/components/CommandPalette");
    expect(COMMANDS.length).toBe(19);
  });
});
