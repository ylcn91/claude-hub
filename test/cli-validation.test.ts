import { test, expect, describe } from "bun:test";
import {
  ConfigSetArgsSchema,
  SessionNameArgsSchema,
  LaunchDirSchema,
  SearchPatternSchema,
  AddAccountArgsSchema,
} from "../src/daemon/schemas";

describe("ConfigSetArgsSchema", () => {
  test("accepts valid dotted key and value", () => {
    const result = ConfigSetArgsSchema.safeParse({ key: "theme", value: "tokyonight" });
    expect(result.success).toBe(true);
  });

  test("accepts dotted path key", () => {
    const result = ConfigSetArgsSchema.safeParse({ key: "features.council", value: "true" });
    expect(result.success).toBe(true);
  });

  test("accepts underscored key", () => {
    const result = ConfigSetArgsSchema.safeParse({ key: "my_setting", value: "hello" });
    expect(result.success).toBe(true);
  });

  test("rejects empty key", () => {
    const result = ConfigSetArgsSchema.safeParse({ key: "", value: "foo" });
    expect(result.success).toBe(false);
  });

  test("rejects key with shell metacharacters", () => {
    const result = ConfigSetArgsSchema.safeParse({ key: "foo;rm -rf /", value: "bar" });
    expect(result.success).toBe(false);
  });

  test("rejects key with spaces", () => {
    const result = ConfigSetArgsSchema.safeParse({ key: "key with spaces", value: "bar" });
    expect(result.success).toBe(false);
  });

  test("rejects key with special characters", () => {
    const result = ConfigSetArgsSchema.safeParse({ key: "key$var", value: "bar" });
    expect(result.success).toBe(false);
  });

  test("rejects key with slashes", () => {
    const result = ConfigSetArgsSchema.safeParse({ key: "../etc/passwd", value: "bar" });
    expect(result.success).toBe(false);
  });

  test("rejects value exceeding max length", () => {
    const result = ConfigSetArgsSchema.safeParse({ key: "theme", value: "x".repeat(10_001) });
    expect(result.success).toBe(false);
  });

  test("accepts value at max length", () => {
    const result = ConfigSetArgsSchema.safeParse({ key: "theme", value: "x".repeat(10_000) });
    expect(result.success).toBe(true);
  });

  test("rejects key exceeding 255 characters", () => {
    const result = ConfigSetArgsSchema.safeParse({ key: "a".repeat(256), value: "ok" });
    expect(result.success).toBe(false);
  });
});

describe("SessionNameArgsSchema", () => {
  test("accepts valid session id and name", () => {
    const result = SessionNameArgsSchema.safeParse({ sessionId: "abc-123", name: "my session" });
    expect(result.success).toBe(true);
  });

  test("rejects empty session id", () => {
    const result = SessionNameArgsSchema.safeParse({ sessionId: "", name: "my session" });
    expect(result.success).toBe(false);
  });

  test("rejects empty name", () => {
    const result = SessionNameArgsSchema.safeParse({ sessionId: "abc-123", name: "" });
    expect(result.success).toBe(false);
  });

  test("rejects session id exceeding 255 characters", () => {
    const result = SessionNameArgsSchema.safeParse({ sessionId: "a".repeat(256), name: "ok" });
    expect(result.success).toBe(false);
  });

  test("rejects name exceeding 255 characters", () => {
    const result = SessionNameArgsSchema.safeParse({ sessionId: "abc", name: "a".repeat(256) });
    expect(result.success).toBe(false);
  });

  test("accepts name at max length", () => {
    const result = SessionNameArgsSchema.safeParse({ sessionId: "abc", name: "a".repeat(255) });
    expect(result.success).toBe(true);
  });
});

describe("LaunchDirSchema", () => {
  test("accepts undefined dir (optional)", () => {
    const result = LaunchDirSchema.safeParse({ dir: undefined });
    expect(result.success).toBe(true);
  });

  test("accepts omitted dir", () => {
    const result = LaunchDirSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  test("accepts valid absolute path", () => {
    const result = LaunchDirSchema.safeParse({ dir: "/home/user/project" });
    expect(result.success).toBe(true);
  });

  test("accepts tilde path", () => {
    const result = LaunchDirSchema.safeParse({ dir: "~/projects/myapp" });
    expect(result.success).toBe(true);
  });

  test("accepts relative path", () => {
    const result = LaunchDirSchema.safeParse({ dir: "src/components" });
    expect(result.success).toBe(true);
  });

  test("accepts path with dots", () => {
    const result = LaunchDirSchema.safeParse({ dir: "/home/user/.config" });
    expect(result.success).toBe(true);
  });

  test("rejects path with shell metacharacters (semicolon)", () => {
    const result = LaunchDirSchema.safeParse({ dir: "/tmp; rm -rf /" });
    expect(result.success).toBe(false);
  });

  test("rejects path with backticks", () => {
    const result = LaunchDirSchema.safeParse({ dir: "/tmp/`whoami`" });
    expect(result.success).toBe(false);
  });

  test("rejects path with $() substitution", () => {
    const result = LaunchDirSchema.safeParse({ dir: "/tmp/$(whoami)" });
    expect(result.success).toBe(false);
  });

  test("rejects path with pipe", () => {
    const result = LaunchDirSchema.safeParse({ dir: "/tmp | cat /etc/passwd" });
    expect(result.success).toBe(false);
  });

  test("rejects path exceeding max length", () => {
    const result = LaunchDirSchema.safeParse({ dir: "/".padEnd(4097, "a") });
    expect(result.success).toBe(false);
  });
});

describe("SearchPatternSchema", () => {
  test("accepts valid search pattern", () => {
    const result = SearchPatternSchema.safeParse({ pattern: "my-account" });
    expect(result.success).toBe(true);
  });

  test("rejects empty pattern", () => {
    const result = SearchPatternSchema.safeParse({ pattern: "" });
    expect(result.success).toBe(false);
  });

  test("rejects pattern exceeding 1000 characters", () => {
    const result = SearchPatternSchema.safeParse({ pattern: "a".repeat(1001) });
    expect(result.success).toBe(false);
  });

  test("accepts pattern at max length", () => {
    const result = SearchPatternSchema.safeParse({ pattern: "a".repeat(1000) });
    expect(result.success).toBe(true);
  });

  test("accepts pattern with special search characters", () => {
    const result = SearchPatternSchema.safeParse({ pattern: "foo*bar" });
    expect(result.success).toBe(true);
  });
});

describe("AddAccountArgsSchema (existing, regression)", () => {
  test("accepts valid account", () => {
    const result = AddAccountArgsSchema.safeParse({ name: "myaccount" });
    expect(result.success).toBe(true);
  });

  test("rejects empty name", () => {
    const result = AddAccountArgsSchema.safeParse({ name: "" });
    expect(result.success).toBe(false);
  });

  test("accepts valid provider", () => {
    const result = AddAccountArgsSchema.safeParse({ name: "test", provider: "claude-code" });
    expect(result.success).toBe(true);
  });

  test("rejects invalid provider", () => {
    const result = AddAccountArgsSchema.safeParse({ name: "test", provider: "invalid" });
    expect(result.success).toBe(false);
  });
});
