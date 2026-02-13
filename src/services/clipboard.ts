import { atomicWrite, atomicRead } from "./file-store";

import { getClipboardPath } from "../paths";

const CLIPBOARD_PATH = getClipboardPath();

export interface ClipboardEntry {
  id: string;
  from: string;
  content: string;
  label?: string;
  createdAt: string;
}

interface ClipboardStore {
  entries: ClipboardEntry[];
}

export async function loadClipboard(): Promise<ClipboardStore> {
  const data = await atomicRead<ClipboardStore>(CLIPBOARD_PATH);
  return data ?? { entries: [] };
}

export async function copyToClipboard(from: string, content: string, label?: string): Promise<ClipboardEntry> {
  const store = await loadClipboard();
  const entry: ClipboardEntry = {
    id: crypto.randomUUID(),
    from,
    content,
    label,
    createdAt: new Date().toISOString(),
  };
  store.entries.push(entry);
  // Keep last 50 entries
  if (store.entries.length > 50) {
    store.entries = store.entries.slice(-50);
  }
  await atomicWrite(CLIPBOARD_PATH, store);
  return entry;
}

export async function pasteFromClipboard(count?: number): Promise<ClipboardEntry[]> {
  const store = await loadClipboard();
  return store.entries.slice(-(count ?? 1));
}

export async function clearClipboard(): Promise<void> {
  await atomicWrite(CLIPBOARD_PATH, { entries: [] });
}
