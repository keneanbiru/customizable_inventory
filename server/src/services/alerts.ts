import { getPool } from "../db/pool.js";
import { resolveExpiryWarningDays, resolveLowStockThreshold } from "../domain/thresholdResolver.js";

type AlertType = "low_stock" | "expiry" | "reorder";

async function upsertOpenAlert(params: {
  productId: string;
  type: AlertType;
  message: string;
}): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE alerts
     SET message = $1, status = 'open'::alert_status, updated_at = now(), resolved_at = NULL
     WHERE product_id = $2::uuid AND alert_type = $3::alert_type AND status IN ('open', 'acknowledged')`,
    [params.message, params.productId, params.type]
  );
  const { rows } = await pool.query<{ c: string }>(
    `SELECT COUNT(*)::text AS c
     FROM alerts
     WHERE product_id = $1::uuid AND alert_type = $2::alert_type AND status IN ('open', 'acknowledged')`,
    [params.productId, params.type]
  );
  if (Number(rows[0]?.c ?? "0") === 0) {
    await pool.query(
      `INSERT INTO alerts (product_id, alert_type, message, status)
       VALUES ($1::uuid, $2::alert_type, $3, 'open'::alert_status)`,
      [params.productId, params.type, params.message]
    );
  }
}

async function resolveOpenAlert(productId: string, type: AlertType): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE alerts
     SET status = 'resolved'::alert_status, updated_at = now(), resolved_at = now()
     WHERE product_id = $1::uuid AND alert_type = $2::alert_type AND status IN ('open', 'acknowledged')`,
    [productId, type]
  );
}

export async function syncProductAlerts(productId: string): Promise<void> {
  const pool = getPool();
  const { rows } = await pool.query<{
    id: string;
    name: string;
    quantity_on_hand: string;
    reorder_level: string | null;
    low_stock_threshold: string | null;
    expiry_warning_days: number | null;
    expiry_date: string | null;
    category_low_stock_threshold: string | null;
    category_expiry_warning_days: number | null;
    default_low_stock_threshold: string | null;
    default_expiry_warning_days: string | null;
  }>(
    `SELECT
       p.id::text,
       p.name,
       p.quantity_on_hand::text,
       p.reorder_level::text,
       p.low_stock_threshold::text,
       p.expiry_warning_days,
       p.expiry_date::text,
       cs.low_stock_threshold::text AS category_low_stock_threshold,
       cs.expiry_warning_days AS category_expiry_warning_days,
       (SELECT value #>> '{}' FROM system_settings WHERE key = 'default_low_stock_threshold') AS default_low_stock_threshold,
       (SELECT value #>> '{}' FROM system_settings WHERE key = 'default_expiry_warning_days') AS default_expiry_warning_days
     FROM products p
     LEFT JOIN category_settings cs ON cs.category_id = p.category_id
     WHERE p.id = $1::uuid`,
    [productId]
  );
  const row = rows[0];
  if (!row) return;

  const qoh = Number(row.quantity_on_hand);
  const resolvedLow = resolveLowStockThreshold({
    productLowStockThreshold: row.low_stock_threshold === null ? null : Number(row.low_stock_threshold),
    categoryLowStockThreshold:
      row.category_low_stock_threshold === null ? null : Number(row.category_low_stock_threshold),
    defaultLowStockThreshold: Number(row.default_low_stock_threshold ?? "10"),
    productExpiryWarningDays: row.expiry_warning_days,
    categoryExpiryWarningDays: row.category_expiry_warning_days,
    defaultExpiryWarningDays: Number(row.default_expiry_warning_days ?? "7"),
  });
  if (qoh <= resolvedLow) {
    await upsertOpenAlert({
      productId,
      type: "low_stock",
      message: `${row.name} is low on stock (${qoh} <= ${resolvedLow}).`,
    });
  } else {
    await resolveOpenAlert(productId, "low_stock");
  }

  const reorderPoint = row.reorder_level === null ? null : Number(row.reorder_level);
  if (reorderPoint !== null && qoh <= reorderPoint) {
    await upsertOpenAlert({
      productId,
      type: "reorder",
      message: `${row.name} reached reorder level (${qoh} <= ${reorderPoint}).`,
    });
  } else {
    await resolveOpenAlert(productId, "reorder");
  }

  if (row.expiry_date) {
    const resolvedExpiryDays = resolveExpiryWarningDays({
      productLowStockThreshold: row.low_stock_threshold === null ? null : Number(row.low_stock_threshold),
      categoryLowStockThreshold:
        row.category_low_stock_threshold === null ? null : Number(row.category_low_stock_threshold),
      defaultLowStockThreshold: Number(row.default_low_stock_threshold ?? "10"),
      productExpiryWarningDays: row.expiry_warning_days,
      categoryExpiryWarningDays: row.category_expiry_warning_days,
      defaultExpiryWarningDays: Number(row.default_expiry_warning_days ?? "7"),
    });
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const expiry = new Date(row.expiry_date);
    expiry.setHours(0, 0, 0, 0);
    const daysLeft = Math.ceil((expiry.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
    if (daysLeft <= resolvedExpiryDays) {
      await upsertOpenAlert({
        productId,
        type: "expiry",
        message: `${row.name} expires in ${daysLeft} day(s).`,
      });
    } else {
      await resolveOpenAlert(productId, "expiry");
    }
  } else {
    await resolveOpenAlert(productId, "expiry");
  }
}

export async function reconcileAllAlerts(): Promise<{ checked: number }> {
  const pool = getPool();
  const { rows } = await pool.query<{ id: string }>("SELECT id::text FROM products");
  for (const r of rows) {
    await syncProductAlerts(r.id);
  }
  return { checked: rows.length };
}
