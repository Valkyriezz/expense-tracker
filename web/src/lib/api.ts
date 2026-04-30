export type Expense = {
  id: number;
  amount_paise: number;
  currency: "INR";
  category: string;
  description: string;
  date: string;
  created_at: string;
};

export type ExpenseList = {
  items: Expense[];
  count: number;
  total_paise: number;
  currency: "INR";
};

export type CreateExpenseInput = {
  amount: string;
  category: string;
  description: string;
  date: string;
};

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown, message: string) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function parseError(res: Response): Promise<ApiError> {
  let body: unknown = null;
  let message = `${res.status} ${res.statusText}`;
  try {
    body = await res.json();
    if (body && typeof body === "object" && "error" in body) {
      const e = body as { error?: string; message?: string };
      message = e.message ?? e.error ?? message;
    }
  } catch {
    /* not JSON */
  }
  return new ApiError(res.status, body, message);
}

export async function listExpenses(params: {
  category?: string;
  sort?: "date_desc" | "date_asc";
  signal?: AbortSignal;
}): Promise<ExpenseList> {
  const q = new URLSearchParams();
  if (params.category) q.set("category", params.category);
  if (params.sort) q.set("sort", params.sort);
  const url = `/api/expenses${q.toString() ? `?${q}` : ""}`;
  const res = await fetch(url, { signal: params.signal });
  if (!res.ok) throw await parseError(res);
  return res.json();
}

export async function createExpense(
  input: CreateExpenseInput,
  idempotencyKey: string,
): Promise<Expense> {
  const res = await fetch("/api/expenses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw await parseError(res);
  return res.json();
}

export function paiseToRupees(paise: number): string {
  const sign = paise < 0 ? "-" : "";
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100);
  const fraction = (abs % 100).toString().padStart(2, "0");
  // Indian-style grouping (e.g. 1,23,45,678) when present, else plain.
  const grouped = rupees.toLocaleString("en-IN");
  return `${sign}₹${grouped}.${fraction}`;
}
