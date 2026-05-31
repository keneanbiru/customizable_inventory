import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { getPgPoolConfig } from "./pgConfig.js";

function migrationsDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // Compiled: server/dist/db -> server/dist/migrations (copied at build)
  if (here.includes(`${path.sep}dist${path.sep}`)) {
    return path.join(here, "..", "migrations");
  }
  // Source: server/src/db -> server/migrations
  return path.join(here, "..", "..", "migrations");
}

async function ensureMigrationsTable(client: pg.PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

export async function runMigrations(): Promise<void> {
  const pool = new pg.Pool(getPgPoolConfig());
  const dir = migrationsDir();
  const files = (await fs.readdir(dir))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const client = await pool.connect();
  try {
    await ensureMigrationsTable(client);
    for (const file of files) {
      const version = file.replace(/\.sql$/i, "");
      const { rowCount } = await client.query(
        "SELECT 1 FROM schema_migrations WHERE version = $1",
        [version]
      );
      if (rowCount) {
        console.log(`Skip ${file} (already applied)`);
        continue;
      }
      const sql = await fs.readFile(path.join(dir, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [version]);
        await client.query("COMMIT");
        console.log(`Applied ${file}`);
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
}
