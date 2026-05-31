import { loadEnv } from "../src/lib/loadEnv.js";
import { runMigrations } from "../src/db/runMigrations.js";

loadEnv(import.meta.url);

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL?.trim()) {
    console.error("DATABASE_URL is required for migrations.");
    process.exit(1);
  }
  await runMigrations();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
