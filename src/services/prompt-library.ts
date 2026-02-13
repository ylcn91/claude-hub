import { atomicWrite, atomicRead } from "./file-store";

const PROMPTS_PATH = `${process.env.CLAUDE_HUB_DIR ?? process.env.HOME + "/.claude-hub"}/prompts.json`;

export interface SavedPrompt {
  id: string;
  title: string;
  content: string;
  tags?: string[];
  usageCount: number;
  createdAt: string;
  updatedAt: string;
}

interface PromptStore {
  prompts: SavedPrompt[];
}

async function loadStore(): Promise<PromptStore> {
  const data = await atomicRead<PromptStore>(PROMPTS_PATH);
  return data ?? { prompts: [] };
}

export async function loadPrompts(): Promise<SavedPrompt[]> {
  const store = await loadStore();
  return store.prompts;
}

export async function savePrompt(prompt: { title: string; content: string; tags?: string[] }): Promise<SavedPrompt> {
  const store = await loadStore();
  const now = new Date().toISOString();
  const entry: SavedPrompt = {
    id: crypto.randomUUID(),
    title: prompt.title,
    content: prompt.content,
    tags: prompt.tags,
    usageCount: 0,
    createdAt: now,
    updatedAt: now,
  };
  store.prompts.push(entry);
  await atomicWrite(PROMPTS_PATH, store);
  return entry;
}

export async function getPrompt(id: string): Promise<SavedPrompt | null> {
  const store = await loadStore();
  const prompt = store.prompts.find((p) => p.id === id);
  if (!prompt) return null;
  // Increment usage count
  prompt.usageCount++;
  prompt.updatedAt = new Date().toISOString();
  await atomicWrite(PROMPTS_PATH, store);
  return prompt;
}

export async function updatePrompt(
  id: string,
  updates: Partial<Pick<SavedPrompt, "title" | "content" | "tags">>
): Promise<SavedPrompt | null> {
  const store = await loadStore();
  const prompt = store.prompts.find((p) => p.id === id);
  if (!prompt) return null;
  if (updates.title !== undefined) prompt.title = updates.title;
  if (updates.content !== undefined) prompt.content = updates.content;
  if (updates.tags !== undefined) prompt.tags = updates.tags;
  prompt.updatedAt = new Date().toISOString();
  await atomicWrite(PROMPTS_PATH, store);
  return prompt;
}

export async function deletePrompt(id: string): Promise<boolean> {
  const store = await loadStore();
  const before = store.prompts.length;
  store.prompts = store.prompts.filter((p) => p.id !== id);
  if (store.prompts.length === before) return false;
  await atomicWrite(PROMPTS_PATH, store);
  return true;
}

export async function searchPrompts(query: string): Promise<SavedPrompt[]> {
  const store = await loadStore();
  const lower = query.toLowerCase();
  return store.prompts.filter((p) => {
    if (p.title.toLowerCase().includes(lower)) return true;
    if (p.tags?.some((t) => t.toLowerCase().includes(lower))) return true;
    return false;
  });
}
