import { Router, type Request, type Response } from "express";
import { createHash } from "node:crypto";
import {
  db,
  prepareNamed,
  transaction,
  SQLITE_CONSTRAINT_PRIMARYKEY,
} from "../lib/db.js";
import { parseAmountToPaise } from "../lib/money.js";
import { CreateExpenseInput, ListExpensesQuery } from "../lib/schema.js";

type ExpenseRow = {
  id: number;
  amount_paise: number;
  category: string;
  description: string;
  date: string;
  created_at: string;
};

const insertExpense = prepareNamed(`
  INSERT INTO expenses (amount_paise, category, description, date)
  VALUES ($amount_paise, $category, $description, $date)
  RETURNING id, amount_paise, category, description, date, created_at
`);

const selectExpense = db.prepare(`SELECT * FROM expenses WHERE id = ?`);

const insertIdemKey = db.prepare(`
  INSERT INTO idempotency_keys (key, request_hash, expense_id)
  VALUES (?, ?, ?)
`);

const selectIdemKey = db.prepare(`
  SELECT request_hash, expense_id FROM idempotency_keys WHERE key = ?
`);

function shapeExpense(row: ExpenseRow) {
  return {
    id: row.id,
    amount_paise: row.amount_paise,
    currency: "INR",
    category: row.category,
    description: row.description,
    date: row.date,
    created_at: row.created_at,
  };
}

function hashRequest(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

class IdemRace extends Error {}

export const expensesRouter = Router();

expensesRouter.post("/expenses", (req: Request, res: Response) => {
  const parsed = CreateExpenseInput.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "invalid_request", details: parsed.error.flatten() });
  }
  const input = parsed.data;

  let amountPaise: number;
  try {
    amountPaise = parseAmountToPaise(input.amount);
  } catch (err) {
    return res
      .status(400)
      .json({ error: "invalid_amount", message: (err as Error).message });
  }

  const idemKey = req.header("Idempotency-Key");
  const requestHash = hashRequest({
    amount_paise: amountPaise,
    category: input.category,
    description: input.description,
    date: input.date,
  });

  // Idempotency replay: same key + same body → return the original result.
  if (idemKey) {
    const existing = selectIdemKey.get(idemKey) as
      | { request_hash: string; expense_id: number }
      | undefined;
    if (existing) {
      if (existing.request_hash !== requestHash) {
        return res.status(409).json({
          error: "idempotency_key_reuse",
          message:
            "Idempotency-Key was previously used with a different request body",
        });
      }
      const row = selectExpense.get(existing.expense_id) as
        | ExpenseRow
        | undefined;
      if (row) return res.status(200).json(shapeExpense(row));
      // Fall through if the original expense was deleted.
    }
  }

  let row: ExpenseRow;
  try {
    row = transaction((): ExpenseRow => {
      const created = insertExpense.get({
        amount_paise: amountPaise,
        category: input.category,
        description: input.description,
        date: input.date,
      }) as ExpenseRow;
      if (idemKey) {
        try {
          insertIdemKey.run(idemKey, requestHash, created.id);
        } catch (err) {
          if (
            (err as { errcode?: number }).errcode === SQLITE_CONSTRAINT_PRIMARYKEY
          ) {
            throw new IdemRace();
          }
          throw err;
        }
      }
      return created;
    });
  } catch (err) {
    if (err instanceof IdemRace) {
      // Concurrent request inserted the same key first — replay its result.
      const winner = selectIdemKey.get(idemKey!) as
        | { request_hash: string; expense_id: number }
        | undefined;
      if (winner && winner.request_hash === requestHash) {
        const row2 = selectExpense.get(winner.expense_id) as ExpenseRow;
        return res.status(200).json(shapeExpense(row2));
      }
      return res.status(409).json({
        error: "idempotency_key_reuse",
        message: "concurrent conflict",
      });
    }
    throw err;
  }

  return res.status(201).json(shapeExpense(row));
});

expensesRouter.get("/expenses", (req: Request, res: Response) => {
  const parsed = ListExpensesQuery.safeParse(req.query);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "invalid_query", details: parsed.error.flatten() });
  }
  const { category, sort } = parsed.data;

  // Newest first by default; tie-break by created_at so two expenses on the
  // same calendar date are deterministically ordered.
  const orderBy =
    sort === "date_asc" ? "date ASC, created_at ASC" : "date DESC, created_at DESC";

  let rows: ExpenseRow[];
  if (category) {
    rows = db
      .prepare(
        `SELECT id, amount_paise, category, description, date, created_at
         FROM expenses
         WHERE category = ?
         ORDER BY ${orderBy}`,
      )
      .all(category) as ExpenseRow[];
  } else {
    rows = db
      .prepare(
        `SELECT id, amount_paise, category, description, date, created_at
         FROM expenses
         ORDER BY ${orderBy}`,
      )
      .all() as ExpenseRow[];
  }

  const total_paise = rows.reduce((sum, r) => sum + r.amount_paise, 0);
  return res.json({
    items: rows.map(shapeExpense),
    count: rows.length,
    total_paise,
    currency: "INR",
  });
});
