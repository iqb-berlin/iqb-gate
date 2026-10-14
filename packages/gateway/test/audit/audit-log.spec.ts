import {
  afterEach, beforeEach, describe, expect, it, vi
} from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { AuditLog, type AuditRecord } from '../../src/audit/audit-log.js';

const DAY_MS = 24 * 60 * 60 * 1000;

const write = (changes: Partial<AuditRecord> = {}): AuditRecord => ({
  sessionId: 's1',
  user: 'anna',
  userVerified: false,
  method: 'PATCH',
  path: '/api/admin/users/3',
  rule: 'administration',
  statusCode: 200,
  outcome: 'allowed',
  blockingSignals: [],
  loggedSignals: [],
  ...changes
});

const rejected = (changes: Partial<AuditRecord> = {}): AuditRecord => write({
  statusCode: 403, outcome: 'automation-detected', blockingSignals: ['webdriver'], ...changes
});

describe('AuditLog', () => {
  let log: AuditLog;
  let onError: ReturnType<typeof vi.fn<(message: string, error: unknown) => void>>;

  beforeEach(() => {
    onError = vi.fn<(message: string, error: unknown) => void>();
    log = new AuditLog(':memory:', 90 * DAY_MS, onError);
  });

  afterEach(() => log.close());

  describe('record', () => {
    it('writes the entry with the time of now', () => {
      log.record(write(), Date.UTC(2026, 9, 12, 10));
      expect(log.find()).toEqual([{
        id: 1,
        createdAt: '2026-10-12T10:00:00.000Z',
        repeated: 0,
        ...write()
      }]);
    });

    it('writes every allowed write, however often', () => {
      [1, 2, 3].forEach(now => log.record(write(), now));
      expect(log.find()).toHaveLength(3);
    });

    it('only reports a failed write, never throws', () => {
      log.close();
      expect(() => log.record(write())).not.toThrow();
      expect(onError).toHaveBeenCalledWith('Writing an audit entry failed.', expect.any(Error));
      log = new AuditLog(':memory:', 90 * DAY_MS, onError);
    });

    it('keeps whether the writer was verified', () => {
      log.record(write({ userVerified: true }), 1000);
      expect(log.find()[0].userVerified).toBe(true);
    });

    // A log written before the gateway verified tokens has no such column yet
    it('adds what an older log file lacks, keeping its entries', () => {
      const directory = mkdtempSync(join(tmpdir(), 'iqb-gate-audit-'));
      const file = join(directory, 'audit.sqlite');
      const old = new DatabaseSync(file);
      old.exec(`CREATE TABLE write_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT, created_at INTEGER NOT NULL, session_id TEXT, user TEXT,
        method TEXT NOT NULL, path TEXT NOT NULL, rule TEXT NOT NULL, status_code INTEGER NOT NULL,
        outcome TEXT NOT NULL, repeated INTEGER NOT NULL DEFAULT 0, blocking_signals TEXT NOT NULL,
        logged_signals TEXT NOT NULL)`);
      old.exec(`INSERT INTO write_audit (created_at, session_id, user, method, path, rule, status_code, outcome,
        blocking_signals, logged_signals) VALUES (1, 's0', 'old', 'PUT', '/api/admin/x', 'administration', 200,
        'allowed', '[]', '[]')`);
      old.close();

      const migrated = new AuditLog(file, 90 * DAY_MS, onError);
      migrated.record(write({ userVerified: true }), 2000);
      expect(migrated.find().map(entry => [entry.user, entry.userVerified])).toEqual([['anna', true], ['old', false]]);
      migrated.close();
      rmSync(directory, { recursive: true });
    });

    it('leaves the file as it was, and unlocked, when taking over the older table fails', () => {
      const directory = mkdtempSync(join(tmpdir(), 'iqb-gate-audit-'));
      const file = join(directory, 'audit.sqlite');
      const old = new DatabaseSync(file);
      // A view by the new name: the table cannot be renamed to it
      old.exec(`CREATE TABLE write_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at INTEGER NOT NULL);
        INSERT INTO write_audit (created_at) VALUES (1);
        CREATE VIEW audit AS SELECT 1`);
      old.close();

      expect(() => new AuditLog(file, 90 * DAY_MS, onError)).toThrow();

      const check = new DatabaseSync(file);
      check.exec('INSERT INTO write_audit (created_at) VALUES (2)');
      expect(check.prepare('SELECT COUNT(*) AS rows FROM write_audit').get()).toEqual({ rows: 2 });
      check.close();
      rmSync(directory, { recursive: true });
    });

    it('records a refused read like a refused write', () => {
      log.record(write({ method: 'GET', outcome: 'verification-required', statusCode: 428 }), 1000);
      expect(log.find()[0]).toEqual(expect.objectContaining({ method: 'GET', outcome: 'verification-required' }));
    });

    it('keeps its entries in the file across a restart', () => {
      const directory = mkdtempSync(join(tmpdir(), 'iqb-gate-audit-'));
      const file = join(directory, 'audit.sqlite');
      const first = new AuditLog(file, 90 * DAY_MS, onError);
      first.record(write());
      first.close();
      const second = new AuditLog(file, 90 * DAY_MS, onError);
      expect(second.find()).toHaveLength(1);
      second.close();
      rmSync(directory, { recursive: true });
    });
  });

  describe('repeated rejections', () => {
    it('writes the first rejection and counts the identical ones of the minute', () => {
      [1000, 2000, 3000].forEach(now => log.record(rejected(), now));
      const entries = log.find();
      expect(entries).toHaveLength(1);
      expect(entries[0].repeated).toBe(2);
    });

    it('folds the rejections of requests that brought no session', () => {
      [1000, 2000].forEach(now => log.record(rejected({ sessionId: null }), now));
      expect(log.find()).toEqual([expect.objectContaining({ sessionId: null, repeated: 1 })]);
    });

    // A script can fetch a fresh cookie and make up a name for every request
    it('folds what a client chooses freely: a new session or an unverified name each time', () => {
      ['s1', 's2', 's3'].forEach((sessionId, index) => log.record(
        rejected({ sessionId, user: `made-up-${index}` }),
        1000 + index,
        '10.0.0.1'
      ));
      expect(log.find()).toEqual([expect.objectContaining({ sessionId: 's1', user: 'made-up-0', repeated: 2 })]);
    });

    it('writes rejections of another kind on their own', () => {
      log.record(rejected(), 1000, '10.0.0.1');
      log.record(rejected(), 1000, '10.0.0.2');
      log.record(rejected({ user: 'bert', userVerified: true }), 1000, '10.0.0.1');
      log.record(rejected({ rule: 'workspace' }), 1000, '10.0.0.1');
      log.record(
        rejected({ outcome: 'verification-required', statusCode: 428, blockingSignals: [] }),
        1000,
        '10.0.0.1'
      );
      expect(log.find()).toHaveLength(5);
    });

    // A script that varies the path would otherwise write a row per request
    it('folds rejections under the same rule whatever their path', () => {
      log.record(rejected({ path: '/api/admin/x1' }), 1000);
      log.record(rejected({ path: '/api/admin/x2' }), 2000);
      expect(log.find()).toEqual([expect.objectContaining({ path: '/api/admin/x1', repeated: 1 })]);
    });

    it('writes the rejection again once the minute is over', () => {
      log.record(rejected(), 1000);
      log.record(rejected(), 1000 + 60 * 1000);
      expect(log.find()).toHaveLength(2);
    });

    it('adds the repeats to their entry when asked to', () => {
      log.record(rejected(), 1000);
      log.record(rejected(), 2000);
      log.addRepeats(70_000);
      log.record(rejected(), 71_000);
      expect(log.find().map(entry => entry.repeated)).toEqual([0, 1]);
    });
  });

  describe('find', () => {
    beforeEach(() => {
      log.record(write({ sessionId: 'a' }), Date.UTC(2026, 9, 1));
      log.record(write({ sessionId: 'b' }), Date.UTC(2026, 9, 5));
      log.record(write({ sessionId: 'a' }), Date.UTC(2026, 9, 9));
    });

    it('returns the newest entries first', () => {
      expect(log.find().map(entry => entry.createdAt.slice(0, 10))).toEqual(['2026-10-09', '2026-10-05', '2026-10-01']);
    });

    it('filters by session and period', () => {
      expect(log.find({ sessionId: 'a' })).toHaveLength(2);
      expect(log.find({ from: new Date(Date.UTC(2026, 9, 2)), to: new Date(Date.UTC(2026, 9, 6)) })
        .map(entry => entry.sessionId)).toEqual(['b']);
      expect(log.find({ from: new Date(Date.UTC(2026, 9, 5)) })).toHaveLength(2);
      expect(log.find({ to: new Date(Date.UTC(2026, 9, 5)) })).toHaveLength(2);
    });

    it('caps the number of entries between 1 and 1000', () => {
      expect(log.find({ limit: 2 })).toHaveLength(2);
      expect(log.find({ limit: 0 })).toHaveLength(3);
      expect(log.find({ limit: -5 })).toHaveLength(1);
    });

    it('defaults to 200 entries', () => {
      Array.from({ length: 210 }, (_, index) => index).forEach(index => log.record(write(), index + 10));
      expect(log.find()).toHaveLength(200);
      expect(log.find({ limit: 5000 })).toHaveLength(213);
    });
  });

  describe('deleteExpired', () => {
    it('deletes the entries older than the retention', () => {
      log.record(write(), 0);
      log.record(write(), 50 * DAY_MS);
      expect(log.deleteExpired(100 * DAY_MS)).toBe(1);
      expect(log.find()).toHaveLength(1);
    });

    it('only reports a failed cleanup', () => {
      log.close();
      expect(log.deleteExpired()).toBe(0);
      expect(onError).toHaveBeenCalledWith('Removing expired audit entries failed.', expect.any(Error));
      log = new AuditLog(':memory:', 90 * DAY_MS, onError);
    });
  });
});
