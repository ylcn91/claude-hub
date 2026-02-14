import { watch, type FSWatcher } from "fs";
import { loadConfig } from "../config";
import { getConfigPath } from "../paths";
import type { HubConfig } from "../types";

export type ConfigChangeHandler = (config: HubConfig) => void;

export class ConfigWatcher {
  private watcher: FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private configPath: string;
  private debounceMs: number;
  private handler: ConfigChangeHandler;
  private lastConfig: string = "";

  constructor(handler: ConfigChangeHandler, opts?: { configPath?: string; debounceMs?: number }) {
    this.handler = handler;
    this.configPath = opts?.configPath ?? getConfigPath();
    this.debounceMs = opts?.debounceMs ?? 500;
  }

  start(): void {
    if (this.watcher) return;

    try {
      this.watcher = watch(this.configPath, (eventType) => {
        if (eventType === "change" || eventType === "rename") {
          this.scheduleReload();
        }
      });

      this.watcher.on("error", (err) => {
        console.error("[config-watcher] Watch error:", err.message);
      });
    } catch (err: unknown) {
      console.error("[config-watcher] Failed to start:", err instanceof Error ? err.message : String(err));
    }
  }

  stop(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  private scheduleReload(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.reload();
    }, this.debounceMs);
  }

  async reload(): Promise<HubConfig | null> {
    try {
      const config = await loadConfig(this.configPath);
      const serialized = JSON.stringify(config);
      if (serialized === this.lastConfig) {
        return null;
      }
      this.lastConfig = serialized;
      this.handler(config);
      return config;
    } catch (err: unknown) {
      console.error("[config-watcher] Reload error:", err instanceof Error ? err.message : String(err));
      return null;
    }
  }

  isWatching(): boolean {
    return this.watcher !== null;
  }
}
