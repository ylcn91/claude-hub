import type { DaemonState } from "./state";
import { getHealthStatus, type HealthStatus } from "./health";

export interface WatchdogConfig {
  intervalMs: number;
  memoryThresholdMb: number;
  onUnhealthy: (status: HealthStatus) => void;
}

/** Default watchdog configuration: 30s poll interval, 512 MB memory ceiling. */
const DEFAULT_CONFIG: WatchdogConfig = {
  intervalMs: 30_000,          // 30 seconds between health checks
  memoryThresholdMb: 512,      // alert when RSS exceeds 512 MB
  onUnhealthy: (status) => {
    console.error("[watchdog] Unhealthy:", JSON.stringify(status));
  },
};

export function startWatchdog(
  state: DaemonState,
  startedAt: string,
  config?: Partial<WatchdogConfig>
): { stop: () => void } {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  const intervalId = setInterval(() => {
    const status = getHealthStatus(state, startedAt);
    if (!status.messageStoreOk || status.memoryUsageMb > cfg.memoryThresholdMb) {
      cfg.onUnhealthy(status);
    }
  }, cfg.intervalMs);

  return {
    stop: () => clearInterval(intervalId),
  };
}
