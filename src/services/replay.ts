import { readCheckpoint, type TranscriptLine } from "./entire-integration";

export type ReplayEventType = "prompt" | "response" | "tool_call";

export interface ReplayEvent {
  type: ReplayEventType;
  timestamp?: string;
  content: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  index: number;
}

/**
 * Build a timeline of events from a checkpoint's full.jsonl transcript.
 * Parses each JSONL line and classifies it as prompt, response, or tool_call.
 *
 * Accepts optional pre-read transcript to avoid redundant readCheckpoint calls.
 */
export async function buildTimeline(
  repoPath: string,
  checkpointId: string,
  preReadTranscript?: TranscriptLine[],
): Promise<ReplayEvent[]> {
  const transcript = preReadTranscript ?? (await readCheckpoint(repoPath, checkpointId)).transcript;
  const events: ReplayEvent[] = [];

  for (let i = 0; i < transcript.length; i++) {
    const line = transcript[i];
    const parsed = line.parsed;

    if (!parsed) {
      // Unparseable line -- skip
      continue;
    }

    const classified = classifyEvent(parsed, i);
    for (const event of classified) {
      events.push(event);
    }
  }

  return events;
}

/**
 * Classify a parsed JSONL object into zero or more ReplayEvents.
 * Returns an array so that assistant messages with multiple content blocks
 * (e.g. text + tool_use) emit all events instead of only the first.
 */
function classifyEvent(parsed: Record<string, unknown>, index: number): ReplayEvent[] {
  // Runtime type guard: must be a non-null object
  if (typeof parsed !== "object" || parsed === null) return [];

  // Claude API format: role-based messages
  if (parsed.role === "user" || parsed.type === "human") {
    const content = extractContent(parsed);
    if (content) {
      return [{ type: "prompt", content, timestamp: parsed.timestamp as string | undefined, index }];
    }
  }

  if (parsed.role === "assistant" || parsed.type === "assistant") {
    // Check for tool_use and text blocks in content array -- emit ALL blocks
    if (Array.isArray(parsed.content)) {
      const events: ReplayEvent[] = [];
      for (const block of parsed.content) {
        if (typeof block !== "object" || block === null) continue;
        if (block.type === "tool_use") {
          events.push({
            type: "tool_call",
            content: JSON.stringify(block.input ?? {}),
            toolName: block.name as string,
            toolInput: (block.input ?? {}) as Record<string, unknown>,
            timestamp: parsed.timestamp as string | undefined,
            index,
          });
        } else if (block.type === "text" && block.text) {
          events.push({
            type: "response",
            content: block.text as string,
            timestamp: parsed.timestamp as string | undefined,
            index,
          });
        }
      }
      if (events.length > 0) return events;
    }

    const content = extractContent(parsed);
    if (content) {
      return [{ type: "response", content, timestamp: parsed.timestamp as string | undefined, index }];
    }
  }

  // Tool result messages
  if (parsed.role === "tool" || parsed.type === "tool_result") {
    return []; // Skip tool results in timeline (they are the consequence of tool_call)
  }

  // Generic fallback: if it has a type field that hints at a category
  if (parsed.type === "tool_use") {
    return [{
      type: "tool_call",
      content: JSON.stringify((parsed.input as Record<string, unknown>) ?? {}),
      toolName: parsed.name as string,
      toolInput: (parsed.input as Record<string, unknown>) ?? {},
      timestamp: parsed.timestamp as string | undefined,
      index,
    }];
  }

  return [];
}

function extractContent(msg: Record<string, unknown>): string {
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((b: Record<string, unknown>) => b.type === "text")
      .map((b: Record<string, unknown>) => b.text as string)
      .join("\n");
  }
  if (typeof msg.text === "string") return msg.text;
  if (typeof msg.message === "string") return msg.message;
  return "";
}
