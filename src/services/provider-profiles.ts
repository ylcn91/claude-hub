// Provider-Aware Routing: provider profiles with strengths and context windows

export interface ProviderProfile {
  id: string;
  name: string;
  strengths: string[];
  contextWindow: number;
}

const PROVIDER_PROFILES: Record<string, ProviderProfile> = {
  "claude-code": {
    id: "claude-code",
    name: "Claude Code",
    strengths: ["typescript", "refactoring", "testing", "architecture", "debugging"],
    contextWindow: 200_000,
  },
  "gemini-cli": {
    id: "gemini-cli",
    name: "Gemini CLI",
    strengths: ["python", "data-analysis", "research", "documentation", "multimodal"],
    contextWindow: 1_000_000,
  },
  "codex-cli": {
    id: "codex-cli",
    name: "Codex CLI",
    strengths: ["code-generation", "rapid-prototyping", "multi-file"],
    contextWindow: 200_000,
  },
  "openhands": {
    id: "openhands",
    name: "OpenHands",
    strengths: ["full-stack", "deployment", "docker", "infrastructure"],
    contextWindow: 200_000,
  },
  "opencode": {
    id: "opencode",
    name: "OpenCode",
    strengths: ["go", "rust", "systems-programming", "performance"],
    contextWindow: 200_000,
  },
  "cursor-agent": {
    id: "cursor-agent",
    name: "Cursor Agent",
    strengths: ["frontend", "react", "css", "ui-design"],
    contextWindow: 128_000,
  },
};

/**
 * Get a provider profile by ID.
 */
export function getProviderProfile(providerId: string): ProviderProfile | undefined {
  return PROVIDER_PROFILES[providerId];
}

/**
 * Calculate how well a provider fits the required skills.
 * Returns a score from 0-100 based on skill overlap.
 */
export function calculateProviderFit(providerId: string, requiredSkills: string[]): number {
  const profile = PROVIDER_PROFILES[providerId];
  if (!profile) return 0;
  if (requiredSkills.length === 0) return 50; // neutral when no skills specified

  const matching = requiredSkills.filter((s) => profile.strengths.includes(s)).length;
  return Math.round((matching / requiredSkills.length) * 100);
}

/**
 * Get all registered provider profile IDs.
 */
export function getAllProviderIds(): string[] {
  return Object.keys(PROVIDER_PROFILES);
}
