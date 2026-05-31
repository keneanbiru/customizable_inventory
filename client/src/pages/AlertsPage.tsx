import { useCallback, useEffect, useMemo, useState } from "react";
import { apiGet, apiPatch, apiPost } from "../api/client";
import { useAuth } from "../auth/AuthContext";

type AlertItem = {
  id: string;
  product_id: string;
  product_name: string;
  alert_type: "low_stock" | "expiry" | "reorder";
  message: string;
  status: "open" | "acknowledged" | "resolved";
  created_at: string;
  updated_at: string;
  resolved_at?: string | null;
};

export function AlertsPage() {
  const { user } = useAuth();
  const canReconcile = user?.role === "admin" || user?.role === "manager";
  const [items, setItems] = useState<AlertItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"" | "open" | "acknowledged" | "resolved">("");
  const [type, setType] = useState<"" | "low_stock" | "expiry" | "reorder">("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      qs.set("page_size", "200");
      if (status) qs.set("status", status);
      if (type) qs.set("type", type);
      const res = await apiGet<{ items: AlertItem[] }>(`/api/v1/alerts?${qs.toString()}`);
      setItems(res.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load alerts");
    } finally {
      setLoading(false);
    }
  }, [status, type]);

  useEffect(() => {
    void load();
  }, [load]);

  async function updateStatus(id: string, nextStatus: "acknowledged" | "resolved") {
    setSaving(true);
    setError(null);
    try {
      await apiPatch(`/api/v1/alerts/${id}`, { status: nextStatus });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update alert");
    } finally {
      setSaving(false);
    }
  }

  async function reconcile() {
    if (!canReconcile) return;
    setSaving(true);
    setError(null);
    try {
      await apiPost("/api/v1/alerts/reconcile", {});
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reconcile alerts");
    } finally {
      setSaving(false);
    }
  }

  const openCount = useMemo(() => items.filter((a) => a.status !== "resolved").length, [items]);

  return (
    <div className="stack suppliers-page">
      <a className="products-page__back" href="/app">
        ← Back
      </a>
      <div className="products-page__head">
        <h2>Alerts</h2>
      </div>
      <section className="suppliers-stats">
        <div className="panel suppliers-stat-card active">
          <p className="text-muted">Open Alerts</p>
          <p className="suppliers-stat-value">{openCount}</p>
          <p className="suppliers-stat-delta">Action required</p>
        </div>
      </section>
      <section className="panel products-page__table-panel">
        <div className="products-page__toolbar">
          <div className="products-page__left-tools">
            <label className="field">
              <span>Status</span>
              <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
                <option value="">All statuses</option>
                <option value="open">Open</option>
                <option value="acknowledged">Acknowledged</option>
                <option value="resolved">Resolved</option>
              </select>
            </label>
            <label className="field">
              <span>Type</span>
              <select value={type} onChange={(e) => setType(e.target.value as typeof type)}>
                <option value="">All types</option>
                <option value="low_stock">Low stock</option>
                <option value="reorder">Reorder</option>
                <option value="expiry">Expiry</option>
              </select>
            </label>
          </div>
          {canReconcile && (
            <button type="button" className="btn btn-outline" onClick={() => void reconcile()} disabled={saving}>
              Reconcile alerts
            </button>
          )}
        </div>
        {error && <p className="text-error">{error}</p>}
        {loading ? (
          <p className="text-muted">Loading alerts...</p>
        ) : (
          <div className="users-table-wrap">
            <table className="users-table products-page__table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Product</th>
                  <th>Message</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((a) => (
                  <tr key={a.id}>
                    <td>{a.alert_type}</td>
                    <td>{a.product_name}</td>
                    <td>{a.message}</td>
                    <td>{a.status}</td>
                    <td>{new Date(a.created_at).toLocaleString()}</td>
                    <td>
                      <div className="products-page__actions">
                        {a.status !== "resolved" && (
                          <button
                            type="button"
                            className="btn btn-outline"
                            onClick={() => void updateStatus(a.id, "acknowledged")}
                            disabled={saving}
                          >
                            Acknowledge
                          </button>
                        )}
                        {a.status !== "resolved" && (
                          <button
                            type="button"
                            className="btn btn-primary"
                            onClick={() => void updateStatus(a.id, "resolved")}
                            disabled={saving}
                          >
                            Resolve
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {!items.length && (
                  <tr>
                    <td colSpan={6} className="text-muted">
                      No alerts found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
