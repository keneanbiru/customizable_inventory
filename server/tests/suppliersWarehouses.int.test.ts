import bcrypt from "bcryptjs";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { getPool } from "../src/db/pool.js";

const testDbUrl = process.env.TEST_DATABASE_URL?.trim();

describe.skipIf(!testDbUrl)("Suppliers & Warehouses APIs (integration)", () => {
  const app = createApp();

  beforeEach(async () => {
    process.env.DATABASE_URL = testDbUrl;
    const pool = getPool();
    await pool.query(
      "TRUNCATE suppliers, warehouses, refresh_tokens, password_reset_tokens, system_logs, users CASCADE"
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

  it("manager can create supplier and export", async () => {
    const managerLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "manager@test.local", password: "Manager!1234" })
      .expect(200);

    await request(app)
      .post("/api/v1/suppliers")
      .set("Authorization", `Bearer ${managerLogin.body.access_token}`)
      .send({ supplier_code: "SUP-1", display_name: "Phoenix Baker" })
      .expect(201);

    await request(app)
      .get("/api/v1/suppliers/stats")
      .set("Authorization", `Bearer ${managerLogin.body.access_token}`)
      .expect(200);

    const csv = await request(app)
      .get("/api/v1/suppliers/export")
      .set("Authorization", `Bearer ${managerLogin.body.access_token}`)
      .expect(200);
    expect(String(csv.text).includes("supplier_code")).toBe(true);
  });

  it("admin can set default warehouse", async () => {
    const adminLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "admin@test.local", password: "Admin!1234" })
      .expect(200);

    const created = await request(app)
      .post("/api/v1/warehouses")
      .set("Authorization", `Bearer ${adminLogin.body.access_token}`)
      .send({ name: "Secondary", code: "SEC", is_default: true })
      .expect(201);

    expect(created.body.is_default).toBe(true);
    const list = await request(app)
      .get("/api/v1/warehouses")
      .set("Authorization", `Bearer ${adminLogin.body.access_token}`)
      .expect(200);
    const defaults = list.body.items.filter((w: { is_default: boolean }) => w.is_default);
    expect(defaults.length).toBe(1);
  });
});
