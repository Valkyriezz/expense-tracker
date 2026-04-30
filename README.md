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
| Backend  | Node 22 + Express + TypeScript                        | Familiar, minimal, fast                                             |
| Storage  | SQLite via Node's built-in `node:sqlite`              | ACID transactions, single-file, zero native build, works on Render free tier |
| Validation | Zod                                                | Single source of truth for input shape, good error messages          |
| Frontend | React 18 + TypeScript + Vite                          | Small, fast, idiomatic                                              |
| Tests    | Node's built-in test runner + Supertest               | No extra runner; works first-try with `node:sqlite`                  |
| Deploy   | One Render Web Service (server serves built web app)  | Single URL, single deploy                                           |

---

## Running locally

Requirements: **Node ≥ 22.5** (uses `node:sqlite`).

```bash
# install
npm run install:all

# in two terminals (recommended for development):
npm run dev:server   # API on :3001
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
- **`node:sqlite` is marked experimental** in Node 22 (still emits a warning).
  Stable enough in practice — the API is identical to `better-sqlite3`. Chose it
  because the dev environment didn't have a C++ toolchain and the deploy target
  doesn't either; this avoids native-build flakiness without giving up real
  SQLite.
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

## Deploying to Render

This repo deploys as a single **Render Web Service**.

1. Push to GitHub.
2. New → Web Service → connect the repo.
3. Settings:
   - **Runtime:** Node
   - **Build command:** `npm run install:all && npm run build`
   - **Start command:** `npm start`
   - **Environment variables:**
     - `NODE_VERSION=22.11.0` (or any 22.5+)
     - `DB_PATH=/var/data/expenses.db` _(see disk note below)_
4. Add a **Render Disk** (1 GB is plenty) mounted at `/var/data` so the SQLite
   file persists across deploys/restarts. _Without a disk, the data is wiped on
   each restart — fine for a quick demo, not for real use._

The same setup works on Railway / Fly.io with equivalent disk attachments.

---

## Project structure

```
expense-tracker/
├── server/                   # Express + node:sqlite API
│   ├── src/
│   │   ├── app.ts            # Express app factory (also serves web/dist)
│   │   ├── index.ts          # Entry: listens on PORT
│   │   ├── lib/
│   │   │   ├── db.ts         # node:sqlite, schema, transaction helper
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
├── package.json              # orchestrates build/start/test
└── README.md
```
