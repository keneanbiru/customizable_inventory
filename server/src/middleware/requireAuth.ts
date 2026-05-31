import type { NextFunction, Request, Response } from "express";
import * as jose from "jose";
import { AppError } from "../lib/AppError.js";
import { verifyAccessToken } from "../lib/jwt.js";
import { parseRole } from "../domain/roles.js";
import { getPool } from "../db/pool.js";

export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : null;
    if (!token) {
      throw new AppError("Unauthorized", 401);
    }
    let claims;
    try {
      claims = await verifyAccessToken(token);
    } catch (e) {
      if (e instanceof jose.errors.JOSEError || e instanceof Error) {
        throw new AppError("Unauthorized", 401);
      }
      throw e;
    }
    const pool = getPool();
    const { rows } = await pool.query<{
      id: string;
      email: string;
      role: string;
      is_active: boolean;
    }>(
      `SELECT id, email, role::text, is_active FROM users WHERE id = $1::uuid`,
      [claims.sub]
    );
    const row = rows[0];
    if (!row || !row.is_active) {
      throw new AppError("Unauthorized", 401);
    }
    const role = parseRole(row.role);
    if (!role) {
      throw new AppError("Unauthorized", 401);
    }
    req.auth = {
      userId: row.id,
      email: row.email,
      role,
    };
    next();
  } catch (err) {
    if (err instanceof AppError) {
      next(err);
      return;
    }
    next(new AppError("Unauthorized", 401));
  }
}
