import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { apiDelete, apiGet, apiPatch, apiPost } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { getAccessToken } from "../auth/accessToken";

type SupplierStatus = "active" | "inactive" | "deleted";

type Supplier = {
  id: string;
  supplier_code: string;
  display_name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  avatar_url: string | null;
  status: SupplierStatus;
  created_at: string;
};

type SupplierListResponse = {
  items: Supplier[];
  page: number;
  page_size: number;
  total: number;
};

type SupplierStats = { active: number; inactive: number; deleted: number };

export function SuppliersPage() {
  const { user } = useAuth();
  const canWrite = user?.role === "admin" || user?.role === "manager";
  const canDelete = user?.role === "admin";

  const [items, setItems] = useState<Supplier[]>([]);
  const [stats, setStats] = useState<SupplierStats>({ active: 0, inactive: 0, deleted: 0 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | SupplierStatus>("all");
  const [showForm, setShowForm] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [supplierCode, setSupplierCode] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [status, setStatus] = useState<SupplierStatus>("active");

  const shownStats = useMemo(
    () => [
      { label: "Active Suppliers", value: stats.active },
      { label: "Inactive Suppliers", value: stats.inactive },
      { label: "Deleted Suppliers", value: stats.deleted },
    ],
    [stats]
  );

  function buildStatsFromItems(rows: Supplier[]): SupplierStats {
    const acc: SupplierStats = { active: 0, inactive: 0, deleted: 0 };
    for (const row of rows) {
      acc[row.status] += 1;
    }
    return acc;
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (search.trim()) qs.set("search", search.trim());
      if (statusFilter !== "all") qs.set("status", statusFilter);
      const list = await apiGet<SupplierListResponse>(`/api/v1/suppliers?${qs.toString()}`);
      setItems(list.items);
      try {
        const s = await apiGet<SupplierStats>("/api/v1/suppliers/stats");
        setStats(s);
      } catch {
        // Keep manager experience clean even if stats endpoint permission differs.
        setStats(buildStatsFromItems(list.items));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load suppliers");
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canWrite) return;
    setSaving(true);
    setError(null);
    try {
      const payload = {
        supplier_code: supplierCode.trim(),
        display_name: displayName.trim(),
        contact_name: contactName.trim() || null,
        email: email.trim() || null,
        phone: phone.trim() || null,
        address: address.trim() || null,
        status,
      };
      if (editingId) {
        await apiPatch(`/api/v1/suppliers/${editingId}`, payload);
      } else {
        await apiPost("/api/v1/suppliers", payload);
      }
      setEditingId(null);
      setSupplierCode("");
      setDisplayName("");
      setContactName("");
      setEmail("");
      setPhone("");
      setAddress("");
      setStatus("active");
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save supplier");
    } finally {
      setSaving(false);
    }
  }

  async function exportCsv() {
    try {
      const qs = new URLSearchParams();
      if (search.trim()) qs.set("search", search.trim());
      if (statusFilter !== "all") qs.set("status", statusFilter);
      const token = getAccessToken();
      const res = await fetch(`/api/v1/suppliers/export?${qs.toString()}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        credentials: "include",
      });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "suppliers.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to export CSV");
    }
  }

  return (
    <div className="stack suppliers-page">
      <a className="products-page__back" href="/app">
        ← Back
      </a>
      <h2>Suppliers</h2>
      {error && <p className="text-error">{error}</p>}
      <section className="suppliers-stats">
        {shownStats.map((s, idx) => (
          <div key={s.label} className={`panel suppliers-stat-card${idx === 0 ? " active" : ""}`}>
            <p className="text-muted">{s.label}</p>
            <p className="suppliers-stat-value">{s.value}</p>
            <p className="suppliers-stat-delta">↑ 12% vs last month</p>
          </div>
        ))}
      </section>

      <section className="panel products-page__table-panel">
        <h3>Active Suppliers</h3>
        <div className="products-page__toolbar">
          <div className="products-page__left-tools">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search"
              className="products-page__search"
            />
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}>
              <option value="all">All</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="deleted">Deleted</option>
            </select>
            <button type="button" className="btn btn-outline" onClick={() => void load()}>
              Filters
            </button>
          </div>
          <div className="products-page__right-tools">
            {canWrite && (
              <button type="button" className="btn btn-outline" onClick={() => setShowForm(true)}>
                + Add New Supplier
              </button>
            )}
            <button type="button" className="btn btn-primary" onClick={() => void exportCsv()}>
              Export
            </button>
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
                  <th>Contact Name</th>
                  <th>Supplier ID</th>
                  <th>Contact Name</th>
                  <th>Email-Id</th>
                  <th>Address</th>
                  <th>Phone Number</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((s) => (
                  <tr key={s.id}>
                    <td><input type="checkbox" /></td>
                    <td>
                      <div className="products-page__name-cell">
                        <span className="products-page__avatar">{s.display_name.slice(0, 2).toUpperCase()}</span>
                        <span>{s.display_name}</span>
                      </div>
                    </td>
                    <td>{s.supplier_code}</td>
                    <td>{s.contact_name ?? "-"}</td>
                    <td>{s.email ?? "-"}</td>
                    <td>{s.address ?? "-"}</td>
                    <td>{s.phone ?? "-"}</td>
                    <td>
                      <div className="products-page__actions">
                        {canWrite && (
                          <button
                            type="button"
                            className="products-page__icon-btn"
                            onClick={() => {
                              setShowForm(true);
                              setEditingId(s.id);
                              setSupplierCode(s.supplier_code);
                              setDisplayName(s.display_name);
                              setContactName(s.contact_name ?? "");
                              setEmail(s.email ?? "");
                              setPhone(s.phone ?? "");
                              setAddress(s.address ?? "");
                              setStatus(s.status);
                            }}
                          >
                            ✎
                          </button>
                        )}
                        {canDelete && (
                          <button
                            type="button"
                            className="products-page__icon-btn delete"
                            onClick={() => void apiDelete(`/api/v1/suppliers/${s.id}`).then(load)}
                          >
                            🗑
                          </button>
                        )}
                        <button type="button" className="products-page__icon-btn">◉</button>
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

      {canWrite && showForm && (
        <section className="products-modal">
          <div className="products-modal__backdrop" onClick={() => setShowForm(false)} />
          <div className="products-modal__dialog panel" role="dialog" aria-modal="true" aria-label="Supplier form">
            <div className="products-modal__head">
              <h3>{editingId ? "Edit supplier" : "Add supplier"}</h3>
              <button type="button" className="products-modal__close" onClick={() => setShowForm(false)}>✕</button>
            </div>
            <form className="products-modal__grid" onSubmit={onSubmit}>
              <label className="field">
                <span>Supplier code</span>
                <input value={supplierCode} onChange={(e) => setSupplierCode(e.target.value)} required />
              </label>
              <label className="field">
                <span>Display name</span>
                <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
              </label>
              <label className="field">
                <span>Contact name</span>
                <input value={contactName} onChange={(e) => setContactName(e.target.value)} />
              </label>
              <label className="field">
                <span>Email</span>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </label>
              <label className="field">
                <span>Phone</span>
                <input value={phone} onChange={(e) => setPhone(e.target.value)} />
              </label>
              <label className="field">
                <span>Address</span>
                <input value={address} onChange={(e) => setAddress(e.target.value)} />
              </label>
              <label className="field">
                <span>Status</span>
                <select value={status} onChange={(e) => setStatus(e.target.value as SupplierStatus)}>
                  <option value="active">active</option>
                  <option value="inactive">inactive</option>
                  <option value="deleted">deleted</option>
                </select>
              </label>
              <button type="submit" className="btn btn-primary btn-block products-modal__submit" disabled={saving}>
                {editingId ? "Save supplier" : "Create supplier"}
              </button>
            </form>
          </div>
        </section>
      )}
    </div>
  );
}
