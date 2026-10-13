/** How long a session that has not been seen is remembered: it would have to verify again anyway. */
export const SESSION_IDLE_MS = 7 * 24 * 60 * 60 * 1000;

/** How many requests of one kind a session may make within a sliding window. */
export interface RequestWindow {
  limit: number;
  windowMs: number;
}

/** What is known about one session: whether it solved a challenge, and when it last saved and read. */
interface SessionEntry {
  verified: boolean;
  verifiedAt: number;
  saves: number[];
  reads: number[];
  lastSeen: number;
}

/**
 * Which sessions have shown that a person is at work, and how fast they have been saving and
 * reading since.
 *
 * A session counts as verified once it has solved a challenge -- one solution counts for writes and
 * reads alike. Every save and every read it makes afterwards is counted in a sliding window of its
 * own; a session that saves or reads more often than a person can loses its verification and has
 * to solve a new challenge, for both. Kept in memory: there is one gateway instance, and a restart
 * only costs every session one more challenge.
 *
 * Sessions are keyed by the id in the gateway's session cookie.
 */
export class SessionVerificationState {
  private readonly sessions = new Map<string, SessionEntry>();

  constructor(
    private readonly saves: RequestWindow,
    private readonly reads: RequestWindow
  ) {}

  isVerified(sessionId: string): boolean {
    return this.sessions.get(sessionId)?.verified ?? false;
  }

  /** Whether the session solved its challenge at `since` or later, and still counts as verified. */
  isVerifiedSince(sessionId: string, since: number): boolean {
    const entry = this.sessions.get(sessionId);
    return !!entry?.verified && entry.verifiedAt >= since;
  }

  /** The session solved a challenge: it starts over with empty windows. */
  markVerified(sessionId: string, now: number): void {
    this.sessions.set(sessionId, {
      verified: true, verifiedAt: now, saves: [], reads: [], lastSeen: now
    });
  }

  /** The session has to solve a challenge again before its next save or read. */
  revoke(sessionId: string): void {
    const entry = this.sessions.get(sessionId);
    if (!entry) return;
    entry.verified = false;
    entry.saves = [];
    entry.reads = [];
  }

  /**
   * Counts a save of a verified session. Returns `false`, and takes the verification back, when the
   * save is one more than the save window allows.
   */
  recordSave(sessionId: string, now: number): boolean {
    return this.record(sessionId, now, 'saves', this.saves);
  }

  /**
   * Counts a read of a verified session. Returns `false`, and takes the verification back, when the
   * read is one more than the read window allows.
   */
  recordRead(sessionId: string, now: number): boolean {
    return this.record(sessionId, now, 'reads', this.reads);
  }

  private record(sessionId: string, now: number, kind: 'saves' | 'reads', window: RequestWindow): boolean {
    const entry = this.sessions.get(sessionId);
    if (!entry?.verified) return false;
    entry.lastSeen = now;
    entry[kind] = entry[kind].filter(time => now - time < window.windowMs);
    if (entry[kind].length >= window.limit) {
      this.revoke(sessionId);
      return false;
    }
    entry[kind].push(now);
    return true;
  }

  /** Forgets sessions not seen for longer than `maxAgeMs` -- they are expired anyway. */
  prune(now: number, maxAgeMs = SESSION_IDLE_MS): void {
    this.sessions.forEach((entry, sessionId) => {
      if (now - entry.lastSeen > maxAgeMs) this.sessions.delete(sessionId);
    });
  }

  get size(): number {
    return this.sessions.size;
  }
}
