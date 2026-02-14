import { calculateProviderFit, getProviderProfile } from "./provider-profiles";

export interface AccountCapability {
  accountName: string;
  skills: string[];
  totalTasks: number;
  acceptedTasks: number;
  rejectedTasks: number;
  avgDeliveryMs: number;
  lastActiveAt: string;
  providerType?: string;
  trustScore?: number;
}

export const PROVIDER_STRENGTHS: Record<string, string[]> = {
  'claude-code':   ['typescript', 'refactoring', 'testing', 'debugging', 'architecture', 'complex-reasoning'],
  'gemini-cli':    ['python', 'data-analysis', 'research', 'documentation', 'multimodal'],
  'codex-cli':     ['code-generation', 'boilerplate', 'rapid-prototyping', 'simple-tasks'],
  'openhands':     ['full-stack', 'deployment', 'docker', 'infrastructure', 'web-apps'],
  'opencode':      ['go', 'rust', 'systems-programming', 'performance'],
  'cursor-agent':  ['frontend', 'react', 'css', 'ui-design', 'visual-tasks'],
};

export interface ScoreBreakdown {
  skillMatch: number;
  providerFit: number;
  successRate: number;
  speed: number;
  workload: number;
  trust: number;
  recency: number;
}

export interface RoutingScore {
  accountName: string;
  score: number;
  reasons: string[];
  breakdown?: ScoreBreakdown;
}

export function scoreAccount(
  capability: AccountCapability,
  requiredSkills: string[],
  _taskPriority?: "P0" | "P1" | "P2",
  workloadModifier?: number
): RoutingScore {
  const reasons: string[] = [];

  // Skill match: 30 points
  let skillPoints: number;
  if (requiredSkills.length === 0) {
    skillPoints = 30;
    reasons.push("skill match: no skills required (30pts)");
  } else {
    const matching = requiredSkills.filter((s) =>
      capability.skills.includes(s)
    ).length;
    skillPoints = (matching / requiredSkills.length) * 30;
    reasons.push(
      `skill match: ${matching}/${requiredSkills.length} (${Math.round(skillPoints)}pts)`
    );
  }

  // Provider fit: 20 points — use provider-profiles for fit calculation
  let providerFitPoints: number;
  if (requiredSkills.length > 0 && capability.providerType) {
    const profile = getProviderProfile(capability.providerType);
    if (profile) {
      const fitPercent = calculateProviderFit(capability.providerType, requiredSkills);
      providerFitPoints = (fitPercent / 100) * 20;
      const matchCount = requiredSkills.filter((s) => profile.strengths.includes(s)).length;
      reasons.push(
        `provider fit: ${matchCount}/${requiredSkills.length} strengths (${Math.round(providerFitPoints)}pts)`
      );
    } else if (PROVIDER_STRENGTHS[capability.providerType]) {
      // Fallback to legacy PROVIDER_STRENGTHS for providers not in profiles
      const strengths = PROVIDER_STRENGTHS[capability.providerType];
      const matchingProviderSkills = requiredSkills.filter((s) => strengths.includes(s)).length;
      providerFitPoints = (matchingProviderSkills / requiredSkills.length) * 20;
      reasons.push(
        `provider fit: ${matchingProviderSkills}/${requiredSkills.length} strengths (${Math.round(providerFitPoints)}pts)`
      );
    } else {
      providerFitPoints = 10;
      reasons.push("provider fit: neutral (10pts)");
    }
  } else {
    providerFitPoints = 10;
    reasons.push("provider fit: neutral (10pts)");
  }

  // Success rate: 20 points
  let successPoints: number;
  if (capability.totalTasks === 0) {
    successPoints = 10;
    reasons.push("success rate: no history (10pts)");
  } else {
    successPoints = (capability.acceptedTasks / capability.totalTasks) * 20;
    const rate = Math.round(
      (capability.acceptedTasks / capability.totalTasks) * 100
    );
    reasons.push(`success rate: ${rate}% (${Math.round(successPoints)}pts)`);
  }

  // Speed: 15 points
  let speedPoints: number;
  if (capability.avgDeliveryMs === 0) {
    speedPoints = 8;
    reasons.push("speed: no data (8pts)");
  } else {
    const mins = capability.avgDeliveryMs / 60_000;
    if (mins < 5) {
      speedPoints = 15;
    } else if (mins < 15) {
      speedPoints = 12;
    } else if (mins < 30) {
      speedPoints = 8;
    } else {
      speedPoints = 3;
    }
    reasons.push(`speed: ${Math.round(mins)}min avg (${speedPoints}pts)`);
  }

  // Trust: 10 points
  let trustPoints: number;
  if (capability.trustScore != null) {
    trustPoints = (capability.trustScore / 100) * 10;
    reasons.push(`trust: ${capability.trustScore}/100 (${Math.round(trustPoints)}pts)`);
  } else {
    trustPoints = 5;
    reasons.push("trust: neutral (5pts)");
  }

  // Recency: 5 points
  let recencyPoints: number;
  const elapsed = Date.now() - new Date(capability.lastActiveAt).getTime();
  const elapsedMin = elapsed / 60_000;
  if (elapsedMin <= 10) {
    recencyPoints = 5;
  } else if (elapsedMin <= 30) {
    recencyPoints = 4;
  } else if (elapsedMin <= 60) {
    recencyPoints = 2;
  } else {
    recencyPoints = 1;
  }
  reasons.push(`recency: ${Math.round(elapsedMin)}min ago (${recencyPoints}pts)`);

  const wlMod = workloadModifier ?? 0;
  if (wlMod !== 0) {
    reasons.push(`workload modifier: ${wlMod > 0 ? "+" : ""}${wlMod}pts`);
  }

  const score = Math.max(0, Math.round(skillPoints + providerFitPoints + successPoints + speedPoints + trustPoints + recencyPoints + wlMod));

  const breakdown: ScoreBreakdown = {
    skillMatch: Math.round(skillPoints),
    providerFit: Math.round(providerFitPoints),
    successRate: Math.round(successPoints),
    speed: speedPoints,
    workload: wlMod,
    trust: Math.round(trustPoints),
    recency: recencyPoints,
  };

  return { accountName: capability.accountName, score, reasons, breakdown };
}

export function rankAccounts(
  capabilities: AccountCapability[],
  requiredSkills: string[],
  opts?: { excludeAccounts?: string[]; priority?: "P0" | "P1" | "P2"; workload?: Map<string, number> }
): RoutingScore[] {
  const excluded = new Set(opts?.excludeAccounts ?? []);
  return capabilities
    .filter((c) => !excluded.has(c.accountName))
    .map((c) => scoreAccount(c, requiredSkills, opts?.priority, opts?.workload?.get(c.accountName)))
    .sort((a, b) => b.score - a.score);
}
