function required(name: string): string {
  const v = process.env[name];
  if (!v?.trim()) {
    throw new Error(`Missing required env: ${name}`);
  }
  return v.trim();
}

export function getJwtSecret(): string {
  return required("JWT_SECRET");
}

export function getAccessTokenTtlSec(): number {
  const raw = process.env.ACCESS_TOKEN_TTL_SEC ?? "3600";
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 3600;
}

export function getRefreshTokenTtlDaysRemember(): number {
  const raw = process.env.REFRESH_TOKEN_TTL_DAYS_REMEMBER ?? "30";
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 30;
}

export function getRefreshTokenTtlDaysSession(): number {
  const raw = process.env.REFRESH_TOKEN_TTL_DAYS_SESSION ?? "1";
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
}

export function isPublicRegistrationEnabled(): boolean {
  return process.env.PUBLIC_REGISTRATION === "true";
}

export function getGoogleOAuthConfig():
  | { clientId: string; clientSecret: string; redirectUri: string }
  | null {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  const redirectUri = process.env.GOOGLE_REDIRECT_URI?.trim();
  if (!clientId || !clientSecret || !redirectUri) {
    return null;
  }
  return { clientId, clientSecret, redirectUri };
}
