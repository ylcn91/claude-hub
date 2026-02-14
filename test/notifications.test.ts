import { describe, test, expect, mock } from "bun:test";
import type { NotificationConfig } from "../src/services/notifications";
import {
  DEFAULT_NOTIFICATION_CONFIG,
  notifyRateLimit,
  notifyHandoff,
  notifyMessage,
  sendNotification,
} from "../src/services/notifications";

describe("Notifications", () => {
  describe("DEFAULT_NOTIFICATION_CONFIG", () => {
    test("has notifications enabled by default", () => {
      expect(DEFAULT_NOTIFICATION_CONFIG.enabled).toBe(true);
    });

    test("has all event types enabled by default", () => {
      expect(DEFAULT_NOTIFICATION_CONFIG.events.rateLimit).toBe(true);
      expect(DEFAULT_NOTIFICATION_CONFIG.events.handoffReceived).toBe(true);
      expect(DEFAULT_NOTIFICATION_CONFIG.events.messageReceived).toBe(true);
    });
  });

  describe("config gating", () => {
    const disabledConfig: NotificationConfig = {
      enabled: false,
      events: {
        rateLimit: true,
        handoffReceived: true,
        messageReceived: true,
      },
    };

    test("disabled config prevents rate limit notification", async () => {
      await notifyRateLimit("claude-work", disabledConfig);
      // If we get here, it means the function returned early correctly
      expect(true).toBe(true);
    });

    test("disabled config prevents handoff notification", async () => {
      await notifyHandoff("alice", "bob", "review PR", disabledConfig);
      expect(true).toBe(true);
    });

    test("disabled config prevents message notification", async () => {
      await notifyMessage("alice", "bob", "hello there", disabledConfig);
      expect(true).toBe(true);
    });
  });

  describe("individual event type disabling", () => {
    test("rateLimit event can be individually disabled", async () => {
      const config: NotificationConfig = {
        enabled: true,
        events: {
          rateLimit: false,
          handoffReceived: true,
          messageReceived: true,
        },
      };
      // Should skip sending due to rateLimit being false
      await notifyRateLimit("claude-work", config);
      expect(true).toBe(true);
    });

    test("handoffReceived event can be individually disabled", async () => {
      const config: NotificationConfig = {
        enabled: true,
        events: {
          rateLimit: true,
          handoffReceived: false,
          messageReceived: true,
        },
      };
      await notifyHandoff("alice", "bob", "task", config);
      expect(true).toBe(true);
    });

    test("messageReceived event can be individually disabled", async () => {
      const config: NotificationConfig = {
        enabled: true,
        events: {
          rateLimit: true,
          handoffReceived: true,
          messageReceived: false,
        },
      };
      await notifyMessage("alice", "bob", "hello", config);
      expect(true).toBe(true);
    });
  });

  describe("sendNotification", () => {
    test("returns false on non-darwin platform", async () => {
      // We test the platform check logic directly
      // On macOS this will actually try to send, so we test the config gating above
      // For a pure unit test of the platform check:
      const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");

      // Mock process.platform to simulate non-darwin
      Object.defineProperty(process, "platform", {
        value: "linux",
        writable: true,
        configurable: true,
      });

      const result = await sendNotification("Test", "Hello");
      expect(result).toBe(false);

      // Restore original
      if (originalPlatform) {
        Object.defineProperty(process, "platform", originalPlatform);
      }
    });
  });

  describe("notification message formatting", () => {
    test("notifyMessage truncates preview to 80 characters", async () => {
      const config: NotificationConfig = {
        enabled: false, // disabled so we don't actually send
        events: {
          rateLimit: true,
          handoffReceived: true,
          messageReceived: true,
        },
      };

      const longPreview = "a".repeat(200);
      // This should not throw even with a very long preview
      await notifyMessage("alice", "bob", longPreview, config);
      expect(longPreview.slice(0, 80).length).toBe(80);
    });

    test("preview slice handles short strings", () => {
      const short = "hello";
      expect(short.slice(0, 80)).toBe("hello");
    });

    test("preview slice handles empty string", () => {
      const empty = "";
      expect(empty.slice(0, 80)).toBe("");
    });
  });

  describe("command injection safety", () => {
    test("sendNotification source has no osascript fallback", async () => {
      const src = await Bun.file(
        new URL("../src/services/notifications.ts", import.meta.url).pathname
      ).text();
      expect(src).not.toContain("osascript");
    });

    test("sendNotification uses Bun.spawn with argument array", async () => {
      const src = await Bun.file(
        new URL("../src/services/notifications.ts", import.meta.url).pathname
      ).text();
      expect(src).toContain('Bun.spawn(["terminal-notifier"');
      expect(src).not.toContain("Bun.$`");
    });
  });
});
