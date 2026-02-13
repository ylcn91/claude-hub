import { describe, test, expect, spyOn, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";

describe("github integration exports", () => {
  test("createIssue is an exported async function", async () => {
    const { createIssue } = await import("../src/integrations/github");
    expect(typeof createIssue).toBe("function");
  });

  test("commentOnIssue is an exported async function", async () => {
    const { commentOnIssue } = await import("../src/integrations/github");
    expect(typeof commentOnIssue).toBe("function");
  });

  test("commentOnPR is an exported async function", async () => {
    const { commentOnPR } = await import("../src/integrations/github");
    expect(typeof commentOnPR).toBe("function");
  });

  test("closeIssue is an exported async function", async () => {
    const { closeIssue } = await import("../src/integrations/github");
    expect(typeof closeIssue).toBe("function");
  });

  test("getIssueStatus is an exported async function", async () => {
    const { getIssueStatus } = await import("../src/integrations/github");
    expect(typeof getIssueStatus).toBe("function");
  });
});

describe("github integration argument construction", () => {
  let spawnSpy: ReturnType<typeof spyOn>;
  let capturedArgs: string[][] = [];

  function mockSpawn() {
    capturedArgs = [];
    spawnSpy = spyOn(Bun, "spawn").mockImplementation(((cmdOrArgs: any, _opts?: any) => {
      const args = Array.isArray(cmdOrArgs) ? cmdOrArgs : [cmdOrArgs];
      capturedArgs.push(args);
      return {
        exited: Promise.resolve(0),
        stdout: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(JSON.stringify({ number: 1, url: "https://github.com/test/repo/issues/1" })));
            controller.close();
          },
        }),
        stderr: new ReadableStream({ start(c) { c.close(); } }),
        pid: 1234,
        killed: false,
        exitCode: 0,
        signalCode: null,
        kill: () => {},
        ref: () => {},
        unref: () => {},
        stdin: null,
        resourceUsage: () => undefined as any,
      } as any;
    }) as any);
  }

  beforeEach(() => {
    mockSpawn();
  });

  afterEach(() => {
    spawnSpy?.mockRestore();
  });

  test("createIssue constructs correct args with title and body", async () => {
    const { createIssue } = await import("../src/integrations/github");
    await createIssue({
      owner: "myorg",
      repo: "myrepo",
      title: "Test issue title",
      body: "Issue body content",
      labels: ["bug", "p1"],
    });

    expect(capturedArgs).toHaveLength(1);
    const args = capturedArgs[0];
    expect(args[0]).toBe("gh");
    expect(args).toContain("issue");
    expect(args).toContain("create");
    expect(args).toContain("--repo");
    expect(args).toContain("myorg/myrepo");
    expect(args).toContain("--title");
    expect(args).toContain("Test issue title");
    expect(args).toContain("--body");
    expect(args).toContain("Issue body content");
    expect(args).toContain("--label");
    expect(args).toContain("bug,p1");
  });

  test("createIssue omits body when not provided", async () => {
    const { createIssue } = await import("../src/integrations/github");
    await createIssue({
      owner: "org",
      repo: "repo",
      title: "No body",
    });

    const args = capturedArgs[0];
    expect(args).not.toContain("--body");
    expect(args).toContain("--title");
    expect(args).toContain("No body");
  });

  test("commentOnIssue constructs correct args", async () => {
    const { commentOnIssue } = await import("../src/integrations/github");
    await commentOnIssue({
      owner: "org",
      repo: "repo",
      issueNumber: 42,
      body: "A comment",
    });

    const args = capturedArgs[0];
    expect(args[0]).toBe("gh");
    expect(args).toContain("issue");
    expect(args).toContain("comment");
    expect(args).toContain("42");
    expect(args).toContain("--repo");
    expect(args).toContain("org/repo");
    expect(args).toContain("--body");
    expect(args).toContain("A comment");
  });

  test("commentOnPR constructs correct args", async () => {
    const { commentOnPR } = await import("../src/integrations/github");
    await commentOnPR({
      owner: "org",
      repo: "repo",
      prNumber: 99,
      body: "PR feedback",
    });

    const args = capturedArgs[0];
    expect(args[0]).toBe("gh");
    expect(args).toContain("pr");
    expect(args).toContain("comment");
    expect(args).toContain("99");
    expect(args).toContain("--body");
    expect(args).toContain("PR feedback");
  });

  test("uses Bun.spawn (no shell) for command injection safety", async () => {
    const { createIssue } = await import("../src/integrations/github");
    await createIssue({
      owner: "org",
      repo: "repo",
      title: "Title with $(dangerous) && rm -rf /",
      body: "--web --edit-last",
    });

    // Bun.spawn passes args as array (execve), not through shell
    expect(spawnSpy).toHaveBeenCalled();
    const args = capturedArgs[0];
    // Dangerous content is passed as a single array element, not shell-interpreted
    expect(args).toContain("Title with $(dangerous) && rm -rf /");
    expect(args).toContain("--web --edit-last");
  });

  test("runGh throws on non-zero exit code", async () => {
    spawnSpy.mockRestore();
    spawnSpy = spyOn(Bun, "spawn").mockImplementation((() => {
      return {
        exited: Promise.resolve(1),
        stdout: new ReadableStream({ start(c) { c.close(); } }),
        stderr: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("fatal: not found"));
            controller.close();
          },
        }),
        pid: 1234,
        killed: false,
        exitCode: 1,
        signalCode: null,
        kill: () => {},
        ref: () => {},
        unref: () => {},
        stdin: null,
        resourceUsage: () => undefined as any,
      } as any;
    }) as any);

    const { runGh } = await import("../src/integrations/github");
    expect(runGh(["issue", "view", "999"])).rejects.toThrow("gh failed");
  });
});

describe("integration-hooks parseExternalId", () => {
  test("parses owner/repo#123 format correctly", async () => {
    const { parseExternalId } = await import("../src/services/integration-hooks");
    const result = parseExternalId("myorg/myrepo#42");
    expect(result.owner).toBe("myorg");
    expect(result.repo).toBe("myrepo");
    expect(result.number).toBe(42);
  });

  test("parses nested repo paths", async () => {
    const { parseExternalId } = await import("../src/services/integration-hooks");
    const result = parseExternalId("owner/complex-repo-name#999");
    expect(result.owner).toBe("owner");
    expect(result.repo).toBe("complex-repo-name");
    expect(result.number).toBe(999);
  });

  test("throws on invalid format without hash", async () => {
    const { parseExternalId } = await import("../src/services/integration-hooks");
    expect(() => parseExternalId("owner/repo")).toThrow("Invalid externalId format");
  });

  test("throws on invalid format without slash", async () => {
    const { parseExternalId } = await import("../src/services/integration-hooks");
    expect(() => parseExternalId("ownerrepo#123")).toThrow("Invalid externalId format");
  });
});

describe("integration-hooks onTaskStatusChanged", () => {
  const TEST_DIR = join(import.meta.dir, ".test-integration-hooks");

  test("does not throw with no links", async () => {
    process.env.CLAUDE_HUB_DIR = TEST_DIR;
    mkdirSync(TEST_DIR, { recursive: true });

    try {
      const { onTaskStatusChanged } = await import("../src/services/integration-hooks");
      // Should not throw even with no links file
      await onTaskStatusChanged("nonexistent-task", "accepted");
    } finally {
      rmSync(TEST_DIR, { recursive: true, force: true });
      delete process.env.CLAUDE_HUB_DIR;
    }
  });
});
