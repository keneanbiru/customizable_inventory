import { loadEnv } from "./lib/loadEnv.js";
import { runMigrations } from "./db/runMigrations.js";

loadEnv(import.meta.url);

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL?.trim()) {
    console.error("DATABASE_URL is required.");
    process.exit(1);
  }
  if (!process.env.JWT_SECRET?.trim()) {
    console.error("JWT_SECRET is required.");
    process.exit(1);
  }

  console.log("Running database migrations...");
  await runMigrations();
  console.log("Migrations complete. Starting API...");

  process.env.SKIP_AUTO_START = "1";
  const { startServer } = await import("./index.js");
  startServer();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
