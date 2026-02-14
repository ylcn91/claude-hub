import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { join } from "path";
import { mkdirSync, rmSync } from "fs";

const TEST_DIR = join(import.meta.dir, ".test-handoff-templates");

beforeAll(() => {
  process.env.AGENTCTL_DIR = TEST_DIR;
  mkdirSync(TEST_DIR, { recursive: true });
});

afterAll(() => {
  delete process.env.AGENTCTL_DIR;
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("handoff templates", () => {
  test("loadTemplates returns built-in templates", async () => {
    const { loadTemplates } = await import("../src/services/handoff-templates");
    const templates = await loadTemplates();
    expect(templates.length).toBeGreaterThanOrEqual(3);
    expect(templates.some((t) => t.name === "bug-fix")).toBe(true);
    expect(templates.some((t) => t.name === "feature-impl")).toBe(true);
    expect(templates.some((t) => t.name === "refactor")).toBe(true);
  });

  test("getTemplate finds built-in by name", async () => {
    const { getTemplate } = await import("../src/services/handoff-templates");
    const tmpl = await getTemplate("bug-fix");
    expect(tmpl).not.toBeNull();
    expect(tmpl!.name).toBe("bug-fix");
    expect(tmpl!.payload.run_commands).toEqual(["bun test"]);
  });

  test("getTemplate finds built-in by id", async () => {
    const { getTemplate } = await import("../src/services/handoff-templates");
    const tmpl = await getTemplate("builtin-bug-fix");
    expect(tmpl).not.toBeNull();
    expect(tmpl!.name).toBe("bug-fix");
  });

  test("saveTemplate persists custom template", async () => {
    const { saveTemplate, loadTemplates } = await import("../src/services/handoff-templates");
    const saved = await saveTemplate({
      name: "custom-deploy",
      description: "Deployment template",
      payload: {
        acceptance_criteria: ["Deploys successfully"],
        run_commands: ["bun run deploy"],
        blocked_by: ["none"],
      },
    });
    expect(saved.id).toBeDefined();
    expect(saved.name).toBe("custom-deploy");

    const all = await loadTemplates();
    expect(all.some((t) => t.name === "custom-deploy")).toBe(true);
  });

  test("deleteTemplate removes custom template", async () => {
    const { saveTemplate, deleteTemplate, loadTemplates } = await import("../src/services/handoff-templates");
    const saved = await saveTemplate({
      name: "to-delete",
      description: "Will be deleted",
      payload: {},
    });
    const deleted = await deleteTemplate(saved.id);
    expect(deleted).toBe(true);

    const all = await loadTemplates();
    expect(all.some((t) => t.id === saved.id)).toBe(false);
  });

  test("deleteTemplate returns false for nonexistent", async () => {
    const { deleteTemplate } = await import("../src/services/handoff-templates");
    const deleted = await deleteTemplate("nonexistent-id");
    expect(deleted).toBe(false);
  });

  test("mergeTemplate combines template with overrides", async () => {
    const { getTemplate, mergeTemplate } = await import("../src/services/handoff-templates");
    const tmpl = await getTemplate("bug-fix");
    expect(tmpl).not.toBeNull();

    const merged = mergeTemplate(tmpl!, {
      goal: "Fix login timeout bug",
      run_commands: ["bun test test/auth.test.ts"],
    });

    expect(merged.goal).toBe("Fix login timeout bug");
    expect(merged.run_commands).toEqual(["bun test test/auth.test.ts"]);
    // acceptance_criteria from template
    expect(merged.acceptance_criteria.length).toBeGreaterThan(0);
    expect(merged.blocked_by).toEqual(["none"]);
  });
});
