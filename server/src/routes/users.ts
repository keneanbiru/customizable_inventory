import bcrypt from "bcryptjs";
import { Router, type Request } from "express";
import { z } from "zod";
import { AppError } from "../lib/AppError.js";
import { getPool } from "../db/pool.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireRoles } from "../middleware/requireRoles.js";
import { writeAuditLog } from "../services/auditLog.js";
import { parseRole, USER_ROLES } from "../domain/roles.js";

const MIN_PASSWORD = Math.max(8, Number(process.env.PASSWORD_MIN_LENGTH ?? "8") || 8);

export const usersRouter = Router();
usersRouter.use(requireAuth, requireRoles("admin"));

function clientIp(req: Pick<Request, "ip" | "headers">): string | null {
  const x = req.headers["x-forwarded-for"];
  if (typeof x === "string" && x.length) {
    return x.split(",")[0]?.trim() ?? null;
  }
  return req.ip ?? null;
}

const createSchema = z.object({
  email: z.string().email(),
  password: z.string().min(MIN_PASSWORD).optional(),
  role: z.enum(USER_ROLES),
  username: z.string().min(1).max(120).optional().nullable(),
});

usersRouter.post("/", async (req, res, next) => {
  try {
    const body = createSchema.parse(req.body);
    const email = body.email.trim().toLowerCase();
    if (!body.password) {
      throw new AppError("password is required when creating users", 400);
    }
    const hash = await bcrypt.hash(body.password, 12);
    const pool = getPool();
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO users (email, username, password_hash, role, is_active, email_verified_at)
       VALUES ($1, $2, $3, $4::user_role, true, now())
       RETURNING id`,
      [email, body.username ?? null, hash, body.role]
    );
    const id = rows[0]!.id;
    await writeAuditLog({
      userId: req.auth!.userId,
      action: "users.create",
      metadata: { targetUserId: id, email, role: body.role },
      ip: clientIp(req),
    });
    res.status(201).json({ id, email, role: body.role });
  } catch (err) {
    if (err instanceof z.ZodError) {
      next(new AppError(err.issues.map((e) => e.message).join("; "), 400));
      return;
    }
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "23505") {
      next(new AppError("Email or username already in use", 409));
      return;
    }
    next(err);
  }
});

usersRouter.get("/", async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.page_size) || 20));
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const offset = (page - 1) * pageSize;
    const pool = getPool();

    if (search) {
      const like = `%${search}%`;
      const { rows } = await pool.query<{
        id: string;
        email: string;
        username: string | null;
        role: string;
        is_active: boolean;
        created_at: string;
      }>(
        `SELECT id, email, username, role::text, is_active, created_at
         FROM users
         WHERE email ILIKE $1 OR COALESCE(username, '') ILIKE $2
         ORDER BY created_at DESC
         LIMIT $3 OFFSET $4`,
        [like, like, pageSize, offset]
      );
      const { rows: cRows } = await pool.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM users
         WHERE email ILIKE $1 OR COALESCE(username, '') ILIKE $2`,
        [like, like]
      );
      const total = Number(cRows[0]?.c ?? "0");
      res.json({
        items: rows.map((r) => ({
          id: r.id,
          email: r.email,
          username: r.username,
          role: parseRole(r.role),
          is_active: r.is_active,
          created_at: r.created_at,
        })),
        page,
        page_size: pageSize,
        total,
      });
      return;
    }

    const { rows } = await pool.query<{
      id: string;
      email: string;
      username: string | null;
      role: string;
      is_active: boolean;
      created_at: string;
    }>(
      `SELECT id, email, username, role::text, is_active, created_at
       FROM users
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      [pageSize, offset]
    );
    const { rows: cRows } = await pool.query<{ c: string }>(
      "SELECT COUNT(*)::text AS c FROM users"
    );
    const total = Number(cRows[0]?.c ?? "0");
    res.json({
      items: rows.map((r) => ({
        id: r.id,
        email: r.email,
        username: r.username,
        role: parseRole(r.role),
        is_active: r.is_active,
        created_at: r.created_at,
      })),
      page,
      page_size: pageSize,
      total,
    });
  } catch (err) {
    next(err);
  }
});

const patchSchema = z.object({
  email: z.string().email().optional(),
  role: z.enum(USER_ROLES).optional(),
  is_active: z.boolean().optional(),
  avatar_url: z.string().max(2048).nullable().optional(),
  username: z.string().min(1).max(120).nullable().optional(),
  password: z.string().min(MIN_PASSWORD).optional(),
});

usersRouter.get("/:id", async (req, res, next) => {
  try {
    const pool = getPool();
    const { rows } = await pool.query<{
      id: string;
      email: string;
      username: string | null;
      role: string;
      is_active: boolean;
      avatar_url: string | null;
      created_at: string;
    }>(
      `SELECT id, email, username, role::text, is_active, avatar_url, created_at
       FROM users WHERE id = $1::uuid`,
      [req.params.id]
    );
    const u = rows[0];
    if (!u) {
      throw new AppError("User not found", 404);
    }
    const role = parseRole(u.role);
    if (!role) {
      throw new AppError("User not found", 404);
    }
    res.json({
      id: u.id,
      email: u.email,
      username: u.username,
      role,
      is_active: u.is_active,
      avatar_url: u.avatar_url,
      created_at: u.created_at,
    });
  } catch (err) {
    next(err);
  }
});

usersRouter.patch("/:id", async (req, res, next) => {
  try {
    const body = patchSchema.parse(req.body);
    const pool = getPool();
    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    if (body.email !== undefined) {
      fields.push(`email = $${i++}`);
      values.push(body.email.trim().toLowerCase());
    }
    if (body.role !== undefined) {
      fields.push(`role = $${i++}::user_role`);
      values.push(body.role);
    }
    if (body.is_active !== undefined) {
      fields.push(`is_active = $${i++}`);
      values.push(body.is_active);
    }
    if (body.avatar_url !== undefined) {
      fields.push(`avatar_url = $${i++}`);
      values.push(body.avatar_url);
    }
    if (body.username !== undefined) {
      fields.push(`username = $${i++}`);
      values.push(body.username);
    }
    if (body.password !== undefined) {
      fields.push(`password_hash = $${i++}`);
      values.push(await bcrypt.hash(body.password, 12));
    }
    if (!fields.length) {
      throw new AppError("No fields to update", 400);
    }
    fields.push(`updated_at = now()`);
    values.push(req.params.id);
    const { rowCount } = await pool.query(
      `UPDATE users SET ${fields.join(", ")} WHERE id = $${i}::uuid`,
      values
    );
    if (!rowCount) {
      throw new AppError("User not found", 404);
    }
    await writeAuditLog({
      userId: req.auth!.userId,
      action: "users.update",
      metadata: { targetUserId: req.params.id, fields: Object.keys(body) },
      ip: clientIp(req),
    });
    res.status(204).end();
  } catch (err) {
    if (err instanceof z.ZodError) {
      next(new AppError(err.issues.map((e) => e.message).join("; "), 400));
      return;
    }
    next(err);
  }
});
