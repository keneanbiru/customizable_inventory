import { FormEvent, useState } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

export function LoginPage() {
  const { user, loading, login, config } = useAuth();
  const appName = config?.appName ?? "Hasu Inventory";
  const location = useLocation();
  const from = (location.state as { from?: { pathname: string } })?.from?.pathname ?? "/app";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!loading && user) {
    return <Navigate to={from} replace />;
  }

  if (loading) {
    return (
      <div className="auth-loading">
        <p className="text-muted">Loading…</p>
      </div>
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email.trim(), password, remember);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-layout login-page">
      <aside className="auth-layout__brand login-page__brand" aria-label="Brand">
        <div className="login-page__brand-content">
          <div className="auth-layout__logo login-page__logo-pill">
            {config?.logoUrl ? (
              <img src={config.logoUrl} alt={appName} className="login-page__logo-image" />
            ) : (
              <span className="login-page__logo-text" aria-label="TheUnityWare logo">
                <span className="login-page__logo-the">The</span>
                <span className="login-page__logo-unity">Unity</span>
                <span className="login-page__logo-ware">Ware</span>
              </span>
            )}
          </div>
          <p className="auth-layout__tagline login-page__tagline">
            Re-imagining inventory management experience with advance
            <br />
            data analytics for optimum performance
          </p>
        </div>
      </aside>
      <main className="auth-layout__form login-page__form-wrap">
        <div className="login-page__form-card">
          <h1>Welcome back</h1>
          <p className="text-muted">Welcome back! Please enter your details.</p>
        {error && <p className="text-error">{error}</p>}
          <form className="stack login-page__form" onSubmit={onSubmit}>
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter your email"
              required
            />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="........"
              required
            />
          </label>
            <div className="row-between login-page__row">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
              />
              Remember for 30 days
            </label>
            <Link to="/forgot-password">Forgot password</Link>
          </div>
          <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
            Sign in
          </button>
        </form>
        {config?.googleEnabled && (
            <a className="btn btn-outline btn-block login-page__google-btn" href="/api/v1/auth/google">
              <span className="login-page__google-icon" aria-hidden="true">
                G
              </span>
            Sign in with Google
          </a>
        )}
        {config?.publicRegistration && (
            <p className="text-muted login-page__signup">
            Don&apos;t have an account? <Link to="/register">Sign up</Link>
          </p>
        )}
        </div>
      </main>
    </div>
  );
}
