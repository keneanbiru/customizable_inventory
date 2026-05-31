import { useCallback, useEffect, useMemo, useState } from "react";
import { apiGet } from "../api/client";

type TxItem = {
  id: string;
  product_id: string;
  product_name: string;
  warehouse_id: string | null;
  warehouse_name: string | null;
  transaction_type: "in" | "out" | "adjustment";
  quantity: string;
  notes: string | null;
  created_by: string | null;
  created_by_email: string | null;
  created_at: string;
};

type TxResponse = {
  items: TxItem[];
  page: number;
  page_size: number;
  total: number;
};

export function TransactionsPage() {
  const [items, setItems] = useState<TxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "in" | "out" | "adjustment">("all");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 12;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      qs.set("page", String(page));
      qs.set("page_size", String(pageSize));
      if (typeFilter !== "all") qs.set("type", typeFilter);
      if (start) qs.set("start", new Date(start).toISOString());
      if (end) qs.set("end", new Date(end).toISOString());
      const res = await apiGet<TxResponse>(`/api/v1/products/transactions?${qs.toString()}`);
      const q = search.trim().toLowerCase();
      const filtered = q
        ? res.items.filter(
            (t) =>
              t.product_name.toLowerCase().includes(q) ||
              (t.created_by_email ?? "").toLowerCase().includes(q) ||
              (t.notes ?? "").toLowerCase().includes(q)
          )
        : res.items;
      setItems(filtered);
      setTotal(res.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load transactions");
    } finally {
      setLoading(false);
    }
  }, [end, page, search, start, typeFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [total]);

  return (
    <div className="stack products-page">
      <a className="products-page__back" href="/app">
        ← Back
      </a>
      <h2>Transaction History</h2>
      <section className="panel products-page__table-panel">
        <div className="products-page__toolbar">
          <div className="products-page__left-tools">
            <input
              className="products-page__search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search product/user/note"
            />
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)}>
              <option value="all">All types</option>
              <option value="in">Stock in</option>
              <option value="out">Stock out</option>
              <option value="adjustment">Adjustment</option>
            </select>
            <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
            <input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
            <button type="button" className="btn btn-outline" onClick={() => { setPage(1); void load(); }}>
              Apply
            </button>
          </div>
        </div>

        {error && <p className="text-error">{error}</p>}
        {loading ? (
          <p className="text-muted">Loading…</p>
        ) : (
          <div className="users-table-wrap">
            <table className="users-table products-page__table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Product</th>
                  <th>Type</th>
                  <th>Quantity</th>
                  <th>Warehouse</th>
                  <th>By</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {items.map((tx) => (
                  <tr key={tx.id}>
                    <td>{new Date(tx.created_at).toLocaleString()}</td>
                    <td>{tx.product_name}</td>
                    <td className="text-capitalize">{tx.transaction_type}</td>
                    <td>{tx.quantity}</td>
                    <td>{tx.warehouse_name ?? "—"}</td>
                    <td>{tx.created_by_email ?? "—"}</td>
                    <td>{tx.notes ?? "—"}</td>
                  </tr>
                ))}
                {!items.length && (
                  <tr>
                    <td colSpan={7} className="text-muted">No transactions found.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        <div className="products-page__pagination">
          <button type="button" className="btn btn-outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            ← Previous
          </button>
          <div className="products-page__pages">Page {page} of {totalPages}</div>
          <button
            type="button"
            className="btn btn-outline"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next →
          </button>
        </div>
      </section>
    </div>
  );
}

