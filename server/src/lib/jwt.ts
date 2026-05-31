import crypto from "node:crypto";
import * as jose from "jose";
import { parseRole, type UserRole } from "../domain/roles.js";
import { getAccessTokenTtlSec, getJwtSecret } from "../config/env.js";

export type AccessClaims = {
  sub: string;
  email: string;
  role: UserRole;
  typ: "access";
};

export async function signAccessToken(claims: Omit<AccessClaims, "typ">): Promise<string> {
  const secret = new TextEncoder().encode(getJwtSecret());
  const exp = Math.floor(Date.now() / 1000) + getAccessTokenTtlSec();
  return new jose.SignJWT({ ...claims, typ: "access" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setExpirationTime(exp)
    .setIssuedAt()
    .sign(secret);
}

export async function verifyAccessToken(token: string): Promise<AccessClaims> {
  const secret = new TextEncoder().encode(getJwtSecret());
  const { payload } = await jose.jwtVerify(token, secret, { algorithms: ["HS256"] });
  if (payload.typ !== "access" || typeof payload.sub !== "string") {
    throw new Error("Invalid access token");
  }
  const email = typeof payload.email === "string" ? payload.email : "";
  const roleRaw = typeof payload.role === "string" ? payload.role : "";
  const role = parseRole(roleRaw);
  if (!role) {
    throw new Error("Invalid role in token");
  }
  return {
    sub: payload.sub,
    email,
    role,
    typ: "access",
  };
}

/** Short-lived signed state for Google OAuth (no server-side session store). */
export async function signOAuthState(): Promise<string> {
  const secret = new TextEncoder().encode(getJwtSecret());
  const rnd = crypto.randomUUID();
  return new jose.SignJWT({ rnd, typ: "oauth_state" })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("10m")
    .sign(secret);
}

export async function verifyOAuthState(state: string): Promise<void> {
  const secret = new TextEncoder().encode(getJwtSecret());
  const { payload } = await jose.jwtVerify(state, secret, { algorithms: ["HS256"] });
  if (payload.typ !== "oauth_state") {
    throw new Error("Invalid oauth state");
  }
}
