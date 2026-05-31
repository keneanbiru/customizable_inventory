import { FormEvent, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

export function RegisterPage() {
  const { user, loading, register, config } = useAuth();
  const appName = config?.appName ?? "Hasu Inventory";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!loading && user) {
    return <Navigate to="/app" replace />;
  }
  if (!loading && config && !config.publicRegistration) {
    return <Navigate to="/login" replace />;
  }

  if (loading || !config) {
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
      await register(email.trim(), password, username.trim() || undefined);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-layout">
      <aside className="auth-layout__brand" aria-label="Brand">
        <div className="auth-layout__logo">{appName}</div>
      </aside>
      <main className="auth-layout__form">
        <h1>Create account</h1>
        <p className="text-muted">First user becomes admin; others become store keepers unless configured.</p>
        {error && <p className="text-error">{error}</p>}
        <form className="stack" onSubmit={onSubmit}>
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label className="field">
            <span>Display name (optional)</span>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              required
            />
          </label>
          <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
            Sign up
          </button>
        </form>
        <p className="text-muted">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </main>
    </div>
  );
}
