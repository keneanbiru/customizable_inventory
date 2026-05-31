import { Router } from "express";
import { z } from "zod";
import { getPool } from "../db/pool.js";
import { AppError } from "../lib/AppError.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireRoles } from "../middleware/requireRoles.js";
import { reconcileAllAlerts } from "../services/alerts.js";
import { writeAuditLog } from "../services/auditLog.js";

const alertStatusSchema = z.enum(["open", "acknowledged", "resolved"]);
const alertTypeSchema = z.enum(["low_stock", "expiry", "reorder"]);

export const alertsRouter = Router();
alertsRouter.use(requireAuth);

alertsRouter.get("/alerts", async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.page_size) || 20));
    const offset = (page - 1) * pageSize;
    const status =
      typeof req.query.status === "string" ? alertStatusSchema.safeParse(req.query.status).data : undefined;
    const type =
      typeof req.query.type === "string" ? alertTypeSchema.safeParse(req.query.type).data : undefined;
    const conds: string[] = ["TRUE"];
    const params: unknown[] = [];
    let i = 1;
    if (status) {
      conds.push(`a.status = $${i}::alert_status`);
      params.push(status);
      i += 1;
    }
    if (type) {
      conds.push(`a.alert_type = $${i}::alert_type`);
      params.push(type);
      i += 1;
    }
    const where = conds.join(" AND ");
    params.push(pageSize, offset);
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT
         a.id::text,
         a.product_id::text,
         p.name AS product_name,
         a.alert_type::text,
         a.message,
         a.status::text,
         a.created_at,
         a.updated_at,
         a.resolved_at
       FROM alerts a
       JOIN products p ON p.id = a.product_id
       WHERE ${where}
       ORDER BY a.created_at DESC
       LIMIT $${i} OFFSET $${i + 1}`,
      params
    );
    const { rows: countRows } = await pool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM alerts a WHERE ${where}`,
      params.slice(0, -2)
    );
    res.json({ items: rows, page, page_size: pageSize, total: Number(countRows[0]?.c ?? "0") });
  } catch (err) {
    next(err);
  }
});

alertsRouter.get("/alerts/count", async (_req, res, next) => {
  try {
    const pool = getPool();
    const { rows } = await pool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM alerts WHERE status IN ('open', 'acknowledged')`
    );
    res.json({ open_count: Number(rows[0]?.c ?? "0") });
  } catch (err) {
    next(err);
  }
});

alertsRouter.patch("/alerts/:id", async (req, res, next) => {
  try {
    const body = z.object({ status: alertStatusSchema }).parse(req.body);
    const pool = getPool();
    const { rows, rowCount } = await pool.query(
      `UPDATE alerts
       SET status = $1::alert_status, updated_at = now(),
           resolved_at = CASE WHEN $1::alert_status = 'resolved'::alert_status THEN now() ELSE resolved_at END
       WHERE id = $2::uuid
       RETURNING id::text, product_id::text, alert_type::text, message, status::text, created_at, updated_at, resolved_at`,
      [body.status, req.params.id]
    );
    if (!rowCount) throw new AppError("Alert not found", 404);
    await writeAuditLog({
      userId: req.auth!.userId,
      action: "alerts.update",
      metadata: { alertId: req.params.id, status: body.status },
      ip: req.ip ?? null,
    });
    res.json(rows[0]);
  } catch (err) {
    if (err instanceof z.ZodError) {
      next(new AppError(err.issues.map((i) => i.message).join("; "), 400));
      return;
    }
    next(err);
  }
});

alertsRouter.post("/alerts/reconcile", requireRoles("admin", "manager"), async (req, res, next) => {
  try {
    const result = await reconcileAllAlerts();
    await writeAuditLog({
      userId: req.auth!.userId,
      action: "alerts.reconcile",
      metadata: result,
      ip: req.ip ?? null,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});
