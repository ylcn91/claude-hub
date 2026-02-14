import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { SessionStore } from "../../src/daemon/session-store";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";

const TEST_DIR = join(import.meta.dir, ".test-session-store");
let dbCounter = 0;
function uniqueDbPath(): string {
  return join(TEST_DIR, `test-${++dbCounter}-${Date.now()}.db`);
}

beforeEach(() => mkdirSync(TEST_DIR, { recursive: true }));
afterEach(() => rmSync(TEST_DIR, { recursive: true, force: true }));

describe("SessionStore", () => {
  test("constructor creates DB and tables", () => {
    const store = new SessionStore(uniqueDbPath());
    const session = store.nameSession("sess-1", "My Session", { account: "work" });
    expect(session.id).toBe("sess-1");
    expect(session.name).toBe("My Session");
    store.close();
  });

  test("nameSession creates new session", () => {
    const store = new SessionStore(uniqueDbPath());
    const session = store.nameSession("sess-1", "Bug Fix Session", {
      account: "work",
      tags: ["bugfix", "urgent"],
      notes: "Fixing login flow",
    });
    expect(session.id).toBe("sess-1");
    expect(session.name).toBe("Bug Fix Session");
    expect(session.account).toBe("work");
    expect(session.tags).toEqual(["bugfix", "urgent"]);
    expect(session.notes).toBe("Fixing login flow");
    expect(session.startedAt).toBeTruthy();
    store.close();
  });

  test("nameSession updates existing session", () => {
    const store = new SessionStore(uniqueDbPath());
    store.nameSession("sess-1", "Original Name", { account: "work", tags: ["v1"] });
    const updated = store.nameSession("sess-1", "Updated Name", { tags: ["v2"] });
    expect(updated.name).toBe("Updated Name");
    expect(updated.tags).toEqual(["v2"]);
    expect(updated.account).toBe("work");
    store.close();
  });

  test("getById retrieves session", () => {
    const store = new SessionStore(uniqueDbPath());
    store.nameSession("sess-1", "Test Session", { account: "alice", tags: ["test"] });
    const result = store.getById("sess-1");
    expect(result).not.toBeNull();
    expect(result!.name).toBe("Test Session");
    expect(result!.account).toBe("alice");
    expect(result!.tags).toEqual(["test"]);
    store.close();
  });

  test("getById returns null for missing session", () => {
    const store = new SessionStore(uniqueDbPath());
    const result = store.getById("nonexistent");
    expect(result).toBeNull();
    store.close();
  });

  test("list returns all sessions", () => {
    const store = new SessionStore(uniqueDbPath());
    store.nameSession("sess-1", "First", { account: "work" });
    store.nameSession("sess-2", "Second", { account: "work" });
    store.nameSession("sess-3", "Third", { account: "review" });

    const all = store.list();
    expect(all.length).toBe(3);
    const names = all.map(s => s.name);
    expect(names).toContain("First");
    expect(names).toContain("Second");
    expect(names).toContain("Third");
    store.close();
  });

  test("list filters by account", () => {
    const store = new SessionStore(uniqueDbPath());
    store.nameSession("sess-1", "Work One", { account: "work" });
    store.nameSession("sess-2", "Work Two", { account: "work" });
    store.nameSession("sess-3", "Review One", { account: "review" });

    const workSessions = store.list({ account: "work" });
    expect(workSessions.length).toBe(2);
    for (const s of workSessions) {
      expect(s.account).toBe("work");
    }
    store.close();
  });

  test("list respects limit and offset", () => {
    const store = new SessionStore(uniqueDbPath());
    for (let i = 0; i < 10; i++) {
      store.nameSession(`sess-${i}`, `Session ${i}`, { account: "work" });
    }

    const page1 = store.list({ limit: 3 });
    expect(page1.length).toBe(3);

    const page2 = store.list({ limit: 3, offset: 3 });
    expect(page2.length).toBe(3);
    expect(page2[0].id).not.toBe(page1[0].id);
    store.close();
  });

  test("search finds sessions by name", () => {
    const store = new SessionStore(uniqueDbPath());
    store.nameSession("sess-1", "Deploy Pipeline Fix", { account: "work" });
    store.nameSession("sess-2", "Unit Test Runner", { account: "work" });

    const results = store.search("Deploy");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].session.name).toBe("Deploy Pipeline Fix");
    expect(results[0].rank).toBeDefined();
    expect(results[0].snippet).toBeDefined();
    store.close();
  });

  test("search finds sessions by tags", () => {
    const store = new SessionStore(uniqueDbPath());
    store.nameSession("sess-1", "Session A", { account: "work", tags: ["kubernetes", "deploy"] });
    store.nameSession("sess-2", "Session B", { account: "work", tags: ["testing"] });

    const results = store.search("kubernetes");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].session.id).toBe("sess-1");
    store.close();
  });

  test("search finds sessions by notes", () => {
    const store = new SessionStore(uniqueDbPath());
    store.nameSession("sess-1", "Debug", { account: "work", notes: "Investigating memory leak in production" });
    store.nameSession("sess-2", "Feature", { account: "work", notes: "Adding pagination" });

    const results = store.search("memory leak");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].session.id).toBe("sess-1");
    store.close();
  });

  test("search returns empty for no match", () => {
    const store = new SessionStore(uniqueDbPath());
    store.nameSession("sess-1", "Hello", { account: "work" });
    const results = store.search("xyznonexistent");
    expect(results).toEqual([]);
    store.close();
  });

  test("search respects limit", () => {
    const store = new SessionStore(uniqueDbPath());
    for (let i = 0; i < 10; i++) {
      store.nameSession(`sess-${i}`, `Deploy session ${i}`, { account: "work" });
    }

    const results = store.search("Deploy", 3);
    expect(results.length).toBe(3);
    store.close();
  });

  test("endSession sets ended_at", () => {
    const store = new SessionStore(uniqueDbPath());
    store.nameSession("sess-1", "Active Session", { account: "work" });
    const ended = store.endSession("sess-1");
    expect(ended).toBe(true);

    const session = store.getById("sess-1");
    expect(session!.endedAt).toBeTruthy();
    store.close();
  });

  test("endSession returns false for missing session", () => {
    const store = new SessionStore(uniqueDbPath());
    const ended = store.endSession("nonexistent");
    expect(ended).toBe(false);
    store.close();
  });

  test("deleteSession removes session", () => {
    const store = new SessionStore(uniqueDbPath());
    store.nameSession("sess-1", "To Delete", { account: "work" });
    const deleted = store.deleteSession("sess-1");
    expect(deleted).toBe(true);
    expect(store.getById("sess-1")).toBeNull();
    store.close();
  });

  test("deleteSession returns false for missing session", () => {
    const store = new SessionStore(uniqueDbPath());
    const deleted = store.deleteSession("nonexistent");
    expect(deleted).toBe(false);
    store.close();
  });

  // --- New tests for code review findings ---

  test("search with empty string returns empty array", () => {
    const store = new SessionStore(uniqueDbPath());
    store.nameSession("sess-1", "Hello World", { account: "work" });
    const results = store.search("");
    expect(results).toEqual([]);
    store.close();
  });

  test("search with special characters (quotes, asterisks, parentheses, OR, NEAR, AND)", () => {
    const store = new SessionStore(uniqueDbPath());
    store.nameSession("sess-1", "Test Session Alpha", { account: "work" });
    store.nameSession("sess-2", "OR AND NEAR session", { account: "work" });

    // Quotes should be sanitized and not crash
    const r1 = store.search('"test"');
    // Should not throw, may or may not find results depending on sanitization
    expect(Array.isArray(r1)).toBe(true);

    // Asterisks
    const r2 = store.search("test*");
    expect(Array.isArray(r2)).toBe(true);

    // Parentheses
    const r3 = store.search("(test)");
    expect(Array.isArray(r3)).toBe(true);

    // FTS5 operators as search terms
    const r4 = store.search("OR");
    expect(Array.isArray(r4)).toBe(true);

    const r5 = store.search("NEAR");
    expect(Array.isArray(r5)).toBe(true);

    const r6 = store.search("AND");
    expect(Array.isArray(r6)).toBe(true);

    store.close();
  });

  test("nameSession with empty tags array", () => {
    const store = new SessionStore(uniqueDbPath());
    const session = store.nameSession("sess-1", "No Tags", { account: "work", tags: [] });
    expect(session.tags).toEqual([]);
    const retrieved = store.getById("sess-1");
    expect(retrieved!.tags).toEqual([]);
    store.close();
  });

  test("nameSession when account is omitted throws error", () => {
    const store = new SessionStore(uniqueDbPath());
    expect(() => {
      store.nameSession("sess-1", "No Account");
    }).toThrow("Account is required when creating a new session");
    store.close();
  });

  test("nameSession when account is empty string throws error", () => {
    const store = new SessionStore(uniqueDbPath());
    expect(() => {
      store.nameSession("sess-1", "Empty Account", { account: "" });
    }).toThrow("Account is required when creating a new session");
    store.close();
  });

  test("nameSession with oversized name (>500 chars) throws error", () => {
    const store = new SessionStore(uniqueDbPath());
    const longName = "x".repeat(501);
    expect(() => {
      store.nameSession("sess-1", longName, { account: "work" });
    }).toThrow("Session name must not exceed 500 characters");
    store.close();
  });

  test("nameSession with exactly 500 char name succeeds", () => {
    const store = new SessionStore(uniqueDbPath());
    const name = "x".repeat(500);
    const session = store.nameSession("sess-1", name, { account: "work" });
    expect(session.name.length).toBe(500);
    store.close();
  });

  test("nameSession with oversized notes (>10000 chars) throws error", () => {
    const store = new SessionStore(uniqueDbPath());
    const longNotes = "n".repeat(10001);
    expect(() => {
      store.nameSession("sess-1", "Valid Name", { account: "work", notes: longNotes });
    }).toThrow("Session notes must not exceed 10000 characters");
    store.close();
  });

  test("nameSession with exactly 10000 char notes succeeds", () => {
    const store = new SessionStore(uniqueDbPath());
    const notes = "n".repeat(10000);
    const session = store.nameSession("sess-1", "Valid Name", { account: "work", notes });
    expect(session.notes!.length).toBe(10000);
    store.close();
  });

  test("nameSession with too many tags (>50) throws error", () => {
    const store = new SessionStore(uniqueDbPath());
    const tooManyTags = Array.from({ length: 51 }, (_, i) => `tag-${i}`);
    expect(() => {
      store.nameSession("sess-1", "Many Tags", { account: "work", tags: tooManyTags });
    }).toThrow("Session tags must not exceed 50 entries");
    store.close();
  });

  test("nameSession with exactly 50 tags succeeds", () => {
    const store = new SessionStore(uniqueDbPath());
    const tags = Array.from({ length: 50 }, (_, i) => `tag-${i}`);
    const session = store.nameSession("sess-1", "Fifty Tags", { account: "work", tags });
    expect(session.tags.length).toBe(50);
    store.close();
  });

  test("nameSession with tag exceeding 100 chars throws error", () => {
    const store = new SessionStore(uniqueDbPath());
    const longTag = "t".repeat(101);
    expect(() => {
      store.nameSession("sess-1", "Long Tag", { account: "work", tags: [longTag] });
    }).toThrow("Each session tag must not exceed 100 characters");
    store.close();
  });

  test("deleteSession followed by search verifies FTS sync", () => {
    const store = new SessionStore(uniqueDbPath());
    store.nameSession("sess-1", "Searchable Session Alpha", { account: "work" });
    store.nameSession("sess-2", "Another Session Beta", { account: "work" });

    // Verify session is searchable before delete
    let results = store.search("Alpha");
    expect(results.length).toBe(1);
    expect(results[0].session.id).toBe("sess-1");

    // Delete the session
    const deleted = store.deleteSession("sess-1");
    expect(deleted).toBe(true);

    // Verify FTS index is updated - searching should no longer find it
    results = store.search("Alpha");
    expect(results.length).toBe(0);

    // Other sessions should still be searchable
    results = store.search("Beta");
    expect(results.length).toBe(1);
    expect(results[0].session.id).toBe("sess-2");

    store.close();
  });

  test("search with only whitespace input returns empty array", () => {
    const store = new SessionStore(uniqueDbPath());
    store.nameSession("sess-1", "Test", { account: "work" });
    const results = store.search("   ");
    expect(results).toEqual([]);
    store.close();
  });

  test("sanitizeQuery handles adversarial inputs indirectly", () => {
    const store = new SessionStore(uniqueDbPath());
    store.nameSession("sess-1", "Hello World", { account: "work" });

    // Only-quotes string should be handled gracefully
    const r1 = store.search('"""');
    expect(Array.isArray(r1)).toBe(true);

    // Single quote character
    const r2 = store.search('"');
    expect(Array.isArray(r2)).toBe(true);

    // Mixed operators and special chars
    const r3 = store.search('OR AND "test" NEAR(a,b)');
    expect(Array.isArray(r3)).toBe(true);

    // Tab and newline characters
    const r4 = store.search("\t\n");
    expect(Array.isArray(r4)).toBe(true);

    // Unicode characters
    const r5 = store.search("cafe\u0301");
    expect(Array.isArray(r5)).toBe(true);

    store.close();
  });
});
