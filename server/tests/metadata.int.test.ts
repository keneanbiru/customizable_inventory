import bcrypt from "bcryptjs";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { getPool } from "../src/db/pool.js";

const testDbUrl = process.env.TEST_DATABASE_URL?.trim();

describe.skipIf(!testDbUrl)("Metadata APIs (integration)", () => {
  const app = createApp();

  beforeEach(async () => {
    process.env.DATABASE_URL = testDbUrl;
    const pool = getPool();
    await pool.query(
      "TRUNCATE categories, units, refresh_tokens, password_reset_tokens, system_logs, users CASCADE"
    );
    const adminHash = await bcrypt.hash("Admin!1234", 8);
    const skHash = await bcrypt.hash("Store!1234", 8);
    await pool.query(
      `INSERT INTO users (email, password_hash, role, is_active)
       VALUES ('admin@test.local', $1, 'admin', true),
              ('keeper@test.local', $2, 'store_keeper', true)`,
      [adminHash, skHash]
    );
  });

  it("admin can CRUD categories; non-admin cannot create", async () => {
    const adminLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "admin@test.local", password: "Admin!1234" })
      .expect(200);

    const created = await request(app)
      .post("/api/v1/categories")
      .set("Authorization", `Bearer ${adminLogin.body.access_token}`)
      .send({ name: "Grocery", sort_order: 1 })
      .expect(201);
    expect(created.body.name).toBe("Grocery");

    await request(app)
      .patch(`/api/v1/categories/${created.body.id}`)
      .set("Authorization", `Bearer ${adminLogin.body.access_token}`)
      .send({ is_active: false })
      .expect(200);

    const skLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "keeper@test.local", password: "Store!1234" })
      .expect(200);

    await request(app)
      .post("/api/v1/categories")
      .set("Authorization", `Bearer ${skLogin.body.access_token}`)
      .send({ name: "Hardware" })
      .expect(403);
  });

  it("admin can CRUD units and duplicate code is rejected", async () => {
    const adminLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "admin@test.local", password: "Admin!1234" })
      .expect(200);

    const piece = await request(app)
      .post("/api/v1/units")
      .set("Authorization", `Bearer ${adminLogin.body.access_token}`)
      .send({ name: "Piece", code: "pc", allows_fractional: false })
      .expect(201);
    expect(piece.body.code).toBe("pc");

    await request(app)
      .post("/api/v1/units")
      .set("Authorization", `Bearer ${adminLogin.body.access_token}`)
      .send({ name: "Pieces", code: "pc", allows_fractional: false })
      .expect(409);

    await request(app)
      .patch(`/api/v1/units/${piece.body.id}`)
      .set("Authorization", `Bearer ${adminLogin.body.access_token}`)
      .send({ allows_fractional: true })
      .expect(200);
  });

  it("all authenticated users can read active categories and units", async () => {
    const pool = getPool();
    await pool.query(
      `INSERT INTO categories (name, is_active) VALUES ('Grocery', true), ('Hidden', false);
       INSERT INTO units (name, code, allows_fractional, is_active)
       VALUES ('Piece', 'pc2', false, true), ('HiddenUnit', 'hu2', false, false);`
    );

    const skLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "keeper@test.local", password: "Store!1234" })
      .expect(200);

    const cRes = await request(app)
      .get("/api/v1/categories")
      .set("Authorization", `Bearer ${skLogin.body.access_token}`)
      .expect(200);
    expect(cRes.body.items.some((c: { name: string }) => c.name === "Grocery")).toBe(true);
    expect(cRes.body.items.some((c: { name: string }) => c.name === "Hidden")).toBe(false);

    const uRes = await request(app)
      .get("/api/v1/units")
      .set("Authorization", `Bearer ${skLogin.body.access_token}`)
      .expect(200);
    expect(uRes.body.items.some((u: { code: string }) => u.code === "pc2")).toBe(true);
    expect(uRes.body.items.some((u: { code: string }) => u.code === "hu2")).toBe(false);
  });
});
