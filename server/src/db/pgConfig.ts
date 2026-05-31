import type pg from "pg";

/**
 * Pool config for local Postgres and hosted providers (Supabase, etc.).
 * Supabase requires SSL; set DATABASE_SSL=true or use a supabase.co URL.
 */
export function getPgPoolConfig(): pg.PoolConfig {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }

  const urlLower = connectionString.toLowerCase();
  const needsSsl =
    process.env.DATABASE_SSL === "true" ||
    process.env.DATABASE_SSL === "1" ||
    urlLower.includes("supabase.com") ||
    urlLower.includes("supabase.co") ||
    urlLower.includes("sslmode=require") ||
    urlLower.includes("sslmode=verify-full");

  const config: pg.PoolConfig = {
    connectionString,
    max: Number(process.env.PG_POOL_MAX) || 20,
  };

  if (needsSsl) {
    config.ssl = { rejectUnauthorized: false };
  }

  return config;
}
