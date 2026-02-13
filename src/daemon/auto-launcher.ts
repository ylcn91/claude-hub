export interface AutoLaunchPolicy {
  maxSpawnsPerMinute: number;
  deduplicationWindowMs: number;
  selfHandoffBlocked: boolean;
  circuitBreaker: {
    failureThreshold: number;
    cooldownMs: number;
  };
}

export interface LaunchDecision {
  allowed: boolean;
  reason?: string;
}

interface SpawnRecord {
  target: string;
  timestamp: number;
}

interface CircuitBreakerState {
  failures: number;
  openedAt?: number;
}

export class AutoLauncher {
  private policy: AutoLaunchPolicy;
  private recentSpawns: SpawnRecord[] = [];
  private dedupMap = new Map<string, number>(); // target -> last spawn timestamp
  private circuitBreakers = new Map<string, CircuitBreakerState>();

  constructor(policy: AutoLaunchPolicy) {
    this.policy = policy;
  }

  canLaunch(from: string, target: string): LaunchDecision {
    // 1. Self-handoff check
    if (this.policy.selfHandoffBlocked && from === target) {
      return { allowed: false, reason: "self-handoff is blocked by policy" };
    }

    // 2. Circuit breaker check
    const cb = this.circuitBreakers.get(target);
    if (cb && cb.failures >= this.policy.circuitBreaker.failureThreshold) {
      if (cb.openedAt) {
        const elapsed = Date.now() - cb.openedAt;
        if (elapsed < this.policy.circuitBreaker.cooldownMs) {
          return { allowed: false, reason: `circuit breaker open for ${target} (${Math.round(elapsed / 1000)}s of ${Math.round(this.policy.circuitBreaker.cooldownMs / 1000)}s cooldown)` };
        }
        // Cooldown expired, reset
        this.circuitBreakers.delete(target);
      }
    }

    // 3. Deduplication check
    const lastSpawn = this.dedupMap.get(target);
    if (lastSpawn !== undefined) {
      const elapsed = Date.now() - lastSpawn;
      if (elapsed < this.policy.deduplicationWindowMs) {
        return { allowed: false, reason: `dedup: ${target} was launched ${Math.round(elapsed / 1000)}s ago (window: ${Math.round(this.policy.deduplicationWindowMs / 1000)}s)` };
      }
    }

    // 4. Rate limit check
    const now = Date.now();
    const windowMs = 60_000;
    this.recentSpawns = this.recentSpawns.filter((s) => now - s.timestamp < windowMs);
    if (this.recentSpawns.length >= this.policy.maxSpawnsPerMinute) {
      return { allowed: false, reason: `rate limit: ${this.recentSpawns.length}/${this.policy.maxSpawnsPerMinute} spawns in last minute` };
    }

    return { allowed: true };
  }

  recordSpawn(target: string): void {
    const now = Date.now();
    this.recentSpawns.push({ target, timestamp: now });
    this.dedupMap.set(target, now);
    // Success resets circuit breaker failures
    this.circuitBreakers.delete(target);
  }

  recordFailure(target: string): void {
    const cb = this.circuitBreakers.get(target) ?? { failures: 0 };
    cb.failures++;
    if (cb.failures >= this.policy.circuitBreaker.failureThreshold) {
      cb.openedAt = Date.now();
    }
    this.circuitBreakers.set(target, cb);
  }

  // Test helpers -- allow expiring windows without waiting real time
  expireRateLimitForTest(): void {
    this.recentSpawns = [];
  }

  expireDedupForTest(target: string): void {
    this.dedupMap.delete(target);
  }

  expireCircuitBreakerForTest(target: string): void {
    this.circuitBreakers.delete(target);
  }
}
