import { randomUUID } from "crypto";

export interface SharedSession {
  id: string;
  initiator: string;
  participant: string;
  workspace: string;
  startedAt: string;
  active: boolean;
  joined: boolean;
  lastPing: Record<string, number>;
}

export interface SessionUpdate {
  from: string;
  data: unknown;
  timestamp: string;
}

const STALE_THRESHOLD_MS = 90_000;

export class SharedSessionManager {
  private sessions = new Map<string, SharedSession>();
  private updates = new Map<string, SessionUpdate[]>();
  private readCursors = new Map<string, number>(); // key: `${sessionId}:${account}`

  /** C1: Check if an account is a member (initiator or participant) of a session */
  isMember(sessionId: string, account: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    return session.initiator === account || session.participant === account;
  }

  createSession(initiator: string, participant: string, workspace: string): SharedSession {
    // M4: Prevent creating a session with yourself
    if (initiator === participant) {
      throw new Error("Cannot create session with yourself");
    }
    const session: SharedSession = {
      id: randomUUID(),
      initiator,
      participant,
      workspace,
      startedAt: new Date().toISOString(),
      active: true,
      joined: false,
      lastPing: { [initiator]: Date.now() },
    };
    this.sessions.set(session.id, session);
    this.updates.set(session.id, []);
    return session;
  }

  joinSession(sessionId: string, account: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || !session.active) return false;
    if (account !== session.participant) return false;
    session.joined = true;
    session.lastPing[account] = Date.now();
    return true;
  }

  /** M2: addUpdate now verifies sender membership. Returns boolean indicating success. */
  addUpdate(sessionId: string, from: string, data: unknown): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || !session.active) return false;
    // M2: Verify sender is a member
    if (session.initiator !== from && session.participant !== from) return false;
    const updates = this.updates.get(sessionId);
    if (!updates) return false;
    updates.push({
      from,
      data,
      timestamp: new Date().toISOString(),
    });
    return true;
  }

  /** M3: getUpdates now verifies reader membership. Returns empty array for non-members. */
  getUpdates(sessionId: string, forAccount: string): SessionUpdate[] {
    const session = this.sessions.get(sessionId);
    // M3: Verify reader is a member
    if (!session || (session.initiator !== forAccount && session.participant !== forAccount)) return [];
    const updates = this.updates.get(sessionId);
    if (!updates) return [];
    const cursorKey = `${sessionId}:${forAccount}`;
    const cursor = this.readCursors.get(cursorKey) ?? 0;
    const unread = updates.slice(cursor);
    this.readCursors.set(cursorKey, updates.length);
    return unread;
  }

  /** C3: recordPing now verifies account is a member before recording */
  recordPing(sessionId: string, account: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || !session.active) return false;
    // C3: Verify account is initiator or participant
    if (session.initiator !== account && session.participant !== account) return false;
    session.lastPing[account] = Date.now();
    return true;
  }

  /** C2: endSession now verifies the requesting account is a member. Returns boolean. */
  endSession(sessionId: string, account: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    // C2: Verify account is initiator or participant
    if (session.initiator !== account && session.participant !== account) return false;
    session.active = false;
    return true;
  }

  getSession(sessionId: string): SharedSession | null {
    return this.sessions.get(sessionId) ?? null;
  }

  /** M5: Returns ALL active sessions for an account (not just the first). */
  getActiveSessionsForAccount(account: string): SharedSession[] {
    const results: SharedSession[] = [];
    for (const session of this.sessions.values()) {
      if (!session.active) continue;
      if (session.initiator === account || session.participant === account) {
        results.push(session);
      }
    }
    return results;
  }

  cleanupStale(): void {
    const now = Date.now();
    for (const session of this.sessions.values()) {
      if (!session.active) continue;
      const pings = Object.values(session.lastPing);
      if (pings.length === 0) {
        session.active = false;
        continue;
      }
      const allStale = pings.every((t) => now - t > STALE_THRESHOLD_MS);
      if (allStale) {
        session.active = false;
      }
    }
  }

  /** M1: Purge inactive sessions older than the specified threshold from all Maps */
  purgeInactive(olderThanMs: number): number {
    const now = Date.now();
    let purged = 0;
    for (const [id, session] of this.sessions) {
      if (session.active) continue;
      const startedAtMs = new Date(session.startedAt).getTime();
      if (now - startedAtMs > olderThanMs) {
        this.sessions.delete(id);
        this.updates.delete(id);
        // Clean up read cursors for this session
        for (const key of this.readCursors.keys()) {
          if (key.startsWith(`${id}:`)) {
            this.readCursors.delete(key);
          }
        }
        purged++;
      }
    }
    return purged;
  }
}
