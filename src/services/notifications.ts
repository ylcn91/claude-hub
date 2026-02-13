import { atomicRead } from "./file-store.js";

export interface NotificationConfig {
  enabled: boolean;
  events: {
    rateLimit: boolean;
    handoffReceived: boolean;
    messageReceived: boolean;
  };
  muteList?: string[];
}

export const DEFAULT_NOTIFICATION_CONFIG: NotificationConfig = {
  enabled: true,
  events: {
    rateLimit: true,
    handoffReceived: true,
    messageReceived: true,
  },
};

// macOS notification via terminal-notifier (custom icon, clickable) with osascript fallback
export async function sendNotification(
  title: string,
  body: string,
  opts?: { subtitle?: string; sound?: string }
): Promise<boolean> {
  if (process.platform !== "darwin") return false;
  if (process.env.NODE_ENV === "test" || process.env.BUN_ENV === "test") return false;

  try {
    // Prefer terminal-notifier for proper app icon and clickable notifications
    const args = ["-title", title, "-message", body, "-group", "claude-hub"];
    if (opts?.subtitle) args.push("-subtitle", opts.subtitle);
    if (opts?.sound) args.push("-sound", opts.sound);
    await Bun.$`terminal-notifier ${args}`.quiet();
    return true;
  } catch {
    // Fallback to osascript if terminal-notifier unavailable
    try {
      const subtitle = opts?.subtitle ? `subtitle "${opts.subtitle}"` : "";
      const sound = opts?.sound ? `sound name "${opts.sound}"` : "";
      const script = `display notification "${body}" with title "${title}" ${subtitle} ${sound}`;
      await Bun.$`osascript -e ${script}`.quiet();
      return true;
    } catch {
      return false;
    }
  }
}

// Load notification config from hub config
export async function loadNotificationConfig(): Promise<NotificationConfig> {
  try {
    const { getConfigPath } = await import("../paths.js");
    const config = await atomicRead<any>(getConfigPath());
    if (config?.notifications) {
      return { ...DEFAULT_NOTIFICATION_CONFIG, ...config.notifications };
    }
  } catch {}
  return DEFAULT_NOTIFICATION_CONFIG;
}

function isMuted(from: string, config: NotificationConfig): boolean {
  return config.muteList?.includes(from) ?? false;
}

// Event-specific notifications
export async function notifyRateLimit(accountName: string, config?: NotificationConfig): Promise<void> {
  const cfg = config ?? await loadNotificationConfig();
  if (!cfg.enabled || !cfg.events.rateLimit) return;
  await sendNotification("Claude Hub", `${accountName} approaching rate limit`, {
    subtitle: "⚠️ Rate Limit Warning",
    sound: "Pop",
  });
}

export async function notifyHandoff(from: string, _to: string, task: string, config?: NotificationConfig): Promise<void> {
  const cfg = config ?? await loadNotificationConfig();
  if (!cfg.enabled || !cfg.events.handoffReceived) return;
  if (isMuted(from, cfg)) return;
  await sendNotification("Claude Hub", task.slice(0, 120), {
    subtitle: `🔄 Handoff from ${from}`,
    sound: "Blow",
  });
}

export async function notifyMessage(from: string, _to: string, preview: string, config?: NotificationConfig): Promise<void> {
  const cfg = config ?? await loadNotificationConfig();
  if (!cfg.enabled || !cfg.events.messageReceived) return;
  if (isMuted(from, cfg)) return;
  await sendNotification("Claude Hub", preview.slice(0, 120), {
    subtitle: `💬 Message from ${from}`,
    sound: "Pop",
  });
}
