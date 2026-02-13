import type { AgentProvider } from "./types";
import { ClaudeCodeProvider } from "./claude-code";
import { CodexCliProvider } from "./codex-cli";
import { OpenHandsProvider } from "./openhands";
import { GeminiCliProvider } from "./gemini-cli";

export class ProviderRegistry {
  private providers = new Map<string, AgentProvider>();

  register(provider: AgentProvider): void {
    if (this.providers.has(provider.id)) {
      throw new Error(`Provider '${provider.id}' is already registered`);
    }
    this.providers.set(provider.id, provider);
  }

  get(id: string): AgentProvider | undefined {
    return this.providers.get(id);
  }

  listIds(): string[] {
    return Array.from(this.providers.keys());
  }

  listAll(): AgentProvider[] {
    return Array.from(this.providers.values());
  }
}

export function createDefaultRegistry(): ProviderRegistry {
  const registry = new ProviderRegistry();
  registry.register(new ClaudeCodeProvider());
  registry.register(new CodexCliProvider());
  registry.register(new OpenHandsProvider());
  registry.register(new GeminiCliProvider());
  return registry;
}
