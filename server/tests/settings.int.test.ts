import bcrypt from "bcryptjs";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { getPool } from "../src/db/pool.js";

const testDbUrl = process.env.TEST_DATABASE_URL?.trim();

describe.skipIf(!testDbUrl)("Settings APIs (integration)", () => {
  const app = createApp();

  beforeEach(async () => {
    process.env.DATABASE_URL = testDbUrl;
    const pool = getPool();
    await pool.query(
      "TRUNCATE category_settings, categories, system_settings, refresh_tokens, password_reset_tokens, system_logs, users CASCADE"
    );
    const adminHash = await bcrypt.hash("Admin!1234", 8);
    const managerHash = await bcrypt.hash("Manager!1234", 8);
    await pool.query(
      `INSERT INTO users (email, password_hash, role, is_active)
       VALUES ('admin@test.local', $1, 'admin', true),
              ('manager@test.local', $2, 'manager', true)`,
      [adminHash, managerHash]
    );
  });

  it("admin can patch settings and manager is forbidden", async () => {
    const adminLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "admin@test.local", password: "Admin!1234" })
      .expect(200);
    const managerLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "manager@test.local", password: "Manager!1234" })
      .expect(200);

    await request(app)
      .patch("/api/v1/settings")
      .set("Authorization", `Bearer ${managerLogin.body.access_token}`)
      .send({ default_low_stock_threshold: 5 })
      .expect(403);

    const patched = await request(app)
      .patch("/api/v1/settings")
      .set("Authorization", `Bearer ${adminLogin.body.access_token}`)
      .send({
        store_timezone: "Africa/Addis_Ababa",
        default_low_stock_threshold: 5,
        default_expiry_warning_days: 4,
      })
      .expect(200);

    expect(patched.body.store_timezone).toBe("Africa/Addis_Ababa");
    expect(patched.body.default_low_stock_threshold).toBe(5);
    expect(patched.body.default_expiry_warning_days).toBe(4);
  });

  it("invalid timezone is rejected", async () => {
    const adminLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "admin@test.local", password: "Admin!1234" })
      .expect(200);

    await request(app)
      .patch("/api/v1/settings")
      .set("Authorization", `Bearer ${adminLogin.body.access_token}`)
      .send({ store_timezone: "Mars/Olympus" })
      .expect(400);
  });

  it("admin can patch category overrides", async () => {
    const pool = getPool();
    const { rows } = await pool.query<{ id: string }>(
      "INSERT INTO categories (name, sort_order, is_active) VALUES ('Grocery', 0, true) RETURNING id::text"
    );
    const categoryId = rows[0]!.id;

    const adminLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "admin@test.local", password: "Admin!1234" })
      .expect(200);

    const updated = await request(app)
      .patch(`/api/v1/category-settings/${categoryId}`)
      .set("Authorization", `Bearer ${adminLogin.body.access_token}`)
      .send({ low_stock_threshold: 2, expiry_warning_days: 1 })
      .expect(200);

    expect(updated.body.low_stock_threshold).toBe(2);
    expect(updated.body.expiry_warning_days).toBe(1);
  });
});
