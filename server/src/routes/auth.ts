import bcrypt from "bcryptjs";
import { Router } from "express";
import type { Request, Response } from "express";
import { AppError } from "../lib/AppError.js";
import { hashToken, randomUrlToken } from "../lib/cryptoToken.js";
import { signAccessToken, signOAuthState, verifyOAuthState } from "../lib/jwt.js";
import { getPool } from "../db/pool.js";
import { writeAuditLog } from "../services/auditLog.js";
import { requireAuth } from "../middleware/requireAuth.js";
import {
  getAccessTokenTtlSec,
  getGoogleOAuthConfig,
  getRefreshTokenTtlDaysRemember,
  getRefreshTokenTtlDaysSession,
  isPublicRegistrationEnabled,
} from "../config/env.js";
import { parseRole, type UserRole } from "../domain/roles.js";

const REFRESH_COOKIE = "refresh_token";

export const authRouter = Router();

function clientIp(req: Request): string | null {
  const x = req.headers["x-forwarded-for"];
  if (typeof x === "string" && x.length) {
    return x.split(",")[0]?.trim() ?? null;
  }
  return req.ip ?? null;
}

function setRefreshCookie(res: Response, token: string, remember: boolean): void {
  const days = remember
    ? getRefreshTokenTtlDaysRemember()
    : getRefreshTokenTtlDaysSession();
  const maxAge = days * 24 * 60 * 60 * 1000;
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge,
  });
}

function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, { path: "/" });
}

function frontendBase(): string {
  return (process.env.FRONTEND_URL ?? "http://localhost:5173").replace(/\/$/, "");
}

authRouter.get("/config", async (_req, res, next) => {
  try {
    const pool = getPool();
    const { rows } = await pool.query<{ c: string }>(
      "SELECT COUNT(*)::text AS c FROM users"
    );
    const userCount = Number(rows[0]?.c ?? "0");
    const { rows: settingsRows } = await pool.query<{ key: string; value: unknown }>(
      `SELECT key, value FROM system_settings
       WHERE key IN ('app_name', 'logo_url', 'primary_color_hex')`
    );
    const settingsMap = new Map(settingsRows.map((r) => [r.key, r.value]));
    const appNameRaw = settingsMap.get("app_name");
    const logoRaw = settingsMap.get("logo_url");
    const colorRaw = settingsMap.get("primary_color_hex");
    res.json({
      publicRegistration: userCount === 0 || isPublicRegistrationEnabled(),
      googleEnabled: getGoogleOAuthConfig() !== null,
      appName: typeof appNameRaw === "string" && appNameRaw.trim() ? appNameRaw : "Hasu Inventory",
      logoUrl: typeof logoRaw === "string" && logoRaw.trim() ? logoRaw : null,
      primaryColorHex:
        typeof colorRaw === "string" && /^#[0-9A-Fa-f]{6}$/.test(colorRaw)
          ? colorRaw
          : "#5B21B6",
    });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/login", async (req, res, next) => {
  try {
    const email = String(req.body?.email ?? "")
      .trim()
      .toLowerCase();
    const password = String(req.body?.password ?? "");
    const remember_me = Boolean(req.body?.remember_me);
    if (!email || !password) {
      throw new AppError("Email and password are required", 400);
    }

    const pool = getPool();
    const { rows } = await pool.query<{
      id: string;
      email: string;
      role: string;
      password_hash: string | null;
      is_active: boolean;
    }>(
      `SELECT id, email, role::text, password_hash, is_active
       FROM users WHERE lower(email) = lower($1)`,
      [email]
    );
    const user = rows[0];
    if (!user?.password_hash || !user.is_active) {
      await writeAuditLog({
        userId: null,
        action: "auth.login_failed",
        metadata: { email },
        ip: clientIp(req),
      });
      throw new AppError("Invalid email or password", 401);
    }
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      await writeAuditLog({
        userId: null,
        action: "auth.login_failed",
        metadata: { email },
        ip: clientIp(req),
      });
      throw new AppError("Invalid email or password", 401);
    }

    const role = parseRole(user.role);
    if (!role) {
      throw new AppError("Invalid email or password", 401);
    }

    const access_token = await signAccessToken({
      sub: user.id,
      email: user.email,
      role,
    });

    const refreshPlain = randomUrlToken();
    const refreshHash = hashToken(refreshPlain);
    const days = remember_me
      ? getRefreshTokenTtlDaysRemember()
      : getRefreshTokenTtlDaysSession();
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    await pool.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, user_agent, ip)
       VALUES ($1::uuid, $2, $3, $4, $5)`,
      [
        user.id,
        refreshHash,
        expiresAt.toISOString(),
        req.headers["user-agent"] ?? null,
        clientIp(req),
      ]
    );

    setRefreshCookie(res, refreshPlain, remember_me);

    await writeAuditLog({
      userId: user.id,
      action: "auth.login_success",
      metadata: { remember_me },
      ip: clientIp(req),
    });

    res.json({
      access_token,
      expires_in: getAccessTokenTtlSec(),
      user: {
        id: user.id,
        email: user.email,
        role,
        avatar_url: null,
        display_name: user.email,
      },
    });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/refresh", async (req, res, next) => {
  try {
    const fromCookie = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    const fromBody = typeof req.body?.refresh_token === "string" ? req.body.refresh_token : undefined;
    const refreshPlain = fromCookie ?? fromBody;
    if (!refreshPlain) {
      throw new AppError("Refresh token required", 401);
    }
    const h = hashToken(refreshPlain);
    const pool = getPool();
    const { rows } = await pool.query<{
      id: string;
      user_id: string;
      email: string;
      role: string;
    }>(
      `SELECT rt.id, rt.user_id, u.email, u.role::text
       FROM refresh_tokens rt
       JOIN users u ON u.id = rt.user_id
       WHERE rt.token_hash = $1
         AND rt.revoked_at IS NULL
         AND rt.expires_at > now()
         AND u.is_active = true`,
      [h]
    );
    const row = rows[0];
    if (!row) {
      throw new AppError("Invalid refresh token", 401);
    }

    const role = parseRole(row.role);
    if (!role) {
      throw new AppError("Invalid refresh token", 401);
    }

    const access_token = await signAccessToken({
      sub: row.user_id,
      email: row.email,
      role,
    });

    await writeAuditLog({
      userId: row.user_id,
      action: "auth.refresh",
      ip: clientIp(req),
    });

    res.json({
      access_token,
      expires_in: getAccessTokenTtlSec(),
      user: {
        id: row.user_id,
        email: row.email,
        role,
        avatar_url: null,
        display_name: row.email,
      },
    });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/logout", requireAuth, async (req, res, next) => {
  try {
    const fromCookie = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    if (fromCookie) {
      const h = hashToken(fromCookie);
      const pool = getPool();
      await pool.query(
        `UPDATE refresh_tokens SET revoked_at = now()
         WHERE token_hash = $1 AND revoked_at IS NULL`,
        [h]
      );
    }
    clearRefreshCookie(res);
    await writeAuditLog({
      userId: req.auth!.userId,
      action: "auth.logout",
      ip: clientIp(req),
    });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

authRouter.get("/me", requireAuth, async (req, res, next) => {
  try {
    const pool = getPool();
    const { rows } = await pool.query<{
      id: string;
      email: string;
      username: string | null;
      role: string;
      avatar_url: string | null;
    }>(
      `SELECT id, email, username, role::text, avatar_url FROM users WHERE id = $1::uuid`,
      [req.auth!.userId]
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
      role,
      avatar_url: u.avatar_url,
      display_name: u.username ?? u.email,
    });
  } catch (err) {
    next(err);
  }
});

const MIN_PASSWORD = Math.max(8, Number(process.env.PASSWORD_MIN_LENGTH ?? "8") || 8);

authRouter.post("/forgot-password", async (req, res, next) => {
  try {
    const email = String(req.body?.email ?? "")
      .trim()
      .toLowerCase();
    const pool = getPool();
    if (email) {
      const { rows } = await pool.query<{ id: string }>(
        "SELECT id FROM users WHERE lower(email) = lower($1) AND is_active = true",
        [email]
      );
      const user = rows[0];
      if (user) {
        const plain = randomUrlToken();
        const tokenHash = hashToken(plain);
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
        await pool.query(
          `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
           VALUES ($1::uuid, $2, $3)`,
          [user.id, tokenHash, expiresAt.toISOString()]
        );
        await writeAuditLog({
          userId: user.id,
          action: "auth.password_reset_requested",
          ip: clientIp(req),
        });
        if (process.env.NODE_ENV !== "production") {
          console.info(
            `[dev] Password reset link token for ${email}: ${plain} (expires 1h)`
          );
        }
      }
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/reset-password", async (req, res, next) => {
  try {
    const token = String(req.body?.token ?? "").trim();
    const newPassword = String(req.body?.new_password ?? "");
    if (!token || newPassword.length < MIN_PASSWORD) {
      throw new AppError(
        `Token and new_password (min ${MIN_PASSWORD} chars) are required`,
        400
      );
    }
    const h = hashToken(token);
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query<{
        id: string;
        user_id: string;
      }>(
        `SELECT id, user_id FROM password_reset_tokens
         WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
         FOR UPDATE`,
        [h]
      );
      const row = rows[0];
      if (!row) {
        await client.query("ROLLBACK");
        throw new AppError("Invalid or expired reset token", 400);
      }
      const hash = await bcrypt.hash(newPassword, 12);
      await client.query(
        "UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2::uuid",
        [hash, row.user_id]
      );
      await client.query(
        "UPDATE password_reset_tokens SET used_at = now() WHERE id = $1::uuid",
        [row.id]
      );
      await client.query("COMMIT");
      await writeAuditLog({
        userId: row.user_id,
        action: "auth.password_reset_completed",
        ip: clientIp(req),
      });
      res.json({ ok: true });
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
});

authRouter.post("/register", async (req, res, next) => {
  try {
    const pool = getPool();
    const { rows: cRows } = await pool.query<{ c: string }>(
      "SELECT COUNT(*)::text AS c FROM users"
    );
    const userCount = Number(cRows[0]?.c ?? "0");
    const allow =
      userCount === 0 || isPublicRegistrationEnabled();
    if (!allow) {
      throw new AppError("Registration is disabled", 403);
    }

    const email = String(req.body?.email ?? "")
      .trim()
      .toLowerCase();
    const password = String(req.body?.password ?? "");
    const username =
      typeof req.body?.username === "string" ? req.body.username.trim() || null : null;
    if (!email || password.length < MIN_PASSWORD) {
      throw new AppError(
        `Email and password (min ${MIN_PASSWORD} chars) are required`,
        400
      );
    }

    const role: UserRole = userCount === 0 ? "admin" : "store_keeper";
    const hash = await bcrypt.hash(password, 12);
    const { rows, rowCount } = await pool.query<{
      id: string;
      email: string;
    }>(
      `INSERT INTO users (email, username, password_hash, role, is_active, email_verified_at)
       VALUES ($1, $2, $3, $4::user_role, true, now())
       RETURNING id, email`,
      [email, username, hash, role]
    );
    if (!rowCount) {
      throw new AppError("Could not create user", 500);
    }
    const user = rows[0]!;

    await writeAuditLog({
      userId: user.id,
      action: "auth.register",
      metadata: { role },
      ip: clientIp(req),
    });

    const access_token = await signAccessToken({
      sub: user.id,
      email: user.email,
      role,
    });
    const refreshPlain = randomUrlToken();
    const refreshHash = hashToken(refreshPlain);
    const days = getRefreshTokenTtlDaysRemember();
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    await pool.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, user_agent, ip)
       VALUES ($1::uuid, $2, $3, $4, $5)`,
      [
        user.id,
        refreshHash,
        expiresAt.toISOString(),
        req.headers["user-agent"] ?? null,
        clientIp(req),
      ]
    );
    setRefreshCookie(res, refreshPlain, true);

    res.status(201).json({
      access_token,
      expires_in: getAccessTokenTtlSec(),
      user: {
        id: user.id,
        email: user.email,
        role,
        avatar_url: null,
        display_name: username ?? user.email,
      },
    });
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "23505") {
      next(new AppError("Email already registered", 409));
      return;
    }
    next(err);
  }
});

authRouter.get("/google", async (_req, res, next) => {
  try {
    const cfg = getGoogleOAuthConfig();
    if (!cfg) {
      throw new AppError("Google sign-in is not configured", 501);
    }
    const state = await signOAuthState();
    const params = new URLSearchParams({
      client_id: cfg.clientId,
      redirect_uri: cfg.redirectUri,
      response_type: "code",
      scope: "openid email profile",
      state,
      access_type: "offline",
      prompt: "consent",
    });
    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
  } catch (err) {
    next(err);
  }
});

authRouter.get("/google/callback", async (req, res, next) => {
  try {
    const cfg = getGoogleOAuthConfig();
    if (!cfg) {
      throw new AppError("Google sign-in is not configured", 501);
    }
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const state = typeof req.query.state === "string" ? req.query.state : "";
    if (!code || !state) {
      throw new AppError("Missing code or state", 400);
    }
    await verifyOAuthState(state);

    const body = new URLSearchParams({
      code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: cfg.redirectUri,
      grant_type: "authorization_code",
    });
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!tokenRes.ok) {
      throw new AppError("Google token exchange failed", 400);
    }
    const tokenJson = (await tokenRes.json()) as { access_token?: string };
    if (!tokenJson.access_token) {
      throw new AppError("Google token exchange failed", 400);
    }
    const ui = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` },
    });
    if (!ui.ok) {
      throw new AppError("Google userinfo failed", 400);
    }
    const profile = (await ui.json()) as {
      sub: string;
      email?: string;
      picture?: string;
      name?: string;
    };
    if (!profile.sub || !profile.email) {
      throw new AppError("Google profile missing email", 400);
    }

    const pool = getPool();
    let userId: string;
    const email = profile.email.toLowerCase();

    const existing = await pool.query<{
      id: string;
      role: string;
      google_sub: string | null;
    }>(
      `SELECT id, role::text, google_sub FROM users WHERE google_sub = $1 OR lower(email) = lower($2)`,
      [profile.sub, email]
    );
    if (existing.rows[0]) {
      const row = existing.rows[0];
      if (!row.google_sub) {
        await pool.query(
          "UPDATE users SET google_sub = $1, avatar_url = COALESCE(avatar_url, $2), updated_at = now() WHERE id = $3::uuid",
          [profile.sub, profile.picture ?? null, row.id]
        );
      }
      userId = row.id;
      const pr = parseRole(row.role);
      if (!pr) {
        throw new AppError("Invalid user role", 500);
      }
    } else {
      const { rows: countRows } = await pool.query<{ c: string }>(
        "SELECT COUNT(*)::text AS c FROM users"
      );
      const isFirstUser = Number(countRows[0]?.c ?? "0") === 0;
      const newRole: UserRole = isFirstUser ? "admin" : "store_keeper";
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO users (email, username, google_sub, avatar_url, role, is_active, email_verified_at)
         VALUES ($1, $2, $3, $4, $5::user_role, true, now())
         RETURNING id`,
        [
          email,
          profile.name ?? null,
          profile.sub,
          profile.picture ?? null,
          newRole,
        ]
      );
      userId = rows[0]!.id;
      await writeAuditLog({
        userId,
        action: "auth.google_register",
        ip: clientIp(req),
      });
    }

    const { rows: uRows } = await pool.query<{
      id: string;
      email: string;
      role: string;
      username: string | null;
      avatar_url: string | null;
      is_active: boolean;
    }>(
      `SELECT id, email, role::text, username, avatar_url, is_active FROM users WHERE id = $1::uuid`,
      [userId]
    );
    const u = uRows[0];
    if (!u?.is_active) {
      throw new AppError("Account disabled", 403);
    }
    if (!parseRole(u.role)) {
      throw new AppError("Invalid user", 500);
    }

    const refreshPlain = randomUrlToken();
    const refreshHash = hashToken(refreshPlain);
    const days = getRefreshTokenTtlDaysRemember();
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    await pool.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, user_agent, ip)
       VALUES ($1::uuid, $2, $3, $4, $5)`,
      [
        u.id,
        refreshHash,
        expiresAt.toISOString(),
        req.headers["user-agent"] ?? null,
        clientIp(req),
      ]
    );
    setRefreshCookie(res, refreshPlain, true);

    await writeAuditLog({
      userId: u.id,
      action: "auth.google_login",
      ip: clientIp(req),
    });

    const redirect = `${frontendBase()}/app?logged_in=1`;
    res.redirect(302, redirect);
  } catch (err) {
    next(err);
  }
});
