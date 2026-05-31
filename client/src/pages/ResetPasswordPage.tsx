import { FormEvent, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { apiPost } from "../api/client";
import { useAuth } from "../auth/AuthContext";

export function ResetPasswordPage() {
  const { config } = useAuth();
  const appName = config?.appName ?? "Hasu Inventory";
  const [params] = useSearchParams();
  const token = useMemo(() => params.get("token") ?? "", [params]);
  const [password, setPassword] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await apiPost(
        "/api/v1/auth/reset-password",
        { token, new_password: password },
        { auth: false }
      );
      setDone(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Reset failed");
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <div className="auth-layout">
        <main className="auth-layout__form">
          <p className="text-error">Missing reset token in URL.</p>
          <Link to="/login">Back to sign in</Link>
        </main>
      </div>
    );
  }

  return (
    <div className="auth-layout">
      <aside className="auth-layout__brand" aria-label="Brand">
        <div className="auth-layout__logo">{appName}</div>
      </aside>
      <main className="auth-layout__form">
        <h1>Set new password</h1>
        {done ? (
          <>
            <p className="text-muted">Your password was updated.</p>
            <Link to="/login">Sign in</Link>
          </>
        ) : (
          <form className="stack" onSubmit={onSubmit}>
            {error && <p className="text-error">{error}</p>}
            <label className="field">
              <span>New password</span>
              <input
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                required
              />
            </label>
            <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
              Update password
            </button>
            <Link to="/login">Back to sign in</Link>
          </form>
        )}
      </main>
    </div>
  );
}
