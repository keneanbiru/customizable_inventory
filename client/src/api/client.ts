import { getAccessToken } from "../auth/accessToken";

const base = import.meta.env.VITE_API_URL ?? "";

export type ApiErrorBody = {
  error: {
    message: string;
    code?: string;
  };
};

export type ApiFetchOptions = RequestInit & {
  /** When false, do not attach Bearer token (e.g. login, refresh). Default true. */
  auth?: boolean;
};

export class ApiError extends Error {
  readonly status: number;
  readonly body?: ApiErrorBody;

  constructor(message: string, status: number, body?: ApiErrorBody) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

function buildHeaders(init: ApiFetchOptions | undefined, jsonBody: boolean): Headers {
  const headers = new Headers(init?.headers);
  headers.set("Accept", "application/json");
  if (jsonBody) {
    headers.set("Content-Type", "application/json");
  }
  if (init?.auth !== false) {
    const token = getAccessToken();
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
  }
  return headers;
}

async function parseJsonResponse<T>(res: Response): Promise<T> {
  if (res.status === 204) {
    return undefined as T;
  }
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    throw new ApiError("Invalid JSON response", res.status);
  }
  if (!res.ok) {
    const body = json as ApiErrorBody | undefined;
    const message = body?.error?.message ?? res.statusText;
    throw new ApiError(message, res.status, body);
  }
  return json as T;
}

export async function apiGet<T>(path: string, init?: ApiFetchOptions): Promise<T> {
  const url = path.startsWith("http") ? path : `${base}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: buildHeaders(init, false),
    credentials: init?.credentials ?? "include",
  });
  return parseJsonResponse<T>(res);
}

export async function apiPost<T>(
  path: string,
  body: unknown,
  init?: ApiFetchOptions
): Promise<T> {
  const url = path.startsWith("http") ? path : `${base}${path}`;
  const res = await fetch(url, {
    ...init,
    method: "POST",
    headers: buildHeaders(init, true),
    credentials: init?.credentials ?? "include",
    body: JSON.stringify(body ?? {}),
  });
  return parseJsonResponse<T>(res);
}

export async function apiPatch<T>(
  path: string,
  body: unknown,
  init?: ApiFetchOptions
): Promise<T> {
  const url = path.startsWith("http") ? path : `${base}${path}`;
  const res = await fetch(url, {
    ...init,
    method: "PATCH",
    headers: buildHeaders(init, true),
    credentials: init?.credentials ?? "include",
    body: JSON.stringify(body ?? {}),
  });
  return parseJsonResponse<T>(res);
}

export async function apiDelete<T>(path: string, init?: ApiFetchOptions): Promise<T> {
  const url = path.startsWith("http") ? path : `${base}${path}`;
  const res = await fetch(url, {
    ...init,
    method: "DELETE",
    headers: buildHeaders(init, false),
    credentials: init?.credentials ?? "include",
  });
  return parseJsonResponse<T>(res);
}
