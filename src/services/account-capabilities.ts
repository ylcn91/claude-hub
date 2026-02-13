export interface AccountCapability {
  accountName: string;
  skills: string[];
  totalTasks: number;
  acceptedTasks: number;
  rejectedTasks: number;
  avgDeliveryMs: number;
  lastActiveAt: string;
}

export interface RoutingScore {
  accountName: string;
  score: number;
  reasons: string[];
}

export function scoreAccount(
  capability: AccountCapability,
  requiredSkills: string[],
  _taskPriority?: "P0" | "P1" | "P2"
): RoutingScore {
  const reasons: string[] = [];

  // Skill match: 40 points
  let skillPoints: number;
  if (requiredSkills.length === 0) {
    skillPoints = 40;
    reasons.push("skill match: no skills required (40pts)");
  } else {
    const matching = requiredSkills.filter((s) =>
      capability.skills.includes(s)
    ).length;
    skillPoints = (matching / requiredSkills.length) * 40;
    reasons.push(
      `skill match: ${matching}/${requiredSkills.length} (${Math.round(skillPoints)}pts)`
    );
  }

  // Success rate: 30 points
  let successPoints: number;
  if (capability.totalTasks === 0) {
    successPoints = 15;
    reasons.push("success rate: no history (15pts)");
  } else {
    successPoints = (capability.acceptedTasks / capability.totalTasks) * 30;
    const rate = Math.round(
      (capability.acceptedTasks / capability.totalTasks) * 100
    );
    reasons.push(`success rate: ${rate}% (${Math.round(successPoints)}pts)`);
  }

  // Speed: 20 points
  let speedPoints: number;
  if (capability.avgDeliveryMs === 0) {
    speedPoints = 10;
    reasons.push("speed: no data (10pts)");
  } else {
    const mins = capability.avgDeliveryMs / 60_000;
    if (mins < 5) {
      speedPoints = 20;
    } else if (mins < 15) {
      speedPoints = 15;
    } else if (mins < 30) {
      speedPoints = 10;
    } else {
      speedPoints = 5;
    }
    reasons.push(`speed: ${Math.round(mins)}min avg (${speedPoints}pts)`);
  }

  // Recency: 10 points
  let recencyPoints: number;
  const elapsed = Date.now() - new Date(capability.lastActiveAt).getTime();
  const elapsedMin = elapsed / 60_000;
  if (elapsedMin <= 10) {
    recencyPoints = 10;
  } else if (elapsedMin <= 30) {
    recencyPoints = 7;
  } else if (elapsedMin <= 60) {
    recencyPoints = 4;
  } else {
    recencyPoints = 1;
  }
  reasons.push(`recency: ${Math.round(elapsedMin)}min ago (${recencyPoints}pts)`);

  const score = Math.round(skillPoints + successPoints + speedPoints + recencyPoints);

  return { accountName: capability.accountName, score, reasons };
}

export function rankAccounts(
  capabilities: AccountCapability[],
  requiredSkills: string[],
  opts?: { excludeAccounts?: string[]; priority?: "P0" | "P1" | "P2" }
): RoutingScore[] {
  const excluded = new Set(opts?.excludeAccounts ?? []);
  return capabilities
    .filter((c) => !excluded.has(c.accountName))
    .map((c) => scoreAccount(c, requiredSkills, opts?.priority))
    .sort((a, b) => b.score - a.score);
}
