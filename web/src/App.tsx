import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  listExpenses,
  paiseToRupees,
  type Expense,
  type ExpenseList as ExpenseListT,
} from "./lib/api.js";
import { ExpenseForm } from "./components/ExpenseForm.js";
import { ExpenseList } from "./components/ExpenseList.js";

type SortOrder = "date_desc" | "date_asc";
type LoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; data: ExpenseListT }
  | { kind: "error"; message: string };

export function App() {
  const [filter, setFilter] = useState<string>("");
  const [sort, setSort] = useState<SortOrder>("date_desc");
  const [state, setState] = useState<LoadState>({ kind: "idle" });
  const [knownCategories, setKnownCategories] = useState<Set<string>>(new Set());
  const abortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(
    async (opts?: { silent?: boolean }) => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      if (!opts?.silent) setState({ kind: "loading" });
      try {
        const data = await listExpenses({
          category: filter || undefined,
          sort,
          signal: ctrl.signal,
        });
        if (ctrl.signal.aborted) return;
        setState({ kind: "ok", data });
        // Build a stable category set from server data (ignores current filter
        // so the dropdown doesn't shrink to a single option once filtered).
        if (!filter) {
          setKnownCategories(new Set(data.items.map((e) => e.category)));
        } else {
          setKnownCategories((prev) => {
            const next = new Set(prev);
            data.items.forEach((e) => next.add(e.category));
            return next;
          });
        }
      } catch (err) {
        if (ctrl.signal.aborted) return;
        const message =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Failed to load expenses";
        setState({ kind: "error", message });
      }
    },
    [filter, sort],
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  const onCreated = useCallback(
    (e: Expense) => {
      setKnownCategories((prev) => new Set(prev).add(e.category));
      // Refetch so the new item appears in the correct sort/filter slot.
      refresh({ silent: true });
    },
    [refresh],
  );

  const sortedCategories = useMemo(
    () => Array.from(knownCategories).sort((a, b) => a.localeCompare(b)),
    [knownCategories],
  );

  return (
    <div className="container">
      <header>
        <h1>Expense Tracker</h1>
        <p className="muted">
          Track your loot. Mine your spending.
        </p>
      </header>

      <ExpenseForm onCreated={onCreated} />

      <section className="card">
        <div className="controls">
          <label className="field">
            <span>Filter by category</span>
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="">All categories</option>
              {sortedCategories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Sort by date</span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortOrder)}
            >
              <option value="date_desc">Newest first</option>
              <option value="date_asc">Oldest first</option>
            </select>
          </label>
          <button
            type="button"
            className="ghost"
            onClick={() => refresh()}
            aria-label="Refresh"
          >
            Refresh
          </button>
        </div>

        {state.kind === "loading" && (
          <div className="status">Loading…</div>
        )}
        {state.kind === "error" && (
          <div className="alert" role="alert">
            {state.message}{" "}
            <button type="button" className="link" onClick={() => refresh()}>
              Retry
            </button>
          </div>
        )}
        {state.kind === "ok" && (
          <>
            <ExpenseList items={state.data.items} />
            <div className="totals">
              <span className="muted">
                {state.data.count} expense{state.data.count === 1 ? "" : "s"}
                {filter ? ` in ${filter}` : ""}
              </span>
              <span className="total">
                Total: <strong>{paiseToRupees(state.data.total_paise)}</strong>
              </span>
            </div>
          </>
        )}
      </section>

      <footer className="muted small">
        Saved to the server. Flaky network? Click again — duplicates are
        deduped by an Idempotency-Key, no double-mining.
      </footer>
    </div>
  );
}
