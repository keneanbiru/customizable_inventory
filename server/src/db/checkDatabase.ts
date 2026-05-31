import pg from "pg";

export type DbHealthStatus = "up" | "down" | "not_configured";

export async function checkDatabase(): Promise<DbHealthStatus> {
  const url = process.env.DATABASE_URL;
  if (!url?.trim()) {
    return "not_configured";
  }

  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 2000 });
  try {
    await client.connect();
    await client.query("SELECT 1");
    return "up";
  } catch {
    return "down";
  } finally {
    await client.end().catch(() => undefined);
  }
}
