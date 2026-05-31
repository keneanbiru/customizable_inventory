import { FormEvent, useCallback, useEffect, useState } from "react";
import { apiGet, apiPatch, apiPost } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useNavigate } from "react-router-dom";

type Warehouse = {
  id: string;
  name: string;
  code: string | null;
  capacity_skus: number;
  used_skus: number;
  is_default: boolean;
};

export function WarehousesPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [items, setItems] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [capacitySkus, setCapacitySkus] = useState("15000");
  const [isDefault, setIsDefault] = useState(false);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiGet<{ items: Warehouse[] }>("/api/v1/warehouses");
      setItems(res.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load warehouses");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!isAdmin) return;
    const parsedCapacity = Number(capacitySkus);
    if (!Number.isInteger(parsedCapacity) || parsedCapacity <= 0) {
      setError("Capacity must be a positive integer");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        name: name.trim(),
        code: code.trim() || null,
        capacity_skus: parsedCapacity,
        is_default: isDefault,
      };
      if (editingId) {
        await apiPatch(`/api/v1/warehouses/${editingId}`, payload);
      } else {
        await apiPost("/api/v1/warehouses", payload);
      }
      setEditingId(null);
      setName("");
      setCode("");
      setCapacitySkus("15000");
      setIsDefault(false);
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save warehouse");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="stack suppliers-page">
      <a className="products-page__back" href="/app">
        ← Back
      </a>
      <div className="products-page__head">
        <h2>Warehouses</h2>
        <div className="overview__periods">
          {["1d", "7d", "1m", "3m", "6m", "1y", "3y", "5y"].map((p) => (
            <button key={p} type="button" className="overview__chip">{p}</button>
          ))}
        </div>
        <button type="button" className="overview__action-btn">Select dates</button>
      </div>
      {error && <p className="text-error">{error}</p>}

      <section className="suppliers-stats">
        <div className="panel suppliers-stat-card active">
          <p className="text-muted">Active Warehouses</p>
          <p className="suppliers-stat-value">{items.length}</p>
          <p className="suppliers-stat-delta">↑ 12% vs last month</p>
        </div>
        <div className="panel suppliers-stat-card">
          <p className="text-muted">Inactive Warehouses</p>
          <p className="suppliers-stat-value">0</p>
          <p className="suppliers-stat-delta">↑ 12% vs last month</p>
        </div>
        <div className="panel suppliers-stat-card">
          <p className="text-muted">Deleted Warehouses</p>
          <p className="suppliers-stat-value">0</p>
          <p className="suppliers-stat-delta">↑ 12% vs last month</p>
        </div>
      </section>

      <section className="panel products-page__table-panel">
        <h3>Active Warehouses</h3>
        <div className="products-page__toolbar">
          <div className="products-page__left-tools">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search"
              className="products-page__search"
            />
            <button type="button" className="btn btn-outline">Filters</button>
          </div>
          <div className="products-page__right-tools">
            {isAdmin && (
              <button type="button" className="btn btn-outline" onClick={() => setShowForm(true)}>
                + Add New Warehouse
              </button>
            )}
            <button type="button" className="btn btn-primary">Export</button>
          </div>
        </div>

        {loading ? (
          <p className="text-muted">Loading…</p>
        ) : (
          <div className="users-table-wrap">
            <table className="users-table products-page__table">
              <thead>
                <tr>
                  <th />
                  <th>Warehouse Name</th>
                  <th>Warehouse ID</th>
                  <th>Location</th>
                  <th>Capacity Usage (SKUs)</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {items
                  .filter((w) => w.name.toLowerCase().includes(search.toLowerCase().trim()))
                  .map((w) => (
                    <tr
                      key={w.id}
                      onClick={() => navigate(`/app/products?warehouse_id=${encodeURIComponent(w.id)}`)}
                      style={{ cursor: "pointer" }}
                      title="View products in this warehouse"
                    >
                      <td><input type="checkbox" onClick={(e) => e.stopPropagation()} /></td>
                      <td>{w.name}</td>
                      <td>{w.code ?? w.id.slice(0, 8).toUpperCase()}</td>
                      <td>{w.is_default ? "Main location" : "Secondary location"}</td>
                      <td>
                        {w.used_skus}/{w.capacity_skus} (
                        {w.capacity_skus > 0 ? Math.round((w.used_skus / w.capacity_skus) * 100) : 0}%)
                      </td>
                      <td>
                        <div className="products-page__actions" onClick={(e) => e.stopPropagation()}>
                          {isAdmin && (
                            <button
                              type="button"
                              className="products-page__icon-btn"
                              onClick={() => {
                                setShowForm(true);
                                setEditingId(w.id);
                                setName(w.name);
                                setCode(w.code ?? "");
                                setCapacitySkus(String(w.capacity_skus));
                                setIsDefault(w.is_default);
                              }}
                            >
                              ✎
                            </button>
                          )}
                          <button type="button" className="products-page__icon-btn delete" onClick={(e) => e.stopPropagation()}>🗑</button>
                          <button type="button" className="products-page__icon-btn" onClick={(e) => e.stopPropagation()}>◉</button>
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="products-page__pagination">
          <button type="button" className="btn btn-outline">← Previous</button>
          <div className="products-page__pages">1 2 3 ... 8 9 10</div>
          <button type="button" className="btn btn-outline">Next →</button>
        </div>
      </section>

      {isAdmin && showForm && (
        <section className="products-modal">
          <div className="products-modal__backdrop" onClick={() => setShowForm(false)} />
          <div className="products-modal__dialog panel" role="dialog" aria-modal="true" aria-label="Warehouse form">
            <div className="products-modal__head">
              <h3>{editingId ? "Edit warehouse" : "Add warehouse"}</h3>
              <button type="button" className="products-modal__close" onClick={() => setShowForm(false)}>✕</button>
            </div>
            <form className="products-modal__grid" onSubmit={submit}>
              <label className="field">
                <span>Name</span>
                <input value={name} onChange={(e) => setName(e.target.value)} required />
              </label>
              <label className="field">
                <span>Code (optional)</span>
                <input value={code} onChange={(e) => setCode(e.target.value)} />
              </label>
              <label className="field">
                <span>Capacity (SKUs)</span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={capacitySkus}
                  onChange={(e) => setCapacitySkus(e.target.value)}
                  required
                />
              </label>
              <label className="checkbox users-checkbox">
                <input
                  type="checkbox"
                  checked={isDefault}
                  onChange={(e) => setIsDefault(e.target.checked)}
                />
                Set as default
              </label>
              <button type="submit" className="btn btn-primary btn-block products-modal__submit" disabled={saving}>
                {editingId ? "Save warehouse" : "Create warehouse"}
              </button>
            </form>
          </div>
        </section>
      )}
    </div>
  );
}
