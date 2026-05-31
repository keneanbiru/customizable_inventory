/**
 * Creates the database named in DATABASE_URL if it is missing.
 * Connects to the `postgres` maintenance database on the same host.
 */
import { loadEnv } from "../src/lib/loadEnv.js";
import pg from "pg";

loadEnv(import.meta.url);

function parseTargetDatabase(databaseUrl: string): { adminUrl: string; database: string } {
  const normalized = databaseUrl.trim().startsWith("postgres://")
    ? `postgresql://${databaseUrl.trim().slice("postgres://".length)}`
    : databaseUrl.trim();

  let u: URL;
  try {
    u = new URL(normalized);
  } catch {
    throw new Error("Invalid DATABASE_URL");
  }

  const pathDb = decodeURIComponent(u.pathname.replace(/^\//, "").split("/")[0] ?? "");
  if (!pathDb) {
    throw new Error("DATABASE_URL must include a database name in the path, e.g. .../hasu_inventory");
  }
  if (pathDb === "postgres") {
    throw new Error(
      "DATABASE_URL points at database `postgres`. Use a dedicated database name (e.g. hasu_inventory)."
    );
  }
  if (!/^[a-zA-Z0-9_]+$/.test(pathDb)) {
    throw new Error(
      "Database name in DATABASE_URL must contain only letters, numbers, and underscores for this script."
    );
  }

  u.pathname = "/postgres";
  const adminUrl = u.toString();

  return { adminUrl, database: pathDb };
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }

  const { adminUrl, database } = parseTargetDatabase(databaseUrl);

  const admin = new pg.Client({ connectionString: adminUrl, connectionTimeoutMillis: 10_000 });
  await admin.connect();

  try {
    const { rows } = await admin.query<{ exists: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1) AS exists",
      [database]
    );
    if (rows[0]?.exists) {
      console.log(`Database "${database}" already exists.`);
      return;
    }

    const ident = `"${database.replace(/"/g, '""')}"`;
    await admin.query(`CREATE DATABASE ${ident}`);
    console.log(`Created database "${database}".`);
  } finally {
    await admin.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
