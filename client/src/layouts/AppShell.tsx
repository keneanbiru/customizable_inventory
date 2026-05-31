import { useEffect, useState, type ReactNode } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { apiGet } from "../api/client";
import { AlertsPage } from "../pages/AlertsPage";
import { HealthCheck } from "../pages/HealthCheck";
import { CategoriesPage } from "../pages/CategoriesPage";
import { ProductsPage } from "../pages/ProductsPage";
import { SettingsPage } from "../pages/SettingsPage";
import { SuppliersPage } from "../pages/SuppliersPage";
import { TransactionsPage } from "../pages/TransactionsPage";
import { UsersPage } from "../pages/UsersPage";
import { WarehousesPage } from "../pages/WarehousesPage";
import type { AuthUser } from "../auth/AuthContext";

type NavItem = {
  to: string;
  label: string;
  end?: boolean;
  disabled?: boolean;
  visibleTo?: Array<AuthUser["role"]>;
};

const coreNav: NavItem[] = [
  { to: "/app", label: "Overview", end: true },
  { to: "/app/alerts", label: "Alerts", disabled: false },
  { to: "/app/products", label: "Products", disabled: false },
  { to: "/app/transactions", label: "Transactions", disabled: false },
  { to: "/app/suppliers", label: "Supplier", disabled: false, visibleTo: ["admin", "manager"] },
  { to: "/app/categories", label: "Category", disabled: false },
  { to: "/app/warehouses", label: "Warehouse", disabled: false, visibleTo: ["admin", "manager"] },
  { to: "/app/settings", label: "Settings", disabled: false, visibleTo: ["admin"] },
];

export function AppShell() {
  const { user, logout, config } = useAuth();
  const [openAlertCount, setOpenAlertCount] = useState(0);
  const role = user?.role;
  const nav: NavItem[] = [
    ...coreNav,
    { to: "/app/users", label: "Roles", disabled: false, visibleTo: ["admin"] },
  ].filter((item) => !item.visibleTo || (role ? item.visibleTo.includes(role) : false));

  useEffect(() => {
    let disposed = false;
    async function loadCount() {
      try {
        const data = await apiGet<{ open_count: number }>("/api/v1/alerts/count");
        if (!disposed) setOpenAlertCount(data.open_count);
      } catch {
        if (!disposed) setOpenAlertCount(0);
      }
    }
    void loadCount();
    const timer = setInterval(() => {
      void loadCount();
    }, 30000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, []);

  return (
    <div className="app-shell">
      <aside className="app-shell__sidebar" aria-label="Main navigation">
        <div className="app-shell__brand">{config?.appName ?? "Hasu Inventory"}</div>
        <input className="app-shell__search" type="search" placeholder="Search (M6)" disabled />
        <nav className="app-shell__nav">
          {nav.map((item) =>
            item.disabled ? (
              <span
                key={item.to + item.label}
                className="app-shell__nav-link app-shell__nav-link--disabled"
                title="Coming in a later milestone"
              >
                {item.label}
              </span>
            ) : (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `app-shell__nav-link${isActive ? " active" : ""}`
                }
              >
                {item.label}
                {item.to === "/app/alerts" && openAlertCount > 0 ? ` (${openAlertCount})` : ""}
              </NavLink>
            )
          )}
        </nav>
        <div className="app-shell__user">
          <div className="app-shell__user-name">{user?.display_name ?? user?.email}</div>
          <div className="text-muted app-shell__user-role">{user?.role}</div>
          <button type="button" className="link-button" onClick={() => void logout()}>
            Log out
          </button>
        </div>
      </aside>
      <div className="app-shell__main">
        <header className="app-shell__header">
          <h1>Welcome back{user?.display_name ? `, ${user.display_name}` : ""}</h1>
        </header>
        <Routes>
          <Route index element={<HealthCheck />} />
          <Route path="alerts" element={<AlertsPage />} />
          <Route path="products" element={<ProductsPage />} />
          <Route path="transactions" element={<TransactionsPage />} />
          <Route path="suppliers" element={<RoleGate allow={["admin", "manager"]}><SuppliersPage /></RoleGate>} />
          <Route path="categories" element={<CategoriesPage />} />
          <Route path="warehouses" element={<RoleGate allow={["admin", "manager"]}><WarehousesPage /></RoleGate>} />
          <Route path="settings" element={<RoleGate allow={["admin"]}><SettingsPage /></RoleGate>} />
          <Route path="users" element={<RoleGate allow={["admin"]}><UsersPage /></RoleGate>} />
        </Routes>
      </div>
    </div>
  );
}

function RoleGate({
  allow,
  children,
}: {
  allow: Array<AuthUser["role"]>;
  children: ReactNode;
}) {
  const { user } = useAuth();
  if (!user || !allow.includes(user.role)) {
    return <p className="text-muted">This section is not available for your role.</p>;
  }
  return <>{children}</>;
}
