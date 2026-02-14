export function assertHomeDir(): string {
  const home = process.env.HOME;
  if (!home) throw new Error("HOME environment variable is not set");
  return home;
}

export function getHubDir(): string {
  return process.env.CLAUDE_HUB_DIR ?? `${assertHomeDir()}/.claude-hub`;
}

export function getSockPath(): string {
  return `${getHubDir()}/hub.sock`;
}

export function getPidPath(): string {
  return `${getHubDir()}/daemon.pid`;
}

export function getTokensDir(): string {
  return `${getHubDir()}/tokens`;
}

export function getConfigPath(): string {
  return `${getHubDir()}/config.json`;
}

export function getMessagesDbPath(): string {
  return `${getHubDir()}/messages.db`;
}

export function getWorkspacesDbPath(): string {
  return `${getHubDir()}/workspaces.db`;
}

export function getCapabilitiesDbPath(): string {
  return `${getHubDir()}/capabilities.db`;
}

export function getDaemonLogPath(): string {
  return `${getHubDir()}/daemon.log`;
}

export function getTasksPath(): string {
  return `${getHubDir()}/tasks.json`;
}

export function getKnowledgeDbPath(): string {
  return `${getHubDir()}/knowledge.db`;
}

export function getPromptsPath(): string {
  return `${getHubDir()}/prompts.json`;
}

export function getHandoffTemplatesPath(): string {
  return `${getHubDir()}/handoff-templates.json`;
}

export function getClipboardPath(): string {
  return `${getHubDir()}/clipboard.json`;
}

export function getExternalLinksDbPath(): string {
  return `${getHubDir()}/external-links.db`;
}

export function getReviewBundlesDir(): string {
  return `${getHubDir()}/review-bundles`;
}

export function getActivityDbPath(): string {
  return `${getHubDir()}/activity.db`;
}

export function getWorkflowDbPath(): string {
  return `${getHubDir()}/workflow.db`;
}

export function getRetroDbPath(): string {
  return `${getHubDir()}/retro.db`;
}

export function getSessionsDbPath(): string {
  return `${getHubDir()}/sessions.db`;
}
