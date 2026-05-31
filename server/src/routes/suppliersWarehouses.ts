import { Router, type Request } from "express";
import { z } from "zod";
import { getPool } from "../db/pool.js";
import { AppError } from "../lib/AppError.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireRoles } from "../middleware/requireRoles.js";
import { writeAuditLog } from "../services/auditLog.js";

const supplierStatus = ["active", "inactive", "deleted"] as const;
type SupplierStatus = (typeof supplierStatus)[number];

export const suppliersRouter = Router();
export const warehousesRouter = Router();

function clientIp(req: Pick<Request, "ip" | "headers">): string | null {
  const x = req.headers["x-forwarded-for"];
  if (typeof x === "string" && x.length) return x.split(",")[0]?.trim() ?? null;
  return req.ip ?? null;
}

function requireAdminOrManager(req: Request): void {
  if (req.auth?.role !== "admin" && req.auth?.role !== "manager") {
    throw new AppError("Forbidden", 403);
  }
}

const supplierSchema = z.object({
  supplier_code: z.string().trim().min(1).max(60),
  display_name: z.string().trim().min(1).max(120),
  contact_name: z.string().trim().max(120).nullable().optional(),
  email: z.string().email().nullable().optional(),
  phone: z.string().trim().max(50).nullable().optional(),
  address: z.string().trim().max(500).nullable().optional(),
  avatar_url: z.string().trim().max(2048).nullable().optional(),
  status: z.enum(supplierStatus).optional(),
});

const supplierPatchSchema = supplierSchema.partial();

suppliersRouter.use(requireAuth);

suppliersRouter.get("/", requireRoles("admin", "manager"), async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.page_size) || 20));
    const offset = (page - 1) * pageSize;
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const status =
      typeof req.query.status === "string" && supplierStatus.includes(req.query.status as SupplierStatus)
        ? (req.query.status as SupplierStatus)
        : null;

    const pool = getPool();
    const conds: string[] = ["TRUE"];
    const params: unknown[] = [];
    let i = 1;
    if (search) {
      conds.push(`(display_name ILIKE $${i} OR supplier_code ILIKE $${i + 1} OR COALESCE(email,'') ILIKE $${i + 2})`);
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
      i += 3;
    }
    if (status) {
      conds.push(`status = $${i}::supplier_status`);
      params.push(status);
      i += 1;
    }
    const where = conds.join(" AND ");
    params.push(pageSize, offset);

    const { rows } = await pool.query(
      `SELECT id, supplier_code, display_name, contact_name, email, phone, address, avatar_url,
              status::text, created_at, updated_at
       FROM suppliers
       WHERE ${where}
       ORDER BY created_at DESC
       LIMIT $${i} OFFSET $${i + 1}`,
      params
    );
    const { rows: cRows } = await pool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM suppliers WHERE ${where}`,
      params.slice(0, -2)
    );
    res.json({
      items: rows,
      page,
      page_size: pageSize,
      total: Number(cRows[0]?.c ?? "0"),
    });
  } catch (err) {
    next(err);
  }
});

suppliersRouter.get("/stats", requireRoles("admin", "manager"), async (_req, res, next) => {
  try {
    const pool = getPool();
    const { rows } = await pool.query<{ status: SupplierStatus; c: string }>(
      `SELECT status::text AS status, COUNT(*)::text AS c
       FROM suppliers
       GROUP BY status`
    );
    const stats = { active: 0, inactive: 0, deleted: 0 };
    for (const r of rows) stats[r.status] = Number(r.c);
    res.json(stats);
  } catch (err) {
    next(err);
  }
});

suppliersRouter.get("/export", requireRoles("admin", "manager"), async (req, res, next) => {
  try {
    const pool = getPool();
    const status =
      typeof req.query.status === "string" && supplierStatus.includes(req.query.status as SupplierStatus)
        ? (req.query.status as SupplierStatus)
        : null;
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const conds: string[] = ["TRUE"];
    const params: unknown[] = [];
    let i = 1;
    if (search) {
      conds.push(`(display_name ILIKE $${i} OR supplier_code ILIKE $${i + 1} OR COALESCE(email,'') ILIKE $${i + 2})`);
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
      i += 3;
    }
    if (status) {
      conds.push(`status = $${i}::supplier_status`);
      params.push(status);
    }
    const { rows } = await pool.query(
      `SELECT supplier_code, display_name, contact_name, email, phone, address, status::text, created_at
       FROM suppliers WHERE ${conds.join(" AND ")} ORDER BY created_at DESC`,
      params
    );
    const header = "supplier_code,display_name,contact_name,email,phone,address,status,created_at";
    const lines = rows.map((r) =>
      [
        r.supplier_code,
        r.display_name,
        r.contact_name ?? "",
        r.email ?? "",
        r.phone ?? "",
        r.address ?? "",
        r.status,
        new Date(r.created_at).toISOString(),
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(",")
    );
    const csv = [header, ...lines].join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=suppliers.csv");
    res.status(200).send(csv);
  } catch (err) {
    next(err);
  }
});

suppliersRouter.get("/:id", requireRoles("admin", "manager"), async (req, res, next) => {
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT id, supplier_code, display_name, contact_name, email, phone, address, avatar_url,
              status::text, created_at, updated_at
       FROM suppliers WHERE id = $1::uuid`,
      [req.params.id]
    );
    if (!rows[0]) throw new AppError("Supplier not found", 404);
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

suppliersRouter.post("/", async (req, res, next) => {
  try {
    requireAdminOrManager(req);
    const body = supplierSchema.parse(req.body);
    const pool = getPool();
    const { rows } = await pool.query(
      `INSERT INTO suppliers (supplier_code, display_name, contact_name, email, phone, address, avatar_url, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::supplier_status)
       RETURNING id, supplier_code, display_name, contact_name, email, phone, address, avatar_url,
                 status::text, created_at, updated_at`,
      [
        body.supplier_code,
        body.display_name,
        body.contact_name ?? null,
        body.email ?? null,
        body.phone ?? null,
        body.address ?? null,
        body.avatar_url ?? null,
        body.status ?? "active",
      ]
    );
    await writeAuditLog({
      userId: req.auth!.userId,
      action: "suppliers.create",
      metadata: { supplierId: rows[0]!.id, supplier_code: body.supplier_code },
      ip: clientIp(req),
    });
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err instanceof z.ZodError) {
      next(new AppError(err.issues.map((i) => i.message).join("; "), 400));
      return;
    }
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "23505") {
      next(new AppError("Supplier code already exists", 409));
      return;
    }
    next(err);
  }
});

suppliersRouter.patch("/:id", async (req, res, next) => {
  try {
    requireAdminOrManager(req);
    const body = supplierPatchSchema.parse(req.body);
    if (!Object.keys(body).length) throw new AppError("No fields to update", 400);
    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    if (body.supplier_code !== undefined) {
      fields.push(`supplier_code = $${i++}`);
      values.push(body.supplier_code);
    }
    if (body.display_name !== undefined) {
      fields.push(`display_name = $${i++}`);
      values.push(body.display_name);
    }
    if (body.contact_name !== undefined) {
      fields.push(`contact_name = $${i++}`);
      values.push(body.contact_name);
    }
    if (body.email !== undefined) {
      fields.push(`email = $${i++}`);
      values.push(body.email);
    }
    if (body.phone !== undefined) {
      fields.push(`phone = $${i++}`);
      values.push(body.phone);
    }
    if (body.address !== undefined) {
      fields.push(`address = $${i++}`);
      values.push(body.address);
    }
    if (body.avatar_url !== undefined) {
      fields.push(`avatar_url = $${i++}`);
      values.push(body.avatar_url);
    }
    if (body.status !== undefined) {
      fields.push(`status = $${i++}::supplier_status`);
      values.push(body.status);
    }
    fields.push("updated_at = now()");
    values.push(req.params.id);
    const pool = getPool();
    const { rows, rowCount } = await pool.query(
      `UPDATE suppliers SET ${fields.join(", ")}
       WHERE id = $${i}::uuid
       RETURNING id, supplier_code, display_name, contact_name, email, phone, address, avatar_url,
                 status::text, created_at, updated_at`,
      values
    );
    if (!rowCount) throw new AppError("Supplier not found", 404);
    await writeAuditLog({
      userId: req.auth!.userId,
      action: "suppliers.update",
      metadata: { supplierId: req.params.id, fields: Object.keys(body) },
      ip: clientIp(req),
    });
    res.json(rows[0]);
  } catch (err) {
    if (err instanceof z.ZodError) {
      next(new AppError(err.issues.map((i) => i.message).join("; "), 400));
      return;
    }
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "23505") {
      next(new AppError("Supplier code already exists", 409));
      return;
    }
    next(err);
  }
});

suppliersRouter.delete("/:id", requireRoles("admin"), async (req, res, next) => {
  try {
    const pool = getPool();
    const { rowCount } = await pool.query(
      `UPDATE suppliers SET status = 'deleted', updated_at = now() WHERE id = $1::uuid`,
      [req.params.id]
    );
    if (!rowCount) throw new AppError("Supplier not found", 404);
    await writeAuditLog({
      userId: req.auth!.userId,
      action: "suppliers.delete",
      metadata: { supplierId: req.params.id },
      ip: clientIp(req),
    });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

const warehouseSchema = z.object({
  name: z.string().trim().min(1).max(120),
  code: z.string().trim().min(1).max(40).nullable().optional(),
  capacity_skus: z.number().int().positive().optional(),
  is_default: z.boolean().optional(),
});

const warehousePatchSchema = warehouseSchema.partial();

warehousesRouter.use(requireAuth);

warehousesRouter.get("/", async (_req, res, next) => {
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT
         w.id,
         w.name,
         w.code,
         w.capacity_skus,
         w.is_default,
         w.created_at,
         w.updated_at,
         COALESCE(ws.used_skus, 0)::int AS used_skus
       FROM warehouses w
       LEFT JOIN (
         SELECT warehouse_id, COUNT(DISTINCT product_id)::int AS used_skus
         FROM product_warehouse_stock
         GROUP BY warehouse_id
       ) ws ON ws.warehouse_id = w.id
       ORDER BY w.is_default DESC, w.created_at ASC`
    );
    res.json({ items: rows });
  } catch (err) {
    next(err);
  }
});

warehousesRouter.post("/", requireRoles("admin"), async (req, res, next) => {
  try {
    const body = warehouseSchema.parse(req.body);
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (body.is_default) {
        await client.query("UPDATE warehouses SET is_default = false WHERE is_default = true");
      }
      const { rows } = await client.query(
        `INSERT INTO warehouses (name, code, capacity_skus, is_default)
         VALUES ($1,$2,$3,$4)
         RETURNING id, name, code, capacity_skus, is_default, created_at, updated_at`,
        [body.name, body.code ?? null, body.capacity_skus ?? 15000, body.is_default ?? false]
      );
      await client.query("COMMIT");
      await writeAuditLog({
        userId: req.auth!.userId,
        action: "warehouses.create",
        metadata: { warehouseId: rows[0]!.id, name: body.name },
        ip: clientIp(req),
      });
      res.status(201).json(rows[0]);
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    if (err instanceof z.ZodError) {
      next(new AppError(err.issues.map((i) => i.message).join("; "), 400));
      return;
    }
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "23505") {
      next(new AppError("Warehouse code already exists", 409));
      return;
    }
    next(err);
  }
});

warehousesRouter.patch("/:id", requireRoles("admin"), async (req, res, next) => {
  try {
    const body = warehousePatchSchema.parse(req.body);
    if (!Object.keys(body).length) throw new AppError("No fields to update", 400);
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (body.is_default === true) {
        await client.query("UPDATE warehouses SET is_default = false WHERE is_default = true");
      }
      const fields: string[] = [];
      const values: unknown[] = [];
      let i = 1;
      if (body.name !== undefined) {
        fields.push(`name = $${i++}`);
        values.push(body.name);
      }
      if (body.code !== undefined) {
        fields.push(`code = $${i++}`);
        values.push(body.code);
      }
      if (body.capacity_skus !== undefined) {
        fields.push(`capacity_skus = $${i++}`);
        values.push(body.capacity_skus);
      }
      if (body.is_default !== undefined) {
        fields.push(`is_default = $${i++}`);
        values.push(body.is_default);
      }
      fields.push("updated_at = now()");
      values.push(req.params.id);
      const { rows, rowCount } = await client.query(
        `UPDATE warehouses SET ${fields.join(", ")}
         WHERE id = $${i}::uuid
         RETURNING id, name, code, capacity_skus, is_default, created_at, updated_at`,
        values
      );
      if (!rowCount) throw new AppError("Warehouse not found", 404);
      await client.query("COMMIT");
      await writeAuditLog({
        userId: req.auth!.userId,
        action: "warehouses.update",
        metadata: { warehouseId: req.params.id, fields: Object.keys(body) },
        ip: clientIp(req),
      });
      res.json(rows[0]);
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    if (err instanceof z.ZodError) {
      next(new AppError(err.issues.map((i) => i.message).join("; "), 400));
      return;
    }
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "23505") {
      next(new AppError("Warehouse code already exists", 409));
      return;
    }
    next(err);
  }
});
