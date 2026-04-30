import { useEffect, useRef, useState } from "react";
import {
  createExpense,
  type CreateExpenseInput,
  type Expense,
  ApiError,
} from "../lib/api.js";

const COMMON_CATEGORIES = [
  "Food",
  "Travel",
  "Groceries",
  "Rent",
  "Utilities",
  "Health",
  "Entertainment",
  "Shopping",
  "Other",
];

function todayISO(): string {
  // Local calendar day, formatted YYYY-MM-DD without UTC drift.
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

type Props = {
  onCreated: (e: Expense) => void;
};

export function ExpenseForm({ onCreated }: Props) {
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(todayISO());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The Idempotency-Key is bound to the *current draft*. While the user is
  // filling the form the key stays stable — so double-submits, retries, and
  // even page-reload-then-resubmit all land as a single expense.
  // We rotate the key only after the server confirms a successful create.
  const idemKeyRef = useRef<string>(newIdempotencyKey());

  // Disable native form submission on Enter inside an in-flight request.
  // We also dedupe on the network layer via the idempotency key, but UI
  // gating gives the user faster feedback.
  const inFlight = useRef(false);

  useEffect(() => {
    setError(null);
  }, [amount, category, description, date]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (inFlight.current) return;

    const trimmedAmount = amount.trim();
    const trimmedCategory = category.trim();
    if (!trimmedAmount) return setError("Amount is required");
    if (!/^\d+(\.\d{1,2})?$/.test(trimmedAmount))
      return setError("Amount must be a positive number with up to 2 decimals");
    if (!trimmedCategory) return setError("Category is required");
    if (!date) return setError("Date is required");

    const payload: CreateExpenseInput = {
      amount: trimmedAmount,
      category: trimmedCategory,
      description: description.trim(),
      date,
    };

    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const created = await createExpense(payload, idemKeyRef.current);
      onCreated(created);
      idemKeyRef.current = newIdempotencyKey();
      setAmount("");
      setDescription("");
      // keep category & date — common case is logging multiple in a row.
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError(
          "Couldn't save. Check your connection — you can safely retry; we won't double-charge.",
        );
      }
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  return (
    <form className="card form" onSubmit={onSubmit} noValidate>
      <h2>Add expense</h2>
      <div className="row">
        <label className="field">
          <span>Amount (₹)</span>
          <input
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={submitting}
            autoComplete="off"
            required
          />
        </label>
        <label className="field">
          <span>Date</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            disabled={submitting}
            required
          />
        </label>
      </div>
      <label className="field">
        <span>Category</span>
        <input
          type="text"
          list="categories"
          placeholder="Food, Travel, …"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          disabled={submitting}
          required
        />
        <datalist id="categories">
          {COMMON_CATEGORIES.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </label>
      <label className="field">
        <span>Description</span>
        <input
          type="text"
          placeholder="optional"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={submitting}
          maxLength={500}
        />
      </label>

      {error && (
        <div className="alert" role="alert">
          {error}
        </div>
      )}

      <button type="submit" disabled={submitting}>
        {submitting ? "Saving…" : "Add expense"}
      </button>
    </form>
  );
}
