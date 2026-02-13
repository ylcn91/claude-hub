import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { $ } from "bun";
import { join } from "path";
import { mkdirSync, rmSync, existsSync, readFileSync } from "fs";

const TEST_DIR = join(import.meta.dir, ".test-integration");
const CLI_PATH = join(import.meta.dir, "..", "src", "cli.tsx");

const origHubDir = process.env.CLAUDE_HUB_DIR;

beforeAll(() => {
  process.env.CLAUDE_HUB_DIR = TEST_DIR;
  mkdirSync(TEST_DIR, { recursive: true });
});

afterAll(() => {
  process.env.CLAUDE_HUB_DIR = origHubDir;
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("CLI integration", () => {
  test("ch --help shows usage", async () => {
    const result = await $`bun ${CLI_PATH} --help`.env({ ...process.env, CLAUDE_HUB_DIR: TEST_DIR }).quiet().nothrow();
    const output = result.stdout.toString();
    expect(output).toContain("Usage");
    expect(output).toContain("ch");
  });

  test("ch add creates account", async () => {
    const configDir = join(TEST_DIR, "accounts", "test-work");
    const result = await $`bun ${CLI_PATH} add test-work --dir ${configDir} --color '#89b4fa' --label Work`
      .env({ ...process.env, CLAUDE_HUB_DIR: TEST_DIR })
      .quiet()
      .nothrow();

    const output = result.stdout.toString();
    expect(output).toContain("Account 'test-work' created");
    expect(existsSync(configDir)).toBe(true);

    // Token should exist
    const tokenPath = join(TEST_DIR, "tokens", "test-work.token");
    expect(existsSync(tokenPath)).toBe(true);

    // Config should have the account
    const config = JSON.parse(readFileSync(join(TEST_DIR, "config.json"), "utf-8"));
    expect(config.accounts.some((a: any) => a.name === "test-work")).toBe(true);
  });

  test("ch list shows accounts", async () => {
    const result = await $`bun ${CLI_PATH} list`
      .env({ ...process.env, CLAUDE_HUB_DIR: TEST_DIR })
      .quiet()
      .nothrow();
    const output = result.stdout.toString();
    expect(output).toContain("test-work");
    expect(output).toContain("Work");
  });

  test("ch status shows account status", async () => {
    const result = await $`bun ${CLI_PATH} status`
      .env({ ...process.env, CLAUDE_HUB_DIR: TEST_DIR })
      .quiet()
      .nothrow();
    const output = result.stdout.toString();
    expect(output).toContain("test-work");
  });

  test("ch usage shows usage table", async () => {
    const result = await $`bun ${CLI_PATH} usage`
      .env({ ...process.env, CLAUDE_HUB_DIR: TEST_DIR })
      .quiet()
      .nothrow();
    const output = result.stdout.toString();
    expect(output).toContain("Account");
    expect(output).toContain("Today");
    expect(output).toContain("test-work");
  });

  test("ch add rejects duplicate", async () => {
    const result = await $`bun ${CLI_PATH} add test-work --dir /tmp/dup --color '#ff0000' --label Dup`
      .env({ ...process.env, CLAUDE_HUB_DIR: TEST_DIR })
      .quiet()
      .nothrow();
    expect(result.exitCode).not.toBe(0);
    const stderr = result.stderr.toString();
    expect(stderr).toContain("already exists");
  });

  test("ch remove removes account", async () => {
    const result = await $`bun ${CLI_PATH} remove test-work`
      .env({ ...process.env, CLAUDE_HUB_DIR: TEST_DIR })
      .quiet()
      .nothrow();
    const output = result.stdout.toString();
    expect(output).toContain("Account 'test-work' removed");

    // Config should no longer have the account
    const config = JSON.parse(readFileSync(join(TEST_DIR, "config.json"), "utf-8"));
    expect(config.accounts.some((a: any) => a.name === "test-work")).toBe(false);
  });

  test("ch list shows no accounts after removal", async () => {
    const result = await $`bun ${CLI_PATH} list`
      .env({ ...process.env, CLAUDE_HUB_DIR: TEST_DIR })
      .quiet()
      .nothrow();
    const output = result.stdout.toString();
    expect(output).toContain("No accounts configured");
  });
});

describe("package.json", () => {
  test("bin.ch points to cli.tsx", () => {
    const pkg = JSON.parse(readFileSync(join(import.meta.dir, "..", "package.json"), "utf-8"));
    expect(pkg.bin?.ch).toBe("./src/cli.tsx");
  });
});
