import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Load env files so `npm run dev` works from repo root or from `server/`.
 * Order: repo `.env` → `server/.env` → cwd `.env` (later does not override earlier by default in dotenv;
 * we use override: false for first loads then last wins for duplicate keys — actually dotenv does not override existing process.env.
 * So: load root first (primary), then server, then cwd for local overrides.
 */
export function loadEnv(importMetaUrl: string): void {
  const here = path.dirname(fileURLToPath(importMetaUrl));
  const repoRoot = path.resolve(here, "..", "..");
  const serverRoot = path.resolve(here, "..");

  dotenv.config({ path: path.join(repoRoot, ".env") });
  dotenv.config({ path: path.join(serverRoot, ".env") });
  dotenv.config();
}
