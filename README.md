# Hasu Inventory

Web inventory platform (React + Express + PostgreSQL). See `docs/IMPLEMENTATION_PLAN.md` for milestones.

## Prerequisites

- Node.js 20+ (CI uses 22)
- npm 10+
- PostgreSQL 13+ (required from **Milestone 1** onward)

## Setup

```bash
# macOS / Linux
cp .env.example .env

# Windows PowerShell
Copy-Item .env.example .env
```

Fill in at least:

- `DATABASE_URL` — Postgres connection string
- `JWT_SECRET` — long random string (32+ characters)

### Database (Milestone 1+)

Postgres must have the **database** referenced in `DATABASE_URL` (e.g. `hasu_inventory`). If you see `database "hasu_inventory" does not exist`, create it once:

```bash
# From repo root (loads .env from project root)
npm run db:create
```

Or manually, e.g. `psql -U postgres -c "CREATE DATABASE hasu_inventory;"`

Then:

```bash
npm run db:migrate
npm run db:seed
```

Seed creates the first **admin** when no admin exists (`ADMIN_EMAIL` / `ADMIN_PASSWORD` in `.env`).

## Develop

```bash
npm run dev
```

- **UI:** http://localhost:5173 — unauthenticated users are sent to `/login`.
- **API:** http://localhost:3000 — under `/api/v1/...` (Vite proxies `/api` to the API in dev).

Sign in with the seeded admin, then open **Overview** (`/app`) or **Roles** (`/app/users`, admin only).

## Scripts (root)

| Script | Description |
| ------ | ----------- |
| `npm run dev` | API + client concurrently |
| `npm run test` | Server tests (set `TEST_DATABASE_URL` to run auth integration tests locally) |
| `npm run lint` | ESLint server + client |
| `npm run build` | Production build for both packages |
| `npm run db:create` | Create the database named in `DATABASE_URL` (if missing) |
| `npm run db:migrate` | Apply SQL migrations |
| `npm run db:seed` | Seed first admin if missing |

## Registration & Google sign-in

- **First user:** `POST /api/v1/auth/register` is allowed when the `users` table is empty (that user becomes **admin**).
- **Later sign-ups:** disabled unless `PUBLIC_REGISTRATION=true` in `.env` (new users are **store_keeper**).
- **Google:** set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI`. For Vite dev, redirect URI should be on the **client origin**, e.g. `http://localhost:5173/api/v1/auth/google/callback`, so the refresh cookie is set for port 5173.

## Milestone status

### Milestone 0

- [x] Monorepo, health endpoint, error handler, client shell, CI

### Milestone 1

- [x] SQL migration: `users`, `refresh_tokens`, `password_reset_tokens`, `system_logs`
- [x] Auth: email login, refresh cookie, logout, forgot/reset password, register policy, Google OAuth (optional)
- [x] RBAC middleware; admin user CRUD; system log listing
- [x] Client: login / register / forgot / reset, session bootstrap via refresh, protected app shell

Next: **Milestone 2** — categories & units.
