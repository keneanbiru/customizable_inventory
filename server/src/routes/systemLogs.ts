import { Router } from "express";
import { AppError } from "../lib/AppError.js";
import { getPool } from "../db/pool.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireRoles } from "../middleware/requireRoles.js";

export const systemLogsRouter = Router();
systemLogsRouter.use(requireAuth, requireRoles("admin"));

systemLogsRouter.get("/", async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(req.query.page_size) || 50));
    const offset = (page - 1) * pageSize;

    const from = typeof req.query.from === "string" ? req.query.from : null;
    const to = typeof req.query.to === "string" ? req.query.to : null;
    const userId = typeof req.query.user_id === "string" ? req.query.user_id : null;
    const action = typeof req.query.action === "string" ? req.query.action.trim() : null;

    const pool = getPool();
    const conds: string[] = ["TRUE"];
    const params: unknown[] = [];
    let n = 1;
    if (from) {
      conds.push(`created_at >= $${n++}::timestamptz`);
      params.push(from);
    }
    if (to) {
      conds.push(`created_at <= $${n++}::timestamptz`);
      params.push(to);
    }
    if (userId) {
      conds.push(`user_id = $${n++}::uuid`);
      params.push(userId);
    }
    if (action) {
      conds.push(`action ILIKE $${n++}`);
      params.push(`%${action}%`);
    }
    const where = conds.join(" AND ");
    const limitIdx = n++;
    const offsetIdx = n++;
    params.push(pageSize, offset);

    const listSql = `SELECT id, user_id::text, action, metadata, ip, created_at
       FROM system_logs WHERE ${where}
       ORDER BY created_at DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`;

    const { rows } = await pool.query<{
      id: string;
      user_id: string | null;
      action: string;
      metadata: unknown;
      ip: string | null;
      created_at: string;
    }>(listSql, params);

    const countParams = params.slice(0, -2);
    const countSql = `SELECT COUNT(*)::text AS c FROM system_logs WHERE ${where}`;
    const { rows: cRows } = await pool.query<{ c: string }>(countSql, countParams);
    const total = Number(cRows[0]?.c ?? "0");
    res.json({
      items: rows,
      page,
      page_size: pageSize,
      total,
    });
  } catch (err) {
    if (err instanceof Error && err.message.includes("invalid input syntax")) {
      next(new AppError("Invalid date or uuid filter", 400));
      return;
    }
    next(err);
  }
});
