import { loadEnv } from "../src/lib/loadEnv.js";

loadEnv(import.meta.url);

import bcrypt from "bcryptjs";
import pg from "pg";
import { getPgPoolConfig } from "../src/db/pgConfig.js";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required for seed.");
    process.exit(1);
  }

  const password = process.env.ADMIN_PASSWORD ?? "ChangeMe!1";
  if (process.env.NODE_ENV === "production" && !process.env.ADMIN_PASSWORD) {
    console.error("ADMIN_PASSWORD is required in production.");
    process.exit(1);
  }

  const pool = new pg.Pool(getPgPoolConfig());
  try {
    const email = (process.env.ADMIN_EMAIL ?? "admin@example.com").toLowerCase();
    const existingAdmin = await pool.query<{ id: string; email: string }>(
      `SELECT id, email FROM users WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1`
    );
    let adminId = existingAdmin.rows[0]?.id ?? null;
    if (!adminId) {
      const hash = await bcrypt.hash(password, 12);
      const inserted = await pool.query<{ id: string }>(
        `INSERT INTO users (email, username, password_hash, role, is_active, email_verified_at)
         VALUES ($1, $2, $3, 'admin', true, now())
         RETURNING id`,
        [email, "admin", hash]
      );
      adminId = inserted.rows[0]?.id ?? null;
      console.log(`Seeded admin user: ${email}`);
    } else {
      console.log(`Admin user already exists: ${existingAdmin.rows[0]?.email}`);
    }

    await pool.query(
      `INSERT INTO units (name, code, allows_fractional, is_active)
       VALUES
         ('Piece', 'PCS', false, true),
         ('Kilogram', 'KG', true, true),
         ('Liter', 'L', true, true),
         ('Box', 'BOX', false, true)
       ON CONFLICT (code) DO UPDATE
       SET name = EXCLUDED.name,
           allows_fractional = EXCLUDED.allows_fractional,
           is_active = EXCLUDED.is_active,
           updated_at = now()`
    );

    await pool.query(
      `INSERT INTO categories (name, sort_order, is_active)
       SELECT v.name, v.sort_order, true
       FROM (VALUES
         ('Beverages', 10),
         ('Snacks', 20),
         ('Cleaning Supplies', 30),
         ('Personal Care', 40)
       ) AS v(name, sort_order)
       WHERE NOT EXISTS (
         SELECT 1 FROM categories c WHERE lower(c.name) = lower(v.name)
       )`
    );

    await pool.query(
      `INSERT INTO warehouses (name, code, is_default)
       VALUES
         ('Main Warehouse', 'MAIN', true),
         ('Front Store', 'FRONT', false)
       ON CONFLICT (code) DO UPDATE
       SET name = EXCLUDED.name,
           is_default = EXCLUDED.is_default,
           updated_at = now()`
    );

    // Keep exactly one default warehouse.
    await pool.query(
      `WITH ranked AS (
         SELECT id, row_number() OVER (ORDER BY (code = 'MAIN') DESC, created_at ASC) AS rn
         FROM warehouses
       )
       UPDATE warehouses w
       SET is_default = (r.rn = 1), updated_at = now()
       FROM ranked r
       WHERE w.id = r.id`
    );

    await pool.query(
      `INSERT INTO suppliers (supplier_code, display_name, contact_name, email, phone, status)
       VALUES
         ('SUP-ETH-001', 'Ethio Foods Distribution', 'Marta Bekele', 'sales@ethiofoods.example', '+251911000001', 'active'),
         ('SUP-ADD-002', 'Addis Beverage PLC', 'Henok Alemu', 'contact@addisbev.example', '+251911000002', 'active'),
         ('SUP-HYG-003', 'Clean Home Trading', 'Ruth Tadesse', 'hello@cleanhome.example', '+251911000003', 'active')
       ON CONFLICT (supplier_code) DO UPDATE
       SET display_name = EXCLUDED.display_name,
           contact_name = EXCLUDED.contact_name,
           email = EXCLUDED.email,
           phone = EXCLUDED.phone,
           status = EXCLUDED.status,
           updated_at = now()`
    );

    const refs = await pool.query<{
      beverages_id: string;
      snacks_id: string;
      cleaning_id: string;
      pcs_id: string;
      kg_id: string;
      main_wh_id: string;
      front_wh_id: string;
      sup_food_id: string;
      sup_bev_id: string;
      sup_clean_id: string;
    }>(
      `SELECT
         (SELECT id::text FROM categories WHERE lower(name) = lower('Beverages') LIMIT 1) AS beverages_id,
         (SELECT id::text FROM categories WHERE lower(name) = lower('Snacks') LIMIT 1) AS snacks_id,
         (SELECT id::text FROM categories WHERE lower(name) = lower('Cleaning Supplies') LIMIT 1) AS cleaning_id,
         (SELECT id::text FROM units WHERE code = 'PCS' LIMIT 1) AS pcs_id,
         (SELECT id::text FROM units WHERE code = 'KG' LIMIT 1) AS kg_id,
         (SELECT id::text FROM warehouses WHERE code = 'MAIN' LIMIT 1) AS main_wh_id,
         (SELECT id::text FROM warehouses WHERE code = 'FRONT' LIMIT 1) AS front_wh_id,
         (SELECT id::text FROM suppliers WHERE supplier_code = 'SUP-ETH-001' LIMIT 1) AS sup_food_id,
         (SELECT id::text FROM suppliers WHERE supplier_code = 'SUP-ADD-002' LIMIT 1) AS sup_bev_id,
         (SELECT id::text FROM suppliers WHERE supplier_code = 'SUP-HYG-003' LIMIT 1) AS sup_clean_id`
    );

    const r = refs.rows[0];
    if (!r || !r.beverages_id || !r.snacks_id || !r.cleaning_id || !r.pcs_id || !r.main_wh_id) {
      throw new Error("Failed to resolve seed references for products.");
    }

    await pool.query(
      `INSERT INTO products (
         sku, name, description, category_id, unit_id, supplier_id, warehouse_id,
         cost_price, selling_price, quantity_on_hand, reorder_level, low_stock_threshold, is_active
       )
       VALUES
         ('PRD-COLA-001', 'Cola 1.5L', 'Popular soft drink bottle', $1::uuid, $2::uuid, $3::uuid, $4::uuid, 32.00, 45.00, 120.000, 40.000, 25.000, true),
         ('PRD-BISC-002', 'Butter Biscuit', 'Family pack biscuit', $5::uuid, $2::uuid, $6::uuid, $7::uuid, 18.50, 28.00, 75.000, 30.000, 20.000, true),
         ('PRD-SOAP-003', 'Liquid Soap 5L', 'Cleaning liquid for home use', $8::uuid, $9::uuid, $10::uuid, $4::uuid, 140.00, 195.00, 28.000, 12.000, 10.000, true)
       ON CONFLICT (sku) DO UPDATE
       SET name = EXCLUDED.name,
           description = EXCLUDED.description,
           category_id = EXCLUDED.category_id,
           unit_id = EXCLUDED.unit_id,
           supplier_id = EXCLUDED.supplier_id,
           warehouse_id = EXCLUDED.warehouse_id,
           cost_price = EXCLUDED.cost_price,
           selling_price = EXCLUDED.selling_price,
           quantity_on_hand = EXCLUDED.quantity_on_hand,
           reorder_level = EXCLUDED.reorder_level,
           low_stock_threshold = EXCLUDED.low_stock_threshold,
           is_active = EXCLUDED.is_active,
           updated_at = now()`,
      [
        r.beverages_id,
        r.pcs_id,
        r.sup_bev_id,
        r.main_wh_id,
        r.snacks_id,
        r.sup_food_id,
        r.front_wh_id ?? r.main_wh_id,
        r.cleaning_id,
        r.kg_id ?? r.pcs_id,
        r.sup_clean_id,
      ]
    );

    if (adminId) {
      await pool.query(
        `INSERT INTO inventory_transactions (product_id, warehouse_id, transaction_type, quantity, notes, created_by)
         SELECT p.id, p.warehouse_id, 'in'::inventory_txn_type, p.quantity_on_hand, 'Initial seed stock', $1::uuid
         FROM products p
         WHERE p.sku IN ('PRD-COLA-001', 'PRD-BISC-002', 'PRD-SOAP-003')
           AND NOT EXISTS (
             SELECT 1
             FROM inventory_transactions t
             WHERE t.product_id = p.id AND t.notes = 'Initial seed stock'
           )`,
        [adminId]
      );
    }

    console.log("Seeded demo categories, units, warehouses, suppliers, and products.");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
