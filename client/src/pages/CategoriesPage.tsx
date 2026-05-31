import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { apiDelete, apiGet, apiPatch, apiPost } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useNavigate } from "react-router-dom";

type Category = {
  id: string;
  name: string;
  parent_id: string | null;
  sort_order: number;
  is_active: boolean;
  product_count: number;
  active_product_count: number;
};

type Unit = {
  id: string;
  name: string;
  code: string;
  allows_fractional: boolean;
  is_active: boolean;
};

type Tab = "categories" | "units";

export function CategoriesPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [tab] = useState<Tab>("categories");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [showCategoryForm, setShowCategoryForm] = useState(false);

  const [categories, setCategories] = useState<Category[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);

  const [name, setName] = useState("");
  const [parentId, setParentId] = useState("");
  const [sortOrder, setSortOrder] = useState(0);
  const [active, setActive] = useState(true);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);

  const [unitName, setUnitName] = useState("");
  const [unitCode, setUnitCode] = useState("");
  const [allowsFractional, setAllowsFractional] = useState(false);
  const [unitActive, setUnitActive] = useState(true);
  const [editingUnitId, setEditingUnitId] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query = isAdmin ? "?include_inactive=true" : "";
      const [cRes, uRes] = await Promise.all([
        apiGet<{ items: Category[] }>(`/api/v1/categories${query}`),
        apiGet<{ items: Unit[] }>(`/api/v1/units${query}`),
      ]);
      setCategories(cRes.items);
      setUnits(uRes.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load metadata");
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const categoryById = useMemo(() => {
    const map = new Map<string, Category>();
    categories.forEach((c) => map.set(c.id, c));
    return map;
  }, [categories]);

  function resetCategoryForm() {
    setEditingCategoryId(null);
    setName("");
    setParentId("");
    setSortOrder(0);
    setActive(true);
  }

  function resetUnitForm() {
    setEditingUnitId(null);
    setUnitName("");
    setUnitCode("");
    setAllowsFractional(false);
    setUnitActive(true);
  }

  async function submitCategory(e: FormEvent) {
    e.preventDefault();
    if (!isAdmin) return;
    setSaving(true);
    setError(null);
    try {
      const payload = {
        name: name.trim(),
        parent_id: parentId || null,
        sort_order: Number(sortOrder) || 0,
        is_active: active,
      };
      if (editingCategoryId) {
        await apiPatch(`/api/v1/categories/${editingCategoryId}`, payload);
      } else {
        await apiPost("/api/v1/categories", payload);
      }
      resetCategoryForm();
      setShowCategoryForm(false);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save category");
    } finally {
      setSaving(false);
    }
  }

  async function deleteCategory(id: string) {
    if (!isAdmin) return;
    setSaving(true);
    setError(null);
    try {
      await apiDelete(`/api/v1/categories/${id}`);
      if (editingCategoryId === id) resetCategoryForm();
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete category");
    } finally {
      setSaving(false);
    }
  }

  async function submitUnit(e: FormEvent) {
    e.preventDefault();
    if (!isAdmin) return;
    setSaving(true);
    setError(null);
    try {
      const payload = {
        name: unitName.trim(),
        code: unitCode.trim(),
        allows_fractional: allowsFractional,
        is_active: unitActive,
      };
      if (editingUnitId) {
        await apiPatch(`/api/v1/units/${editingUnitId}`, payload);
      } else {
        await apiPost("/api/v1/units", payload);
      }
      resetUnitForm();
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save unit");
    } finally {
      setSaving(false);
    }
  }

  async function deleteUnit(id: string) {
    if (!isAdmin) return;
    setSaving(true);
    setError(null);
    try {
      await apiDelete(`/api/v1/units/${id}`);
      if (editingUnitId === id) resetUnitForm();
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete unit");
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
        <h2>Category</h2>
      </div>
      {error && <p className="text-error">{error}</p>}
      <section className="suppliers-stats">
        <div className="panel suppliers-stat-card active">
          <p className="text-muted">Active Categories</p>
          <p className="suppliers-stat-value">{categories.filter((c) => c.is_active).length}</p>
          <p className="suppliers-stat-delta">↑ 12% vs last month</p>
        </div>
        <div className="panel suppliers-stat-card">
          <p className="text-muted">Inactive Categories</p>
          <p className="suppliers-stat-value">{categories.filter((c) => !c.is_active).length}</p>
          <p className="suppliers-stat-delta">↑ 12% vs last month</p>
        </div>
        <div className="panel suppliers-stat-card">
          <p className="text-muted">Deleted Categories</p>
          <p className="suppliers-stat-value">0</p>
          <p className="suppliers-stat-delta">↑ 12% vs last month</p>
        </div>
      </section>

      {loading ? (
        <section className="panel">
          <p className="text-muted">Loading metadata…</p>
        </section>
      ) : tab === "categories" ? (
        <section className="panel products-page__table-panel">
          <h3>Active Categories</h3>
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
                <button type="button" className="btn btn-outline" onClick={() => setShowCategoryForm(true)}>
                  + Add New Category
                </button>
              )}
              <button type="button" className="btn btn-primary">Export</button>
            </div>
          </div>
          <div className="users-table-wrap">
            <table className="users-table products-page__table">
              <thead>
                <tr>
                  <th />
                  <th>Category Name</th>
                  <th>Category ID</th>
                  <th>Description</th>
                  <th>Products</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {categories
                  .filter((c) => c.name.toLowerCase().includes(search.toLowerCase().trim()))
                  .map((c) => (
                    <tr
                      key={c.id}
                      onClick={() => navigate(`/app/products?category_id=${encodeURIComponent(c.id)}`)}
                      style={{ cursor: "pointer" }}
                      title="View products in this category"
                    >
                      <td><input type="checkbox" onClick={(e) => e.stopPropagation()} /></td>
                      <td>{c.name}</td>
                      <td>{c.id.slice(0, 10).toUpperCase()}</td>
                      <td>{c.parent_id ? `Parent: ${categoryById.get(c.parent_id)?.name ?? "Unknown"}` : "General category"}</td>
                      <td>{c.product_count} total ({c.active_product_count} active)</td>
                      <td>
                        <div className="products-page__actions" onClick={(e) => e.stopPropagation()}>
                          {isAdmin && (
                            <button
                              type="button"
                              className="products-page__icon-btn"
                              onClick={() => {
                                setShowCategoryForm(true);
                                setEditingCategoryId(c.id);
                                setName(c.name);
                                setParentId(c.parent_id ?? "");
                                setSortOrder(c.sort_order);
                                setActive(c.is_active);
                              }}
                            >
                              ✎
                            </button>
                          )}
                          {isAdmin && (
                            <button
                              type="button"
                              className="products-page__icon-btn delete"
                              onClick={() => void deleteCategory(c.id)}
                              disabled={saving}
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
          <div className="products-page__pagination">
            <button type="button" className="btn btn-outline">← Previous</button>
            <div className="products-page__pages">1 2 3 ... 8 9 10</div>
            <button type="button" className="btn btn-outline">Next →</button>
          </div>
        </section>
      ) : (
        <>
          {isAdmin && (
            <section className="panel">
              <h3>{editingUnitId ? "Edit unit" : "Create unit"}</h3>
              <form className="users-form-grid" onSubmit={submitUnit}>
                <label className="field">
                  <span>Name</span>
                  <input value={unitName} onChange={(e) => setUnitName(e.target.value)} required />
                </label>
                <label className="field">
                  <span>Code</span>
                  <input value={unitCode} onChange={(e) => setUnitCode(e.target.value)} required />
                </label>
                <label className="checkbox users-checkbox">
                  <input
                    type="checkbox"
                    checked={allowsFractional}
                    onChange={(e) => setAllowsFractional(e.target.checked)}
                  />
                  Allows fractional quantities
                </label>
                <label className="checkbox users-checkbox">
                  <input
                    type="checkbox"
                    checked={unitActive}
                    onChange={(e) => setUnitActive(e.target.checked)}
                  />
                  Unit is active
                </label>
                <div className="users-actions">
                  <button type="submit" className="btn btn-primary" disabled={saving}>
                    {editingUnitId ? "Save unit" : "Create unit"}
                  </button>
                  {editingUnitId && (
                    <button
                      type="button"
                      className="btn btn-outline"
                      onClick={resetUnitForm}
                      disabled={saving}
                    >
                      Cancel edit
                    </button>
                  )}
                </div>
              </form>
            </section>
          )}

          <section className="panel">
            <h3>Units</h3>
            <div className="users-table-wrap">
              <table className="users-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Code</th>
                    <th>Fractional</th>
                    <th>Status</th>
                    {isAdmin && <th />}
                  </tr>
                </thead>
                <tbody>
                  {units.map((u) => (
                    <tr key={u.id}>
                      <td>{u.name}</td>
                      <td>{u.code}</td>
                      <td>{u.allows_fractional ? "Yes" : "No"}</td>
                      <td>{u.is_active ? "Active" : "Inactive"}</td>
                      {isAdmin && (
                        <td>
                          <div className="users-actions">
                            <button
                              type="button"
                              className="btn btn-outline"
                              onClick={() => {
                                setEditingUnitId(u.id);
                                setUnitName(u.name);
                                setUnitCode(u.code);
                                setAllowsFractional(u.allows_fractional);
                                setUnitActive(u.is_active);
                              }}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="btn btn-outline"
                              onClick={() => void deleteUnit(u.id)}
                              disabled={saving}
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {isAdmin && showCategoryForm && (
        <section className="products-modal">
          <div className="products-modal__backdrop" onClick={() => setShowCategoryForm(false)} />
          <div className="products-modal__dialog panel" role="dialog" aria-modal="true" aria-label="Category form">
            <div className="products-modal__head">
              <h3>{editingCategoryId ? "Edit category" : "Add new category"}</h3>
              <button type="button" className="products-modal__close" onClick={() => setShowCategoryForm(false)}>✕</button>
            </div>
            <form className="products-modal__grid" onSubmit={submitCategory}>
              <label className="field">
                <span>Name</span>
                <input value={name} onChange={(e) => setName(e.target.value)} required />
              </label>
              <label className="field">
                <span>Parent (optional)</span>
                <select value={parentId} onChange={(e) => setParentId(e.target.value)}>
                  <option value="">None</option>
                  {categories
                    .filter((c) => c.id !== editingCategoryId)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="field">
                <span>Sort order</span>
                <input
                  type="number"
                  value={sortOrder}
                  onChange={(e) => setSortOrder(Number(e.target.value))}
                />
              </label>
              <label className="checkbox users-checkbox">
                <input
                  type="checkbox"
                  checked={active}
                  onChange={(e) => setActive(e.target.checked)}
                />
                Category is active
              </label>
              <button type="submit" className="btn btn-primary btn-block products-modal__submit" disabled={saving}>
                {editingCategoryId ? "Save category" : "Create category"}
              </button>
            </form>
          </div>
        </section>
      )}
    </div>
  );
}
