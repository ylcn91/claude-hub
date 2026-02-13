import { describe, test, expect } from "bun:test";
import { shellQuote, buildShellCommand } from "../src/services/shell-quote";

describe("shellQuote", () => {
  test("simple alphanumeric args pass through", () => {
    expect(shellQuote("hello")).toBe("hello");
    expect(shellQuote("foo-bar_baz")).toBe("foo-bar_baz");
    expect(shellQuote("/usr/bin/node")).toBe("/usr/bin/node");
    expect(shellQuote("KEY=value")).toBe("KEY=value");
  });

  test("paths with spaces are quoted", () => {
    expect(shellQuote("/path/with spaces/dir")).toBe("'/path/with spaces/dir'");
  });

  test("single quotes in args are escaped", () => {
    expect(shellQuote("it's")).toBe("'it'\"'\"'s'");
  });

  test("shell metacharacters are quoted", () => {
    expect(shellQuote("; rm -rf /")).toBe("'; rm -rf /'");
    expect(shellQuote("$(whoami)")).toBe("'$(whoami)'");
    expect(shellQuote("`id`")).toBe("'`id`'");
    expect(shellQuote("foo|bar")).toBe("'foo|bar'");
    expect(shellQuote("a&b")).toBe("'a&b'");
  });

  test("empty string is quoted", () => {
    expect(shellQuote("")).toBe("''");
  });
});

describe("buildShellCommand", () => {
  test("joins simple args with spaces", () => {
    expect(buildShellCommand(["echo", "hello"])).toBe("echo hello");
  });

  test("quotes args that need it", () => {
    const cmd = buildShellCommand(["CLAUDE_CONFIG=/path with spaces/config", "claude", "--dir", "/my project"]);
    expect(cmd).toBe("'CLAUDE_CONFIG=/path with spaces/config' claude --dir '/my project'");
  });

  test("prevents injection via semicolons", () => {
    const cmd = buildShellCommand(["echo", "; rm -rf /"]);
    expect(cmd).toContain("'; rm -rf /'");
    expect(cmd).not.toContain("echo ; rm");
  });
});
