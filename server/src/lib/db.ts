import { createClient, type Client, type Transaction } from "@libsql/client";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

// Local dev / tests: a `file:` URL pointing at a SQLite file on disk.
// Production (Vercel): set TURSO_URL = libsql://… and TURSO_AUTH_TOKEN.
function resolveUrl(): string {
  if (process.env.TURSO_URL) return process.env.TURSO_URL;
  const path = process.env.DB_PATH ?? "./data/expenses.db";
  mkdirSync(dirname(path), { recursive: true });
  return `file:${path}`;
}

export const db: Client = createClient({
  url: resolveUrl(),
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const SCHEMA_SQL = `
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
`;

// Run schema setup once per process. Stored as a module-level promise so
// concurrent callers (Vercel cold-start fan-in) await the same init.
let initPromise: Promise<void> | null = null;
export function ready(): Promise<void> {
  if (!initPromise) {
    initPromise = db.executeMultiple(SCHEMA_SQL);
  }
  return initPromise;
}

export async function withTransaction<T>(
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  const tx = await db.transaction("write");
  try {
    const out = await fn(tx);
    await tx.commit();
    return out;
  } catch (err) {
    try {
      await tx.rollback();
    } catch {
      /* best-effort */
    }
    throw err;
  }
}

// libSQL surfaces SQLite extended error codes as either `code` (string like
// "SQLITE_CONSTRAINT") or in the message. Match conservatively on both.
export function isPrimaryKeyConflict(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  if (e?.code && /CONSTRAINT/i.test(e.code)) return true;
  if (e?.message && /UNIQUE constraint failed/i.test(e.message)) return true;
  return false;
}
