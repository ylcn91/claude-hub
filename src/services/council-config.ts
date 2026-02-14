// Council pre-analysis configuration — default models, chairman, and OpenRouter settings

export const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

export const DEFAULT_COUNCIL_MODELS = [
  "openai/gpt-4o",
  "anthropic/claude-sonnet-4-5-20250929",
  "google/gemini-2.5-pro-preview",
];

export const DEFAULT_CHAIRMAN_MODEL = "anthropic/claude-sonnet-4-5-20250929";

export interface CouncilServiceConfig {
  models: string[];
  chairman: string;
  apiKey?: string;
  openRouterUrl?: string;
  timeoutMs?: number;
}

export const DEFAULT_COUNCIL_CONFIG: CouncilServiceConfig = {
  models: DEFAULT_COUNCIL_MODELS,
  chairman: DEFAULT_CHAIRMAN_MODEL,
  openRouterUrl: OPENROUTER_API_URL,
  timeoutMs: 120_000,
};
