import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { join } from "path";
import { mkdirSync, rmSync } from "fs";

const TEST_DIR = join(import.meta.dir, ".test-prompt-library");

beforeAll(() => {
  process.env.CLAUDE_HUB_DIR = TEST_DIR;
  mkdirSync(TEST_DIR, { recursive: true });
});

afterAll(() => {
  delete process.env.CLAUDE_HUB_DIR;
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("prompt library", () => {
  let savedId: string;

  test("loadPrompts returns empty initially", async () => {
    const { loadPrompts } = await import("../src/services/prompt-library");
    const prompts = await loadPrompts();
    expect(prompts).toEqual([]);
  });

  test("savePrompt creates a new prompt", async () => {
    const { savePrompt } = await import("../src/services/prompt-library");
    const prompt = await savePrompt({
      title: "Code Review",
      content: "Review this code for bugs, security issues, and style",
      tags: ["review", "code"],
    });
    expect(prompt.id).toBeDefined();
    expect(prompt.title).toBe("Code Review");
    expect(prompt.content).toContain("Review this code");
    expect(prompt.usageCount).toBe(0);
    expect(prompt.tags).toEqual(["review", "code"]);
    savedId = prompt.id;
  });

  test("loadPrompts returns saved prompts", async () => {
    const { loadPrompts } = await import("../src/services/prompt-library");
    const prompts = await loadPrompts();
    expect(prompts.length).toBeGreaterThanOrEqual(1);
    expect(prompts.some((p) => p.title === "Code Review")).toBe(true);
  });

  test("getPrompt retrieves by id and increments usageCount", async () => {
    const { getPrompt } = await import("../src/services/prompt-library");
    const prompt = await getPrompt(savedId);
    expect(prompt).not.toBeNull();
    expect(prompt!.title).toBe("Code Review");
    expect(prompt!.usageCount).toBe(1);

    // Get again — count should be 2
    const prompt2 = await getPrompt(savedId);
    expect(prompt2!.usageCount).toBe(2);
  });

  test("getPrompt returns null for nonexistent id", async () => {
    const { getPrompt } = await import("../src/services/prompt-library");
    const prompt = await getPrompt("nonexistent-id");
    expect(prompt).toBeNull();
  });

  test("updatePrompt updates fields", async () => {
    const { updatePrompt } = await import("../src/services/prompt-library");
    const updated = await updatePrompt(savedId, {
      title: "Enhanced Code Review",
      tags: ["review", "code", "enhanced"],
    });
    expect(updated).not.toBeNull();
    expect(updated!.title).toBe("Enhanced Code Review");
    expect(updated!.tags).toEqual(["review", "code", "enhanced"]);
  });

  test("searchPrompts finds by title", async () => {
    const { searchPrompts } = await import("../src/services/prompt-library");
    const results = await searchPrompts("enhanced");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].title).toContain("Enhanced");
  });

  test("searchPrompts finds by tag", async () => {
    const { searchPrompts } = await import("../src/services/prompt-library");
    const results = await searchPrompts("review");
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  test("searchPrompts returns empty for no match", async () => {
    const { searchPrompts } = await import("../src/services/prompt-library");
    const results = await searchPrompts("zzz-nonexistent-zzz");
    expect(results).toEqual([]);
  });

  test("deletePrompt removes prompt", async () => {
    const { deletePrompt, loadPrompts } = await import("../src/services/prompt-library");
    const deleted = await deletePrompt(savedId);
    expect(deleted).toBe(true);

    const prompts = await loadPrompts();
    expect(prompts.some((p) => p.id === savedId)).toBe(false);
  });

  test("deletePrompt returns false for nonexistent", async () => {
    const { deletePrompt } = await import("../src/services/prompt-library");
    const deleted = await deletePrompt("nonexistent-id");
    expect(deleted).toBe(false);
  });
});
