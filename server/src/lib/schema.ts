import { z } from "zod";

export const CreateExpenseInput = z.object({
  // amount can be a string ("12.50") or number; parsed downstream into paise.
  amount: z.union([z.string(), z.number()]),
  category: z
    .string()
    .trim()
    .min(1, "category is required")
    .max(64, "category too long"),
  description: z.string().trim().max(500, "description too long").default(""),
  // ISO date YYYY-MM-DD. We don't accept timestamps — date is the user's local
  // calendar day, independent of timezone.
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD")
    .refine((s) => {
      const d = new Date(`${s}T00:00:00Z`);
      return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
    }, "date must be a real calendar day"),
});

export type CreateExpenseInput = z.infer<typeof CreateExpenseInput>;

export const ListExpensesQuery = z.object({
  category: z.string().trim().min(1).max(64).optional(),
  sort: z.enum(["date_desc", "date_asc"]).optional(),
});

export type ListExpensesQuery = z.infer<typeof ListExpensesQuery>;
