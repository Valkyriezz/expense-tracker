import { DatabaseSync, type StatementSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const dbPath = process.env.DB_PATH ?? "./data/expenses.db";
mkdirSync(dirname(dbPath), { recursive: true });

export const db = new DatabaseSync(dbPath);
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");
db.exec("PRAGMA busy_timeout = 5000");

db.exec(`
  CREATE TABLE IF NOT EXISTS expenses (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    amount_paise INTEGER NOT NULL CHECK(amount_paise > 0),
    category     TEXT    NOT NULL,
    description  TEXT    NOT NULL DEFAULT '',
    date         TEXT    NOT NULL,
    created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(category);
  CREATE INDEX IF NOT EXISTS idx_expenses_date     ON expenses(date);

  CREATE TABLE IF NOT EXISTS idempotency_keys (
    key           TEXT    PRIMARY KEY,
    request_hash  TEXT    NOT NULL,
    expense_id    INTEGER NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
    created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
`);

export function prepareNamed(sql: string): StatementSync {
  const stmt = db.prepare(sql);
  stmt.setAllowBareNamedParameters(true);
  return stmt;
}

export function transaction<T>(fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // best-effort rollback; original error wins.
    }
    throw err;
  }
}

// SQLite extended error code for PRIMARY KEY constraint violation.
export const SQLITE_CONSTRAINT_PRIMARYKEY = 1555;
