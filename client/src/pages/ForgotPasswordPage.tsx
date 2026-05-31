import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { apiPost } from "../api/client";
import { useAuth } from "../auth/AuthContext";

export function ForgotPasswordPage() {
  const { config } = useAuth();
  const appName = config?.appName ?? "Hasu Inventory";
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await apiPost("/api/v1/auth/forgot-password", { email: email.trim() }, { auth: false });
      setDone(true);
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
        <h1>Reset password</h1>
        {done ? (
          <>
            <p className="text-muted">
              If an account exists for that email, we sent reset instructions. Check the server
              logs in development for the reset token.
            </p>
            <Link to="/login">Back to sign in</Link>
          </>
        ) : (
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
            <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
              Send reset link
            </button>
            <Link to="/login">Back to sign in</Link>
          </form>
        )}
      </main>
    </div>
  );
}
