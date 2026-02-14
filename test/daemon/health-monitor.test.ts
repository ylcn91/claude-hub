import { describe, test, expect, beforeEach } from "bun:test";
import { HealthMonitor } from "../../src/daemon/health-monitor";

describe("HealthMonitor", () => {
  test("new account defaults to critical (disconnected)", () => {
    const monitor = new HealthMonitor();
    const statuses = monitor.getStatuses(["alice"]);
    expect(statuses).toHaveLength(1);
    expect(statuses[0].account).toBe("alice");
    expect(statuses[0].status).toBe("critical");
    expect(statuses[0].connected).toBe(false);
  });

  test("markActive sets account to healthy", () => {
    const monitor = new HealthMonitor();
    monitor.markActive("alice");
    const health = monitor.getHealth("alice");
    expect(health).not.toBeNull();
    expect(health!.status).toBe("healthy");
    expect(health!.connected).toBe(true);
    expect(health!.lastActivity).not.toBeNull();
  });

  test("markDisconnected sets account to critical", () => {
    const monitor = new HealthMonitor();
    monitor.markActive("alice");
    monitor.markDisconnected("alice");
    const health = monitor.getHealth("alice");
    expect(health!.status).toBe("critical");
    expect(health!.connected).toBe(false);
  });

  test("recordError increments error count", () => {
    const monitor = new HealthMonitor();
    monitor.markActive("alice");
    monitor.recordError("alice");
    const health = monitor.getHealth("alice");
    expect(health!.errorCount).toBe(1);
    expect(health!.status).toBe("degraded");
  });

  test("5+ errors sets status to critical", () => {
    const monitor = new HealthMonitor();
    monitor.markActive("alice");
    for (let i = 0; i < 5; i++) {
      monitor.recordError("alice");
    }
    const health = monitor.getHealth("alice");
    expect(health!.errorCount).toBe(5);
    expect(health!.status).toBe("critical");
  });

  test("recordRateLimit sets status to critical", () => {
    const monitor = new HealthMonitor();
    monitor.markActive("alice");
    monitor.recordRateLimit("alice");
    const health = monitor.getHealth("alice");
    expect(health!.rateLimited).toBe(true);
    expect(health!.status).toBe("critical");
  });

  test("clearRateLimit restores status", () => {
    const monitor = new HealthMonitor();
    monitor.markActive("alice");
    monitor.recordRateLimit("alice");
    expect(monitor.getHealth("alice")!.status).toBe("critical");
    monitor.clearRateLimit("alice");
    expect(monitor.getHealth("alice")!.status).toBe("healthy");
    expect(monitor.getHealth("alice")!.rateLimited).toBe(false);
  });

  test("recordSlaViolation sets status to degraded", () => {
    const monitor = new HealthMonitor();
    monitor.markActive("alice");
    monitor.recordSlaViolation("alice");
    const health = monitor.getHealth("alice");
    expect(health!.slaViolations).toBe(1);
    expect(health!.status).toBe("degraded");
  });

  test("getStatuses returns all requested accounts", () => {
    const monitor = new HealthMonitor();
    monitor.markActive("alice");
    monitor.markActive("bob");
    const statuses = monitor.getStatuses(["alice", "bob", "charlie"]);
    expect(statuses).toHaveLength(3);
    expect(statuses[0].status).toBe("healthy");
    expect(statuses[1].status).toBe("healthy");
    expect(statuses[2].status).toBe("critical"); // charlie never connected
  });

  test("getHealth returns null for unknown account", () => {
    const monitor = new HealthMonitor();
    expect(monitor.getHealth("nonexistent")).toBeNull();
  });

  test("stale activity sets status to degraded", () => {
    const monitor = new HealthMonitor();
    // Simulate stale activity by setting lastActivity to 15 minutes ago
    const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    monitor.update("alice", {
      connected: true,
      lastActivity: fifteenMinAgo,
    });
    const health = monitor.getHealth("alice");
    expect(health!.status).toBe("degraded");
  });

  test("recent activity keeps status healthy", () => {
    const monitor = new HealthMonitor();
    monitor.update("alice", {
      connected: true,
      lastActivity: new Date().toISOString(),
    });
    const health = monitor.getHealth("alice");
    expect(health!.status).toBe("healthy");
  });

  test("update preserves existing values when not overridden", () => {
    const monitor = new HealthMonitor();
    monitor.markActive("alice");
    monitor.recordError("alice");
    // Update only rateLimited, should preserve errorCount
    monitor.update("alice", { rateLimited: true });
    const health = monitor.getHealth("alice");
    expect(health!.errorCount).toBe(1);
    expect(health!.rateLimited).toBe(true);
  });

  test("getStatuses with no arguments returns tracked accounts", () => {
    const monitor = new HealthMonitor();
    monitor.markActive("alice");
    monitor.markActive("bob");
    const statuses = monitor.getStatuses();
    expect(statuses.length).toBe(2);
    const names = statuses.map((s) => s.account).sort();
    expect(names).toEqual(["alice", "bob"]);
  });
});

describe("HealthMonitor - multi-account aggregation", () => {
  let monitor: HealthMonitor;

  beforeEach(() => {
    monitor = new HealthMonitor();
  });

  test("aggregates health from multiple accounts", () => {
    monitor.markActive("alice");
    monitor.markActive("bob");
    monitor.markActive("charlie");
    monitor.recordError("bob"); // degraded
    monitor.markDisconnected("charlie"); // critical

    const aggregate = monitor.getAggregateStatus(["alice", "bob", "charlie"]);
    expect(aggregate.total).toBe(3);
    expect(aggregate.healthy).toBe(1);
    expect(aggregate.degraded).toBe(1);
    expect(aggregate.critical).toBe(1);
    expect(aggregate.overall).toBe("critical"); // at least one critical
    expect(aggregate.accounts).toHaveLength(3);
  });

  test("aggregate overall is healthy when all accounts are healthy", () => {
    monitor.markActive("alice");
    monitor.markActive("bob");

    const aggregate = monitor.getAggregateStatus(["alice", "bob"]);
    expect(aggregate.overall).toBe("healthy");
    expect(aggregate.healthy).toBe(2);
    expect(aggregate.degraded).toBe(0);
    expect(aggregate.critical).toBe(0);
  });

  test("aggregate overall is degraded when worst is degraded", () => {
    monitor.markActive("alice");
    monitor.markActive("bob");
    monitor.recordError("bob"); // degraded

    const aggregate = monitor.getAggregateStatus(["alice", "bob"]);
    expect(aggregate.overall).toBe("degraded");
    expect(aggregate.healthy).toBe(1);
    expect(aggregate.degraded).toBe(1);
  });
});

describe("HealthMonitor - status transitions", () => {
  let monitor: HealthMonitor;

  beforeEach(() => {
    monitor = new HealthMonitor();
  });

  test("healthy -> degraded via error", () => {
    monitor.markActive("alice");
    expect(monitor.getHealth("alice")!.status).toBe("healthy");

    monitor.recordError("alice");
    expect(monitor.getHealth("alice")!.status).toBe("degraded");
  });

  test("healthy -> critical via disconnect", () => {
    monitor.markActive("alice");
    expect(monitor.getHealth("alice")!.status).toBe("healthy");

    monitor.markDisconnected("alice");
    expect(monitor.getHealth("alice")!.status).toBe("critical");
  });

  test("degraded -> critical via 5 errors", () => {
    monitor.markActive("alice");
    monitor.recordError("alice");
    expect(monitor.getHealth("alice")!.status).toBe("degraded");

    for (let i = 0; i < 4; i++) {
      monitor.recordError("alice");
    }
    expect(monitor.getHealth("alice")!.status).toBe("critical");
    expect(monitor.getHealth("alice")!.errorCount).toBe(5);
  });

  test("degraded -> healthy by clearing errors", () => {
    monitor.markActive("alice");
    monitor.recordError("alice");
    expect(monitor.getHealth("alice")!.status).toBe("degraded");

    // Reset error count to 0
    monitor.update("alice", { errorCount: 0 });
    expect(monitor.getHealth("alice")!.status).toBe("healthy");
  });

  test("critical -> healthy by reconnecting", () => {
    monitor.markActive("alice");
    monitor.markDisconnected("alice");
    expect(monitor.getHealth("alice")!.status).toBe("critical");

    monitor.markActive("alice");
    expect(monitor.getHealth("alice")!.status).toBe("healthy");
  });
});

describe("HealthMonitor - error rate calculation", () => {
  let monitor: HealthMonitor;

  beforeEach(() => {
    monitor = new HealthMonitor();
  });

  test("error count increments correctly", () => {
    monitor.markActive("alice");
    expect(monitor.getHealth("alice")!.errorCount).toBe(0);

    monitor.recordError("alice");
    expect(monitor.getHealth("alice")!.errorCount).toBe(1);

    monitor.recordError("alice");
    expect(monitor.getHealth("alice")!.errorCount).toBe(2);

    monitor.recordError("alice");
    expect(monitor.getHealth("alice")!.errorCount).toBe(3);
  });

  test("1-4 errors = degraded, 5+ = critical", () => {
    monitor.markActive("alice");
    for (let i = 1; i <= 4; i++) {
      monitor.recordError("alice");
      expect(monitor.getHealth("alice")!.status).toBe("degraded");
    }
    monitor.recordError("alice");
    expect(monitor.getHealth("alice")!.status).toBe("critical");
    expect(monitor.getHealth("alice")!.errorCount).toBe(5);
  });

  test("recording error on unknown account creates entry", () => {
    monitor.recordError("newaccount");
    const health = monitor.getHealth("newaccount");
    expect(health).not.toBeNull();
    expect(health!.errorCount).toBe(1);
    // Not connected, so critical
    expect(health!.status).toBe("critical");
  });
});

describe("HealthMonitor - rate limit tracking", () => {
  let monitor: HealthMonitor;

  beforeEach(() => {
    monitor = new HealthMonitor();
  });

  test("rate limited account is critical even if connected", () => {
    monitor.markActive("alice");
    monitor.recordRateLimit("alice");
    expect(monitor.getHealth("alice")!.status).toBe("critical");
    expect(monitor.getHealth("alice")!.rateLimited).toBe(true);
    expect(monitor.getHealth("alice")!.connected).toBe(true); // still connected
  });

  test("clearing rate limit restores to appropriate status", () => {
    monitor.markActive("alice");
    monitor.recordRateLimit("alice");
    expect(monitor.getHealth("alice")!.status).toBe("critical");

    monitor.clearRateLimit("alice");
    expect(monitor.getHealth("alice")!.status).toBe("healthy");
    expect(monitor.getHealth("alice")!.rateLimited).toBe(false);
  });

  test("rate limit with existing errors stays critical", () => {
    monitor.markActive("alice");
    monitor.recordError("alice"); // degraded
    monitor.recordRateLimit("alice"); // critical
    expect(monitor.getHealth("alice")!.status).toBe("critical");

    // Clear rate limit, but errors remain -> degraded
    monitor.clearRateLimit("alice");
    expect(monitor.getHealth("alice")!.status).toBe("degraded");
  });
});

describe("HealthMonitor - stale account detection", () => {
  let monitor: HealthMonitor;

  beforeEach(() => {
    monitor = new HealthMonitor();
  });

  test("stale accounts (>10 min) are marked degraded", () => {
    const elevenMinAgo = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    monitor.update("alice", {
      connected: true,
      lastActivity: elevenMinAgo,
    });
    expect(monitor.getHealth("alice")!.status).toBe("degraded");
  });

  test("account with activity 9 min ago is still healthy", () => {
    const nineMinAgo = new Date(Date.now() - 9 * 60 * 1000).toISOString();
    monitor.update("alice", {
      connected: true,
      lastActivity: nineMinAgo,
    });
    expect(monitor.getHealth("alice")!.status).toBe("healthy");
  });

  test("getStatuses recomputes staleness on each call", () => {
    // Set activity to exactly 10 minutes ago (borderline)
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    monitor.update("alice", {
      connected: true,
      lastActivity: tenMinAgo,
    });
    // At exactly 10 min it should still be healthy (threshold is >10min)
    const statuses = monitor.getStatuses(["alice"]);
    expect(statuses[0].status).toBe("healthy");

    // Set to 11 minutes ago -> degraded
    const elevenMinAgo = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    monitor.update("alice", {
      connected: true,
      lastActivity: elevenMinAgo,
    });
    const statuses2 = monitor.getStatuses(["alice"]);
    expect(statuses2[0].status).toBe("degraded");
  });

  test("stale + disconnected = critical (not degraded)", () => {
    const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    monitor.update("alice", {
      connected: false,
      lastActivity: fifteenMinAgo,
    });
    expect(monitor.getHealth("alice")!.status).toBe("critical");
  });
});
