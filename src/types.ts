export interface QuotaPolicyConfig {
  plan: "max-5x" | "max-20x" | "pro" | "unknown";
  windowMs: number;
  estimatedLimit: number;
  source: "community-estimate" | "custom";
}

export const PROVIDER_IDS = ["claude-code", "codex-cli", "openhands", "gemini-cli"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export interface AccountConfig {
  name: string;
  configDir: string;
  color: string;
  label: string;
  provider: ProviderId;
  quotaPolicy?: Partial<QuotaPolicyConfig>;
}

export interface FeatureFlags {
  workspaceWorktree?: boolean;
  autoAcceptance?: boolean;
  capabilityRouting?: boolean;
  slaEngine?: boolean;
}

export interface HubConfig {
  schemaVersion: number;
  accounts: AccountConfig[];
  entire: { autoEnable: boolean };
  notifications?: {
    enabled: boolean;
    events: {
      rateLimit: boolean;
      handoffReceived: boolean;
      messageReceived: boolean;
    };
    muteList?: string[];
  };
  features?: FeatureFlags;
  defaults: {
    launchInNewWindow: boolean;
    quotaPolicy: QuotaPolicyConfig;
  };
}

export const DEFAULT_CONFIG: HubConfig = {
  schemaVersion: 1,
  accounts: [],
  entire: { autoEnable: true },
  defaults: {
    launchInNewWindow: true,
    quotaPolicy: {
      plan: "max-5x",
      windowMs: 5 * 60 * 60 * 1000,
      estimatedLimit: 225,
      source: "community-estimate",
    },
  },
};

export const HUB_DIR = `${process.env.HOME}/.claude-hub`;
export const CONFIG_PATH = `${HUB_DIR}/config.json`;
export const TOKENS_DIR = `${HUB_DIR}/tokens`;
export const MESSAGES_DIR = `${HUB_DIR}/messages`;
export const TASKS_PATH = `${HUB_DIR}/tasks.json`;
export const DAEMON_PID_PATH = `${HUB_DIR}/daemon.pid`;
export const DAEMON_SOCK_PATH = `${HUB_DIR}/hub.sock`;
export const DAEMON_LOG_PATH = `${HUB_DIR}/daemon.log`;
