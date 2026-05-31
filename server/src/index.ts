import { createApp } from "./app.js";
import { loadEnv } from "./lib/loadEnv.js";

loadEnv(import.meta.url);

export function startServer(): void {
  const port = Number(process.env.PORT) || 3000;
  const app = createApp();
  app.listen(port, () => {
    console.log(`API listening on port ${port}`);
  });
}

if (!process.env.VITEST && !process.env.SKIP_AUTO_START) {
  if (!process.env.DATABASE_URL?.trim()) {
    console.error("DATABASE_URL is required to start the API.");
    process.exit(1);
  }
  if (!process.env.JWT_SECRET?.trim()) {
    console.error("JWT_SECRET is required to start the API.");
    process.exit(1);
  }
  startServer();
}
