import { DatabaseSync, type StatementSync } from 'node:sqlite';
import type { WriteOutcome } from '../write-gate/write-gate.js';
import { RepeatedRejections } from './repeated-rejections.js';

/** One checked write as the gateway hands it over; the time and the repeats are set here. */
export interface AuditRecord {
  /**
   * The session the request came with; `null` when it brought none (or one the gateway did not
   * sign) -- a script without cookies, or a person's very first write. Such rejections fold
   * together, so a script in a loop cannot flood the log by never keeping its cookie.
   */
  sessionId: string | null;
  /** Who the application was told writes -- an unverified claim, see `unverifiedBearerClaim`. */
  user: string | null;
  method: string;
  /** The path without the query. */
  path: string;
  /** The name of the rule the write was checked under. */
  rule: string;
  statusCode: number;
  outcome: WriteOutcome;
  blockingSignals: string[];
  loggedSignals: string[];
}

/** One entry of the audit log, as it is read. */
export interface AuditEntry extends AuditRecord {
  id: number;
  createdAt: string;
  /** Identical rejections of the same session within a minute, folded into this entry. */
  repeated: number;
}

/** What the audit log can be narrowed down to. */
export interface AuditFilter {
  from?: Date;
  to?: Date;
  sessionId?: string;
  limit?: number;
}

interface AuditRow {
  id: number;
  created_at: number;
  session_id: string | null;
  user: string | null;
  method: string;
  path: string;
  rule: string;
  status_code: number;
  outcome: WriteOutcome;
  repeated: number;
  blocking_signals: string;
  logged_signals: string;
}

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;
/** How long identical rejections of a session are folded into one entry. */
const REPEAT_WINDOW_MS = 60 * 1000;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS write_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at INTEGER NOT NULL,
    session_id TEXT,
    user TEXT,
    method TEXT NOT NULL,
    path TEXT NOT NULL,
    rule TEXT NOT NULL,
    status_code INTEGER NOT NULL,
    outcome TEXT NOT NULL,
    repeated INTEGER NOT NULL DEFAULT 0,
    blocking_signals TEXT NOT NULL,
    logged_signals TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS write_audit_created_at ON write_audit (created_at);
`;

function toEntry(row: AuditRow): AuditEntry {
  return {
    id: row.id,
    createdAt: new Date(row.created_at).toISOString(),
    sessionId: row.session_id,
    user: row.user,
    method: row.method,
    path: row.path,
    rule: row.rule,
    statusCode: row.status_code,
    outcome: row.outcome,
    repeated: row.repeated,
    blockingSignals: JSON.parse(row.blocking_signals) as string[],
    loggedSignals: JSON.parse(row.logged_signals) as string[]
  };
}

/**
 * The audit log of checked writes, in SQLite: who, when, which path under which rule, how it was
 * decided and answered. Neither the body nor the query is kept. Entries older than the retention
 * are deleted ({@link deleteExpired}).
 *
 * Writing an entry never fails a request: a failure is reported to `onError` and the request goes
 * on. Identical rejections -- same session, user, method, rule, outcome, status and observations --
 * within a minute are written once and counted (`RepeatedRejections`): a script in a loop is
 * answered at once and would otherwise write one row per request. The counts are added to their entries by
 * {@link addRepeats}, and before the log is read.
 */
export class AuditLog {
  private readonly db: DatabaseSync;
  private readonly insert: StatementSync;
  private readonly increment: StatementSync;
  private readonly rejections = new RepeatedRejections(REPEAT_WINDOW_MS);

  constructor(
    file: string,
    private readonly retentionMs: number,
    private readonly onError: (message: string, error: unknown) => void
  ) {
    this.db = new DatabaseSync(file);
    // With WAL, NORMAL loses at most the last entries on a power failure, never the file, and does
    // not wait for the disk on every entry -- the event loop that serves all traffic would wait too
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
    this.db.exec(SCHEMA);
    this.insert = this.db.prepare(`
      INSERT INTO write_audit (
        created_at, session_id, user, method, path, rule, status_code, outcome, blocking_signals, logged_signals
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.increment = this.db.prepare('UPDATE write_audit SET repeated = repeated + ? WHERE id = ?');
  }

  record(entry: AuditRecord, now = Date.now()): void {
    const kind = entry.outcome === 'allowed' ? null : AuditLog.kindOf(entry);
    if (kind && this.rejections.isRepeat(kind, now)) return;
    try {
      const result = this.insert.run(
        now, entry.sessionId, entry.user, entry.method, entry.path, entry.rule, entry.statusCode, entry.outcome,
        JSON.stringify(entry.blockingSignals), JSON.stringify(entry.loggedSignals)
      );
      if (kind) this.rejections.opened(kind, Number(result.lastInsertRowid), now);
    } catch (error) {
      this.onError('Writing the audit entry of a write failed.', error);
    }
  }

  /**
   * What makes two rejections the same: who (session and user), under which rule, how decided and
   * answered, and what was observed. Not the path: a script that varies it would otherwise write a
   * row per request. The entry keeps the path of the first rejection.
   */
  private static kindOf(entry: AuditRecord): string {
    return JSON.stringify([
      entry.sessionId, entry.user, entry.method, entry.rule, entry.outcome, entry.statusCode,
      entry.blockingSignals, entry.loggedSignals
    ]);
  }

  /** Adds the counted repeats to their entries. */
  addRepeats(now = Date.now()): void {
    try {
      this.rejections.drain(now).forEach(({ id, count }) => this.increment.run(count, id));
    } catch (error) {
      this.onError('Adding repeated rejections to their audit entries failed.', error);
    }
  }

  /** The newest entries first. */
  find(filter: AuditFilter = {}): AuditEntry[] {
    this.addRepeats();
    const conditions: string[] = [];
    const values: (string | number)[] = [];
    if (filter.from) {
      conditions.push('created_at >= ?');
      values.push(filter.from.getTime());
    }
    if (filter.to) {
      conditions.push('created_at <= ?');
      values.push(filter.to.getTime());
    }
    if (filter.sessionId) {
      conditions.push('session_id = ?');
      values.push(filter.sessionId);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = Math.min(Math.max(filter.limit || DEFAULT_LIMIT, 1), MAX_LIMIT);
    const rows = this.db
      .prepare(`SELECT * FROM write_audit ${where} ORDER BY created_at DESC, id DESC LIMIT ?`)
      .all(...values, limit) as unknown as AuditRow[];
    return rows.map(toEntry);
  }

  /** Deletes the entries past their retention; returns how many. */
  deleteExpired(now = Date.now()): number {
    try {
      const result = this.db.prepare('DELETE FROM write_audit WHERE created_at < ?').run(now - this.retentionMs);
      return Number(result.changes);
    } catch (error) {
      this.onError('Removing expired audit entries failed.', error);
      return 0;
    }
  }

  close(): void {
    this.db.close();
  }
}
