import type { PoolClient } from "pg";
import { getPool } from "../db/pool.js";

export async function writeAuditLog(params: {
  userId: string | null;
  action: string;
  metadata?: Record<string, unknown>;
  ip?: string | null;
  client?: PoolClient;
}): Promise<void> {
  const meta = JSON.stringify(params.metadata ?? {});
  const run = async (c: PoolClient) => {
    await c.query(
      `INSERT INTO system_logs (user_id, action, metadata, ip)
       VALUES ($1::uuid, $2, $3::jsonb, $4)`,
      [params.userId, params.action, meta, params.ip ?? null]
    );
  };

  if (params.client) {
    await run(params.client);
    return;
  }

  const pool = getPool();
  await pool.query(
    `INSERT INTO system_logs (user_id, action, metadata, ip)
     VALUES ($1::uuid, $2, $3::jsonb, $4)`,
    [params.userId, params.action, meta, params.ip ?? null]
  );
}
