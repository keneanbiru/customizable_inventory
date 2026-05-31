import { Router } from "express";
import { z } from "zod";
import { getPool } from "../db/pool.js";
import { AppError } from "../lib/AppError.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireRoles } from "../middleware/requireRoles.js";
import { writeAuditLog } from "../services/auditLog.js";
import { syncProductAlerts } from "../services/alerts.js";

const decimalValue = z
  .union([z.number(), z.string()])
  .transform((value) => Number(value))
  .refine((value) => Number.isFinite(value), "Must be a valid number")
  .refine((value) => value >= 0, "Must be non-negative");

const productSchema = z.object({
  sku: z.string().trim().min(1).max(60),
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(1200).nullable().optional(),
  category_id: z.string().uuid(),
  unit_id: z.string().uuid(),
  supplier_id: z.string().uuid().nullable().optional(),
  warehouse_id: z.string().uuid(),
  cost_price: decimalValue.nullable().optional(),
  selling_price: decimalValue.nullable().optional(),
  reorder_level: decimalValue.nullable().optional(),
  expiry_warning_days: z.number().int().min(0).nullable().optional(),
  expiry_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  low_stock_threshold: decimalValue.nullable().optional(),
  is_active: z.boolean().optional(),
});

const productPatchSchema = productSchema.partial();
const stockMoveSchema = z.object({
  quantity: decimalValue.refine((value) => value > 0, "Quantity must be greater than zero"),
  note: z.string().trim().max(500).nullable().optional(),
  warehouse_id: z.string().uuid(),
  grn_reference: z.string().trim().max(120).nullable().optional(),
});
const stockAdjustSchema = z
  .object({
    delta: decimalValue.nullable().optional(),
    quantity_after: decimalValue.nullable().optional(),
    note: z.string().trim().max(500).nullable().optional(),
    warehouse_id: z.string().uuid(),
  })
  .refine(
    (value) =>
      (value.delta !== undefined && value.delta !== null) !==
      (value.quantity_after !== undefined && value.quantity_after !== null),
    "Provide exactly one of delta or quantity_after"
  );
const transactionTypeSchema = z.enum(["in", "out", "adjustment"]);

function asSqlNumber(value: number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value.toString();
}

function routeParamId(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export const productsRouter = Router();

productsRouter.use(requireAuth);

async function applyStockChange(params: {
  productId: string;
  type: "in" | "out" | "adjustment";
  quantity: number;
  note?: string | null;
  warehouseId: string;
  userId: string;
}) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ id: string }>(
      "SELECT id::text FROM products WHERE id = $1::uuid FOR UPDATE",
      [params.productId]
    );
    if (!rows[0]) {
      throw new AppError("Product not found", 404);
    }

    const stockRow = await client.query<{ quantity_on_hand: string }>(
      `SELECT quantity_on_hand::text
       FROM product_warehouse_stock
       WHERE product_id = $1::uuid AND warehouse_id = $2::uuid
       FOR UPDATE`,
      [params.productId, params.warehouseId]
    );

    let currentWarehouseQty = Number(stockRow.rows[0]?.quantity_on_hand ?? "0");
    if (!stockRow.rows[0] && params.type === "in") {
      await client.query(
        `INSERT INTO product_warehouse_stock (product_id, warehouse_id, quantity_on_hand, updated_at)
         VALUES ($1::uuid, $2::uuid, 0, now())`,
        [params.productId, params.warehouseId]
      );
      currentWarehouseQty = 0;
    } else if (!stockRow.rows[0]) {
      throw new AppError("No stock record for this warehouse", 400);
    }
    let nextWarehouseQty = currentWarehouseQty;
    if (params.type === "in") nextWarehouseQty = currentWarehouseQty + params.quantity;
    if (params.type === "out") nextWarehouseQty = currentWarehouseQty - params.quantity;
    if (params.type === "adjustment") nextWarehouseQty = currentWarehouseQty + params.quantity;
    if (nextWarehouseQty < 0) throw new AppError("Insufficient stock for this warehouse", 400);

    await client.query(
      `INSERT INTO inventory_transactions (product_id, warehouse_id, transaction_type, quantity, notes, created_by)
       VALUES ($1::uuid, $2::uuid, $3::inventory_txn_type, $4, $5, $6::uuid)`,
      [
        params.productId,
        params.warehouseId,
        params.type,
        Math.abs(params.quantity).toString(),
        params.note ?? null,
        params.userId,
      ]
    );
    await client.query(
      `UPDATE product_warehouse_stock
       SET quantity_on_hand = $1, updated_at = now()
       WHERE product_id = $2::uuid AND warehouse_id = $3::uuid`,
      [nextWarehouseQty.toString(), params.productId, params.warehouseId]
    );

    const totalRows = await client.query<{ q: string }>(
      `SELECT COALESCE(SUM(quantity_on_hand), 0)::text AS q
       FROM product_warehouse_stock
       WHERE product_id = $1::uuid`,
      [params.productId]
    );
    const totalQty = Number(totalRows.rows[0]?.q ?? "0");
    const { rows: updatedRows } = await client.query(
      `UPDATE products SET quantity_on_hand = $1, updated_at = now()
       WHERE id = $2::uuid
       RETURNING id, sku, name, description, category_id, unit_id, supplier_id, warehouse_id,
                 cost_price::text, selling_price::text, quantity_on_hand::text, reorder_level::text,
                 expiry_warning_days, low_stock_threshold::text, is_active, created_at, updated_at`,
      [totalQty.toString(), params.productId]
    );
    await client.query("COMMIT");
    return updatedRows[0];
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function applyStockAdjustTo(params: {
  productId: string;
  quantityAfter: number;
  note?: string | null;
  warehouseId: string;
  userId: string;
}) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ id: string }>(
      "SELECT id::text FROM products WHERE id = $1::uuid FOR UPDATE",
      [params.productId]
    );
    if (!rows[0]) throw new AppError("Product not found", 404);
    const stockRow = await client.query<{ quantity_on_hand: string }>(
      `SELECT quantity_on_hand::text
       FROM product_warehouse_stock
       WHERE product_id = $1::uuid AND warehouse_id = $2::uuid
       FOR UPDATE`,
      [params.productId, params.warehouseId]
    );
    if (!stockRow.rows[0]) throw new AppError("No stock record for this warehouse", 400);
    const current = Number(stockRow.rows[0].quantity_on_hand);
    const delta = params.quantityAfter - current;
    if (delta === 0) throw new AppError("Adjustment delta cannot be zero", 400);
    if (params.quantityAfter < 0) throw new AppError("Quantity after adjustment cannot be negative", 400);
    await client.query(
      `INSERT INTO inventory_transactions (product_id, warehouse_id, transaction_type, quantity, notes, created_by)
       VALUES ($1::uuid, $2::uuid, 'adjustment'::inventory_txn_type, $3, $4, $5::uuid)`,
      [params.productId, params.warehouseId, Math.abs(delta).toString(), params.note ?? null, params.userId]
    );
    await client.query(
      `UPDATE product_warehouse_stock
       SET quantity_on_hand = $1, updated_at = now()
       WHERE product_id = $2::uuid AND warehouse_id = $3::uuid`,
      [params.quantityAfter.toString(), params.productId, params.warehouseId]
    );
    const totalRows = await client.query<{ q: string }>(
      `SELECT COALESCE(SUM(quantity_on_hand), 0)::text AS q
       FROM product_warehouse_stock
       WHERE product_id = $1::uuid`,
      [params.productId]
    );
    const totalQty = Number(totalRows.rows[0]?.q ?? "0");
    const { rows: updatedRows } = await client.query(
      `UPDATE products SET quantity_on_hand = $1, updated_at = now()
       WHERE id = $2::uuid
       RETURNING id, sku, name, description, category_id, unit_id, supplier_id, warehouse_id,
                 cost_price::text, selling_price::text, quantity_on_hand::text, reorder_level::text,
                 expiry_warning_days, low_stock_threshold::text, is_active, created_at, updated_at`,
      [totalQty.toString(), params.productId]
    );
    await client.query("COMMIT");
    return { updated: updatedRows[0], delta };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

productsRouter.get("/", async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.page_size) || 20));
    const offset = (page - 1) * pageSize;
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const isActiveFilter =
      typeof req.query.is_active === "string" ? req.query.is_active === "true" : null;
    const categoryId = typeof req.query.category_id === "string" ? req.query.category_id.trim() : "";
    const warehouseId =
      typeof req.query.warehouse_id === "string" ? req.query.warehouse_id.trim() : "";

    const conds: string[] = ["TRUE"];
    const params: unknown[] = [];
    let i = 1;
    if (search) {
      conds.push(`(p.name ILIKE $${i} OR p.sku ILIKE $${i + 1})`);
      params.push(`%${search}%`, `%${search}%`);
      i += 2;
    }
    if (isActiveFilter !== null) {
      conds.push(`p.is_active = $${i}`);
      params.push(isActiveFilter);
      i += 1;
    }
    if (categoryId) {
      conds.push(`p.category_id = $${i}::uuid`);
      params.push(categoryId);
      i += 1;
    }
    if (warehouseId) {
      conds.push(
        `EXISTS (
          SELECT 1
          FROM product_warehouse_stock pws
          WHERE pws.product_id = p.id AND pws.warehouse_id = $${i}::uuid
        )`
      );
      params.push(warehouseId);
      i += 1;
    }
    const where = conds.join(" AND ");

    params.push(pageSize, offset);
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT p.id, p.sku, p.name, p.description, p.category_id, c.name AS category_name,
              p.unit_id, u.name AS unit_name, p.supplier_id, s.display_name AS supplier_name,
              p.warehouse_id, w.name AS warehouse_name, p.cost_price::text, p.selling_price::text,
              p.quantity_on_hand::text, p.reorder_level::text, p.expiry_warning_days, p.expiry_date,
              p.low_stock_threshold::text, p.is_active, p.created_at, p.updated_at
       FROM products p
       JOIN categories c ON c.id = p.category_id
       JOIN units u ON u.id = p.unit_id
       LEFT JOIN suppliers s ON s.id = p.supplier_id
       LEFT JOIN warehouses w ON w.id = p.warehouse_id
       WHERE ${where}
       ORDER BY p.created_at DESC
       LIMIT $${i} OFFSET $${i + 1}`,
      params
    );
    const { rows: countRows } = await pool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM products p WHERE ${where}`,
      params.slice(0, -2)
    );
    res.json({
      items: rows,
      page,
      page_size: pageSize,
      total: Number(countRows[0]?.c ?? "0"),
    });
  } catch (err) {
    next(err);
  }
});

productsRouter.get("/transactions", async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.page_size) || 20));
    const offset = (page - 1) * pageSize;
    const productId = typeof req.query.product_id === "string" ? req.query.product_id : "";
    const txType =
      typeof req.query.type === "string" ? transactionTypeSchema.safeParse(req.query.type).data : undefined;
    const start = typeof req.query.start === "string" ? req.query.start : "";
    const end = typeof req.query.end === "string" ? req.query.end : "";

    const conds: string[] = ["TRUE"];
    const params: unknown[] = [];
    let i = 1;
    if (productId) {
      conds.push(`t.product_id = $${i}::uuid`);
      params.push(productId);
      i += 1;
    }
    if (txType) {
      conds.push(`t.transaction_type = $${i}::inventory_txn_type`);
      params.push(txType);
      i += 1;
    }
    if (start) {
      conds.push(`t.created_at >= $${i}::timestamptz`);
      params.push(start);
      i += 1;
    }
    if (end) {
      conds.push(`t.created_at <= $${i}::timestamptz`);
      params.push(end);
      i += 1;
    }
    const where = conds.join(" AND ");
    params.push(pageSize, offset);

    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT
        t.id,
        t.product_id::text,
        p.name AS product_name,
        t.warehouse_id::text,
        w.name AS warehouse_name,
        t.transaction_type::text,
        t.quantity::text,
        t.notes,
        t.created_by::text,
        u.email AS created_by_email,
        t.created_at
       FROM inventory_transactions t
       JOIN products p ON p.id = t.product_id
       LEFT JOIN warehouses w ON w.id = t.warehouse_id
       LEFT JOIN users u ON u.id = t.created_by
       WHERE ${where}
       ORDER BY t.created_at DESC
       LIMIT $${i} OFFSET $${i + 1}`,
      params
    );
    const { rows: countRows } = await pool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM inventory_transactions t WHERE ${where}`,
      params.slice(0, -2)
    );

    res.json({
      items: rows,
      page,
      page_size: pageSize,
      total: Number(countRows[0]?.c ?? "0"),
    });
  } catch (err) {
    next(err);
  }
});

productsRouter.get("/:id/transactions", async (req, res, next) => {
  try {
    const productId = routeParamId(req.params.id);
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.page_size) || 20));
    const offset = (page - 1) * pageSize;
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT
        t.id,
        t.product_id::text,
        p.name AS product_name,
        t.warehouse_id::text,
        w.name AS warehouse_name,
        t.transaction_type::text,
        t.quantity::text,
        t.notes,
        t.created_by::text,
        u.email AS created_by_email,
        t.created_at
       FROM inventory_transactions t
       JOIN products p ON p.id = t.product_id
       LEFT JOIN warehouses w ON w.id = t.warehouse_id
       LEFT JOIN users u ON u.id = t.created_by
       WHERE t.product_id = $1::uuid
       ORDER BY t.created_at DESC
       LIMIT $2 OFFSET $3`,
      [productId, pageSize, offset]
    );
    const { rows: countRows } = await pool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM inventory_transactions WHERE product_id = $1::uuid`,
      [productId]
    );
    res.json({
      items: rows,
      page,
      page_size: pageSize,
      total: Number(countRows[0]?.c ?? "0"),
    });
  } catch (err) {
    next(err);
  }
});

productsRouter.post("/", requireRoles("admin", "manager"), async (req, res, next) => {
  try {
    const body = productSchema.parse(req.body);
    const pool = getPool();
    const { rows } = await pool.query(
      `INSERT INTO products (
        sku, name, description, category_id, unit_id, supplier_id, warehouse_id,
        cost_price, selling_price, reorder_level, expiry_warning_days, expiry_date, low_stock_threshold, is_active
      ) VALUES (
        $1,$2,$3,$4::uuid,$5::uuid,$6::uuid,$7::uuid,$8,$9,$10,$11,$12::date,$13,$14
      )
      RETURNING id, sku, name, description, category_id, unit_id, supplier_id, warehouse_id,
                cost_price::text, selling_price::text, quantity_on_hand::text, reorder_level::text,
                expiry_warning_days, low_stock_threshold::text, is_active, created_at, updated_at`,
      [
        body.sku,
        body.name,
        body.description ?? null,
        body.category_id,
        body.unit_id,
        body.supplier_id ?? null,
        body.warehouse_id,
        asSqlNumber(body.cost_price),
        asSqlNumber(body.selling_price),
        asSqlNumber(body.reorder_level),
        body.expiry_warning_days ?? null,
        body.expiry_date ?? null,
        asSqlNumber(body.low_stock_threshold),
        body.is_active ?? true,
      ]
    );

    await pool.query(
      `INSERT INTO product_warehouse_stock (product_id, warehouse_id, quantity_on_hand, updated_at)
       VALUES ($1::uuid, $2::uuid, 0, now())
       ON CONFLICT (product_id, warehouse_id) DO NOTHING`,
      [rows[0]!.id, body.warehouse_id]
    );
    await writeAuditLog({
      userId: req.auth!.userId,
      action: "products.create",
      metadata: { productId: rows[0]!.id, sku: rows[0]!.sku },
      ip: req.ip ?? null,
    });
    await syncProductAlerts(rows[0]!.id);
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err instanceof z.ZodError) {
      next(new AppError(err.issues.map((i) => i.message).join("; "), 400));
      return;
    }
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "23505") {
      next(new AppError("SKU already exists", 409));
      return;
    }
    next(err);
  }
});

productsRouter.patch("/:id", requireRoles("admin", "manager"), async (req, res, next) => {
  try {
    const body = productPatchSchema.parse(req.body);
    if (!Object.keys(body).length) throw new AppError("No fields to update", 400);

    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (body.sku !== undefined) {
      fields.push(`sku = $${i++}`);
      values.push(body.sku);
    }
    if (body.name !== undefined) {
      fields.push(`name = $${i++}`);
      values.push(body.name);
    }
    if (body.description !== undefined) {
      fields.push(`description = $${i++}`);
      values.push(body.description);
    }
    if (body.category_id !== undefined) {
      fields.push(`category_id = $${i++}::uuid`);
      values.push(body.category_id);
    }
    if (body.unit_id !== undefined) {
      fields.push(`unit_id = $${i++}::uuid`);
      values.push(body.unit_id);
    }
    if (body.supplier_id !== undefined) {
      fields.push(`supplier_id = $${i++}::uuid`);
      values.push(body.supplier_id);
    }
    if (body.warehouse_id !== undefined) {
      fields.push(`warehouse_id = $${i++}::uuid`);
      values.push(body.warehouse_id);
    }
    if (body.cost_price !== undefined) {
      fields.push(`cost_price = $${i++}`);
      values.push(asSqlNumber(body.cost_price));
    }
    if (body.selling_price !== undefined) {
      fields.push(`selling_price = $${i++}`);
      values.push(asSqlNumber(body.selling_price));
    }
    if (body.reorder_level !== undefined) {
      fields.push(`reorder_level = $${i++}`);
      values.push(asSqlNumber(body.reorder_level));
    }
    if (body.expiry_warning_days !== undefined) {
      fields.push(`expiry_warning_days = $${i++}`);
      values.push(body.expiry_warning_days);
    }
    if (body.expiry_date !== undefined) {
      fields.push(`expiry_date = $${i++}::date`);
      values.push(body.expiry_date);
    }
    if (body.low_stock_threshold !== undefined) {
      fields.push(`low_stock_threshold = $${i++}`);
      values.push(asSqlNumber(body.low_stock_threshold));
    }
    if (body.is_active !== undefined) {
      fields.push(`is_active = $${i++}`);
      values.push(body.is_active);
    }

    fields.push("updated_at = now()");
    values.push(req.params.id);

    const pool = getPool();
    const { rows, rowCount } = await pool.query(
      `UPDATE products SET ${fields.join(", ")}
       WHERE id = $${i}::uuid
       RETURNING id, sku, name, description, category_id, unit_id, supplier_id, warehouse_id,
                 cost_price::text, selling_price::text, quantity_on_hand::text, reorder_level::text,
                 expiry_warning_days, low_stock_threshold::text, is_active, created_at, updated_at`,
      values
    );
    if (!rowCount) throw new AppError("Product not found", 404);

    await writeAuditLog({
      userId: req.auth!.userId,
      action: "products.update",
      metadata: { productId: req.params.id, fields: Object.keys(body) },
      ip: req.ip ?? null,
    });
    // await syncProductAlerts(req.params.id);

    res.json(rows[0]);
  } catch (err) {
    if (err instanceof z.ZodError) {
      next(new AppError(err.issues.map((i) => i.message).join("; "), 400));
      return;
    }
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "23505") {
      next(new AppError("SKU already exists", 409));
      return;
    }
    next(err);
  }
});

productsRouter.post(
  "/:id/stock/in",
  requireRoles("admin", "manager", "store_keeper"),
  async (req, res, next) => {
    try {
      const productId = routeParamId(req.params.id);
      const body = stockMoveSchema.parse(req.body);
      const updated = await applyStockChange({
        productId,
        type: "in",
        quantity: body.quantity,
        note: body.note ?? null,
        warehouseId: body.warehouse_id,
        userId: req.auth!.userId,
      });
      await writeAuditLog({
        userId: req.auth!.userId,
        action: "products.stock_in",
        metadata: { productId, quantity: body.quantity, grn_reference: body.grn_reference ?? null },
        ip: req.ip ?? null,
      });
      await syncProductAlerts(productId);
      res.json(updated);
    } catch (err) {
      if (err instanceof z.ZodError) {
        next(new AppError(err.issues.map((i) => i.message).join("; "), 400));
        return;
      }
      next(err);
    }
  }
);

productsRouter.post(
  "/:id/stock/out",
  requireRoles("admin", "manager", "store_keeper"),
  async (req, res, next) => {
    try {
      const productId = routeParamId(req.params.id);
      const body = stockMoveSchema.parse(req.body);
      const updated = await applyStockChange({
        productId,
        type: "out",
        quantity: body.quantity,
        note: body.note ?? null,
        warehouseId: body.warehouse_id,
        userId: req.auth!.userId,
      });
      await writeAuditLog({
        userId: req.auth!.userId,
        action: "products.stock_out",
        metadata: { productId, quantity: body.quantity },
        ip: req.ip ?? null,
      });
      await syncProductAlerts(productId);
      res.json(updated);
    } catch (err) {
      if (err instanceof z.ZodError) {
        next(new AppError(err.issues.map((i) => i.message).join("; "), 400));
        return;
      }
      next(err);
    }
  }
);

productsRouter.post(
  "/:id/stock/adjust",
  requireRoles("admin", "manager", "store_keeper"),
  async (req, res, next) => {
    try {
      const productId = routeParamId(req.params.id);
      const body = stockAdjustSchema.parse(req.body);
      if (body.quantity_after !== undefined && body.quantity_after !== null) {
        const { updated, delta } = await applyStockAdjustTo({
          productId,
          quantityAfter: body.quantity_after,
          note: body.note ?? null,
          warehouseId: body.warehouse_id,
          userId: req.auth!.userId,
        });
        await writeAuditLog({
          userId: req.auth!.userId,
          action: "products.stock_adjust",
          metadata: { productId, delta },
          ip: req.ip ?? null,
        });
        await syncProductAlerts(productId);
        res.json(updated);
        return;
      }
      const amount = Number(body.delta ?? 0);
      if (amount === 0) throw new AppError("Adjustment delta cannot be zero", 400);
      const updated = await applyStockChange({
        productId,
        type: "adjustment",
        quantity: amount,
        note: body.note ?? null,
        warehouseId: body.warehouse_id,
        userId: req.auth!.userId,
      });
      await writeAuditLog({
        userId: req.auth!.userId,
        action: "products.stock_adjust",
        metadata: { productId, delta: amount },
        ip: req.ip ?? null,
      });
      await syncProductAlerts(productId);
      res.json(updated);
    } catch (err) {
      if (err instanceof z.ZodError) {
        next(new AppError(err.issues.map((i) => i.message).join("; "), 400));
        return;
      }
      next(err);
    }
  }
);
