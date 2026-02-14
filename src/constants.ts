/**
 * Centralized numeric constants for daemon, protocol, and infrastructure.
 * Keeps magic numbers out of individual modules.
 */

// -- Daemon protocol --
export const MAX_PAYLOAD_BYTES = 1_048_576; // 1 MB max message payload
export const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 min idle disconnect

// -- MCP bridge --
export const MCP_REQUEST_TIMEOUT_MS = 5_000;
export const DAEMON_START_TIMEOUT_MS = 3_000;
export const DAEMON_START_POLL_MS = 100;
export const MAX_RECONNECT_ATTEMPTS = 5;
export const RECONNECT_MAX_DELAY_MS = 30_000;

// -- Daemon client (TUI) --
export const DAEMON_CLIENT_TIMEOUT_MS = 2_000;

// -- Health monitoring --
export const STALE_THRESHOLD_MS = 10 * 60 * 1000; // 10 min

// -- Workload metrics --
export const THROUGHPUT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
