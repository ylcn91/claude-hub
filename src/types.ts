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
  githubIntegration?: boolean;
  reviewBundles?: boolean;
  knowledgeIndex?: boolean;
  reliability?: boolean;
}

export interface GitHubConfig {
  enabled: boolean;
  defaultOwner?: string;
  defaultRepo?: string;
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
  github?: GitHubConfig;
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

// Re-export path functions from the consolidated paths module
export {
  getHubDir, getSockPath, getPidPath, getTokensDir, getConfigPath,
  getMessagesDbPath, getWorkspacesDbPath, getCapabilitiesDbPath,
  getDaemonLogPath, getTasksPath,
} from "./paths";

// Backward-compatible const aliases (computed once on import via the paths module)
import {
  getHubDir as _getHubDir, getConfigPath as _getConfigPath,
  getTokensDir as _getTokensDir, getTasksPath as _getTasksPath,
  getPidPath as _getPidPath, getSockPath as _getSockPath,
  getDaemonLogPath as _getDaemonLogPath,
} from "./paths";
export const HUB_DIR = _getHubDir();
export const CONFIG_PATH = _getConfigPath();
export const TOKENS_DIR = _getTokensDir();
export const TASKS_PATH = _getTasksPath();
export const DAEMON_PID_PATH = _getPidPath();
export const DAEMON_SOCK_PATH = _getSockPath();
export const DAEMON_LOG_PATH = _getDaemonLogPath();
