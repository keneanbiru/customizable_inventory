import { Router, type Request } from "express";
import { z } from "zod";
import { getPool } from "../db/pool.js";
import { AppError } from "../lib/AppError.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { writeAuditLog } from "../services/auditLog.js";

export const metadataRouter = Router();
metadataRouter.use(requireAuth);

function clientIp(req: Pick<Request, "ip" | "headers">): string | null {
  const x = req.headers["x-forwarded-for"];
  if (typeof x === "string" && x.length) {
    return x.split(",")[0]?.trim() ?? null;
  }
  return req.ip ?? null;
}

function requireAdmin(req: Request): void {
  if (req.auth?.role !== "admin") {
    throw new AppError("Forbidden", 403);
  }
}

async function assertNoCategoryCycle(categoryId: string, parentId: string): Promise<void> {
  const pool = getPool();
  let current: string | null = parentId;
  while (current) {
    if (current === categoryId) {
      throw new AppError("Category parent creates a cycle", 400);
    }
    const result: { rows: Array<{ parent_id: string | null }> } = await pool.query<{
      parent_id: string | null;
    }>(
      "SELECT parent_id::text FROM categories WHERE id = $1::uuid",
      [current]
    );
    current = result.rows[0]?.parent_id ?? null;
  }
}

const categoryCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  parent_id: z.string().uuid().nullable().optional(),
  sort_order: z.number().int().min(-100000).max(100000).optional(),
  is_active: z.boolean().optional(),
});

const categoryPatchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  parent_id: z.string().uuid().nullable().optional(),
  sort_order: z.number().int().min(-100000).max(100000).optional(),
  is_active: z.boolean().optional(),
});

metadataRouter.get("/categories", async (req, res, next) => {
  try {
    const includeInactive =
      req.auth?.role === "admin" && req.query.include_inactive === "true";
    const pool = getPool();
    const { rows } = await pool.query<{
      id: string;
      name: string;
      parent_id: string | null;
      sort_order: number;
      is_active: boolean;
      product_count: number;
      active_product_count: number;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT
         c.id,
         c.name,
         c.parent_id::text,
         c.sort_order,
         c.is_active,
         COALESCE(cp.product_count, 0)::int AS product_count,
         COALESCE(cp.active_product_count, 0)::int AS active_product_count,
         c.created_at,
         c.updated_at
       FROM categories c
       LEFT JOIN (
         SELECT
           category_id,
           COUNT(*)::int AS product_count,
           COUNT(*) FILTER (WHERE is_active = true)::int AS active_product_count
         FROM products
         GROUP BY category_id
       ) cp ON cp.category_id = c.id
       WHERE ($1::boolean = true OR c.is_active = true)
       ORDER BY c.sort_order ASC, c.created_at ASC`,
      [includeInactive]
    );
    res.json({ items: rows });
  } catch (err) {
    next(err);
  }
});

metadataRouter.get("/categories/:id", async (req, res, next) => {
  try {
    const pool = getPool();
    const { rows } = await pool.query<{
      id: string;
      name: string;
      parent_id: string | null;
      sort_order: number;
      is_active: boolean;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT id, name, parent_id::text, sort_order, is_active, created_at, updated_at
       FROM categories WHERE id = $1::uuid`,
      [req.params.id]
    );
    if (!rows[0]) {
      throw new AppError("Category not found", 404);
    }
    if (!rows[0].is_active && req.auth?.role !== "admin") {
      throw new AppError("Category not found", 404);
    }
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

metadataRouter.post("/categories", async (req, res, next) => {
  try {
    requireAdmin(req);
    const body = categoryCreateSchema.parse(req.body);
    if (body.parent_id) {
      const pool = getPool();
      const { rowCount } = await pool.query("SELECT 1 FROM categories WHERE id = $1::uuid", [
        body.parent_id,
      ]);
      if (!rowCount) {
        throw new AppError("Parent category not found", 400);
      }
    }
    const pool = getPool();
    const { rows } = await pool.query<{
      id: string;
      name: string;
      parent_id: string | null;
      sort_order: number;
      is_active: boolean;
      created_at: string;
      updated_at: string;
    }>(
      `INSERT INTO categories (name, parent_id, sort_order, is_active)
       VALUES ($1, $2::uuid, $3, $4)
       RETURNING id, name, parent_id::text, sort_order, is_active, created_at, updated_at`,
      [body.name, body.parent_id ?? null, body.sort_order ?? 0, body.is_active ?? true]
    );
    await writeAuditLog({
      userId: req.auth!.userId,
      action: "categories.create",
      metadata: { categoryId: rows[0]!.id, name: body.name },
      ip: clientIp(req),
    });
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err instanceof z.ZodError) {
      next(new AppError(err.issues.map((i) => i.message).join("; "), 400));
      return;
    }
    next(err);
  }
});

metadataRouter.patch("/categories/:id", async (req, res, next) => {
  try {
    requireAdmin(req);
    const body = categoryPatchSchema.parse(req.body);
    if (Object.keys(body).length === 0) {
      throw new AppError("No fields to update", 400);
    }
    const pool = getPool();
    const { rowCount: existing } = await pool.query(
      "SELECT 1 FROM categories WHERE id = $1::uuid",
      [req.params.id]
    );
    if (!existing) {
      throw new AppError("Category not found", 404);
    }
    if (body.parent_id) {
      const { rowCount: parentExists } = await pool.query(
        "SELECT 1 FROM categories WHERE id = $1::uuid",
        [body.parent_id]
      );
      if (!parentExists) {
        throw new AppError("Parent category not found", 400);
      }
      await assertNoCategoryCycle(req.params.id, body.parent_id);
    }

    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    if (body.name !== undefined) {
      fields.push(`name = $${i++}`);
      values.push(body.name);
    }
    if (body.parent_id !== undefined) {
      fields.push(`parent_id = $${i++}::uuid`);
      values.push(body.parent_id);
    }
    if (body.sort_order !== undefined) {
      fields.push(`sort_order = $${i++}`);
      values.push(body.sort_order);
    }
    if (body.is_active !== undefined) {
      fields.push(`is_active = $${i++}`);
      values.push(body.is_active);
    }
    fields.push("updated_at = now()");
    values.push(req.params.id);
    const { rows } = await pool.query<{
      id: string;
      name: string;
      parent_id: string | null;
      sort_order: number;
      is_active: boolean;
      created_at: string;
      updated_at: string;
    }>(
      `UPDATE categories SET ${fields.join(", ")}
       WHERE id = $${i}::uuid
       RETURNING id, name, parent_id::text, sort_order, is_active, created_at, updated_at`,
      values
    );
    await writeAuditLog({
      userId: req.auth!.userId,
      action: "categories.update",
      metadata: { categoryId: req.params.id, fields: Object.keys(body) },
      ip: clientIp(req),
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

metadataRouter.delete("/categories/:id", async (req, res, next) => {
  try {
    requireAdmin(req);
    const pool = getPool();
    const { rowCount: childCount } = await pool.query(
      "SELECT 1 FROM categories WHERE parent_id = $1::uuid LIMIT 1",
      [req.params.id]
    );
    if (childCount) {
      throw new AppError("Cannot delete category with child categories", 409);
    }
    const { rowCount } = await pool.query("DELETE FROM categories WHERE id = $1::uuid", [
      req.params.id,
    ]);
    if (!rowCount) {
      throw new AppError("Category not found", 404);
    }
    await writeAuditLog({
      userId: req.auth!.userId,
      action: "categories.delete",
      metadata: { categoryId: req.params.id },
      ip: clientIp(req),
    });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

const unitCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  code: z.string().trim().min(1).max(30),
  allows_fractional: z.boolean(),
  is_active: z.boolean().optional(),
});

const unitPatchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  code: z.string().trim().min(1).max(30).optional(),
  allows_fractional: z.boolean().optional(),
  is_active: z.boolean().optional(),
});

metadataRouter.get("/units", async (req, res, next) => {
  try {
    const includeInactive =
      req.auth?.role === "admin" && req.query.include_inactive === "true";
    const pool = getPool();
    const { rows } = await pool.query<{
      id: string;
      name: string;
      code: string;
      allows_fractional: boolean;
      is_active: boolean;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT id, name, code, allows_fractional, is_active, created_at, updated_at
       FROM units
       WHERE ($1::boolean = true OR is_active = true)
       ORDER BY name ASC`,
      [includeInactive]
    );
    res.json({ items: rows });
  } catch (err) {
    next(err);
  }
});

metadataRouter.get("/units/:id", async (req, res, next) => {
  try {
    const pool = getPool();
    const { rows } = await pool.query<{
      id: string;
      name: string;
      code: string;
      allows_fractional: boolean;
      is_active: boolean;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT id, name, code, allows_fractional, is_active, created_at, updated_at
       FROM units WHERE id = $1::uuid`,
      [req.params.id]
    );
    if (!rows[0]) {
      throw new AppError("Unit not found", 404);
    }
    if (!rows[0].is_active && req.auth?.role !== "admin") {
      throw new AppError("Unit not found", 404);
    }
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

metadataRouter.post("/units", async (req, res, next) => {
  try {
    requireAdmin(req);
    const body = unitCreateSchema.parse(req.body);
    const pool = getPool();
    const { rows } = await pool.query<{
      id: string;
      name: string;
      code: string;
      allows_fractional: boolean;
      is_active: boolean;
      created_at: string;
      updated_at: string;
    }>(
      `INSERT INTO units (name, code, allows_fractional, is_active)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, code, allows_fractional, is_active, created_at, updated_at`,
      [body.name, body.code, body.allows_fractional, body.is_active ?? true]
    );
    await writeAuditLog({
      userId: req.auth!.userId,
      action: "units.create",
      metadata: { unitId: rows[0]!.id, code: body.code },
      ip: clientIp(req),
    });
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err instanceof z.ZodError) {
      next(new AppError(err.issues.map((i) => i.message).join("; "), 400));
      return;
    }
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "23505") {
      next(new AppError("Unit code already exists", 409));
      return;
    }
    next(err);
  }
});

metadataRouter.patch("/units/:id", async (req, res, next) => {
  try {
    requireAdmin(req);
    const body = unitPatchSchema.parse(req.body);
    if (Object.keys(body).length === 0) {
      throw new AppError("No fields to update", 400);
    }
    const pool = getPool();
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
    if (body.allows_fractional !== undefined) {
      fields.push(`allows_fractional = $${i++}`);
      values.push(body.allows_fractional);
    }
    if (body.is_active !== undefined) {
      fields.push(`is_active = $${i++}`);
      values.push(body.is_active);
    }
    fields.push("updated_at = now()");
    values.push(req.params.id);
    const { rows, rowCount } = await pool.query<{
      id: string;
      name: string;
      code: string;
      allows_fractional: boolean;
      is_active: boolean;
      created_at: string;
      updated_at: string;
    }>(
      `UPDATE units SET ${fields.join(", ")}
       WHERE id = $${i}::uuid
       RETURNING id, name, code, allows_fractional, is_active, created_at, updated_at`,
      values
    );
    if (!rowCount) {
      throw new AppError("Unit not found", 404);
    }
    await writeAuditLog({
      userId: req.auth!.userId,
      action: "units.update",
      metadata: { unitId: req.params.id, fields: Object.keys(body) },
      ip: clientIp(req),
    });
    res.json(rows[0]);
  } catch (err) {
    if (err instanceof z.ZodError) {
      next(new AppError(err.issues.map((i) => i.message).join("; "), 400));
      return;
    }
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "23505") {
      next(new AppError("Unit code already exists", 409));
      return;
    }
    next(err);
  }
});

metadataRouter.delete("/units/:id", async (req, res, next) => {
  try {
    requireAdmin(req);
    const pool = getPool();
    const { rowCount } = await pool.query("DELETE FROM units WHERE id = $1::uuid", [req.params.id]);
    if (!rowCount) {
      throw new AppError("Unit not found", 404);
    }
    await writeAuditLog({
      userId: req.auth!.userId,
      action: "units.delete",
      metadata: { unitId: req.params.id },
      ip: clientIp(req),
    });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
