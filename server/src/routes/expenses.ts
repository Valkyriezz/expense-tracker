import { Router, type Request, type Response } from "express";
import { createHash } from "node:crypto";
import {
  db,
  ready,
  withTransaction,
  isPrimaryKeyConflict,
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

function rowToExpense(row: Record<string, unknown>): ExpenseRow {
  return {
    id: Number(row.id),
    amount_paise: Number(row.amount_paise),
    category: String(row.category),
    description: String(row.description ?? ""),
    date: String(row.date),
    created_at: String(row.created_at),
  };
}

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

expensesRouter.post("/expenses", async (req: Request, res: Response) => {
  await ready();

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
    const existingRs = await db.execute({
      sql: `SELECT request_hash, expense_id FROM idempotency_keys WHERE key = ?`,
      args: [idemKey],
    });
    const existing = existingRs.rows[0];
    if (existing) {
      if (String(existing.request_hash) !== requestHash) {
        return res.status(409).json({
          error: "idempotency_key_reuse",
          message:
            "Idempotency-Key was previously used with a different request body",
        });
      }
      const rowRs = await db.execute({
        sql: `SELECT * FROM expenses WHERE id = ?`,
        args: [Number(existing.expense_id)],
      });
      const row = rowRs.rows[0];
      if (row) return res.status(200).json(shapeExpense(rowToExpense(row)));
      // Fall through if the original expense was deleted.
    }
  }

  let row: ExpenseRow;
  try {
    row = await withTransaction(async (tx) => {
      const insertRs = await tx.execute({
        sql: `INSERT INTO expenses (amount_paise, category, description, date)
              VALUES (?, ?, ?, ?)
              RETURNING id, amount_paise, category, description, date, created_at`,
        args: [amountPaise, input.category, input.description, input.date],
      });
      const created = rowToExpense(insertRs.rows[0]!);
      if (idemKey) {
        try {
          await tx.execute({
            sql: `INSERT INTO idempotency_keys (key, request_hash, expense_id)
                  VALUES (?, ?, ?)`,
            args: [idemKey, requestHash, created.id],
          });
        } catch (err) {
          if (isPrimaryKeyConflict(err)) throw new IdemRace();
          throw err;
        }
      }
      return created;
    });
  } catch (err) {
    if (err instanceof IdemRace) {
      // Concurrent request inserted the same key first — replay its result.
      const winnerRs = await db.execute({
        sql: `SELECT request_hash, expense_id FROM idempotency_keys WHERE key = ?`,
        args: [idemKey!],
      });
      const winner = winnerRs.rows[0];
      if (winner && String(winner.request_hash) === requestHash) {
        const r = await db.execute({
          sql: `SELECT * FROM expenses WHERE id = ?`,
          args: [Number(winner.expense_id)],
        });
        return res.status(200).json(shapeExpense(rowToExpense(r.rows[0]!)));
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

expensesRouter.get("/expenses", async (req: Request, res: Response) => {
  await ready();

  const parsed = ListExpensesQuery.safeParse(req.query);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "invalid_query", details: parsed.error.flatten() });
  }
  const { category, sort } = parsed.data;

  const orderBy =
    sort === "date_asc" ? "date ASC, created_at ASC" : "date DESC, created_at DESC";

  const rs = category
    ? await db.execute({
        sql: `SELECT id, amount_paise, category, description, date, created_at
              FROM expenses
              WHERE category = ?
              ORDER BY ${orderBy}`,
        args: [category],
      })
    : await db.execute(
        `SELECT id, amount_paise, category, description, date, created_at
         FROM expenses
         ORDER BY ${orderBy}`,
      );

  const rows = rs.rows.map(rowToExpense);
  const total_paise = rows.reduce((sum, r) => sum + r.amount_paise, 0);
  return res.json({
    items: rows.map(shapeExpense),
    count: rows.length,
    total_paise,
    currency: "INR",
  });
});
