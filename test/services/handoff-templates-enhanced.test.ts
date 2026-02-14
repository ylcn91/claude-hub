import { describe, test, expect, beforeEach } from "bun:test";
import { loadTemplates, getTemplate, mergeTemplate } from "../../src/services/handoff-templates";

describe("Enhanced Handoff Templates", () => {
  test("built-in templates include code-review", async () => {
    const templates = await loadTemplates();
    const codeReview = templates.find((t) => t.name === "code-review");
    expect(codeReview).toBeDefined();
    expect(codeReview!.id).toBe("builtin-code-review");
    expect(codeReview!.description).toContain("PR link");
    expect(codeReview!.payload.acceptance_criteria).toBeDefined();
    expect(codeReview!.payload.acceptance_criteria!.length).toBeGreaterThanOrEqual(3);
    expect(codeReview!.payload.acceptance_criteria!.some((c) => c.includes("PR link"))).toBe(true);
    expect(codeReview!.payload.acceptance_criteria!.some((c) => c.includes("focus areas"))).toBe(true);
    expect(codeReview!.payload.acceptance_criteria!.some((c) => c.includes("checklist"))).toBe(true);
  });

  test("built-in templates include investigation", async () => {
    const templates = await loadTemplates();
    const investigation = templates.find((t) => t.name === "investigation");
    expect(investigation).toBeDefined();
    expect(investigation!.id).toBe("builtin-investigation");
    expect(investigation!.description).toContain("symptoms");
    expect(investigation!.payload.acceptance_criteria).toBeDefined();
    expect(investigation!.payload.acceptance_criteria!.length).toBeGreaterThanOrEqual(3);
    expect(investigation!.payload.acceptance_criteria!.some((c) => c.includes("Symptoms"))).toBe(true);
    expect(investigation!.payload.acceptance_criteria!.some((c) => c.includes("hypothesis"))).toBe(true);
    expect(investigation!.payload.acceptance_criteria!.some((c) => c.includes("investigation steps"))).toBe(true);
  });

  test("getTemplate finds code-review by name", async () => {
    const template = await getTemplate("code-review");
    expect(template).not.toBeNull();
    expect(template!.name).toBe("code-review");
  });

  test("getTemplate finds investigation by id", async () => {
    const template = await getTemplate("builtin-investigation");
    expect(template).not.toBeNull();
    expect(template!.name).toBe("investigation");
  });

  test("mergeTemplate works with code-review template", async () => {
    const template = await getTemplate("code-review");
    expect(template).not.toBeNull();
    const merged = mergeTemplate(template!, {
      goal: "Review PR #42 for security issues",
    });
    expect(merged.goal).toBe("Review PR #42 for security issues");
    expect(merged.acceptance_criteria.length).toBeGreaterThanOrEqual(3);
    expect(merged.run_commands).toEqual(["bun test"]);
    expect(merged.blocked_by).toEqual(["none"]);
  });

  test("mergeTemplate allows overriding investigation criteria", async () => {
    const template = await getTemplate("investigation");
    expect(template).not.toBeNull();
    const customCriteria = ["Bug is fully understood", "Fix plan documented"];
    const merged = mergeTemplate(template!, {
      goal: "Investigate login timeout issue",
      acceptance_criteria: customCriteria,
    });
    expect(merged.goal).toBe("Investigate login timeout issue");
    expect(merged.acceptance_criteria).toEqual(customCriteria);
  });

  test("all 5 built-in templates are present", async () => {
    const templates = await loadTemplates();
    const builtInNames = templates.filter((t) => t.id.startsWith("builtin-")).map((t) => t.name);
    expect(builtInNames).toContain("bug-fix");
    expect(builtInNames).toContain("feature-impl");
    expect(builtInNames).toContain("refactor");
    expect(builtInNames).toContain("code-review");
    expect(builtInNames).toContain("investigation");
    expect(builtInNames.length).toBe(5);
  });
});

describe("list_handoff_types consistency", () => {
  test("list_handoff_types returns all built-in types", async () => {
    const templates = await loadTemplates();
    // Simulate what the MCP tool does (after our fix)
    const types = templates.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      acceptance_criteria: t.payload.acceptance_criteria ?? [],
      run_commands: t.payload.run_commands ?? [],
      blocked_by: t.payload.blocked_by ?? ["none"],
    }));

    const builtInTypes = types.filter((t) => t.id.startsWith("builtin-"));
    expect(builtInTypes.length).toBe(5);

    const expectedNames = ["bug-fix", "feature-impl", "refactor", "code-review", "investigation"];
    for (const name of expectedNames) {
      const found = builtInTypes.find((t) => t.name === name);
      expect(found).toBeDefined();
    }
  });

  test("built-in templates have required fields (goal placeholder, acceptanceCriteria, etc.)", async () => {
    const templates = await loadTemplates();
    const builtIns = templates.filter((t) => t.id.startsWith("builtin-"));

    for (const template of builtIns) {
      // Every built-in template should have:
      expect(template.id).toBeTruthy();
      expect(template.name).toBeTruthy();
      expect(template.description).toBeTruthy();

      // Payload should have acceptance_criteria
      expect(template.payload.acceptance_criteria).toBeDefined();
      expect(template.payload.acceptance_criteria!.length).toBeGreaterThan(0);

      // Payload should have run_commands
      expect(template.payload.run_commands).toBeDefined();
      expect(template.payload.run_commands!.length).toBeGreaterThan(0);

      // Payload should have blocked_by
      expect(template.payload.blocked_by).toBeDefined();
      expect(template.payload.blocked_by!.length).toBeGreaterThan(0);

      // Timestamps should be set
      expect(template.createdAt).toBeTruthy();
      expect(template.updatedAt).toBeTruthy();
    }
  });

  test("handoff types response includes acceptance_criteria, run_commands, and blocked_by", async () => {
    const templates = await loadTemplates();
    // Simulate the updated MCP tool response format
    const types = templates.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      acceptance_criteria: t.payload.acceptance_criteria ?? [],
      run_commands: t.payload.run_commands ?? [],
      blocked_by: t.payload.blocked_by ?? ["none"],
    }));

    for (const type of types) {
      expect(type).toHaveProperty("id");
      expect(type).toHaveProperty("name");
      expect(type).toHaveProperty("description");
      expect(type).toHaveProperty("acceptance_criteria");
      expect(type).toHaveProperty("run_commands");
      expect(type).toHaveProperty("blocked_by");

      // Verify arrays
      expect(type.acceptance_criteria).toBeInstanceOf(Array);
      expect(type.run_commands).toBeInstanceOf(Array);
      expect(type.blocked_by).toBeInstanceOf(Array);
    }
  });

  test("built-in template names match between loadTemplates and list format", async () => {
    const templates = await loadTemplates();
    const types = templates.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      acceptance_criteria: t.payload.acceptance_criteria ?? [],
      run_commands: t.payload.run_commands ?? [],
      blocked_by: t.payload.blocked_by ?? ["none"],
    }));

    // Every template should appear in both representations
    for (const template of templates) {
      const typeEntry = types.find((t) => t.id === template.id);
      expect(typeEntry).toBeDefined();
      expect(typeEntry!.name).toBe(template.name);
      expect(typeEntry!.description).toBe(template.description);
      expect(typeEntry!.acceptance_criteria).toEqual(template.payload.acceptance_criteria ?? []);
    }
  });
});
