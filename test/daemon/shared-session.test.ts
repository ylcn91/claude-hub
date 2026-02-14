import { describe, test, expect, beforeEach } from "bun:test";
import { SharedSessionManager } from "../../src/daemon/shared-session";

describe("SharedSessionManager", () => {
  let manager: SharedSessionManager;

  beforeEach(() => {
    manager = new SharedSessionManager();
  });

  describe("createSession", () => {
    test("creates a session with correct fields", () => {
      const session = manager.createSession("alice", "bob", "/project");
      expect(session.id).toBeTruthy();
      expect(session.initiator).toBe("alice");
      expect(session.participant).toBe("bob");
      expect(session.workspace).toBe("/project");
      expect(session.active).toBe(true);
      expect(session.joined).toBe(false);
      expect(session.startedAt).toBeTruthy();
      expect(session.lastPing["alice"]).toBeGreaterThan(0);
    });

    test("generates unique session IDs", () => {
      const s1 = manager.createSession("alice", "bob", "/proj1");
      const s2 = manager.createSession("alice", "charlie", "/proj2");
      expect(s1.id).not.toBe(s2.id);
    });

    // Test 9: Self-pairing throws error
    test("throws error when initiator === participant", () => {
      expect(() => manager.createSession("alice", "alice", "/project")).toThrow(
        "Cannot create session with yourself"
      );
    });
  });

  describe("joinSession", () => {
    test("allows participant to join", () => {
      const session = manager.createSession("alice", "bob", "/project");
      const result = manager.joinSession(session.id, "bob");
      expect(result).toBe(true);
      const updated = manager.getSession(session.id)!;
      expect(updated.joined).toBe(true);
      expect(updated.lastPing["bob"]).toBeGreaterThan(0);
    });

    test("rejects non-participant from joining", () => {
      const session = manager.createSession("alice", "bob", "/project");
      const result = manager.joinSession(session.id, "charlie");
      expect(result).toBe(false);
    });

    test("rejects join on invalid session", () => {
      const result = manager.joinSession("nonexistent", "bob");
      expect(result).toBe(false);
    });

    test("rejects join on inactive session", () => {
      const session = manager.createSession("alice", "bob", "/project");
      manager.endSession(session.id, "alice");
      const result = manager.joinSession(session.id, "bob");
      expect(result).toBe(false);
    });
  });

  describe("isMember", () => {
    // Test 5: isMember returns true for initiator
    test("returns true for initiator", () => {
      const session = manager.createSession("alice", "bob", "/project");
      expect(manager.isMember(session.id, "alice")).toBe(true);
    });

    // Test 6: isMember returns true for participant
    test("returns true for participant", () => {
      const session = manager.createSession("alice", "bob", "/project");
      expect(manager.isMember(session.id, "bob")).toBe(true);
    });

    // Test 7: isMember returns false for non-member
    test("returns false for non-member", () => {
      const session = manager.createSession("alice", "bob", "/project");
      expect(manager.isMember(session.id, "charlie")).toBe(false);
    });

    // Test 8: isMember returns false for nonexistent session
    test("returns false for nonexistent session", () => {
      expect(manager.isMember("nonexistent", "alice")).toBe(false);
    });
  });

  describe("addUpdate and getUpdates", () => {
    test("stores and retrieves updates", () => {
      const session = manager.createSession("alice", "bob", "/project");
      manager.addUpdate(session.id, "alice", { type: "file_change", path: "/foo.ts" });
      manager.addUpdate(session.id, "alice", { type: "message", text: "hello" });

      const updates = manager.getUpdates(session.id, "bob");
      expect(updates).toHaveLength(2);
      expect(updates[0].from).toBe("alice");
      expect(updates[0].data).toEqual({ type: "file_change", path: "/foo.ts" });
      expect(updates[0].timestamp).toBeTruthy();
      expect(updates[1].data).toEqual({ type: "message", text: "hello" });
    });

    test("read cursors track unread updates per account", () => {
      const session = manager.createSession("alice", "bob", "/project");
      manager.addUpdate(session.id, "alice", "update1");
      manager.addUpdate(session.id, "alice", "update2");

      // Bob reads both
      const first = manager.getUpdates(session.id, "bob");
      expect(first).toHaveLength(2);

      // Bob reads again - no new updates
      const second = manager.getUpdates(session.id, "bob");
      expect(second).toHaveLength(0);

      // New update arrives
      manager.addUpdate(session.id, "bob", "update3");

      // Alice reads all 3 (never read before)
      const aliceUpdates = manager.getUpdates(session.id, "alice");
      expect(aliceUpdates).toHaveLength(3);

      // Bob reads only the new one
      const bobNew = manager.getUpdates(session.id, "bob");
      expect(bobNew).toHaveLength(1);
      expect(bobNew[0].data).toBe("update3");
    });

    // Test 14: addUpdate returns false for inactive session
    test("does not add updates to inactive session and returns false", () => {
      const session = manager.createSession("alice", "bob", "/project");
      manager.endSession(session.id, "alice");
      const result = manager.addUpdate(session.id, "alice", "should-not-appear");
      expect(result).toBe(false);
      const updates = manager.getUpdates(session.id, "bob");
      expect(updates).toHaveLength(0);
    });

    test("returns empty array for nonexistent session", () => {
      const updates = manager.getUpdates("nonexistent", "bob");
      expect(updates).toHaveLength(0);
    });

    // Test 1: Non-member cannot addUpdate
    test("non-member cannot addUpdate to a session", () => {
      const session = manager.createSession("alice", "bob", "/project");
      const result = manager.addUpdate(session.id, "charlie", { type: "hack" });
      expect(result).toBe(false);
      // Verify no update was added
      const updates = manager.getUpdates(session.id, "alice");
      expect(updates).toHaveLength(0);
    });

    // Test 2: Non-member cannot getUpdates
    test("non-member cannot getUpdates from a session", () => {
      const session = manager.createSession("alice", "bob", "/project");
      manager.addUpdate(session.id, "alice", "secret data");
      const updates = manager.getUpdates(session.id, "charlie");
      expect(updates).toHaveLength(0);
    });

    // Test 13: addUpdate returns false for non-member
    test("addUpdate returns false for non-member", () => {
      const session = manager.createSession("alice", "bob", "/project");
      expect(manager.addUpdate(session.id, "charlie", "data")).toBe(false);
    });

    // Test 15: addUpdate returns true for valid member and active session
    test("addUpdate returns true for valid member and active session", () => {
      const session = manager.createSession("alice", "bob", "/project");
      expect(manager.addUpdate(session.id, "alice", "data")).toBe(true);
      expect(manager.addUpdate(session.id, "bob", "reply")).toBe(true);
    });
  });

  describe("recordPing", () => {
    test("updates lastPing for account", () => {
      const session = manager.createSession("alice", "bob", "/project");

      // Wait a tiny bit to ensure timestamp changes
      const before = Date.now();
      manager.recordPing(session.id, "alice");
      const updated = manager.getSession(session.id)!;
      expect(updated.lastPing["alice"]).toBeGreaterThanOrEqual(before);
    });

    test("does not crash on nonexistent session", () => {
      const result = manager.recordPing("nonexistent", "alice");
      expect(result).toBe(false);
    });

    test("does not update ping on inactive session", () => {
      const session = manager.createSession("alice", "bob", "/project");
      manager.endSession(session.id, "alice");
      const before = session.lastPing["alice"];
      const result = manager.recordPing(session.id, "alice");
      expect(result).toBe(false);
      // lastPing is unchanged since session is inactive
      expect(manager.getSession(session.id)!.lastPing["alice"]).toBe(before);
    });

    // Test 4: Non-member cannot recordPing
    test("non-member cannot recordPing", () => {
      const session = manager.createSession("alice", "bob", "/project");
      const result = manager.recordPing(session.id, "charlie");
      expect(result).toBe(false);
      // Verify charlie's ping was NOT recorded
      expect(manager.getSession(session.id)!.lastPing["charlie"]).toBeUndefined();
    });

    test("recordPing returns true for valid member", () => {
      const session = manager.createSession("alice", "bob", "/project");
      expect(manager.recordPing(session.id, "alice")).toBe(true);
    });
  });

  describe("endSession", () => {
    // Test 16: endSession returns true when session exists and account is member
    test("marks session as inactive and returns true for member", () => {
      const session = manager.createSession("alice", "bob", "/project");
      const result = manager.endSession(session.id, "alice");
      expect(result).toBe(true);
      const updated = manager.getSession(session.id)!;
      expect(updated.active).toBe(false);
    });

    test("participant can also end session", () => {
      const session = manager.createSession("alice", "bob", "/project");
      const result = manager.endSession(session.id, "bob");
      expect(result).toBe(true);
      expect(manager.getSession(session.id)!.active).toBe(false);
    });

    // Test 17: endSession returns false when session doesn't exist
    test("returns false for nonexistent session", () => {
      const result = manager.endSession("nonexistent", "alice");
      expect(result).toBe(false);
    });

    // Test 3 + 18: Non-member cannot endSession
    test("non-member cannot end session and returns false", () => {
      const session = manager.createSession("alice", "bob", "/project");
      const result = manager.endSession(session.id, "charlie");
      expect(result).toBe(false);
      // Session should still be active
      expect(manager.getSession(session.id)!.active).toBe(true);
    });
  });

  describe("getSession", () => {
    test("returns session by ID", () => {
      const session = manager.createSession("alice", "bob", "/project");
      const found = manager.getSession(session.id);
      expect(found).toBeTruthy();
      expect(found!.id).toBe(session.id);
    });

    test("returns null for nonexistent session", () => {
      expect(manager.getSession("nonexistent")).toBeNull();
    });
  });

  describe("getActiveSessionsForAccount", () => {
    test("finds active session for initiator", () => {
      const session = manager.createSession("alice", "bob", "/project");
      const found = manager.getActiveSessionsForAccount("alice");
      expect(found).toHaveLength(1);
      expect(found[0].id).toBe(session.id);
    });

    test("finds active session for participant", () => {
      const session = manager.createSession("alice", "bob", "/project");
      const found = manager.getActiveSessionsForAccount("bob");
      expect(found).toHaveLength(1);
      expect(found[0].id).toBe(session.id);
    });

    test("returns empty array when no active session", () => {
      const found = manager.getActiveSessionsForAccount("alice");
      expect(found).toHaveLength(0);
    });

    test("does not find inactive sessions", () => {
      const session = manager.createSession("alice", "bob", "/project");
      manager.endSession(session.id, "alice");
      const found = manager.getActiveSessionsForAccount("alice");
      expect(found).toHaveLength(0);
    });

    // Test 19: getActiveSessionsForAccount returns all active sessions
    test("returns all active sessions for account", () => {
      const s1 = manager.createSession("alice", "bob", "/proj1");
      const s2 = manager.createSession("alice", "charlie", "/proj2");
      const found = manager.getActiveSessionsForAccount("alice");
      expect(found).toHaveLength(2);
      const ids = found.map((s) => s.id);
      expect(ids).toContain(s1.id);
      expect(ids).toContain(s2.id);
    });

    // Test 20: Account with multiple active sessions
    test("account with multiple active sessions as both initiator and participant", () => {
      const s1 = manager.createSession("alice", "bob", "/proj1");
      const s2 = manager.createSession("charlie", "alice", "/proj2");
      const found = manager.getActiveSessionsForAccount("alice");
      expect(found).toHaveLength(2);
      const ids = found.map((s) => s.id);
      expect(ids).toContain(s1.id);
      expect(ids).toContain(s2.id);
    });
  });

  describe("cleanupStale", () => {
    test("marks sessions with all stale pings as inactive", () => {
      const session = manager.createSession("alice", "bob", "/project");
      // Artificially age the pings beyond the 90s threshold
      session.lastPing["alice"] = Date.now() - 100_000;
      manager.cleanupStale();
      expect(manager.getSession(session.id)!.active).toBe(false);
    });

    test("keeps sessions with recent pings active", () => {
      const session = manager.createSession("alice", "bob", "/project");
      manager.joinSession(session.id, "bob");
      // Alice's ping is old, but Bob's is fresh
      session.lastPing["alice"] = Date.now() - 100_000;
      session.lastPing["bob"] = Date.now();
      manager.cleanupStale();
      expect(manager.getSession(session.id)!.active).toBe(true);
    });

    test("does not affect already inactive sessions", () => {
      const session = manager.createSession("alice", "bob", "/project");
      manager.endSession(session.id, "alice");
      manager.cleanupStale();
      expect(manager.getSession(session.id)!.active).toBe(false);
    });

    test("handles sessions with no pings", () => {
      const session = manager.createSession("alice", "bob", "/project");
      session.lastPing = {};
      manager.cleanupStale();
      expect(manager.getSession(session.id)!.active).toBe(false);
    });
  });

  describe("purgeInactive", () => {
    // Test 10: purgeInactive removes old inactive sessions from all Maps
    test("removes old inactive sessions from all Maps", () => {
      const session = manager.createSession("alice", "bob", "/project");
      const sessionId = session.id;

      // Add an update and read it to create a cursor
      manager.addUpdate(sessionId, "alice", "data");
      manager.getUpdates(sessionId, "bob");

      // End the session
      manager.endSession(sessionId, "alice");

      // Make the session appear old by backdating startedAt
      session.startedAt = new Date(Date.now() - 2 * 60 * 60_000).toISOString(); // 2 hours ago

      const purged = manager.purgeInactive(60 * 60_000); // 1 hour threshold
      expect(purged).toBe(1);

      // Session should be completely removed
      expect(manager.getSession(sessionId)).toBeNull();

      // Updates and cursors should also be cleaned up
      // We verify by checking getUpdates returns empty for the session
      const updates = manager.getUpdates(sessionId, "bob");
      expect(updates).toHaveLength(0);
    });

    // Test 11: purgeInactive preserves active sessions
    test("preserves active sessions", () => {
      const session = manager.createSession("alice", "bob", "/project");
      // Backdate to make it old
      session.startedAt = new Date(Date.now() - 2 * 60 * 60_000).toISOString();

      const purged = manager.purgeInactive(60 * 60_000);
      expect(purged).toBe(0);
      expect(manager.getSession(session.id)).not.toBeNull();
    });

    // Test 12: purgeInactive preserves recently-ended sessions
    test("preserves recently-ended sessions within threshold", () => {
      const session = manager.createSession("alice", "bob", "/project");
      manager.endSession(session.id, "alice");
      // startedAt is recent (just created), threshold is 1 hour
      const purged = manager.purgeInactive(60 * 60_000);
      expect(purged).toBe(0);
      expect(manager.getSession(session.id)).not.toBeNull();
    });

    test("purges multiple old inactive sessions", () => {
      const s1 = manager.createSession("alice", "bob", "/proj1");
      const s2 = manager.createSession("alice", "charlie", "/proj2");
      const s3 = manager.createSession("bob", "charlie", "/proj3");

      manager.endSession(s1.id, "alice");
      manager.endSession(s2.id, "alice");
      // s3 stays active

      // Backdate s1 and s2
      s1.startedAt = new Date(Date.now() - 2 * 60 * 60_000).toISOString();
      s2.startedAt = new Date(Date.now() - 2 * 60 * 60_000).toISOString();

      const purged = manager.purgeInactive(60 * 60_000);
      expect(purged).toBe(2);
      expect(manager.getSession(s1.id)).toBeNull();
      expect(manager.getSession(s2.id)).toBeNull();
      expect(manager.getSession(s3.id)).not.toBeNull();
    });
  });
});
