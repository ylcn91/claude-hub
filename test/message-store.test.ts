import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { MessageStore } from "../src/daemon/message-store";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("MessageStore", () => {
  let store: MessageStore;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "msg-store-"));
    store = new MessageStore(join(tmpDir, "test.db"));
  });

  afterEach(() => {
    store.close();
    rmSync(tmpDir, { recursive: true });
  });

  test("adds and retrieves messages", () => {
    store.addMessage({
      from: "alice",
      to: "bob",
      type: "message",
      content: "Hello Bob!",
      timestamp: new Date().toISOString(),
    });

    const messages = store.getMessages("bob");
    expect(messages).toHaveLength(1);
    expect(messages[0].from).toBe("alice");
    expect(messages[0].to).toBe("bob");
    expect(messages[0].content).toBe("Hello Bob!");
    expect(messages[0].type).toBe("message");
    expect(messages[0].read).toBe(false);
    expect(messages[0].id).toBeDefined();
  });

  test("marks messages as read", () => {
    const id = store.addMessage({
      from: "alice",
      to: "bob",
      type: "message",
      content: "Hello",
      timestamp: new Date().toISOString(),
    });

    store.markRead("bob", id);
    const unread = store.getUnreadMessages("bob");
    expect(unread).toHaveLength(0);

    const all = store.getMessages("bob");
    expect(all).toHaveLength(1);
    expect(all[0].read).toBe(true);
  });

  test("marks all read for account", () => {
    store.addMessage({
      from: "alice",
      to: "bob",
      type: "message",
      content: "Hello 1",
      timestamp: new Date().toISOString(),
    });
    store.addMessage({
      from: "carol",
      to: "bob",
      type: "message",
      content: "Hello 2",
      timestamp: new Date().toISOString(),
    });

    store.markAllRead("bob");
    const unread = store.getUnreadMessages("bob");
    expect(unread).toHaveLength(0);
  });

  test("gets unread messages only", () => {
    const id1 = store.addMessage({
      from: "alice",
      to: "bob",
      type: "message",
      content: "Read me",
      timestamp: new Date().toISOString(),
    });
    store.addMessage({
      from: "carol",
      to: "bob",
      type: "message",
      content: "Unread",
      timestamp: new Date().toISOString(),
    });

    store.markRead("bob", id1);
    const unread = store.getUnreadMessages("bob");
    expect(unread).toHaveLength(1);
    expect(unread[0].content).toBe("Unread");
  });

  test("supports pagination with limit/offset", () => {
    for (let i = 0; i < 10; i++) {
      store.addMessage({
        from: "alice",
        to: "bob",
        type: "message",
        content: `Message ${i}`,
        timestamp: new Date(Date.now() + i * 1000).toISOString(),
      });
    }

    const page1 = store.getMessages("bob", { limit: 3, offset: 0 });
    expect(page1).toHaveLength(3);

    const page2 = store.getMessages("bob", { limit: 3, offset: 3 });
    expect(page2).toHaveLength(3);

    // Messages are ordered by timestamp DESC, so page1 has newest
    expect(page1[0].content).not.toBe(page2[0].content);

    const all = store.getMessages("bob", { limit: 50, offset: 0 });
    expect(all).toHaveLength(10);
  });

  test("archives old read messages", () => {
    const oldTimestamp = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const newTimestamp = new Date().toISOString();

    const oldId = store.addMessage({
      from: "alice",
      to: "bob",
      type: "message",
      content: "Old message",
      timestamp: oldTimestamp,
    });
    store.addMessage({
      from: "carol",
      to: "bob",
      type: "message",
      content: "New message",
      timestamp: newTimestamp,
    });

    // Mark the old one as read
    store.markRead("bob", oldId);

    const archived = store.archiveOld(7);
    expect(archived).toBe(1);

    const remaining = store.getMessages("bob");
    expect(remaining).toHaveLength(1);
    expect(remaining[0].content).toBe("New message");
  });

  test("does not archive unread messages", () => {
    const oldTimestamp = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();

    store.addMessage({
      from: "alice",
      to: "bob",
      type: "message",
      content: "Old unread",
      timestamp: oldTimestamp,
    });

    const archived = store.archiveOld(7);
    expect(archived).toBe(0);

    const messages = store.getMessages("bob");
    expect(messages).toHaveLength(1);
  });

  test("handles handoff messages", () => {
    store.addMessage({
      from: "alice",
      to: "bob",
      type: "handoff",
      content: "Please review this PR",
      timestamp: new Date().toISOString(),
      context: { branch: "feature/foo", projectDir: "/code" },
    });
    store.addMessage({
      from: "carol",
      to: "bob",
      type: "message",
      content: "Regular message",
      timestamp: new Date().toISOString(),
    });

    const handoffs = store.getHandoffs("bob");
    expect(handoffs).toHaveLength(1);
    expect(handoffs[0].type).toBe("handoff");
    expect(handoffs[0].content).toBe("Please review this PR");
  });

  test("persists context as JSON", () => {
    store.addMessage({
      from: "alice",
      to: "bob",
      type: "handoff",
      content: "Task",
      timestamp: new Date().toISOString(),
      context: { branch: "main", projectDir: "/home/project", notes: "check tests" },
    });

    const messages = store.getMessages("bob");
    expect(messages[0].context).toEqual({
      branch: "main",
      projectDir: "/home/project",
      notes: "check tests",
    });
  });

  test("handles null context", () => {
    store.addMessage({
      from: "alice",
      to: "bob",
      type: "message",
      content: "No context",
      timestamp: new Date().toISOString(),
    });

    const messages = store.getMessages("bob");
    expect(messages[0].context).toBeUndefined();
  });

  test("survives close and reopen", () => {
    store.addMessage({
      from: "alice",
      to: "bob",
      type: "message",
      content: "Persistent message",
      timestamp: new Date().toISOString(),
    });

    const dbPath = join(tmpDir, "test.db");
    store.close();

    // Reopen with same path
    store = new MessageStore(dbPath);
    const messages = store.getMessages("bob");
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe("Persistent message");
  });

  test("returns generated id from addMessage", () => {
    const id = store.addMessage({
      from: "alice",
      to: "bob",
      type: "message",
      content: "Test",
      timestamp: new Date().toISOString(),
    });

    expect(id).toBeDefined();
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });

  test("uses provided id if given", () => {
    const customId = "custom-id-123";
    const id = store.addMessage({
      id: customId,
      from: "alice",
      to: "bob",
      type: "message",
      content: "Test",
      timestamp: new Date().toISOString(),
    });

    expect(id).toBe(customId);
    const messages = store.getMessages("bob");
    expect(messages[0].id).toBe(customId);
  });

  test("isolates messages by recipient", () => {
    store.addMessage({
      from: "alice",
      to: "bob",
      type: "message",
      content: "For Bob",
      timestamp: new Date().toISOString(),
    });
    store.addMessage({
      from: "alice",
      to: "carol",
      type: "message",
      content: "For Carol",
      timestamp: new Date().toISOString(),
    });

    const bobMessages = store.getMessages("bob");
    expect(bobMessages).toHaveLength(1);
    expect(bobMessages[0].content).toBe("For Bob");

    const carolMessages = store.getMessages("carol");
    expect(carolMessages).toHaveLength(1);
    expect(carolMessages[0].content).toBe("For Carol");
  });
});
