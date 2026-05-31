import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { apiGet, apiPatch, apiPost } from "../api/client";
import { useAuth } from "../auth/AuthContext";

type Role = "admin" | "manager" | "store_keeper";

type UserRow = {
  id: string;
  email: string;
  username: string | null;
  role: Role;
  is_active: boolean;
  created_at: string;
};

type UsersResponse = {
  items: UserRow[];
  page: number;
  page_size: number;
  total: number;
};

type UserDetails = UserRow & {
  avatar_url?: string | null;
};

const roleOptions: Role[] = ["admin", "manager", "store_keeper"];

export function UsersPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [total, setTotal] = useState(0);

  const [newEmail, setNewEmail] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [newRole, setNewRole] = useState<Role>("store_keeper");
  const [newPassword, setNewPassword] = useState("");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editEmail, setEditEmail] = useState("");
  const [editUsername, setEditUsername] = useState("");
  const [editRole, setEditRole] = useState<Role>("store_keeper");
  const [editActive, setEditActive] = useState(true);
  const [editAvatar, setEditAvatar] = useState("");
  const [editPassword, setEditPassword] = useState("");

  const pages = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [total, pageSize]);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams({
        page: String(page),
        page_size: String(pageSize),
      });
      if (search.trim()) {
        q.set("search", search.trim());
      }
      const res = await apiGet<UsersResponse>(`/api/v1/users?${q.toString()}`);
      setItems(res.items);
      setTotal(res.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, search]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  if (user?.role !== "admin") {
    return <p className="text-error">You need admin access to manage roles.</p>;
  }

  async function createUser(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await apiPost("/api/v1/users", {
        email: newEmail.trim(),
        username: newUsername.trim() || null,
        role: newRole,
        password: newPassword,
      });
      setNewEmail("");
      setNewUsername("");
      setNewRole("store_keeper");
      setNewPassword("");
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create user");
    } finally {
      setSaving(false);
    }
  }

  async function startEdit(id: string) {
    setError(null);
    try {
      const details = await apiGet<UserDetails>(`/api/v1/users/${id}`);
      setEditingId(id);
      setEditEmail(details.email);
      setEditUsername(details.username ?? "");
      setEditRole(details.role);
      setEditActive(details.is_active);
      setEditAvatar(details.avatar_url ?? "");
      setEditPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load selected user");
    }
  }

  async function saveEdit(e: FormEvent) {
    e.preventDefault();
    if (!editingId) return;
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        email: editEmail.trim(),
        username: editUsername.trim() || null,
        role: editRole,
        is_active: editActive,
        avatar_url: editAvatar.trim() || null,
      };
      if (editPassword.trim()) {
        payload.password = editPassword;
      }
      await apiPatch(`/api/v1/users/${editingId}`, payload);
      setEditingId(null);
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update user");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="stack">
      <section className="panel">
        <h2>Roles & users</h2>
        <p className="text-muted">Create and manage admin, manager, and store keeper accounts.</p>
        {error && <p className="text-error">{error}</p>}
        <div className="users-toolbar">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by email or username"
          />
          <button type="button" className="btn btn-outline" onClick={() => void loadUsers()}>
            Search
          </button>
        </div>
      </section>

      <section className="panel">
        <h3>Create user</h3>
        <form className="users-form-grid" onSubmit={createUser}>
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              required
            />
          </label>
          <label className="field">
            <span>Username (optional)</span>
            <input value={newUsername} onChange={(e) => setNewUsername(e.target.value)} />
          </label>
          <label className="field">
            <span>Role</span>
            <select value={newRole} onChange={(e) => setNewRole(e.target.value as Role)}>
              {roleOptions.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
            />
          </label>
          <div className="users-actions">
            <button type="submit" className="btn btn-primary" disabled={saving}>
              Create user
            </button>
          </div>
        </form>
      </section>

      <section className="panel">
        <div className="users-list-head">
          <h3>User accounts</h3>
          <p className="text-muted">
            {loading ? "Loading..." : `${items.length} shown / ${total} total`}
          </p>
        </div>
        <div className="users-table-wrap">
          <table className="users-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Username</th>
                <th>Role</th>
                <th>Status</th>
                <th>Created</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((u) => (
                <tr key={u.id}>
                  <td>{u.email}</td>
                  <td>{u.username ?? "—"}</td>
                  <td className="text-capitalize">{u.role}</td>
                  <td>{u.is_active ? "Active" : "Disabled"}</td>
                  <td>{new Date(u.created_at).toLocaleDateString()}</td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-outline"
                      onClick={() => void startEdit(u.id)}
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="users-pagination">
          <button
            type="button"
            className="btn btn-outline"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </button>
          <span className="text-muted">
            Page {page} of {pages}
          </span>
          <button
            type="button"
            className="btn btn-outline"
            disabled={page >= pages}
            onClick={() => setPage((p) => Math.min(pages, p + 1))}
          >
            Next
          </button>
        </div>
      </section>

      {editingId && (
        <section className="panel">
          <h3>Edit user</h3>
          <form className="users-form-grid" onSubmit={saveEdit}>
            <label className="field">
              <span>Email</span>
              <input
                type="email"
                value={editEmail}
                onChange={(e) => setEditEmail(e.target.value)}
                required
              />
            </label>
            <label className="field">
              <span>Username</span>
              <input value={editUsername} onChange={(e) => setEditUsername(e.target.value)} />
            </label>
            <label className="field">
              <span>Role</span>
              <select value={editRole} onChange={(e) => setEditRole(e.target.value as Role)}>
                {roleOptions.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Avatar URL (optional)</span>
              <input value={editAvatar} onChange={(e) => setEditAvatar(e.target.value)} />
            </label>
            <label className="field">
              <span>Set new password (optional)</span>
              <input
                type="password"
                minLength={8}
                value={editPassword}
                onChange={(e) => setEditPassword(e.target.value)}
              />
            </label>
            <label className="checkbox users-checkbox">
              <input
                type="checkbox"
                checked={editActive}
                onChange={(e) => setEditActive(e.target.checked)}
              />
              User is active
            </label>
            <div className="users-actions">
              <button type="submit" className="btn btn-primary" disabled={saving}>
                Save changes
              </button>
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => setEditingId(null)}
                disabled={saving}
              >
                Cancel
              </button>
            </div>
          </form>
        </section>
      )}
    </div>
  );
}
