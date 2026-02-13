import { describe, test, expect } from "bun:test";
import {
  validateWorkspaceRequest,
  isValidBranch,
  isActiveStatus,
  computeWorktreePath,
} from "../src/services/workspace";

describe("validateWorkspaceRequest", () => {
  test("valid request passes", () => {
    const result = validateWorkspaceRequest({
      repoPath: "/home/user/repo",
      branch: "main",
      ownerAccount: "alice",
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test("missing repoPath is invalid", () => {
    const result = validateWorkspaceRequest({
      branch: "main",
      ownerAccount: "alice",
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("repoPath");
  });

  test("relative repoPath is invalid", () => {
    const result = validateWorkspaceRequest({
      repoPath: "relative/path",
      branch: "main",
      ownerAccount: "alice",
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("absolute");
  });

  test("empty branch is invalid", () => {
    const result = validateWorkspaceRequest({
      repoPath: "/home/user/repo",
      branch: "",
      ownerAccount: "alice",
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e: string) => e.includes("branch"))).toBe(true);
  });

  test("empty ownerAccount is invalid", () => {
    const result = validateWorkspaceRequest({
      repoPath: "/home/user/repo",
      branch: "main",
      ownerAccount: "",
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e: string) => e.includes("ownerAccount"))).toBe(true);
  });

  test("branch with .. is invalid", () => {
    const result = validateWorkspaceRequest({
      repoPath: "/home/user/repo",
      branch: "../escape",
      ownerAccount: "alice",
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e: string) => e.includes("'..'"))).toBe(true);
  });

  test("branch with shell metacharacters is invalid", () => {
    const result = validateWorkspaceRequest({
      repoPath: "/home/user/repo",
      branch: "foo;rm -rf",
      ownerAccount: "alice",
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e: string) => e.includes("invalid characters"))).toBe(true);
  });

  test("branch with spaces is invalid", () => {
    const result = validateWorkspaceRequest({
      repoPath: "/home/user/repo",
      branch: "my branch",
      ownerAccount: "alice",
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e: string) => e.includes("invalid characters"))).toBe(true);
  });

  test("branch starting with / is invalid", () => {
    const result = validateWorkspaceRequest({
      repoPath: "/home/user/repo",
      branch: "/feature/foo",
      ownerAccount: "alice",
    });
    expect(result.valid).toBe(false);
  });

  test("branch starting with - is invalid", () => {
    const result = validateWorkspaceRequest({
      repoPath: "/home/user/repo",
      branch: "-dangerous",
      ownerAccount: "alice",
    });
    expect(result.valid).toBe(false);
  });

  test("branch with namespaced slashes is valid", () => {
    const result = validateWorkspaceRequest({
      repoPath: "/home/user/repo",
      branch: "feature/my-feature",
      ownerAccount: "alice",
    });
    expect(result.valid).toBe(true);
  });

  test("branch with dot-prefixed segment is invalid", () => {
    const result = validateWorkspaceRequest({
      repoPath: "/home/user/repo",
      branch: "feature/.hidden",
      ownerAccount: "alice",
    });
    expect(result.valid).toBe(false);
  });
});

describe("isValidBranch", () => {
  test("simple branch names are valid", () => {
    expect(isValidBranch("main")).toBe(true);
    expect(isValidBranch("develop")).toBe(true);
    expect(isValidBranch("v1.0.0")).toBe(true);
  });

  test("namespaced branches are valid", () => {
    expect(isValidBranch("feature/my-feature")).toBe(true);
    expect(isValidBranch("user/feature/bar")).toBe(true);
    expect(isValidBranch("release/1.0")).toBe(true);
  });

  test("empty branch is invalid", () => {
    expect(isValidBranch("")).toBe(false);
  });

  test("branch starting with / is invalid", () => {
    expect(isValidBranch("/foo")).toBe(false);
  });

  test("branch starting with - is invalid", () => {
    expect(isValidBranch("-flag")).toBe(false);
  });

  test("branch with .. is invalid", () => {
    expect(isValidBranch("../escape")).toBe(false);
    expect(isValidBranch("foo/../bar")).toBe(false);
  });

  test("branch with dot-prefixed segment is invalid", () => {
    expect(isValidBranch(".hidden")).toBe(false);
    expect(isValidBranch("feature/.hidden")).toBe(false);
  });

  test("branch over 200 chars is invalid", () => {
    expect(isValidBranch("a".repeat(201))).toBe(false);
    expect(isValidBranch("a".repeat(200))).toBe(true);
  });

  test("empty segment (double slash) is invalid", () => {
    expect(isValidBranch("feature//bar")).toBe(false);
  });
});

describe("isActiveStatus", () => {
  test("preparing is active", () => {
    expect(isActiveStatus("preparing")).toBe(true);
  });

  test("ready is active", () => {
    expect(isActiveStatus("ready")).toBe(true);
  });

  test("cleaning is active", () => {
    expect(isActiveStatus("cleaning")).toBe(true);
  });

  test("failed is not active", () => {
    expect(isActiveStatus("failed")).toBe(false);
  });
});

describe("computeWorktreePath", () => {
  test("simple branch name", () => {
    expect(computeWorktreePath("/repo", "main")).toBe("/repo/.worktrees/main");
  });

  test("converts slashes to dashes", () => {
    expect(computeWorktreePath("/repo", "feature/foo")).toBe(
      "/repo/.worktrees/feature-foo"
    );
  });

  test("handles multiple slashes", () => {
    expect(computeWorktreePath("/repo", "user/feature/bar")).toBe(
      "/repo/.worktrees/user-feature-bar"
    );
  });

  test("path traversal via .. is detected", () => {
    expect(() => computeWorktreePath("/repo", "..")).toThrow("Path traversal");
  });

  test("safe branch names with .. substring do not throw", () => {
    // After slash replacement, "-.."/"..-foo" resolve inside base, so they are safe
    expect(computeWorktreePath("/repo", "-..")).toBe("/repo/.worktrees/-..");
    expect(computeWorktreePath("/repo", "../escape")).toBe("/repo/.worktrees/..-escape");
  });
});
