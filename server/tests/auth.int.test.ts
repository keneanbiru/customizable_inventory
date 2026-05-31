import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { closePool, getPool } from "../src/db/pool.js";
import { hashToken } from "../src/lib/cryptoToken.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.join(__dirname, "..");

const testDbUrl = process.env.TEST_DATABASE_URL?.trim();

function run(cmd: "migrate" | "seed") {
  execFileSync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["tsx", `scripts/${cmd}.ts`],
    {
      cwd: serverRoot,
      stdio: "inherit",
      env: {
        ...process.env,
        DATABASE_URL: testDbUrl,
        ADMIN_EMAIL: "admin@test.local",
        ADMIN_PASSWORD: "TestAdmin!123",
        NODE_ENV: "test",
      },
    }
  );
}

describe.skipIf(!testDbUrl)("Auth & RBAC (integration)", () => {
  const app = createApp();

  beforeAll(() => {
    process.env.DATABASE_URL = testDbUrl;
    run("migrate");
  });

  beforeEach(async () => {
    const pool = getPool();
    await pool.query(
      "TRUNCATE refresh_tokens, password_reset_tokens, system_logs CASCADE"
    );
    await pool.query("TRUNCATE users CASCADE");
    run("seed");
  });

  afterAll(async () => {
    await closePool();
  });

  it("POST /auth/login returns tokens and remember_me sets refresh cookie", async () => {
    const agent = request.agent(app);
    const res = await agent
      .post("/api/v1/auth/login")
      .send({
        email: "admin@test.local",
        password: "TestAdmin!123",
        remember_me: true,
      })
      .expect(200);

    expect(res.body.access_token).toBeTruthy();
    expect(res.body.user.role).toBe("admin");
    const setCookie = res.headers["set-cookie"];
    expect(setCookie?.some((c) => c.startsWith("refresh_token="))).toBe(true);

    await agent
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${res.body.access_token}`)
      .expect(200);
  });

  it("POST /auth/login rejects wrong password", async () => {
    await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "admin@test.local", password: "wrong" })
      .expect(401);
  });

  it("POST /auth/refresh returns access token when cookie present", async () => {
    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({
        email: "admin@test.local",
        password: "TestAdmin!123",
        remember_me: true,
      })
      .expect(200);
    const cookie = login.headers["set-cookie"];
    expect(cookie).toBeTruthy();

    const ref = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", cookie!)
      .expect(200);
    expect(ref.body.access_token).toBeTruthy();
    expect(ref.body.user.role).toBe("admin");
  });

  it("POST /auth/forgot-password returns 200 and inserts a row", async () => {
    await request(app)
      .post("/api/v1/auth/forgot-password")
      .send({ email: "admin@test.local" })
      .expect(200);

    const pool = getPool();
    const { rows } = await pool.query<{ c: string }>(
      "SELECT COUNT(*)::text AS c FROM password_reset_tokens WHERE used_at IS NULL"
    );
    expect(Number(rows[0]?.c)).toBeGreaterThan(0);
  });

  it("POST /auth/reset-password updates password", async () => {
    const pool = getPool();
    const token = crypto.randomBytes(32).toString("hex");
    await pool.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
       SELECT id, $1, now() + interval '1 hour' FROM users WHERE lower(email) = lower('admin@test.local')`,
      [hashToken(token)]
    );

    await request(app)
      .post("/api/v1/auth/reset-password")
      .send({ token, new_password: "NewPassword!456" })
      .expect(200);

    await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "admin@test.local", password: "NewPassword!456" })
      .expect(200);
  });

  it("GET /users allows admin and forbids store_keeper", async () => {
    const pool = getPool();
    const hash = await bcrypt.hash("Sk!12345678", 8);
    await pool.query(
      `INSERT INTO users (email, password_hash, role, is_active)
       VALUES ('sk@test.local', $1, 'store_keeper', true)`,
      [hash]
    );

    const adminLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "admin@test.local", password: "TestAdmin!123" })
      .expect(200);

    await request(app)
      .get("/api/v1/users")
      .set("Authorization", `Bearer ${adminLogin.body.access_token}`)
      .expect(200);

    const skLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "sk@test.local", password: "Sk!12345678" })
      .expect(200);

    await request(app)
      .get("/api/v1/users")
      .set("Authorization", `Bearer ${skLogin.body.access_token}`)
      .expect(403);
  });

  it("GET /system-logs returns entries for admin", async () => {
    const adminLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "admin@test.local", password: "TestAdmin!123" })
      .expect(200);

    const logs = await request(app)
      .get("/api/v1/system-logs?page_size=5")
      .set("Authorization", `Bearer ${adminLogin.body.access_token}`)
      .expect(200);
    expect(Array.isArray(logs.body.items)).toBe(true);
    expect(logs.body.total).toBeGreaterThanOrEqual(1);
  });
});
