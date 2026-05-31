import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { apiGet, apiPatch, apiPost } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useSearchParams } from "react-router-dom";

type Product = {
  id: string;
  sku: string;
  name: string;
  category_id?: string;
  warehouse_id?: string | null;
  supplier_name?: string | null;
  category_name: string;
  unit_name: string;
  quantity_on_hand: string;
  reorder_level?: string | null;
  selling_price: string | null;
  is_active: boolean;
  created_at?: string;
};

type ProductListResponse = {
  items: Product[];
};

type MetadataItem = {
  id: string;
  name: string;
};

type MetadataResponse = {
  items: MetadataItem[];
};

type CustomField = {
  id: string;
  key: string;
  value: string;
};

export function ProductsPage() {
  type ProductPeriod = "1d" | "7d" | "1m" | "3m" | "6m" | "1y" | "3y" | "5y";
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const canWrite = user?.role === "admin" || user?.role === "manager";
  const canAdjustStock =
    user?.role === "admin" || user?.role === "manager" || user?.role === "store_keeper";

  const [items, setItems] = useState<Product[]>([]);
  const [categories, setCategories] = useState<MetadataItem[]>([]);
  const [units, setUnits] = useState<MetadataItem[]>([]);
  const [warehouses, setWarehouses] = useState<MetadataItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [showStockPanel, setShowStockPanel] = useState(false);
  const [showDatesPanel, setShowDatesPanel] = useState(false);
  const [showFiltersPanel, setShowFiltersPanel] = useState(false);
  const [period, setPeriod] = useState<ProductPeriod>("1m");
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  const [onlyActive, setOnlyActive] = useState(true);
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [filterCategoryId, setFilterCategoryId] = useState(() => searchParams.get("category_id") ?? "");
  const [filterWarehouseId, setFilterWarehouseId] = useState(
    () => searchParams.get("warehouse_id") ?? ""
  );
  const [page, setPage] = useState(1);
  const pageSize = 8;

  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [unitId, setUnitId] = useState("");
  const [sellingPrice, setSellingPrice] = useState("");
  const [supplierIdInput, setSupplierIdInput] = useState("");
  const [warningThreshold, setWarningThreshold] = useState("");
  const [autoOrderLevel, setAutoOrderLevel] = useState("");
  const [barcode, setBarcode] = useState("");
  const [grnNumber, setGrnNumber] = useState("");
  const [purchasePrice, setPurchasePrice] = useState("");
  const [sellingMargin, setSellingMargin] = useState("");
  const [weight, setWeight] = useState("");
  const [dimensionUnit, setDimensionUnit] = useState("inch");
  const [dimensions, setDimensions] = useState("");
  const [description, setDescription] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [stockProductId, setStockProductId] = useState("");
  const [stockWarehouseId, setStockWarehouseId] = useState("");
  const [stockType, setStockType] = useState<"in" | "out" | "adjust">("in");
  const [stockQuantity, setStockQuantity] = useState("");
  const [stockQuantityAfter, setStockQuantityAfter] = useState("");
  const [stockNote, setStockNote] = useState("");
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [importing, setImporting] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [productsRes, categoriesRes, unitsRes, warehousesRes] = await Promise.all([
        apiGet<ProductListResponse>("/api/v1/products?page_size=100"),
        apiGet<MetadataResponse>("/api/v1/categories?page_size=200"),
        apiGet<MetadataResponse>("/api/v1/units?page_size=200"),
        apiGet<MetadataResponse>("/api/v1/warehouses?page_size=200"),
      ]);
      setItems(productsRes.items);
      setCategories(categoriesRes.items);
      setUnits(unitsRes.items);
      setWarehouses(warehousesRes.items);
      if (!categoryId && categoriesRes.items[0]) setCategoryId(categoriesRes.items[0].id);
      if (!unitId && unitsRes.items[0]) setUnitId(unitsRes.items[0].id);
      if (!warehouseId && warehousesRes.items[0]) setWarehouseId(warehousesRes.items[0].id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load products");
    } finally {
      setLoading(false);
    }
  }, [categoryId, unitId, warehouseId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const categoryFromUrl = searchParams.get("category_id") ?? "";
    const warehouseFromUrl = searchParams.get("warehouse_id") ?? "";
    setFilterCategoryId(categoryFromUrl);
    setFilterWarehouseId(warehouseFromUrl);
    setPage(1);
  }, [searchParams]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canWrite) return;
    setSaving(true);
    setError(null);
    try {
      await apiPost("/api/v1/products", {
        sku: sku.trim(),
        name: name.trim(),
        description: description.trim() || null,
        category_id: categoryId,
        unit_id: unitId,
        warehouse_id: warehouseId,
        expiry_date: expiryDate.trim() || null,
        cost_price: purchasePrice.trim() ? Number(purchasePrice) : null,
        selling_price: sellingPrice.trim() ? Number(sellingPrice) : null,
        reorder_level: autoOrderLevel.trim() ? Number(autoOrderLevel) : null,
        low_stock_threshold: warningThreshold.trim() ? Number(warningThreshold) : null,
      });
      setSku("");
      setName("");
      setSellingPrice("");
      setSupplierIdInput("");
      setWarningThreshold("");
      setAutoOrderLevel("");
      setBarcode("");
      setGrnNumber("");
      setPurchasePrice("");
      setSellingMargin("");
      setWeight("");
      setDimensionUnit("inch");
      setDimensions("");
      setDescription("");
      setExpiryDate("");
      setWarehouseId((prev) => prev || warehouses[0]?.id || "");
      setCustomFields([]);
      setShowCreate(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create product");
    } finally {
      setSaving(false);
    }
  }

  async function onStockSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canAdjustStock || !stockProductId) return;
    setSaving(true);
    setError(null);
    try {
      if (stockType === "adjust" && stockQuantityAfter.trim()) {
        await apiPost(`/api/v1/products/${stockProductId}/stock/adjust`, {
          quantity_after: Number(stockQuantityAfter),
          note: stockNote.trim() || null,
          warehouse_id: stockWarehouseId,
        });
      } else {
        const endpoint =
          stockType === "in"
            ? `/api/v1/products/${stockProductId}/stock/in`
            : stockType === "out"
              ? `/api/v1/products/${stockProductId}/stock/out`
              : `/api/v1/products/${stockProductId}/stock/adjust`;
        await apiPost(endpoint, {
          quantity: Number(stockQuantity),
          delta: stockType === "adjust" ? Number(stockQuantity) : undefined,
          note: stockNote.trim() || null,
          warehouse_id: stockWarehouseId,
        });
      }
      setStockQuantity("");
      setStockQuantityAfter("");
      setStockNote("");
      setStockWarehouseId("");
      setShowStockPanel(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to apply stock change");
    } finally {
      setSaving(false);
    }
  }

  function openStockModal(productId: string, initialType: "in" | "out" | "adjust" = "in") {
    setStockProductId(productId);
    setStockWarehouseId(items.find((p) => p.id === productId)?.warehouse_id ?? warehouses[0]?.id ?? "");
    setStockType(initialType);
    setShowStockPanel(true);
  }

  function addCustomField() {
    setCustomFields((prev) => [...prev, { id: crypto.randomUUID(), key: "", value: "" }]);
  }

  async function onBulkUploadSelected(file: File | null) {
    if (!file || !canWrite) return;
    setImporting(true);
    setError(null);
    try {
      const text = await file.text();
      const lines = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      if (lines.length < 2) throw new Error("CSV must include header and at least one data row");
      const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
      const idx = {
        sku: headers.indexOf("sku"),
        name: headers.indexOf("name"),
        category: headers.indexOf("category"),
        unit: headers.indexOf("unit"),
        selling_price: headers.indexOf("selling_price"),
      };
      if (idx.sku < 0 || idx.name < 0 || idx.category < 0 || idx.unit < 0) {
        throw new Error("CSV header must include: sku,name,category,unit (selling_price optional)");
      }

      let created = 0;
      for (let i = 1; i < lines.length; i += 1) {
        const cols = lines[i].split(",").map((c) => c.trim());
        const skuV = cols[idx.sku] ?? "";
        const nameV = cols[idx.name] ?? "";
        const categoryName = cols[idx.category] ?? "";
        const unitName = cols[idx.unit] ?? "";
        const sellingV = idx.selling_price >= 0 ? cols[idx.selling_price] : "";
        if (!skuV || !nameV || !categoryName || !unitName) continue;

        const category = categories.find((c) => c.name.toLowerCase() === categoryName.toLowerCase());
        const unit = units.find((u) => u.name.toLowerCase() === unitName.toLowerCase());
        if (!category || !unit) continue;

        await apiPost("/api/v1/products", {
          sku: skuV,
          name: nameV,
          category_id: category.id,
          unit_id: unit.id,
          warehouse_id: warehouseId,
          selling_price: sellingV ? Number(sellingV) : null,
        });
        created += 1;
      }
      if (!created) throw new Error("No valid rows imported. Check category/unit names in CSV.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bulk upload failed");
    } finally {
      setImporting(false);
      if (uploadInputRef.current) uploadInputRef.current.value = "";
    }
  }

  function exportCsv() {
    const rows = items.map((item) =>
      [
        item.name,
        item.sku,
        item.supplier_name ?? "",
        item.category_name,
        item.selling_price ?? "",
        item.unit_name,
        item.quantity_on_hand,
        item.reorder_level ?? "",
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(",")
    );
    const csv = [
      "product_name,product_id,supplier_id,category,price,weight,stock_level,rec_level",
      ...rows,
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "products.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const filteredItems = items.filter((item) => {
    const q = search.trim().toLowerCase();
    const matchesSearch =
      item.name.toLowerCase().includes(q) ||
      item.sku.toLowerCase().includes(q) ||
      (item.category_name ?? "").toLowerCase().includes(q);
    if (!matchesSearch) return false;
    if (onlyActive && !item.is_active) return false;
    if (lowStockOnly) {
      const qoh = Number(item.quantity_on_hand ?? 0);
      const rl = Number(item.reorder_level ?? 0);
      if (!(qoh <= rl && rl > 0)) return false;
    }
    if (filterCategoryId && item.category_id !== filterCategoryId) return false;
    if (filterWarehouseId && item.warehouse_id !== filterWarehouseId) return false;
    const createdAt = item.created_at ? new Date(item.created_at).getTime() : null;
    if (createdAt && rangeStart && rangeEnd) {
      const s = new Date(rangeStart).getTime();
      const e = new Date(rangeEnd).getTime();
      if (!(createdAt >= s && createdAt <= e)) return false;
    } else if (createdAt) {
      const now = Date.now();
      const msByPeriod: Record<ProductPeriod, number> = {
        "1d": 24 * 60 * 60 * 1000,
        "7d": 7 * 24 * 60 * 60 * 1000,
        "1m": 30 * 24 * 60 * 60 * 1000,
        "3m": 90 * 24 * 60 * 60 * 1000,
        "6m": 180 * 24 * 60 * 60 * 1000,
        "1y": 365 * 24 * 60 * 60 * 1000,
        "3y": 3 * 365 * 24 * 60 * 60 * 1000,
        "5y": 5 * 365 * 24 * 60 * 60 * 1000,
      };
      if (createdAt < now - msByPeriod[period]) return false;
    }
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedItems = filteredItems.slice((safePage - 1) * pageSize, safePage * pageSize);

  async function softDeleteProduct(productId: string) {
    if (!canWrite) return;
    setSaving(true);
    setError(null);
    try {
      await apiPatch(`/api/v1/products/${productId}`, { is_active: false });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to deactivate product");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="stack products-page">
      <a className="products-page__back" href="/app">
        ← Back
      </a>
      <div className="products-page__head">
        <h2>Products</h2>
        <div className="overview__periods">
          {(["1d", "7d", "1m", "3m", "6m", "1y", "3y", "5y"] as ProductPeriod[]).map((p) => (
            <button
              key={p}
              type="button"
              className={`overview__chip${period === p ? " active" : ""}`}
              onClick={() => {
                setPeriod(p);
                setPage(1);
              }}
            >
              {p}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="overview__action-btn"
          onClick={() => {
            setShowDatesPanel((v) => !v);
            setShowFiltersPanel(false);
          }}
        >
          Select dates
        </button>
      </div>

      {showDatesPanel && (
        <section className="panel overview__control-panel">
          <h3>Select Date Range</h3>
          <div className="overview__date-row">
            <label className="field">
              <span>From</span>
              <input type="datetime-local" value={rangeStart} onChange={(e) => setRangeStart(e.target.value)} />
            </label>
            <label className="field">
              <span>To</span>
              <input type="datetime-local" value={rangeEnd} onChange={(e) => setRangeEnd(e.target.value)} />
            </label>
            <div className="users-actions">
              <button type="button" className="btn btn-primary" onClick={() => setShowDatesPanel(false)}>
                Apply
              </button>
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => {
                  setRangeStart("");
                  setRangeEnd("");
                  setShowDatesPanel(false);
                }}
              >
                Clear
              </button>
            </div>
          </div>
        </section>
      )}

      <section className="panel products-page__table-panel">
        <div className="products-page__toolbar">
          <div className="products-page__left-tools">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search"
              className="products-page__search"
            />
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => {
                setShowFiltersPanel((v) => !v);
                setShowDatesPanel(false);
              }}
            >
              Filters
            </button>
          </div>
          <div className="products-page__right-tools">
            {canWrite && (
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => setShowCreate((v) => !v)}
              >
                + Add New Product
              </button>
            )}
            <button type="button" className="btn btn-primary" onClick={exportCsv}>
              Export
            </button>
          </div>
        </div>
        {showFiltersPanel && (
          <section className="overview__control-panel">
            <h3>Product Filters</h3>
            <div className="overview__check-grid">
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={onlyActive}
                  onChange={(e) => {
                    setOnlyActive(e.target.checked);
                    setPage(1);
                  }}
                />
                Active products only
              </label>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={lowStockOnly}
                  onChange={(e) => {
                    setLowStockOnly(e.target.checked);
                    setPage(1);
                  }}
                />
                Low stock only
              </label>
            </div>
            <div className="overview__date-row">
              <label className="field">
                <span>Category</span>
                <select
                  value={filterCategoryId}
                  onChange={(e) => {
                    setFilterCategoryId(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">All categories</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Warehouse</span>
                <select
                  value={filterWarehouseId}
                  onChange={(e) => {
                    setFilterWarehouseId(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">All warehouses</option>
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="users-actions">
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => {
                    setFilterCategoryId("");
                    setFilterWarehouseId("");
                    setPage(1);
                  }}
                >
                  Clear category/warehouse
                </button>
              </div>
            </div>
          </section>
        )}
        {error && <p className="text-error">{error}</p>}
        {loading ? (
          <p className="text-muted">Loading...</p>
        ) : (
          <div className="users-table-wrap">
            <table className="users-table products-page__table">
              <thead>
                <tr>
                  <th />
                  <th>Product Name</th>
                  <th>Product ID</th>
                  <th>Supplier ID</th>
                  <th>Category</th>
                  <th>Price</th>
                  <th>Weight</th>
                  <th>Stock Level (in units)</th>
                  <th>Rec. Level (in units)</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pagedItems.map((product) => (
                  <tr key={product.id}>
                    <td>
                      <input type="checkbox" />
                    </td>
                    <td>
                      <div className="products-page__name-cell">
                        <span className="products-page__avatar">
                          {product.name.slice(0, 2).toUpperCase()}
                        </span>
                        <span>{product.name}</span>
                      </div>
                    </td>
                    <td>{product.sku}</td>
                    <td>{product.supplier_name ?? "-"}</td>
                    <td>{product.category_name}</td>
                    <td>{product.selling_price ? `$${product.selling_price}` : "-"}</td>
                    <td>{product.unit_name}</td>
                    <td>{product.quantity_on_hand}</td>
                    <td>{product.reorder_level ?? "-"}</td>
                    <td>
                      <div className="products-page__actions">
                        {canAdjustStock && (
                          <>
                            <button
                              type="button"
                              className="products-page__stock-btn stock-in"
                              title="Stock in"
                              onClick={() => openStockModal(product.id, "in")}
                            >
                              Stock In
                            </button>
                            <button
                              type="button"
                              className="products-page__stock-btn stock-out"
                              title="Stock out"
                              onClick={() => openStockModal(product.id, "out")}
                            >
                              Stock Out
                            </button>
                            <button
                              type="button"
                              className="products-page__stock-btn stock-adjust"
                              title="Adjust stock"
                              onClick={() => openStockModal(product.id, "adjust")}
                            >
                              Adjust
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          className="products-page__icon-btn delete"
                          title="Delete"
                          onClick={() => void softDeleteProduct(product.id)}
                          disabled={saving}
                        >
                          🗑
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!filteredItems.length && (
                  <tr>
                    <td colSpan={10} className="text-muted">
                      No products found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        <div className="products-page__pagination">
          <button
            type="button"
            className="btn btn-outline"
            disabled={safePage <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            ← Previous
          </button>
          <div className="products-page__pages">
            {Array.from({ length: totalPages }).map((_, idx) => {
              const n = idx + 1;
              return (
                <button
                  key={n}
                  type="button"
                  className={`overview__chip${n === safePage ? " active" : ""}`}
                  onClick={() => setPage(n)}
                >
                  {n}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            className="btn btn-outline"
            disabled={safePage >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            Next →
          </button>
        </div>
      </section>

      {canWrite && showCreate && (
        <section className="products-modal">
          <div className="products-modal__backdrop" onClick={() => setShowCreate(false)} />
          <div className="products-modal__dialog panel" role="dialog" aria-modal="true" aria-label="Add new product">
            <div className="products-modal__head">
              <h3>Add new product</h3>
              <div className="products-modal__head-actions">
                <button type="button" className="btn btn-outline" onClick={addCustomField}>+ Add Custom Field</button>
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => uploadInputRef.current?.click()}
                  disabled={importing}
                >
                  {importing ? "Uploading..." : "⇪ Bulk Upload"}
                </button>
                <input
                  ref={uploadInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  style={{ display: "none" }}
                  onChange={(e) => void onBulkUploadSelected(e.target.files?.[0] ?? null)}
                />
                <button type="button" className="products-modal__close" onClick={() => setShowCreate(false)}>
                  ✕
                </button>
              </div>
            </div>
            <form className="products-modal__grid" onSubmit={onSubmit}>
              <label className="field">
                <span>Product Name</span>
                <input placeholder="Ex: Cola 1.5L" value={name} onChange={(e) => setName(e.target.value)} required />
              </label>
              <label className="field">
                <span>Supplier ID</span>
                <input placeholder="Ex: TUV10234" value={supplierIdInput} onChange={(e) => setSupplierIdInput(e.target.value)} />
              </label>
              <label className="field">
                <span>Weight (in lbs)</span>
                <input placeholder="Enter Weight here" value={weight} onChange={(e) => setWeight(e.target.value)} />
              </label>

              <label className="field">
                <span>Category</span>
                <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} required>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Dimension Unit</span>
                <select value={dimensionUnit} onChange={(e) => setDimensionUnit(e.target.value)}>
                  <option value="inch">inch</option>
                  <option value="cm">cm</option>
                </select>
              </label>
              <label className="field">
                <span>Dimensions (L x B x H)</span>
                <input placeholder="20 × 30 × 40" value={dimensions} onChange={(e) => setDimensions(e.target.value)} />
              </label>

              <label className="field">
                <span>Unit</span>
                <select value={unitId} onChange={(e) => setUnitId(e.target.value)} required>
                  {units.map((u) => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Warehouse</span>
                <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} required>
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>SKU Code</span>
                <input placeholder="Ex: PRD-0001" value={sku} onChange={(e) => setSku(e.target.value)} required />
              </label>
              <label className="field">
                <span>Barcode Number</span>
                <input placeholder="QWERTY0987" value={barcode} onChange={(e) => setBarcode(e.target.value)} />
              </label>
              <label className="field">
                <span>GRN Number (Optional)</span>
                <input placeholder="QWERTY56787" value={grnNumber} onChange={(e) => setGrnNumber(e.target.value)} />
              </label>

              <label className="field">
                <span>Purchasing Price</span>
                <input type="number" min="0" step="0.01" placeholder="Ex: 100" value={purchasePrice} onChange={(e) => setPurchasePrice(e.target.value)} />
              </label>
              <label className="field">
                <span>Selling Price</span>
                <input type="number" min="0" step="0.01" placeholder="Ex: 120" value={sellingPrice} onChange={(e) => setSellingPrice(e.target.value)} />
              </label>
              <label className="field">
                <span>Selling Price Margin</span>
                <input placeholder="Ex: 20%" value={sellingMargin} onChange={(e) => setSellingMargin(e.target.value)} />
              </label>

              <label className="field products-modal__image-box">
                <span>Insert Image (400px x 400 px)</span>
                <div className="products-modal__image-placeholder">＋</div>
              </label>

              <label className="field">
                <span>Warning Threshold Stock Level</span>
                <input type="number" min="0" step="0.001" placeholder="Ex: 100" value={warningThreshold} onChange={(e) => setWarningThreshold(e.target.value)} />
              </label>
              <label className="field">
                <span>Auto Order Stock Level</span>
                <input type="number" min="0" step="0.001" placeholder="Ex: 50" value={autoOrderLevel} onChange={(e) => setAutoOrderLevel(e.target.value)} />
              </label>
              <label className="field">
                <span>Expiry Date</span>
                <input
                  type="date"
                  value={expiryDate}
                  onChange={(e) => setExpiryDate(e.target.value)}
                />
              </label>

              <label className="field products-modal__full">
                <span>Product Description</span>
                <input placeholder="Ex: Type something about product here" value={description} onChange={(e) => setDescription(e.target.value)} />
              </label>

              {customFields.map((field) => (
                <div key={field.id} className="products-modal__full products-modal__custom-row">
                  <input
                    placeholder="Custom field name"
                    value={field.key}
                    onChange={(e) =>
                      setCustomFields((prev) =>
                        prev.map((x) => (x.id === field.id ? { ...x, key: e.target.value } : x))
                      )
                    }
                  />
                  <input
                    placeholder="Custom field value"
                    value={field.value}
                    onChange={(e) =>
                      setCustomFields((prev) =>
                        prev.map((x) => (x.id === field.id ? { ...x, value: e.target.value } : x))
                      )
                    }
                  />
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={() => setCustomFields((prev) => prev.filter((x) => x.id !== field.id))}
                  >
                    Remove
                  </button>
                </div>
              ))}

              <button type="submit" className="btn btn-primary btn-block products-modal__submit" disabled={saving}>
                {saving ? "Saving..." : "Add Product"}
              </button>
            </form>
          </div>
        </section>
      )}

      {canAdjustStock && stockProductId && showStockPanel && (
        <section className="products-modal">
          <div
            className="products-modal__backdrop"
            onClick={() => {
              setShowStockPanel(false);
              setStockProductId("");
            }}
          />
          <div className="products-modal__dialog panel" role="dialog" aria-modal="true" aria-label="Stock movement">
            <div className="products-modal__head">
              <h3>Stock movement</h3>
              <button
                type="button"
                className="products-modal__close"
                onClick={() => {
                  setShowStockPanel(false);
                  setStockProductId("");
                }}
              >
                ✕
              </button>
            </div>
            <form className="products-modal__grid" onSubmit={onStockSubmit}>
              <label className="field">
                <span>Type</span>
                <select
                  value={stockType}
                  onChange={(e) => setStockType(e.target.value as "in" | "out" | "adjust")}
                >
                  <option value="in">Stock in</option>
                  <option value="out">Stock out</option>
                  <option value="adjust">Adjust</option>
                </select>
              </label>
              <label className="field">
                <span>Warehouse</span>
                <select
                  value={stockWarehouseId}
                  onChange={(e) => setStockWarehouseId(e.target.value)}
                  required
                >
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>{stockType === "adjust" ? "Delta (optional)" : "Quantity"}</span>
                <input
                  type="number"
                  step="0.001"
                  min={stockType === "adjust" ? undefined : "0"}
                  value={stockQuantity}
                  onChange={(e) => setStockQuantity(e.target.value)}
                  required={stockType !== "adjust"}
                />
              </label>
              {stockType === "adjust" ? (
                <label className="field">
                  <span>Or set quantity after</span>
                  <input
                    type="number"
                    step="0.001"
                    min="0"
                    value={stockQuantityAfter}
                    onChange={(e) => setStockQuantityAfter(e.target.value)}
                  />
                </label>
              ) : (
                <div />
              )}
              <label className="field products-modal__full">
                <span>Note</span>
                <input value={stockNote} onChange={(e) => setStockNote(e.target.value)} />
              </label>
              <button type="submit" className="btn btn-primary btn-block products-modal__submit" disabled={saving}>
                {saving ? "Saving..." : "Apply stock change"}
              </button>
            </form>
          </div>
        </section>
      )}
    </div>
  );
}
