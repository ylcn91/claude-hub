// Entire.io session monitoring adapter
// Reads session state files from .git/entire-sessions/ and maps changes to agentctl EventBus events

import { watch, existsSync, readdirSync, readFileSync, type FSWatcher } from "fs";
import { join, basename } from "path";
import type { EventBus } from "./event-bus";

/** entire.io session phase (mirrors session/phase.go) */
export type EntirePhase = "active" | "active_committed" | "idle" | "ended" | "";

/** entire.io token usage (mirrors agent/types.go) */
export interface EntireTokenUsage {
  input_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  output_tokens: number;
  api_call_count: number;
  subagent_tokens?: EntireTokenUsage;
}

/** entire.io session state on disk (mirrors session/state.go JSON tags) */
export interface EntireSessionState {
  session_id: string;
  cli_version?: string;
  base_commit: string;
  attribution_base_commit?: string;
  worktree_path?: string;
  worktree_id?: string;
  started_at: string;
  ended_at?: string;
  phase?: EntirePhase;
  pending_checkpoint_id?: string;
  last_interaction_time?: string;
  /** JSON tag is "checkpoint_count" for backward compat */
  checkpoint_count: number;
  files_touched?: string[];
  agent_type?: string;
  token_usage?: EntireTokenUsage;
  first_prompt?: string;
  transcript_path?: string;
}

/** Derived metrics for an entire.io session */
export interface EntireSessionMetrics {
  sessionId: string;
  phase: EntirePhase;
  stepCount: number;
  filesTouched: string[];
  totalTokens: number;
  tokenBurnRate: number;
  contextSaturation: number;
  progressEstimate: number;
  elapsedMinutes: number;
  agentType: string;
}

/** Default context window sizes by provider */
const CONTEXT_WINDOWS: Record<string, number> = {
  "Claude Code": 200_000,
  "Gemini CLI": 1_000_000,
  "Cursor": 128_000,
  "Copilot": 128_000,
};
const DEFAULT_CONTEXT_WINDOW = 200_000;

function totalTokens(usage: EntireTokenUsage | undefined): number {
  if (!usage) return 0;
  let total = usage.input_tokens + usage.cache_creation_tokens +
    usage.cache_read_tokens + usage.output_tokens;
  if (usage.subagent_tokens) {
    total += totalTokens(usage.subagent_tokens);
  }
  return total;
}

export class EntireAdapter {
  private eventBus: EventBus;
  private sessionsDir: string;
  private watcher: FSWatcher | null = null;
  private previousStates = new Map<string, EntireSessionState>();
  private sessionTaskMap = new Map<string, string>();
  private expectedFiles = new Map<string, number>();

  constructor(eventBus: EventBus, gitDir: string) {
    this.eventBus = eventBus;
    this.sessionsDir = join(gitDir, "entire-sessions");
  }

  startWatching(): boolean {
    if (!existsSync(this.sessionsDir)) {
      return false;
    }

    // Load initial state for all existing sessions
    try {
      const files = readdirSync(this.sessionsDir);
      for (const file of files) {
        if (!file.endsWith(".json") || file.endsWith(".tmp")) continue;
        const filePath = join(this.sessionsDir, file);
        try {
          const state = this.readSession(filePath);
          if (state) {
            this.previousStates.set(state.session_id, state);
          }
        } catch {
          // Skip corrupted files
        }
      }
    } catch {
      // Directory read failed
    }

    this.watcher = watch(this.sessionsDir, (eventType, filename) => {
      if (!filename || !filename.endsWith(".json") || filename.endsWith(".tmp")) return;
      const filePath = join(this.sessionsDir, filename);

      try {
        const current = this.readSession(filePath);
        if (!current) return;

        const prev = this.previousStates.get(current.session_id);
        if (prev) {
          this.processSessionUpdate(prev, current);
        } else {
          // New session — check if it started active
          if (current.phase === "active" || current.phase === "active_committed") {
            const taskId = this.sessionTaskMap.get(current.session_id) ?? current.session_id;
            this.eventBus.emit({
              type: "TASK_STARTED",
              taskId,
              agent: current.agent_type ?? "unknown",
            });
          }
        }
        this.previousStates.set(current.session_id, current);
      } catch {
        // File may have been deleted or is being written
      }
    });

    return true;
  }

  stopWatching(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    this.previousStates.clear();
  }

  readSession(filePath: string): EntireSessionState | null {
    try {
      const data = readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(data) as EntireSessionState;
      if (!parsed.session_id) return null;
      // Normalize empty phase to "idle"
      if (!parsed.phase) {
        parsed.phase = "idle";
      }
      return parsed;
    } catch {
      return null;
    }
  }

  processSessionUpdate(prev: EntireSessionState, current: EntireSessionState): void {
    const taskId = this.sessionTaskMap.get(current.session_id) ?? current.session_id;
    const agent = current.agent_type ?? "unknown";
    const prevPhaseActive = prev.phase === "active" || prev.phase === "active_committed";
    const currPhaseActive = current.phase === "active" || current.phase === "active_committed";

    // Phase transition: became active
    if (!prevPhaseActive && currPhaseActive) {
      this.eventBus.emit({
        type: "TASK_STARTED",
        taskId,
        agent,
      });
    }

    // StepCount increased — checkpoint reached
    if (current.checkpoint_count > prev.checkpoint_count) {
      const expected = this.expectedFiles.get(current.session_id);
      const percent = expected && expected > 0
        ? Math.min(100, Math.round(((current.files_touched?.length ?? 0) / expected) * 100))
        : Math.min(95, current.checkpoint_count * 15);
      this.eventBus.emit({
        type: "CHECKPOINT_REACHED",
        taskId,
        agent,
        percent,
        step: `checkpoint ${current.checkpoint_count}`,
      });
    }

    // Token usage changed
    const prevTokens = totalTokens(prev.token_usage);
    const currTokens = totalTokens(current.token_usage);
    if (currTokens > prevTokens) {
      const elapsed = this.getElapsedMinutes(current);
      const burnRate = elapsed > 0 ? currTokens / elapsed : 0;
      const contextWindow = CONTEXT_WINDOWS[current.agent_type ?? ""] ?? DEFAULT_CONTEXT_WINDOW;
      const saturation = currTokens / contextWindow;

      this.eventBus.emit({
        type: "PROGRESS_UPDATE",
        taskId,
        agent,
        data: {
          percent: Math.min(95, Math.round(saturation * 100)),
          currentStep: `tokens: ${currTokens}, burn rate: ${Math.round(burnRate)}/min`,
        },
      });

      // Warn if approaching context limit
      if (saturation > 0.8) {
        this.eventBus.emit({
          type: "RESOURCE_WARNING",
          taskId,
          agent,
          warning: `Context saturation at ${Math.round(saturation * 100)}% (${currTokens}/${contextWindow} tokens)`,
        });
      }
    }

    // Files touched changed
    const prevFiles = prev.files_touched?.length ?? 0;
    const currFiles = current.files_touched?.length ?? 0;
    if (currFiles > prevFiles) {
      this.eventBus.emit({
        type: "PROGRESS_UPDATE",
        taskId,
        agent,
        data: {
          percent: Math.min(95, currFiles * 10),
          currentStep: `files touched: ${current.files_touched!.join(", ")}`,
        },
      });
    }

    // Phase transition: became idle or ended
    if (prevPhaseActive && (current.phase === "idle" || current.phase === "ended")) {
      this.eventBus.emit({
        type: "TASK_COMPLETED",
        taskId,
        agent,
        result: "success",
      });
    }
  }

  getSessionMetrics(sessionId: string): EntireSessionMetrics | null {
    const state = this.previousStates.get(sessionId);
    if (!state) return null;

    const tokens = totalTokens(state.token_usage);
    const elapsed = this.getElapsedMinutes(state);
    const contextWindow = CONTEXT_WINDOWS[state.agent_type ?? ""] ?? DEFAULT_CONTEXT_WINDOW;
    const expected = this.expectedFiles.get(sessionId);

    return {
      sessionId: state.session_id,
      phase: state.phase ?? "idle",
      stepCount: state.checkpoint_count,
      filesTouched: state.files_touched ?? [],
      totalTokens: tokens,
      tokenBurnRate: elapsed > 0 ? tokens / elapsed : 0,
      contextSaturation: tokens / contextWindow,
      progressEstimate: expected && expected > 0
        ? Math.min(100, Math.round(((state.files_touched?.length ?? 0) / expected) * 100))
        : Math.min(95, (state.files_touched?.length ?? 0) * 10),
      elapsedMinutes: elapsed,
      agentType: state.agent_type ?? "unknown",
    };
  }

  linkSessionToTask(sessionId: string, taskId: string): void {
    this.sessionTaskMap.set(sessionId, taskId);
  }

  setExpectedFiles(sessionId: string, count: number): void {
    this.expectedFiles.set(sessionId, count);
  }

  getLinkedTaskId(sessionId: string): string | undefined {
    return this.sessionTaskMap.get(sessionId);
  }

  private getElapsedMinutes(state: EntireSessionState): number {
    const startedAt = new Date(state.started_at).getTime();
    if (isNaN(startedAt)) return 0;
    const now = state.ended_at ? new Date(state.ended_at).getTime() : Date.now();
    return Math.max(0, (now - startedAt) / 60_000);
  }
}
