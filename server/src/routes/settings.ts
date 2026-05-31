import { Router } from "express";
import { z } from "zod";
import { getPool } from "../db/pool.js";
import { AppError } from "../lib/AppError.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireRoles } from "../middleware/requireRoles.js";

export const settingsRouter = Router();

const settingsSchema = z.object({
  store_timezone: z.string().min(1).max(100).optional(),
  default_low_stock_threshold: z.number().min(0).optional(),
  default_expiry_warning_days: z.number().int().min(0).optional(),
  app_name: z.string().min(1).max(120).optional(),
  logo_url: z.string().max(2048).nullable().optional(),
  primary_color_hex: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
  password_min_length: z.number().int().min(8).max(128).optional(),
});

const categorySettingsSchema = z.object({
  low_stock_threshold: z.number().min(0).nullable().optional(),
  expiry_warning_days: z.number().int().min(0).nullable().optional(),
});

const defaultSettings = {
  store_timezone: "UTC",
  default_low_stock_threshold: 10,
  default_expiry_warning_days: 7,
  app_name: "Hasu Inventory",
  logo_url: null as string | null,
  primary_color_hex: "#5B21B6",
  password_min_length: 8,
};

type SettingKey = keyof typeof defaultSettings;

async function getSettingsMap(): Promise<Record<string, unknown>> {
  const pool = getPool();
  const { rows } = await pool.query<{ key: string; value: unknown }>(
    "SELECT key, value FROM system_settings"
  );
  const map: Record<string, unknown> = {};
  for (const row of rows) {
    map[row.key] = row.value;
  }
  return map;
}

function validateTimezone(tz: string): void {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz }).format(new Date());
  } catch {
    throw new AppError("Invalid timezone", 400);
  }
}

settingsRouter.get("/settings", requireAuth, requireRoles("admin"), async (_req, res, next) => {
  try {
    const map = await getSettingsMap();
    const data = {
      store_timezone:
        typeof map.store_timezone === "string" ? map.store_timezone : defaultSettings.store_timezone,
      default_low_stock_threshold:
        typeof map.default_low_stock_threshold === "number"
          ? map.default_low_stock_threshold
          : defaultSettings.default_low_stock_threshold,
      default_expiry_warning_days:
        typeof map.default_expiry_warning_days === "number"
          ? map.default_expiry_warning_days
          : defaultSettings.default_expiry_warning_days,
      app_name: typeof map.app_name === "string" ? map.app_name : defaultSettings.app_name,
      logo_url: typeof map.logo_url === "string" || map.logo_url === null ? map.logo_url : null,
      primary_color_hex:
        typeof map.primary_color_hex === "string"
          ? map.primary_color_hex
          : defaultSettings.primary_color_hex,
      password_min_length:
        typeof map.password_min_length === "number"
          ? map.password_min_length
          : defaultSettings.password_min_length,
    };
    res.json(data);
  } catch (err) {
    next(err);
  }
});

settingsRouter.patch("/settings", requireAuth, requireRoles("admin"), async (req, res, next) => {
  try {
    const body = settingsSchema.parse(req.body);
    const keys = Object.keys(body) as SettingKey[];
    if (!keys.length) {
      throw new AppError("No fields to update", 400);
    }
    if (body.store_timezone) {
      validateTimezone(body.store_timezone);
    }
    const pool = getPool();
    for (const key of keys) {
      const value = body[key];
      await pool.query(
        `INSERT INTO system_settings (key, value, updated_at)
         VALUES ($1, $2::jsonb, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [key, JSON.stringify(value)]
      );
    }
    const map = await getSettingsMap();
    res.json({
      store_timezone:
        typeof map.store_timezone === "string" ? map.store_timezone : defaultSettings.store_timezone,
      default_low_stock_threshold:
        typeof map.default_low_stock_threshold === "number"
          ? map.default_low_stock_threshold
          : defaultSettings.default_low_stock_threshold,
      default_expiry_warning_days:
        typeof map.default_expiry_warning_days === "number"
          ? map.default_expiry_warning_days
          : defaultSettings.default_expiry_warning_days,
      app_name: typeof map.app_name === "string" ? map.app_name : defaultSettings.app_name,
      logo_url: typeof map.logo_url === "string" || map.logo_url === null ? map.logo_url : null,
      primary_color_hex:
        typeof map.primary_color_hex === "string"
          ? map.primary_color_hex
          : defaultSettings.primary_color_hex,
      password_min_length:
        typeof map.password_min_length === "number"
          ? map.password_min_length
          : defaultSettings.password_min_length,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      next(new AppError(err.issues.map((i) => i.message).join("; "), 400));
      return;
    }
    next(err);
  }
});

settingsRouter.get(
  "/category-settings/:categoryId",
  requireAuth,
  requireRoles("admin"),
  async (req, res, next) => {
  try {
    const pool = getPool();
    const { rowCount: categoryExists } = await pool.query(
      "SELECT 1 FROM categories WHERE id = $1::uuid",
      [req.params.categoryId]
    );
    if (!categoryExists) {
      throw new AppError("Category not found", 404);
    }
    const { rows } = await pool.query<{
      category_id: string;
      low_stock_threshold: number | null;
      expiry_warning_days: number | null;
    }>(
      `SELECT category_id::text, low_stock_threshold, expiry_warning_days
       FROM category_settings WHERE category_id = $1::uuid`,
      [req.params.categoryId]
    );
    res.json(
      rows[0] ?? {
        category_id: req.params.categoryId,
        low_stock_threshold: null,
        expiry_warning_days: null,
      }
    );
  } catch (err) {
    next(err);
  }
  }
);

settingsRouter.patch(
  "/category-settings/:categoryId",
  requireAuth,
  requireRoles("admin"),
  async (req, res, next) => {
  try {
    const body = categorySettingsSchema.parse(req.body);
    if (Object.keys(body).length === 0) {
      throw new AppError("No fields to update", 400);
    }
    const pool = getPool();
    const { rowCount: categoryExists } = await pool.query(
      "SELECT 1 FROM categories WHERE id = $1::uuid",
      [req.params.categoryId]
    );
    if (!categoryExists) {
      throw new AppError("Category not found", 404);
    }
    const low = body.low_stock_threshold ?? null;
    const expiry = body.expiry_warning_days ?? null;
    const { rows } = await pool.query<{
      category_id: string;
      low_stock_threshold: number | null;
      expiry_warning_days: number | null;
      updated_at: string;
    }>(
      `INSERT INTO category_settings (category_id, low_stock_threshold, expiry_warning_days, updated_at)
       VALUES ($1::uuid, $2, $3, now())
       ON CONFLICT (category_id)
       DO UPDATE SET
         low_stock_threshold = EXCLUDED.low_stock_threshold,
         expiry_warning_days = EXCLUDED.expiry_warning_days,
         updated_at = now()
       RETURNING category_id::text, low_stock_threshold, expiry_warning_days, updated_at`,
      [req.params.categoryId, low, expiry]
    );
    res.json(rows[0]);
  } catch (err) {
    if (err instanceof z.ZodError) {
      next(new AppError(err.issues.map((i) => i.message).join("; "), 400));
      return;
    }
    next(err);
  }
  }
);
