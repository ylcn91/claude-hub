import { atomicWrite, atomicRead } from "./file-store";
import type { HandoffPayload } from "./handoff";

import { getHandoffTemplatesPath } from "../paths";

const TEMPLATES_PATH = getHandoffTemplatesPath();

export interface HandoffTemplate {
  id: string;
  name: string;
  description: string;
  payload: Partial<HandoffPayload>;
  createdAt: string;
  updatedAt: string;
}

interface TemplateStore {
  templates: HandoffTemplate[];
}

const BUILT_IN_TEMPLATES: HandoffTemplate[] = [
  {
    id: "builtin-bug-fix",
    name: "bug-fix",
    description: "Standard bug fix template with test verification",
    payload: {
      acceptance_criteria: ["Bug is reproducible before fix", "Fix resolves the reported issue", "No regression in related functionality"],
      run_commands: ["bun test"],
      blocked_by: ["none"],
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "builtin-feature-impl",
    name: "feature-impl",
    description: "New feature implementation template",
    payload: {
      acceptance_criteria: ["Feature works as specified", "Tests cover happy path and edge cases", "No breaking changes to existing API"],
      run_commands: ["bun test"],
      blocked_by: ["none"],
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "builtin-refactor",
    name: "refactor",
    description: "Code refactoring template — no behavior changes",
    payload: {
      acceptance_criteria: ["All existing tests still pass", "No functional behavior change", "Code is cleaner/more maintainable"],
      run_commands: ["bun test"],
      blocked_by: ["none"],
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
];

async function loadStore(): Promise<TemplateStore> {
  const data = await atomicRead<TemplateStore>(TEMPLATES_PATH);
  return data ?? { templates: [] };
}

export async function loadTemplates(): Promise<HandoffTemplate[]> {
  const store = await loadStore();
  return [...BUILT_IN_TEMPLATES, ...store.templates];
}

export async function getTemplate(id: string): Promise<HandoffTemplate | null> {
  const all = await loadTemplates();
  return all.find((t) => t.id === id || t.name === id) ?? null;
}

export async function saveTemplate(template: Omit<HandoffTemplate, "id" | "createdAt" | "updatedAt">): Promise<HandoffTemplate> {
  const store = await loadStore();
  const now = new Date().toISOString();
  const entry: HandoffTemplate = {
    ...template,
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
  };
  store.templates.push(entry);
  await atomicWrite(TEMPLATES_PATH, store);
  return entry;
}

export async function deleteTemplate(id: string): Promise<boolean> {
  const store = await loadStore();
  const before = store.templates.length;
  store.templates = store.templates.filter((t) => t.id !== id);
  if (store.templates.length === before) return false;
  await atomicWrite(TEMPLATES_PATH, store);
  return true;
}

export function mergeTemplate(
  template: HandoffTemplate,
  overrides: Partial<HandoffPayload>,
): HandoffPayload {
  return {
    goal: overrides.goal ?? template.payload.goal ?? "",
    acceptance_criteria: overrides.acceptance_criteria ?? template.payload.acceptance_criteria ?? [],
    run_commands: overrides.run_commands ?? template.payload.run_commands ?? [],
    blocked_by: overrides.blocked_by ?? template.payload.blocked_by ?? ["none"],
  };
}
