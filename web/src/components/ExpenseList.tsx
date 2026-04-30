import { paiseToRupees, type Expense } from "../lib/api.js";

type Props = {
  items: Expense[];
};

const dateFmt = new Intl.DateTimeFormat("en-IN", {
  year: "numeric",
  month: "short",
  day: "numeric",
});

export function ExpenseList({ items }: Props) {
  if (items.length === 0) {
    return (
      <div className="empty">
        No expenses to show. Add one above to get started.
      </div>
    );
  }

  return (
    <div className="list">
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Category</th>
            <th>Description</th>
            <th className="num">Amount</th>
          </tr>
        </thead>
        <tbody>
          {items.map((e) => (
            <tr key={e.id}>
              <td>{dateFmt.format(new Date(`${e.date}T00:00:00`))}</td>
              <td>
                <span className="pill">{e.category}</span>
              </td>
              <td className="desc">{e.description || <span className="muted">—</span>}</td>
              <td className="num">{paiseToRupees(e.amount_paise)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
