import type { DatabaseSync } from 'node:sqlite';

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

function columnsOf(db: DatabaseSync, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(column => column.name);
}

/** Runs the statements all or none: a step that fails leaves the file as it was. */
function inTransaction(db: DatabaseSync, statements: string): void {
  db.exec('BEGIN');
  try {
    db.exec(statements);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/**
 * A log file from before reads were checked keeps its entries in a table named for writes: it is
 * renamed once, with its index, and keeps every entry. Where both tables exist -- an older
 * gateway ran again after a newer one had started -- what the older one wrote joins the log.
 */
function adoptWriteAudit(db: DatabaseSync): void {
  const tables = (db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('write_audit', 'audit')")
    .all() as Array<{ name: string }>).map(({ name }) => name);
  if (!tables.includes('write_audit')) return;
  if (!tables.includes('audit')) {
    inTransaction(db, 'ALTER TABLE write_audit RENAME TO audit; DROP INDEX IF EXISTS write_audit_created_at;');
    return;
  }
  const auditColumns = columnsOf(db, 'audit');
  const columns = columnsOf(db, 'write_audit')
    .filter(column => column !== 'id' && auditColumns.includes(column))
    .join(', ');
  inTransaction(db, `INSERT INTO audit (${columns}) SELECT ${columns} FROM write_audit; DROP TABLE write_audit;`);
}

/**
 * Brings the audit log's file to the schema of this version: creates the table on a new file, and
 * takes an older file over with every entry -- the table of the write-only log, and columns added
 * since, with their defaults for the old entries. Throws when the file cannot be brought there.
 */
export function prepareAuditSchema(db: DatabaseSync): void {
  adoptWriteAudit(db);
  db.exec(SCHEMA);
  if (!columnsOf(db, 'audit').includes('user_verified')) {
    db.exec('ALTER TABLE audit ADD COLUMN user_verified INTEGER NOT NULL DEFAULT 0');
  }
}
