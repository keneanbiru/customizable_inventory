# Hasu Inventory — Milestone Implementation Plan

This document is the **authoritative milestone plan** for the single-store-per-deployment inventory platform: **React** (frontend), **Node.js + Express** (API), **PostgreSQL** (data). Each milestone lists **deliverables**, **database artifacts**, **REST APIs**, **frontend scope**, and **tests** to complete before moving on.

**Global conventions**

- Base path: `/api/v1` (all routes below are relative unless stated).
- Auth: `Authorization: Bearer <JWT>` after M1.
- Roles: `admin`, `manager`, `store_keeper`.
- Stock rule: every quantity change runs in **one DB transaction**: insert `inventory_transactions` + update `products.quantity`.
- Threshold / expiry warning days: **product override → category override → global settings**.

### Reference UI alignment (design mockups)

The **target UX** follows the provided high-fidelity screens: **split-panel auth** (brand left, form right), **purple accent** design system, **persistent sidebar** with global search, and **data-dense** tables, modals, KPI cards, and charts. Product branding (app name, logo) should be **configurable** via settings so each sold deployment can differ without code changes.

| UI area (sidebar / screen) | Plan coverage | Notes |
|----------------------------|---------------|--------|
| Login (email, remember 30d, forgot, Google, sign up) | **M1** (expanded) | Match mockup flows; sign-up policy documented (open vs admin-only). |
| Overview (KPIs, sparklines, sales vs inventory chart, date ranges) | **M6** (expanded) | Aggregation APIs; chart library on client. |
| Products (table, export, add modal, bulk upload, custom fields) | **M4** (expanded) | SKU, barcode, supplier, thresholds, pricing, media, import. |
| Category | **M2** | Same domain; **UI** = dedicated admin page in shell. |
| Supplier | **M3.5** | Full CRUD + stats + export; links to products. |
| Warehouse | **M3.5** | Single default row OK for v1; optional `warehouse_id` on stock/products. |
| Roles | **M1** | User list + role assignment; richer **UI** in shell (no new backend primitive). |
| Settings | **M3** + branding keys | Timezone, thresholds, **theme / app name / logo URL**. |
| Payment | **Phase 2** (Appendix C) | Stub or omit until POS/billing scope is defined. |
| Support | **Phase 2** (Appendix C) | Tickets or external link; stub acceptable. |

**Frontend additions (early milestones)**

- **Design tokens:** CSS variables (primary purple, neutrals, radii, shadows) aligned to reference.
- **Layout:** `AuthLayout` (split) vs `AppShell` (collapsible sidebar + header + content).
- **Charts:** e.g. **Recharts** or **Chart.js** for KPI sparklines and stacked bar (e.g. sales vs inventory moved).
- **Tables:** reusable data table (pagination, row actions, tooltips on truncated cells, export trigger).

---

## Milestone 0 — Project foundation

### Objectives

- Runnable dev environment, API + client, migrations pipeline, CI entry point.

### Implement

| Area | Detail |
|------|--------|
| Repo layout | `server/` (Express), `client/` (React + Vite or CRA), root `package.json` workspaces **or** separate packages with documented scripts. |
| Server | Express app, CORS for client origin, JSON body parser, centralized error handler, request logging (structured or pino). |
| Client | Router, **auth layout** (split hero + form) vs **app shell** (sidebar) placeholders, API client module (base URL from env), 401 interceptor → login redirect. |
| Design | Global styles: **typography**, **CSS variables** (primary / surface / border), focus states (a11y). |
| DB | Migration runner configured; `DATABASE_URL` in `.env.example`. |
| CI | GitHub Actions / equivalent: install, lint, `test` (may be no-op until M1). |

### APIs (this milestone)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | None | `{ "status": "ok", "db": "up"|"down" }` — DB ping optional. |

### Database

- No business tables required; optional migration table if tool creates it.

### Tests

| Type | What to test |
|------|----------------|
| Unit | Error handler returns correct status + JSON shape for `AppError` vs unknown errors. |
| Integration | `GET /health` returns 200 (and DB connected when `DATABASE_URL` set in test env). |
| Manual | Clone repo → copy env → run migrations (none) → start server + client → see shell. |

### Exit criteria

- [ ] `npm run dev` (or documented equivalent) runs API and UI.
- [ ] CI passes lint + health integration test.

---

## Milestone 1 — Identity, RBAC, audit spine (matches auth UI)

### Objectives

- **Email-first** sign-in (UI shows email field); JWT auth; optional **refresh token** for “Remember for 30 days”; **forgot / reset password**; optional **Sign in with Google**; **sign-up** flow per policy; role guards; `system_logs`.

### Database

| Table | Key columns | Notes |
|-------|----------------|------|
| `users` | `id`, `email` UNIQUE, `username` UNIQUE nullable (optional display handle), `password_hash` nullable (OAuth-only users), `google_sub` UNIQUE nullable, `avatar_url` nullable, `role`, `is_active`, `email_verified_at` nullable, `created_at`, `updated_at` | Indexes: `email`, `google_sub`. |
| `refresh_tokens` | `id`, `user_id` FK, `token_hash`, `expires_at`, `created_at`, `revoked_at` nullable, `user_agent`/`ip` optional | For “Remember me”; rotate on use optional. |
| `password_reset_tokens` | `id`, `user_id` FK, `token_hash`, `expires_at`, `used_at` nullable | Single-use reset. |
| `system_logs` | `id`, `user_id` FK nullable, `action`, `metadata` JSONB, `ip` optional, `created_at` | Index: `created_at`, `user_id`. |

### Implement

- **Login:** `POST /auth/login` accepts `{ email, password, remember_me? }`. Short-lived access JWT (e.g. 15m–1h) + if `remember_me`, issue **refresh token** (30d) stored hashed in DB.
- **Refresh:** `POST /auth/refresh` with refresh token cookie or body → new access token (and optional rotation).
- **Forgot password:** `POST /auth/forgot-password` → always 200 (anti-enumeration); email with link **or** log token in dev.
- **Reset:** `POST /auth/reset-password` `{ token, new_password }`.
- **Google OAuth:** Authorization code flow: `GET /auth/google` → redirect; `GET /auth/google/callback` → create/link user, issue tokens. Env: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, callback URL.
- **Sign up:** Choose one: **(A)** public `POST /auth/register` for first store self-onboarding, **(B)** disabled—only admin-created users + seed admin. Document in README.
- Middleware: `requireAuth`, `requireRoles(...roles)`.
- Log: login success/failure, token refresh, OAuth link, password reset request/complete, logout, user CRUD, role change.

### APIs

| Method | Path | Roles | Description |
|--------|------|--------|-------------|
| POST | `/auth/login` | Public | `{ email, password, remember_me? }` → `{ access_token, expires_in, refresh_token? }` + `user` DTO (id, email, role, avatar_url, display_name). |
| POST | `/auth/refresh` | Public | Refresh token → new access token. |
| POST | `/auth/logout` | Authenticated | Revoke refresh token(s) for current device or all. |
| POST | `/auth/forgot-password` | Public | `{ email }`. |
| POST | `/auth/reset-password` | Public | `{ token, new_password }`. |
| POST | `/auth/register` | Public or disabled | Per policy (A/B above). |
| GET | `/auth/google` | Public | Start OAuth redirect. |
| GET | `/auth/google/callback` | Public | OAuth callback; issue tokens. |
| GET | `/auth/me` | Authenticated | Current user profile. |
| POST | `/users` | `admin` | Invite/create user: `{ email, password?, role, username? }`. |
| GET | `/users` | `admin` | Paginated list + search (matches **Roles** screen). |
| GET | `/users/:id` | `admin` | Detail. |
| PATCH | `/users/:id` | `admin` | email, role, is_active, avatar_url; optional password set by admin. |
| GET | `/system-logs` | `admin` | Query: `from`, `to`, `user_id`, `action`, `page`, `page_size`. |

**Role matrix (enforce in routes)**

| Endpoint | admin | manager | store_keeper |
|----------|-------|---------|--------------|
| `/users*`, `/system-logs` | ✓ | ✗ | ✗ |
| `/auth/me`, refresh, logout | ✓ | ✓ | ✓ |

### Frontend

- **Login page (split layout):** email, password, “Remember for 30 days,” forgot link, primary **Sign in**, **Sign in with Google**, footer **Sign up** (if policy A).
- **Forgot password** + **Reset password** routes.
- **Sign up** route (if enabled).
- Token storage: prefer **httpOnly cookie** for refresh token; access token memory or short-lived cookie—document XSS implications if using `localStorage`.
- **App shell:** sidebar nav items (Overview, Products, Supplier, Category, Warehouse, Roles, Settings; Payment/Support stub or hidden); profile block (name, role, avatar, logout) matching mockup.
- Protected routes; nav visibility by role (e.g. store_keeper: hide Roles, restrict Settings).

### Tests

| Type | What to test |
|------|----------------|
| Unit | Password verify; JWT claims; `requireRoles` 403; reset token single-use expiry. |
| Integration | Login with email → 200 + access token; wrong password → 401; `remember_me` creates refresh row. |
| Integration | `POST /auth/refresh` with valid refresh → new access; revoked → 401. |
| Integration | Forgot-password creates token row; reset with valid token updates password. |
| Integration | Google callback with mocked OAuth profile → user created or linked (integration test via stubbed verifier). |
| Integration | `GET /users` as store_keeper → 403; as admin → 200; mutations log to `system_logs`. |
| Integration | `GET /system-logs` date filter correctness. |

### Exit criteria

- [ ] Login UX matches reference (email + optional Google + remember + forgot + conditional sign up).
- [ ] Seed creates first `admin`; README documents OAuth env and sign-up policy.

---

## Milestone 2 — Dynamic metadata (categories & units)

### Objectives

- Admin defines **categories** (hierarchical optional) and **units**; all authenticated users can read lists for dropdowns.

### Database

| Table | Key columns | Notes |
|-------|----------------|------|
| `categories` | `id`, `name`, `parent_id` FK self nullable, `sort_order`, `is_active`, `created_at`, `updated_at` | Index: `parent_id`, `is_active`. |
| `units` | `id`, `name`, `code` UNIQUE, `allows_fractional`, `is_active`, `created_at`, `updated_at` | Index: `is_active`. |

### Implement

- Soft validation: no circular parent chains; deactivate instead of hard delete if referenced (or block delete with FK).
- Log all category/unit mutations to `system_logs`.

### APIs

| Method | Path | Roles | Description |
|--------|------|--------|-------------|
| GET | `/categories` | Authenticated | Query: `include_inactive` (admin only), tree or flat + `parent_id`. |
| GET | `/categories/:id` | Authenticated | Single category. |
| POST | `/categories` | `admin` | `{ name, parent_id?, sort_order? }`. |
| PATCH | `/categories/:id` | `admin` | Partial update. |
| DELETE | `/categories/:id` | `admin` | Only if no products FK or soft-delete policy. |
| GET | `/units` | Authenticated | List units for dropdowns. |
| GET | `/units/:id` | Authenticated | Detail. |
| POST | `/units` | `admin` | `{ name, code, allows_fractional }`. |
| PATCH | `/units/:id` | `admin` | Partial update. |
| DELETE | `/units/:id` | `admin` | Policy same as categories. |

**Optional read for managers:** same GET endpoints; POST/PATCH/DELETE remain `admin` only (aligns with original “Admin = category definitions”).

### Frontend

- **App shell → Category:** dedicated admin page (table or tree + modals) matching sidebar **Category** item.
- **Units:** admin sub-page or tab under Category/Settings per IA choice.
- Shared components: `CategorySelect`, `UnitSelect` (used in M4).

### Tests

| Type | What to test |
|------|----------------|
| Unit | Category tree validator rejects cycles. |
| Integration | Admin CRUD category/unit → 200/201; store_keeper GET `/categories` → 200; store_keeper POST `/categories` → 403. |
| Integration | Duplicate `units.code` → 409. |
| Integration | Each mutation creates matching `system_logs` row. |

### Exit criteria

- [ ] Fresh DB: admin can define taxonomy before any product exists.

---

## Milestone 3 — System settings & threshold resolution

### Objectives

- Global defaults and optional **per-category** overrides for low-stock threshold and expiry warning days; single resolver service used by APIs and alerts.

### Database

**Option A — key/value (flexible)**

| Table | Key columns |
|-------|-------------|
| `system_settings` | `key` PK, `value` JSONB or text, `updated_at` |

Keys: `store_timezone`, `default_low_stock_threshold`, `default_expiry_warning_days`, `jwt_ttl_minutes` (if not env-only), `password_min_length`, **`app_name`**, **`logo_url`**, **`primary_color_hex`** (optional theming for purple accent per deployment).

**Option B — typed `category_settings`**

| Table | Key columns |
|-------|-------------|
| `category_settings` | `category_id` PK FK, `low_stock_threshold` nullable, `expiry_warning_days` nullable |

Product-level overrides stored on `products` in M4.

### Implement

- `getSetting(key)` / `setSetting(key, value)` (admin).
- `resolveLowStockThreshold(productRow, categoryRow, settings)` and `resolveExpiryWarningDays(...)` pure functions + integration in services.

### APIs

| Method | Path | Roles | Description |
|--------|------|--------|-------------|
| GET | `/settings` | `admin` | Return all public settings (no secrets) or whitelisted keys. |
| PATCH | `/settings` | `admin` | Partial update of allowed keys. |
| GET | `/category-settings/:categoryId` | `admin` | Optional if not embedded in category PATCH. |
| PATCH | `/category-settings/:categoryId` | `admin` | `{ low_stock_threshold?, expiry_warning_days? }`. |

**Note:** If you embed overrides in `PATCH /categories/:id`, document that and skip separate `category-settings` routes.

### Frontend

- Admin **Settings** page: timezone, defaults, password policy; **branding** (app name, logo URL, primary color); category overrides (drawer or nested form).

### Tests

| Type | What to test |
|------|----------------|
| Unit | Resolver: only global; category beats global; product beats category (product in M4 — add forward-compatible tests with mock product row in M3 or defer product case to M4). |
| Integration | PATCH `/settings` as manager → 403; as admin → 200 and persisted. |
| Integration | Invalid timezone string → 400. |

### Exit criteria

- [ ] Resolver module exists with tests; M5 alerts **must** import it (no duplicated precedence logic).

---

## Milestone 3.5 — Suppliers & warehouses (reference UI)

### Objectives

- **Suppliers** module: CRUD, status (active / inactive / soft-deleted), stats cards, search/filter, export—matches **Suppliers** screen.
- **Warehouses** (locations): at minimum a **default warehouse** row per deployment; optional multi-warehouse for future stock splits.

### Database

| Table | Key columns | Notes |
|-------|----------------|------|
| `suppliers` | `id`, `supplier_code` UNIQUE, `display_name`, `contact_name`, `email`, `phone`, `address`, `avatar_url` nullable, `status` (`active`,`inactive`,`deleted`), `created_at`, `updated_at` | Index: `status`, `supplier_code`, `email`. |
| `warehouses` | `id`, `name`, `code` UNIQUE nullable, `is_default`, `created_at` | Seed one `is_default = true` on bootstrap. |

### APIs — Suppliers

| Method | Path | Roles | Description |
|--------|------|--------|-------------|
| GET | `/suppliers` | `admin`, `manager` | Pagination, `search`, `status`, filters. |
| GET | `/suppliers/stats` | `admin`, `manager` | Counts: active, inactive, deleted (+ optional MoM deltas when movement data exists). |
| GET | `/suppliers/:id` | `admin`, `manager` | Detail. |
| POST | `/suppliers` | `admin`, `manager` | Create. |
| PATCH | `/suppliers/:id` | `admin`, `manager` | Update; status transitions (soft delete → `deleted`). |
| DELETE | `/suppliers/:id` | `admin` | Soft-delete preferred if products reference supplier. |
| GET | `/suppliers/export` | `admin`, `manager` | CSV/Excel stream; same filters as list. |

### APIs — Warehouses

| Method | Path | Roles | Description |
|--------|------|--------|-------------|
| GET | `/warehouses` | Authenticated | List; include default flag. |
| POST | `/warehouses` | `admin` | Optional extra sites. |
| PATCH | `/warehouses/:id` | `admin` | Rename; set default (transaction: unset other defaults). |

### Frontend

- **Suppliers** page: stat cards, toolbar (search, filters, Add, Export), table with avatar, tooltip on address, pagination, row actions (view/edit/delete).
- **Warehouse** nav: list + set default (v1 can be minimal if single warehouse only).

### Tests

| Type | What to test |
|------|----------------|
| Integration | CRUD supplier; `deleted` excluded from default list unless filter; export returns rows + correct headers. |
| Integration | Cannot hard-delete supplier still referenced by products (FK or 409). |
| Integration | Exactly one default warehouse after seed; PATCH default flips others. |
| Unit | Stats endpoint counts match seeded statuses. |

### Exit criteria

- [ ] Product form (M4) can bind `supplier_id` and optional `warehouse_id` to seeded entities.

---

## Milestone 4 — Products & inventory transactions (matches Products UI)

### Objectives

- Rich **product catalog** aligned with **Add new product** modal: supplier, SKU/barcode, optional GRN on receipt, description, physical attributes, **warning threshold** + **reorder (auto-order) level**, **cost + margin → selling price**, image, **bulk import**, **admin-defined custom fields**.
- Stock changes remain **transactional** with `inventory_transactions` + quantity update (same rules as global conventions). Optional `warehouse_id` on product and/or transaction if multi-warehouse enabled in M3.5.

### Database

| Table | Key columns | Notes |
|-------|----------------|------|
| `products` | Core: `id`, `name`, `description` nullable, `category_id` FK, `unit_id` FK (stock-keeping unit), `supplier_id` FK nullable, `warehouse_id` FK nullable, `sku` UNIQUE nullable, `barcode` nullable, `quantity` NUMERIC, `expiry_date` nullable | Indexes: `category_id`, `supplier_id`, `sku`, `barcode`, `expiry_date`, search on `name`. |
| | Pricing: `cost_price` NUMERIC nullable (purchasing), `selling_price` NUMERIC nullable, `margin_percent` NUMERIC nullable | **Rule (document + test):** on write, either compute `selling_price` from `cost_price` + `margin_percent` or accept explicit `selling_price` and backfill margin—pick one canonical source. |
| | Thresholds: `low_stock_threshold` nullable (warning / “Rec. level”), `reorder_point` nullable (auto-order trigger), `expiry_warning_days` nullable | Resolver (M3) still applies for defaults; these are product overrides. |
| | Physical: `weight_value` NUMERIC nullable, `weight_unit_id` FK nullable (or reuse `units`), `dimension_length`, `dimension_width`, `dimension_height` NUMERIC nullable, `dimension_unit_id` FK nullable | Matches weight + L×B×H + unit dropdowns. |
| | Media / flex: `image_url` nullable (S3/local path after upload), `custom_attributes` JSONB default `{}` | For “Add custom field” without schema migration per field (v1). Optional later: `product_field_definitions` table driving form builder. |
| `inventory_transactions` | `id`, `product_id` FK, `warehouse_id` FK nullable, `quantity_delta`, `type` (`in`,`out`,`adjustment`,`sale` optional), `note` nullable, `grn_reference` nullable (goods received note on **in**), `user_id` FK, `created_at` | Indexes: `product_id`, `created_at`, `user_id`, `warehouse_id`. |

**Check constraints**

- `quantity` ≥ 0; `quantity_delta` sign convention documented and tested.
- `reorder_point` ≥ `low_stock_threshold` when both set (optional business rule—warn vs reject).

### Implement

- `applyStockChange({ productId, warehouseId?, type, quantity, userId, note, grnReference? })` in **one DB transaction**: lock product row (`FOR UPDATE`), insert `inventory_transactions`, update `products.quantity`.
- **Selling price:** server validates numeric consistency with cost + margin per chosen rule.
- **Image upload:** `POST /products/:id/image` multipart → store file or object storage; persist `image_url`; max size + MIME allowlist; optional sharp resize to ~400×400 per UI hint.
- **Bulk upload:** CSV/Excel parse → validate rows → transactional batch insert (partial failure strategy: row errors report, no silent skip—document).
- **Custom fields:** validate keys/types against allowlist or `product_field_definitions` if implemented; else validate JSON shape/size on `custom_attributes`.
- **Catalog policy:** `admin` + `manager` for catalog CRUD; `store_keeper` stock endpoints only (unless PRD changes).

### APIs

| Method | Path | Roles | Description |
|--------|------|--------|-------------|
| GET | `/products` | Authenticated | Query: `category_id`, `supplier_id`, `warehouse_id`, `search`, `low_stock_only`, `page`, `page_size`; columns for table include resolved “Rec. level” / thresholds. |
| GET | `/products/:id` | Authenticated | Full detail + computed selling display + custom_attributes. |
| POST | `/products` | `admin`, `manager` | Create; body includes all catalog fields; initial `quantity` optional (0 default). |
| PATCH | `/products/:id` | `admin`, `manager` | Partial update; **no** direct quantity except via stock endpoints or dedicated adjust (policy). |
| DELETE | `/products/:id` | `admin` | Soft delete preferred for audit. |
| POST | `/products/:id/image` | `admin`, `manager` | `multipart/form-data` image → returns `image_url`. |
| POST | `/products/import` | `admin`, `manager` | Bulk CSV/Excel upload; async job ID optional if large. |
| GET | `/products/export` | `admin`, `manager` | CSV/Excel; same filters as list. |
| POST | `/products/:id/stock/in` | `store_keeper`, `manager`, `admin` | `{ quantity, note?, grn_reference? }` |
| POST | `/products/:id/stock/out` | `store_keeper`, `manager`, `admin` | `{ quantity, note? }` |
| POST | `/products/:id/stock/adjust` | `store_keeper`, `manager`, `admin` | `{ quantity_after` or `delta`, note }` |

**System logs:** product create/update/delete, import job completion, image replace.

### Frontend

- **Products** page: header **Add Product** + **Export**; data table (product name, SKU, category, recorded level, thresholds, actions edit/delete); pagination.
- **Add / Edit product modal:** sections for identity, supplier + category, identifiers (SKU, barcode, optional GRN hint text), description, physical dims, stock + **warning threshold** + **auto order level**, cost + margin + derived selling display, image dropzone (400×400 hint), **Add custom field** (dynamic key/value rows bound to `custom_attributes`), **Bulk upload** entry.
- **Store Keeper:** stock in/out/adjust flows (can open from product row or dedicated flow).

### Tests

| Type | What to test |
|------|----------------|
| Unit | Quantity vs `allows_fractional`; margin/selling price math; `custom_attributes` max depth/size validation. |
| Integration | Stock `in` with `grn_reference` persists on transaction row. |
| Integration | Stock `out` negative guard; concurrency with `FOR UPDATE`. |
| Integration | `store_keeper` forbidden from `POST /products`. |
| Integration | `GET /products?low_stock_only` compares quantity to **resolved** warning threshold (includes `reorder_point` only if filter defined). |
| Integration | Image upload rejects oversize / wrong MIME; `image_url` updated. |
| Integration | Import: valid file creates N products; invalid rows return structured errors without corrupting DB. |
| Integration | Export includes SKU and supplier columns when present. |

### Exit criteria

- [ ] No code path updates `products.quantity` without a matching `inventory_transactions` row in the **same** DB transaction.
- [ ] UI parity with reference: list + modal + export + bulk path **or** explicitly deferred items listed in issue tracker with Phase tag.

---

## Milestone 5 — Alerts (low stock & expiry)

### Objectives

- Persist alerts; generate/update on stock change and/or periodic reconciliation; acknowledge workflow.

### Database

| Table | Key columns | Notes |
|-------|----------------|------|
| `alerts` | `id`, `product_id` FK, `alert_type` (`low_stock`,`expiry`,`reorder` optional), `message`, `status` (`open`,`acknowledged`,`resolved`), `created_at`, `updated_at`, `resolved_at` nullable | `reorder` when `quantity` ≤ `reorder_point` (if set). Indexes: `status`, `alert_type`, `product_id`. |

### Implement

- After successful `applyStockChange`, call `syncLowStockAlert(productId)` and **`syncReorderAlert(productId)`** when `reorder_point` is defined.
- Expiry: `syncExpiryAlerts()` — invoked nightly cron **or** on product patch + scheduled job every 15–60 min (document choice).
- Message templates include product name, quantity, threshold, or days to expiry using `store_timezone` for “day” boundaries.
- Dedupe: update existing `open` alert vs create new (policy in code + tests).

### APIs

| Method | Path | Roles | Description |
|--------|------|--------|-------------|
| GET | `/alerts` | Authenticated | Query: `status`, `type`, `page`, `page_size`; store_keeper sees same tenant (single store). |
| GET | `/alerts/count` | Authenticated | Open count for badge (or include in `/alerts?limit=1` meta). |
| PATCH | `/alerts/:id` | `store_keeper`, `manager`, `admin` | `{ status }` acknowledge/resolve. |
| POST | `/alerts/reconcile` | `admin`, `manager` | Optional manual trigger for full recompute (rate-limited). |

### Frontend

- Alerts list with filters by **type** (`low_stock`, `expiry`, `reorder`) and status; acknowledge/resolve actions.
- Dashboard / shell **badge**; optional **polling** every 30–60s for `/alerts/count`.

### Tests

| Type | What to test |
|------|----------------|
| Unit | `syncLowStockAlert`: below warning threshold → open alert; above → resolved or deleted per policy. |
| Unit | `syncReorderAlert`: at/below reorder point → open `reorder` alert (dedupe policy). |
| Unit | Expiry within N days uses resolved N from product/category/global. |
| Integration | Stock drops below threshold → `GET /alerts` contains new `low_stock` open. |
| Integration | Stock rises above threshold → alert `resolved` or removed per policy. |
| Integration | When `reorder_point` set and quantity drops to/below it → `reorder` alert appears; restocking above clears per policy. |
| Integration | PATCH alert as store_keeper → 200; assert `system_logs` if you log acknowledgements. |

### Exit criteria

- [ ] Alert generation uses **only** the M3 resolver for thresholds and warning days.

---

## Milestone 6 — Overview dashboard, reporting & analytics

### Objectives

- **Overview** screen: KPI cards with **period vs previous period** deltas, **sparkline** series, and **Monthly sales vs inventory moved** stacked-style chart (time-range presets: 1d, 7d, 1m, 3m, 6m, 1y, etc.).
- Existing **tabular reports**, CSV export, movement history (may power chart backend).

### Implement

- KPIs require **definitions** agreed and documented, e.g.: **transaction count** (count of `inventory_transactions` or “orders” if you add sales orders later), **products sold** (sum of `out` quantities in range), **inventory moved** (sum of abs deltas or `in+out`), **revenue** only if **selling_price × quantity** applied on outbound lines—**if true sales orders do not exist in v1**, derive conservative metrics from transactions + product prices and label them clearly in UI (“estimated from stock movements”) **or** add optional `order_lines` in a later phase. **Pick one** and test copy matches math.
- Materialized rollups optional for performance; start with SQL aggregates indexed by `created_at`.

### APIs — Dashboard (Overview)

| Method | Path | Roles | Description |
|--------|------|--------|-------------|
| GET | `/dashboard/kpis` | `manager`, `admin` | Query: `range` or `from`/`to`. Returns cards: labels, current value, previous value, `delta_percent`, `series` (small array per sparkline). |
| GET | `/dashboard/sales-vs-inventory` | `manager`, `admin` | Query: same; bucketed by month/week; series for stacked bar: e.g. `gross_sales_component`, `inventory_moved_units`—shape must match chart component contract. |
| GET | `/search` | Authenticated | Global search: `q`, `limit`; returns grouped hits (products, suppliers, categories) for sidebar search. |

### APIs — Reports

| Method | Path | Roles | Description |
|--------|------|--------|-------------|
| GET | `/reports/stock-levels` | `manager`, `admin` | Query: `category_id`, `unit_id`, `warehouse_id`; CSV via `Accept` or `?format=csv`. |
| GET | `/reports/low-stock` | `manager`, `admin` | Filters; include reorder flags. |
| GET | `/reports/expiry` | `manager`, `admin` | `within_days`. |
| GET | `/reports/movements` | `manager`, `admin` | `from`, `to`, `product_id`, `category_id`, `user_id`, `type`, pagination. |
| GET | `/reports/movements/summary` | `manager`, `admin` | Aggregated net in/out per product per day/week. |

**store_keeper:** Read-only **Overview** optional; if denied, hide nav item. Reports remain manager/admin unless PRD extends.

### Frontend

- **Overview:** greeting, range chips, “Add metrics” can be **static v1** or hidden; date picker + filters; KPI grid; large chart with tooltip + horizontal scroll if many buckets.
- **Global search** in sidebar wired to `GET /search` with debounce.
- Report pages: date pickers, exports.

### Tests

| Type | What to test |
|------|----------------|
| Unit | KPI calculator: given seeded transactions, delta % matches expected formula. |
| Integration | `GET /dashboard/kpis` respects date window; empty data returns zeros not 500. |
| Integration | `GET /dashboard/sales-vs-inventory` bucket boundaries respect `store_timezone`. |
| Integration | `GET /search` returns products matching `q` and respects role (no leakage of admin-only entities if any). |
| Integration | Movements report + summary consistency with M4 transaction rules. |
| Integration | Unauthorized role → 403 for dashboard/reports. |

### Exit criteria

- [ ] Overview page renders from live APIs (no hardcoded demo numbers in production build).
- [ ] KPI definitions documented in `/docs` one-pager so UI labels match backend math.
- [ ] Report queries use indexed `created_at`; document max date range.

---

## Milestone 7 — Hardening, UX, accessibility

### Objectives

- Responsive UI, production middleware, deployment docs.

### Implement

- Mobile breakpoints: sidebar collapses to drawer; tables use cards or horizontal scroll; modals full-screen on small viewports.
- Rate limit: `/auth/login`, `/auth/forgot-password`, `/auth/register` (e.g. 5/min per IP).
- Helmet, compression, trust proxy if behind reverse proxy.
- Input sanitization, max payload size.
- README: env vars, migrations, production build, HTTPS.

### APIs

- No new domain routes required; optional `GET /api/v1/version` returning git SHA or package version.

### Tests

| Type | What to test |
|------|----------------|
| Integration | Login rate limit returns 429 after N attempts. |
| Manual / E2E (optional Playwright) | Login → create supplier → create product → stock in → Overview KPIs change → low-stock alert → acknowledge. |
| Lighthouse or axe (manual) | Critical pages no serious a11y regressions. |

### Exit criteria

- [ ] Runbook for backup/restore of Postgres for one customer instance.

---

## Milestone 8 — Test suite completion & release gates

### Objectives

- Coverage targets for core domain; CI gate.

### Implement

- Jest (or Vitest) for server; React Testing Library for critical forms.
- Test DB lifecycle: migrations up before suite, truncate between tests or use transactions.

### Tests (consolidation checklist)

| Area | Minimum integration coverage |
|------|------------------------------|
| Auth | Email login, refresh/remember, forgot/reset, OAuth callback (mocked), forbidden routes, token expiry. |
| Metadata | Category/unit CRUD + FK constraints. |
| Settings | Admin-only, resolver precedence. |
| Stock | In/out/adjust, negative guard, concurrency. |
| Alerts | Create/resolve paths tied to stock, expiry, reorder. |
| Reports + dashboard | KPI math, chart buckets, search endpoint, filters + auth. |
| Suppliers / warehouses | CRUD, stats, export, default warehouse. |
| Products | Import, image upload, margin pricing, custom_attributes. |

### Exit criteria

- [ ] CI runs unit + integration on every PR.
- [ ] Changelog + semantic version tag for customer releases.

---

## Milestone 9 — Commercial deploy pattern (per sold store)

### Objectives

- Repeatable onboarding without multi-tenant code.

### Implement

- `docker-compose.yml` (optional): `app`, `postgres`, env for first boot.
- Script: `npm run db:seed` → admin user + optional demo categories/units.
- **Customer checklist:** provision VM/container → Postgres → set secrets (incl. **Google OAuth** callback URLs if used) → run migrations → seed admin + **default warehouse** → Admin configures **branding**, **categories/units**, **settings**, **suppliers**, then products.

### APIs

- None required beyond existing.

### Tests

| Type | What to test |
|------|----------------|
| Smoke | Dockerfile build + compose up + health + login (CI job optional, can be nightly). |

### Exit criteria

- [ ] Third party can follow docs to a working instance without source code knowledge beyond env template.

---

## Appendix A — Role × module matrix (reference)

| Module | admin | manager | store_keeper |
|--------|-------|---------|--------------|
| Auth / me (incl. OAuth, refresh) | ✓ | ✓ | ✓ |
| Users, system logs (Roles UI) | ✓ | ✗ | ✗ |
| Categories, units (write) | ✓ | ✗ | ✗ |
| Categories, units (read) | ✓ | ✓ | ✓ |
| Settings / category-settings / branding | ✓ | ✗ | ✗ |
| Suppliers, warehouses | ✓ | ✓ R/W | read-only optional† |
| Products (write catalog, import, image) | ✓ | ✓ | ✗* |
| Stock transactions | ✓ | ✓ | ✓ |
| Alerts (read/act) | ✓ | ✓ | ✓ |
| Dashboard + global search | ✓ | ✓ | optional read‡ |
| Tabular reports + export | ✓ | ✓ | ✗** |

\*If you allow store_keeper to create products, widen POST/PATCH accordingly.  
\**If you grant read-only reports to store_keeper, document and test.  
†If store_keeper must pick supplier on receive, grant `GET /suppliers` only.  
‡If store_keeper should not see financial KPIs, hide Overview or return labor-only metrics—document.

---

## Appendix B — Suggested sprint mapping (UI-aligned)

| Sprint | Milestones |
|--------|------------|
| 1 | M0, M1 (auth shell + email/OAuth/refresh as prioritized) |
| 2 | M2, M3 (metadata + settings/branding) |
| 3 | M3.5 (suppliers + warehouses) |
| 4 | M4 (rich products + stock + import/media) |
| 5 | M5 (alerts incl. reorder) |
| 6 | M6 (Overview dashboard + reports + search) |
| 7 | M7, M8 (responsive polish + test gates) |
| 8 | M9 + pilot feedback |

---

## Appendix C — Phase 2 (sidebar placeholders)

| Module | Suggested approach |
|--------|---------------------|
| **Payment** | Define scope: POS payments, supplier invoices, or customer orders—each is a different subsystem. Until then: hide nav item **or** static “Coming soon” page with no PII. |
| **Support** | External link (mailto/docs), **or** minimal internal tickets (`support_tickets` table + admin queue), **or** embed third-party widget. |

---

*Document version: 2.0 — adds reference UI alignment, expanded auth, suppliers/warehouses, rich product model (SKU, pricing, reorder, media, import, custom attributes), Overview dashboard APIs, global search, reorder alerts, and Phase 2 stubs for Payment/Support.*
