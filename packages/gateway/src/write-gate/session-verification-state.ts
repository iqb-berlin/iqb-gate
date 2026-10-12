/** What is known about one session: whether it solved a challenge, and when it last saved. */
interface SessionEntry {
  verified: boolean;
  verifiedAt: number;
  saves: number[];
  lastSeen: number;
}

/**
 * Which sessions have shown that a person is at work, and how fast they have been saving since.
 *
 * A session counts as verified once it has solved a challenge. Every save it makes afterwards is
 * counted in a sliding window; a session that saves more often than a person can loses its
 * verification and has to solve a new challenge. Kept in memory: there is one gateway instance, and a
 * restart only costs every session one more challenge.
 *
 * Sessions are keyed by the id in the gateway's session cookie.
 */
export class SessionVerificationState {
  private readonly sessions = new Map<string, SessionEntry>();

  constructor(
    private readonly burstLimit: number,
    private readonly burstWindowMs: number
  ) {}

  isVerified(sessionId: string): boolean {
    return this.sessions.get(sessionId)?.verified ?? false;
  }

  /** Whether the session solved its challenge at `since` or later, and still counts as verified. */
  isVerifiedSince(sessionId: string, since: number): boolean {
    const entry = this.sessions.get(sessionId);
    return !!entry?.verified && entry.verifiedAt >= since;
  }

  /** The session solved a challenge: it starts over with an empty window. */
  markVerified(sessionId: string, now: number): void {
    this.sessions.set(sessionId, {
      verified: true, verifiedAt: now, saves: [], lastSeen: now
    });
  }

  /** The session has to solve a challenge again before its next save. */
  revoke(sessionId: string): void {
    const entry = this.sessions.get(sessionId);
    if (!entry) return;
    entry.verified = false;
    entry.saves = [];
  }

  /**
   * Counts a save of a verified session. Returns `false`, and takes the verification back, when the
   * save is one more than {@link burstLimit} within {@link burstWindowMs}.
   */
  recordSave(sessionId: string, now: number): boolean {
    const entry = this.sessions.get(sessionId);
    if (!entry?.verified) return false;
    entry.lastSeen = now;
    entry.saves = entry.saves.filter(time => now - time < this.burstWindowMs);
    if (entry.saves.length >= this.burstLimit) {
      entry.verified = false;
      entry.saves = [];
      return false;
    }
    entry.saves.push(now);
    return true;
  }

  /** Forgets sessions not seen for longer than `maxAgeMs` -- they are expired anyway. */
  prune(now: number, maxAgeMs: number): void {
    this.sessions.forEach((entry, sessionId) => {
      if (now - entry.lastSeen > maxAgeMs) this.sessions.delete(sessionId);
    });
  }

  get size(): number {
    return this.sessions.size;
  }
}
