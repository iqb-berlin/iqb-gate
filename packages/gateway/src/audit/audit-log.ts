import { DatabaseSync, type StatementSync } from 'node:sqlite';
import type { GateOutcome } from '../session/gate-assessment.js';
import { RepeatedRejections } from './repeated-rejections.js';

/** One checked write or refused read as the gateway hands it over; the time and the repeats are set here. */
export interface AuditRecord {
  /**
   * The session the request came with; `null` when it brought none (or one the gateway did not
   * sign) -- a script without cookies, or a person's very first request. Such rejections fold
   * together, so a script in a loop cannot flood the log by never keeping its cookie.
   */
  sessionId: string | null;
  /**
   * Who sent it: the name in an OpenID Connect token the gateway verified, or else a claim of the
   * Bearer JWT that nobody checked (see `unverifiedBearerClaim`) -- which {@link userVerified} tells.
   */
  user: string | null;
  userVerified: boolean;
  method: string;
  /** The path without the query. */
  path: string;
  /** The name of the rule the request was checked under. */
  rule: string;
  statusCode: number;
  outcome: GateOutcome;
  blockingSignals: string[];
  loggedSignals: string[];
}

/** One entry of the audit log, as it is read. */
export interface AuditEntry extends AuditRecord {
  id: number;
  createdAt: string;
  /** Identical rejections from the same client address within a minute, folded into this entry. */
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
  user_verified: number;
  method: string;
  path: string;
  rule: string;
  status_code: number;
  outcome: GateOutcome;
  repeated: number;
  blocking_signals: string;
  logged_signals: string;
}

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;
/** How long identical rejections of a session are folded into one entry. */
const REPEAT_WINDOW_MS = 60 * 1000;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at INTEGER NOT NULL,
    session_id TEXT,
    user TEXT,
    user_verified INTEGER NOT NULL DEFAULT 0,
    method TEXT NOT NULL,
    path TEXT NOT NULL,
    rule TEXT NOT NULL,
    status_code INTEGER NOT NULL,
    outcome TEXT NOT NULL,
    repeated INTEGER NOT NULL DEFAULT 0,
    blocking_signals TEXT NOT NULL,
    logged_signals TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS audit_created_at ON audit (created_at);
`;

function toEntry(row: AuditRow): AuditEntry {
  return {
    id: row.id,
    createdAt: new Date(row.created_at).toISOString(),
    sessionId: row.session_id,
    user: row.user,
    userVerified: row.user_verified === 1,
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
 * The audit log of checked writes and refused reads, in SQLite: who, when, which path under which
 * rule, how it was decided and answered. Neither the body nor the query is kept. Entries older than the retention
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
    try {
      // With WAL, NORMAL loses at most the last entries on a power failure, never the file, and does
      // not wait for the disk on every entry -- the event loop that serves all traffic would wait too
      this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
      this.adoptWriteAudit();
      this.db.exec(SCHEMA);
      this.addMissingColumns();
      this.insert = this.db.prepare(`
        INSERT INTO audit (
          created_at, session_id, user, user_verified, method, path, rule, status_code, outcome,
          blocking_signals, logged_signals
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      this.increment = this.db.prepare('UPDATE audit SET repeated = repeated + ? WHERE id = ?');
    } catch (error) {
      // The gateway does not start without its log; the file is left as it was, and unlocked
      this.db.close();
      throw error;
    }
  }

  /**
   * A log file from before reads were checked keeps its entries in a table named for writes: it is
   * renamed once, with its index, and keeps every entry. Where both tables exist -- an older
   * gateway ran again after this one had started -- what the older one wrote joins the log.
   */
  private adoptWriteAudit(): void {
    const tables = (this.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('write_audit', 'audit')")
      .all() as Array<{ name: string }>).map(({ name }) => name);
    if (!tables.includes('write_audit')) return;
    if (!tables.includes('audit')) {
      this.inTransaction('ALTER TABLE write_audit RENAME TO audit; DROP INDEX IF EXISTS write_audit_created_at;');
      return;
    }
    const auditColumns = this.columnsOf('audit');
    const columns = this.columnsOf('write_audit')
      .filter(column => column !== 'id' && auditColumns.includes(column))
      .join(', ');
    this.inTransaction(`INSERT INTO audit (${columns}) SELECT ${columns} FROM write_audit; DROP TABLE write_audit;`);
  }

  /** Runs the statements all or none: a step that fails leaves the file as it was. */
  private inTransaction(statements: string): void {
    this.db.exec('BEGIN');
    try {
      this.db.exec(statements);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  private columnsOf(table: string): string[] {
    return (this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>)
      .map(column => column.name);
  }

  /** A log file from before a column existed gets it, with its default for the old entries. */
  private addMissingColumns(): void {
    if (!this.columnsOf('audit').includes('user_verified')) {
      this.db.exec('ALTER TABLE audit ADD COLUMN user_verified INTEGER NOT NULL DEFAULT 0');
    }
  }

  /**
   * Writes one checked request. `clientAddress` -- where it came from, as the gateway sees it --
   * only decides which rejections fold together; it is not stored.
   */
  record(entry: AuditRecord, now = Date.now(), clientAddress: string | null = null): void {
    const kind = entry.outcome === 'allowed' ? null : AuditLog.kindOf(entry, clientAddress);
    if (kind && this.rejections.isRepeat(kind, now)) return;
    try {
      const result = this.insert.run(
        now, entry.sessionId, entry.user, entry.userVerified ? 1 : 0, entry.method, entry.path, entry.rule,
        entry.statusCode, entry.outcome, JSON.stringify(entry.blockingSignals), JSON.stringify(entry.loggedSignals)
      );
      if (kind) this.rejections.opened(kind, Number(result.lastInsertRowid), now);
    } catch (error) {
      this.onError('Writing an audit entry failed.', error);
    }
  }

  /**
   * What makes two rejections the same: where they came from (the client address) and a person
   * the gateway verified, under which rule, how decided and answered, and what was observed. Nothing
   * the client chooses freely: not the session -- a script can fetch a fresh cookie for every
   * request -- nor an unverified name, nor the path. Either would let a script in a loop write a
   * row per request. The entry keeps the session, name and path of the first rejection.
   */
  private static kindOf(entry: AuditRecord, clientAddress: string | null): string {
    return JSON.stringify([
      clientAddress, entry.userVerified ? entry.user : null, entry.method, entry.rule, entry.outcome,
      entry.statusCode, entry.blockingSignals, entry.loggedSignals
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
      .prepare(`SELECT * FROM audit ${where} ORDER BY created_at DESC, id DESC LIMIT ?`)
      .all(...values, limit) as unknown as AuditRow[];
    return rows.map(toEntry);
  }

  /** Deletes the entries past their retention; returns how many. */
  deleteExpired(now = Date.now()): number {
    try {
      const result = this.db.prepare('DELETE FROM audit WHERE created_at < ?').run(now - this.retentionMs);
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
