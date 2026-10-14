import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { prepareAuditSchema } from '../../src/audit/audit-schema.js';

/** The table of the write-only log, as an older gateway created it -- with or without user_verified. */
const writeAuditTable = (withUserVerified: boolean) => `CREATE TABLE write_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT, created_at INTEGER NOT NULL, session_id TEXT, user TEXT,
  ${withUserVerified ? 'user_verified INTEGER NOT NULL DEFAULT 0,' : ''}
  method TEXT NOT NULL, path TEXT NOT NULL, rule TEXT NOT NULL, status_code INTEGER NOT NULL,
  outcome TEXT NOT NULL, repeated INTEGER NOT NULL DEFAULT 0, blocking_signals TEXT NOT NULL,
  logged_signals TEXT NOT NULL);
  CREATE INDEX write_audit_created_at ON write_audit (created_at)`;

const insertOld = (db: DatabaseSync, table: string, user: string) => db.exec(`INSERT INTO ${table} (created_at,
  session_id, user, method, path, rule, status_code, outcome, blocking_signals, logged_signals) VALUES (1, 's0',
  '${user}', 'PUT', '/api/admin/x', 'administration', 200, 'allowed', '[]', '[]')`);

const namesIn = (db: DatabaseSync): string[] => (db
  .prepare("SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name")
  .all() as Array<{ name: string }>).map(({ name }) => name);

const usersIn = (db: DatabaseSync): Array<{ user: string; user_verified: number }> => db
  .prepare('SELECT user, user_verified FROM audit ORDER BY id')
  .all() as Array<{ user: string; user_verified: number }>;

describe('prepareAuditSchema', () => {
  it('creates the table and its index on a new file, and leaves them be the next time', () => {
    const db = new DatabaseSync(':memory:');
    prepareAuditSchema(db);
    prepareAuditSchema(db);
    expect(namesIn(db)).toEqual(['audit', 'audit_created_at']);
  });

  // A log written before reads were checked keeps its entries in a table named for writes
  it('renames the table of an older file to audit, with its index, keeping its entries', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(writeAuditTable(true));
    insertOld(db, 'write_audit', 'old');

    prepareAuditSchema(db);

    expect(namesIn(db)).toEqual(['audit', 'audit_created_at']);
    expect(usersIn(db)).toEqual([{ user: 'old', user_verified: 0 }]);
  });

  // A log written before the gateway verified tokens has no such column yet
  it('adds what an older file lacks, with its default for the old entries', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(writeAuditTable(false));
    insertOld(db, 'write_audit', 'old');

    prepareAuditSchema(db);

    expect(usersIn(db)).toEqual([{ user: 'old', user_verified: 0 }]);
  });

  // Back on an older gateway after a newer one had started, and then on the newer one again
  it('takes over what an older gateway wrote beside the log, and keeps the log\'s own entries', () => {
    const db = new DatabaseSync(':memory:');
    prepareAuditSchema(db);
    insertOld(db, 'audit', 'new');
    db.exec(writeAuditTable(false));
    insertOld(db, 'write_audit', 'old');

    prepareAuditSchema(db);

    expect(namesIn(db)).toEqual(['audit', 'audit_created_at']);
    expect(usersIn(db).map(({ user }) => user)).toEqual(['new', 'old']);
  });

  it('leaves the file as it was, without a transaction left open, when taking over fails', () => {
    const db = new DatabaseSync(':memory:');
    // A view by the new name: the table cannot be renamed to it
    db.exec(`CREATE TABLE write_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at INTEGER NOT NULL);
      INSERT INTO write_audit (created_at) VALUES (1);
      CREATE VIEW audit AS SELECT 1`);

    expect(() => prepareAuditSchema(db)).toThrow();

    expect(() => db.exec('BEGIN; COMMIT;')).not.toThrow();
    expect(db.prepare('SELECT COUNT(*) AS rows FROM write_audit').get()).toEqual({ rows: 1 });
  });
});
