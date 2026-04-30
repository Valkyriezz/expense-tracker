# Expense Tracker

A small full-stack personal finance tool: record expenses, view, filter by
category, sort by date, and see a running total. Built to behave correctly
under realistic conditions — flaky networks, retries, double-clicks, and page
refreshes.

- **Live app:** _add Render URL after deploy_
- **Repo:** _add GitHub URL after push_

---

## Stack

| Layer    | Choice                                                | Why                                                                 |
| -------- | ----------------------------------------------------- | ------------------------------------------------------------------- |
| Backend  | Node + Express + TypeScript                           | Familiar, minimal, fast                                             |
| Storage  | SQLite via `@libsql/client` (libSQL)                  | Same SQL as SQLite, but the client also speaks Turso (`libsql://…`), so dev uses a local file and prod uses a hosted serverless SQLite — no driver swap |
| Validation | Zod                                                | Single source of truth for input shape, good error messages          |
| Frontend | React 18 + TypeScript + Vite                          | Small, fast, idiomatic                                              |
| Tests    | Node's built-in test runner + Supertest               | No extra runner; runs against a real SQLite file in a temp dir      |
| Deploy   | Vercel serverless function + Vercel CDN for the SPA   | Free tier, no card; same domain so no CORS                           |

---

## Running locally

Requirements: **Node ≥ 18**.

```bash
# install
npm run install:all

# in two terminals (recommended for development):
npm run dev:server   # API on :3001 (writes to ./server/data/expenses.db)
npm run dev:web      # Vite dev server on :5173, proxies /api → :3001

# OR, single-process (build once, serve everything from :3001)
npm run build
npm start
# then open http://localhost:3001
```

Tests:

```bash
npm test
```

By default the server uses a local SQLite file (`./server/data/expenses.db`).
Set `TURSO_URL` and `TURSO_AUTH_TOKEN` to point it at a hosted Turso database
instead — the same code path covers both.

---

## API

Base URL: `/api`

### `POST /api/expenses`

Creates an expense.

**Request**

```http
POST /api/expenses
Content-Type: application/json
Idempotency-Key: <uuid>     # recommended; see "Idempotency" below

{
  "amount": "199.50",        // string or number, ₹; up to 2 decimals
  "category": "Food",        // 1–64 chars
  "description": "Lunch",    // optional, up to 500 chars
  "date": "2026-04-30"       // YYYY-MM-DD (calendar date, no timezone)
}
```

**Response — 201 Created** (or **200 OK** when an idempotency key replays a previous request)

```json
{
  "id": 1,
  "amount_paise": 19950,
  "currency": "INR",
  "category": "Food",
  "description": "Lunch",
  "date": "2026-04-30",
  "created_at": "2026-04-30T14:06:17.962Z"
}
```

**Errors**

| Status | When                                                                |
| ------ | ------------------------------------------------------------------- |
| 400    | Invalid body (missing field, bad date, non-decimal amount, ≤ 0, &gt; 2 dp) |
| 409    | `Idempotency-Key` reused with a *different* request body            |
| 500    | Unexpected server error                                             |

### `GET /api/expenses`

List expenses with optional filter and sort.

**Query parameters**

| Param      | Values                            | Default     |
| ---------- | --------------------------------- | ----------- |
| `category` | any non-empty string              | _no filter_ |
| `sort`     | `date_desc` \| `date_asc`         | `date_desc` |

**Response — 200**

```json
{
  "items": [/* shaped same as POST response */],
  "count": 2,
  "total_paise": 69950,
  "currency": "INR"
}
```

The `total_paise` is summed over the **filtered** result set so the UI total
matches what's on screen.

### `GET /health`

Returns `{ "ok": true }`. Useful for uptime probes.

---

## Key design decisions

### 1. Money is stored as integer paise

`amount_paise INTEGER` in the DB. Floats are not safe for currency: `0.1 + 0.2`
is `0.30000000000000004`, and "₹199.99" can become "₹199.98999…" after a few
sums. The API accepts the user's amount as a string (e.g. `"199.50"`), validates
it with a regex (`^\d+(\.\d{1,2})?$`), and converts it to paise *manually* —
never via `Number * 100`, which has the same drift.

The DB has `CHECK(amount_paise > 0)` as a final guardrail.

### 2. Idempotency for safe retries

The acceptance criteria call out _"behave correctly even if the client retries
the same request due to network issues or page reloads"_. Solved with a
standard `Idempotency-Key` header (RFC-7231-style; same shape as Stripe).

- Client generates a UUID per draft expense and sends it on every retry.
- Server stores `(key → expense_id, request_hash)` in an `idempotency_keys` table.
  - **Same key + same body** → return the original result with `200 OK`.
  - **Same key + different body** → `409 Conflict` (catches client bugs).
  - **No key** → no replay; just create as normal.
- The insert + key-record happen inside one `BEGIN IMMEDIATE` SQLite transaction,
  so we never end up with an expense whose key wasn't recorded.
- Concurrent racers (two parallel POSTs with the same key) are detected via the
  PRIMARY KEY constraint on the keys table; the loser reads the winner's row
  and returns it. End result: **at most one expense per (key + body)**, no matter
  how many times the client retries.

The frontend regenerates the key after each successful submit and disables the
submit button while in flight, so:

- Double-clicking submit → server inserts once.
- Network is slow and user clicks again → same key, deduped server-side.
- Submit goes out, page reloads — user re-enters and submits — different key,
  treated as a new expense (correct: same form, intentional re-submit).

### 3. Date is a calendar day, not a timestamp

`date TEXT` stores `YYYY-MM-DD`. We deliberately don't store time or convert
through UTC — an expense made on April 30 should display as April 30 to a user
in any timezone. `created_at` is a UTC timestamp for ordering tie-breaks.

### 4. Filter + sort are server-side

The client sends `category=` and `sort=` as query params; the server handles
them in SQL with indexes on `(category)` and `(date)`. The total returned by
`GET` is computed over the filtered set so the UI's "Total: ₹X" line is always
authoritative.

### 5. SPA + API in one service

The Express server serves `web/dist/*` as static files in production with a
fallback route that returns `index.html` for any non-`/api`, non-`/health` path.
One URL, one deploy, no CORS problems for the user. In dev, Vite runs separately
and proxies `/api` to the server.

---

## Production-readiness notes

- **Concurrency:** SQLite uses WAL + `busy_timeout=5000`, so concurrent reads
  and a single writer interleave well at this scale.
- **Crash safety:** All inserts run inside `BEGIN IMMEDIATE` transactions.
- **Input limits:** JSON body is capped at 32 KB. Strings have max lengths.
- **CORS:** Open in dev for the Vite proxy; in production the SPA is same-origin
  so it's a no-op.
- **Logging:** Unhandled errors are logged with `console.error` and the client
  gets a generic `500 internal_error` (no stack-leak).
- **Secrets:** None required; the only knob is `DB_PATH` and `PORT`.

---

## Trade-offs (because of the timebox)

- **No edit/delete.** The acceptance criteria don't mention them, and adding
  them properly (with idempotency on PATCH/DELETE) would have eaten time better
  spent on the foundation.
- **No auth or multi-user.** Single-tenant tool. Adding auth is a half-day at
  minimum and outside scope.
- **No pagination.** With a personal finance tool, list size stays small for a
  long time. The API is designed to add `limit`/`offset` later without a
  breaking change.
- **No category management UI.** Categories are free-text with a datalist of
  common values. A real product would have a managed category list with
  per-user customization.
- **`@libsql/client` (libSQL) instead of `better-sqlite3`** because the same
  client speaks both a local SQLite file and a hosted Turso database — local
  dev, tests, and prod all run the same code path with just an env-var swap.
- **No automatic database migrations.** Schema is created with `CREATE TABLE IF
  NOT EXISTS` on boot. For v2 I'd add a `_migrations` table and a numbered set
  of SQL files.
- **No CSRF protection** — the API is JSON-only with no cookie auth, so it isn't
  exploitable today. Would add same-site cookies and CSRF tokens once auth lands.
- **Tests cover the API's correctness story** (validation, money handling,
  idempotency, filter/sort). I didn't add frontend tests; the UI is small enough
  to verify manually and the bulk of the *behavioural* risk lives in the server.

---

## Things I intentionally did *not* do

- Charts, summary-per-category, budgets, currency switching, recurring expenses.
- A heavyweight UI library (MUI, etc.). Plain CSS keeps the bundle small and
  focuses review attention on the logic.
- A separate frontend host. One URL is simpler to operate; we can split later
  if traffic warrants it.
- Premature abstractions (repository pattern, service layer, DI container).
  At this size they cost more than they save.

---

## Deploying

The repo ships ready for **Vercel + Turso** (both have free tiers that don't
require a credit card on file). The Express app runs as a single Vercel
serverless function (`api/[[...slug]].ts` → catch-all under `/api/*`); the
React app is served by Vercel's CDN from `web/dist`.

### 1. Create a Turso database (~3 min)

1. Sign in at [turso.tech](https://turso.tech) (GitHub login, no card).
2. **Create database** — pick a region near you.
3. On the database page, copy the **Database URL** (starts with `libsql://…`).
4. **Generate Token** → copy it.

### 2. Deploy on Vercel (~3 min)

1. Sign in at [vercel.com](https://vercel.com) (GitHub login, no card).
2. **New Project** → import this repo.
3. Vercel will read `vercel.json` and pick the right install/build commands.
4. Add **Environment Variables** before the first deploy:
   - `TURSO_URL` = `libsql://…` (from step 1.3)
   - `TURSO_AUTH_TOKEN` = the token from step 1.4
5. **Deploy**. First build takes ~2 min.

### Why not Render?

Render now requires a credit card on file even for the free tier. Vercel +
Turso gives the same shape (managed compute + managed SQLite-flavoured DB) with
a free, no-card path that's friendlier for short-lived demos. The code is
deploy-target-agnostic — set `DB_PATH` (file mode) or `TURSO_URL` (network
mode) and the same server runs anywhere.

---

## Project structure

```
expense-tracker/
├── api/
│   └── [[...slug]].ts        # Vercel serverless entry — wraps the Express app
├── server/                   # Express + libSQL API
│   ├── src/
│   │   ├── app.ts            # Express app factory (also serves web/dist locally)
│   │   ├── index.ts          # Entry: listens on PORT (used by `npm start`)
│   │   ├── lib/
│   │   │   ├── db.ts         # libSQL client, schema, transaction helper
│   │   │   ├── money.ts      # rupee-string ↔ paise integer
│   │   │   └── schema.ts     # zod input/query schemas
│   │   └── routes/
│   │       └── expenses.ts   # POST + GET, idempotency replay
│   └── test/
│       └── expenses.test.ts  # node:test + supertest
├── web/                      # React + Vite SPA
│   ├── index.html
│   └── src/
│       ├── App.tsx
│       ├── main.tsx
│       ├── styles.css
│       ├── components/
│       │   ├── ExpenseForm.tsx
│       │   └── ExpenseList.tsx
│       └── lib/
│           └── api.ts        # fetch wrappers, money formatting
├── vercel.json               # Vercel build/output config
├── package.json              # orchestrates build/start/test
└── README.md
```
