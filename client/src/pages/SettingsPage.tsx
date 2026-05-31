import { FormEvent, useEffect, useMemo, useState } from "react";
import { apiGet, apiPatch } from "../api/client";
import { useAuth } from "../auth/AuthContext";

type AppSettings = {
  store_timezone: string;
  default_low_stock_threshold: number;
  default_expiry_warning_days: number;
  app_name: string;
  logo_url: string | null;
  primary_color_hex: string;
  password_min_length: number;
};

type Category = {
  id: string;
  name: string;
  parent_id: string | null;
  sort_order: number;
  is_active: boolean;
};

type CategoryOverrides = {
  category_id: string;
  low_stock_threshold: number | null;
  expiry_warning_days: number | null;
};

const defaultSettings: AppSettings = {
  store_timezone: "UTC",
  default_low_stock_threshold: 10,
  default_expiry_warning_days: 7,
  app_name: "Hasu Inventory",
  logo_url: null,
  primary_color_hex: "#5B21B6",
  password_min_length: 8,
};

export function SettingsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);

  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [overrides, setOverrides] = useState<CategoryOverrides | null>(null);
  const [overrideLow, setOverrideLow] = useState<string>("");
  const [overrideExpiry, setOverrideExpiry] = useState<string>("");

  const activeCategories = useMemo(
    () => categories.filter((c) => c.is_active).sort((a, b) => a.sort_order - b.sort_order),
    [categories]
  );

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [s, c] = await Promise.all([
          apiGet<AppSettings>("/api/v1/settings"),
          apiGet<{ items: Category[] }>("/api/v1/categories?include_inactive=true"),
        ]);
        if (!cancelled) {
          setSettings({
            ...defaultSettings,
            ...s,
          });
          setCategories(c.items);
          if (c.items.length) {
            setSelectedCategoryId(c.items[0]!.id);
          }
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load settings");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin || !selectedCategoryId) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await apiGet<CategoryOverrides>(
          `/api/v1/category-settings/${selectedCategoryId}`
        );
        if (!cancelled) {
          setOverrides(data);
          setOverrideLow(
            data.low_stock_threshold === null ? "" : String(data.low_stock_threshold)
          );
          setOverrideExpiry(
            data.expiry_warning_days === null ? "" : String(data.expiry_warning_days)
          );
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load overrides");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAdmin, selectedCategoryId]);

  if (!isAdmin) {
    return <p className="text-error">You need admin access to manage settings.</p>;
  }

  async function saveSettings(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const payload = {
        store_timezone: settings.store_timezone,
        default_low_stock_threshold: Number(settings.default_low_stock_threshold),
        default_expiry_warning_days: Number(settings.default_expiry_warning_days),
        app_name: settings.app_name,
        logo_url: settings.logo_url?.trim() ? settings.logo_url.trim() : null,
        primary_color_hex: settings.primary_color_hex,
        password_min_length: Number(settings.password_min_length),
      };
      const updated = await apiPatch<AppSettings>("/api/v1/settings", payload);
      setSettings({ ...defaultSettings, ...updated });
      setSuccess("Settings saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  async function saveCategoryOverrides(e: FormEvent) {
    e.preventDefault();
    if (!selectedCategoryId) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const payload = {
        low_stock_threshold: overrideLow.trim() === "" ? null : Number(overrideLow),
        expiry_warning_days: overrideExpiry.trim() === "" ? null : Number(overrideExpiry),
      };
      const updated = await apiPatch<CategoryOverrides>(
        `/api/v1/category-settings/${selectedCategoryId}`,
        payload
      );
      setOverrides(updated);
      setOverrideLow(
        updated.low_stock_threshold === null ? "" : String(updated.low_stock_threshold)
      );
      setOverrideExpiry(
        updated.expiry_warning_days === null ? "" : String(updated.expiry_warning_days)
      );
      setSuccess("Category override saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save category override");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="stack">
      <section className="panel">
        <h2>Settings</h2>
        <p className="text-muted">
          Configure defaults, timezone, branding, and category-level threshold overrides.
        </p>
        {error && <p className="text-error">{error}</p>}
        {success && <p className="text-success">{success}</p>}
      </section>

      {loading ? (
        <section className="panel">
          <p className="text-muted">Loading settings…</p>
        </section>
      ) : (
        <>
          <section className="panel">
            <h3>Global settings</h3>
            <form className="users-form-grid" onSubmit={saveSettings}>
              <label className="field">
                <span>Store timezone</span>
                <input
                  value={settings.store_timezone}
                  onChange={(e) =>
                    setSettings((s) => ({ ...s, store_timezone: e.target.value }))
                  }
                  required
                />
              </label>
              <label className="field">
                <span>Default low-stock threshold</span>
                <input
                  type="number"
                  min={0}
                  value={settings.default_low_stock_threshold}
                  onChange={(e) =>
                    setSettings((s) => ({
                      ...s,
                      default_low_stock_threshold: Number(e.target.value),
                    }))
                  }
                  required
                />
              </label>
              <label className="field">
                <span>Default expiry warning days</span>
                <input
                  type="number"
                  min={0}
                  value={settings.default_expiry_warning_days}
                  onChange={(e) =>
                    setSettings((s) => ({
                      ...s,
                      default_expiry_warning_days: Number(e.target.value),
                    }))
                  }
                  required
                />
              </label>
              <label className="field">
                <span>Password min length</span>
                <input
                  type="number"
                  min={8}
                  max={128}
                  value={settings.password_min_length}
                  onChange={(e) =>
                    setSettings((s) => ({
                      ...s,
                      password_min_length: Number(e.target.value),
                    }))
                  }
                  required
                />
              </label>
              <label className="field">
                <span>App name</span>
                <input
                  value={settings.app_name}
                  onChange={(e) => setSettings((s) => ({ ...s, app_name: e.target.value }))}
                  required
                />
              </label>
              <label className="field">
                <span>Logo URL (optional)</span>
                <input
                  value={settings.logo_url ?? ""}
                  onChange={(e) => setSettings((s) => ({ ...s, logo_url: e.target.value }))}
                />
              </label>
              <label className="field">
                <span>Primary color (hex)</span>
                <input
                  value={settings.primary_color_hex}
                  onChange={(e) =>
                    setSettings((s) => ({ ...s, primary_color_hex: e.target.value }))
                  }
                  required
                />
              </label>
              <div className="users-actions">
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  Save global settings
                </button>
              </div>
            </form>
          </section>

          <section className="panel">
            <h3>Category threshold overrides</h3>
            <form className="users-form-grid" onSubmit={saveCategoryOverrides}>
              <label className="field">
                <span>Category</span>
                <select
                  value={selectedCategoryId}
                  onChange={(e) => setSelectedCategoryId(e.target.value)}
                >
                  {activeCategories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Low-stock threshold override (blank = use global)</span>
                <input
                  type="number"
                  min={0}
                  value={overrideLow}
                  onChange={(e) => setOverrideLow(e.target.value)}
                />
              </label>
              <label className="field">
                <span>Expiry warning days override (blank = use global)</span>
                <input
                  type="number"
                  min={0}
                  value={overrideExpiry}
                  onChange={(e) => setOverrideExpiry(e.target.value)}
                />
              </label>
              <div className="users-actions">
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={saving || !selectedCategoryId}
                >
                  Save category override
                </button>
                {overrides && (
                  <span className="text-muted">
                    Current: low={overrides.low_stock_threshold ?? "global"}, expiry=
                    {overrides.expiry_warning_days ?? "global"}
                  </span>
                )}
              </div>
            </form>
          </section>
        </>
      )}
    </div>
  );
}
