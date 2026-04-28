"use client";

import { useMemo, useState } from "react";
import { useConfirm } from "@/components/ConfirmDialog";

interface User {
  id: string;
  email: string | null;
  full_name: string | null;
  role: string | null;
  invited_at: string | null;
  last_seen_at: string | null;
  disabled_at: string | null;
  created_at: string;
}

const ROLES = ["super_admin", "operator", "athlete"] as const;

/**
 * Operator-friendly users console.
 *
 * - Multi-select with shift-range
 * - Bulk role change + bulk disable/re-enable
 * - Optimistic mutations, no full-page refresh
 * - Inline filter (search across name/email/role)
 */
export default function UsersTable({ users: initial, meId }: { users: User[]; meId: string }) {
  const confirmDialog = useConfirm();
  const [users, setUsers] = useState<User[]>(initial);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastClicked, setLastClicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [bulkRole, setBulkRole] = useState<typeof ROLES[number]>("operator");

  const visible = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return users;
    return users.filter(
      (u) =>
        (u.full_name ?? "").toLowerCase().includes(s) ||
        (u.email ?? "").toLowerCase().includes(s) ||
        (u.role ?? "").toLowerCase().includes(s)
    );
  }, [users, q]);

  const visibleIds = useMemo(() => visible.map((u) => u.id), [visible]);
  const selectableIds = visibleIds.filter((id) => id !== meId);
  const allSelectedOnPage =
    selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));

  function toggle(id: string, range: boolean) {
    if (id === meId) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (range && lastClicked) {
        const i = visibleIds.indexOf(lastClicked);
        const j = visibleIds.indexOf(id);
        if (i >= 0 && j >= 0) {
          const [lo, hi] = i < j ? [i, j] : [j, i];
          for (let k = lo; k <= hi; k++) {
            const v = visibleIds[k];
            if (v !== meId) next.add(v);
          }
          return next;
        }
      }
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setLastClicked(id);
  }

  function patch(ids: string[], p: Partial<User>) {
    const set = new Set(ids);
    setUsers((prev) => prev.map((u) => (set.has(u.id) ? { ...u, ...p } : u)));
  }

  function popFlash(msg: string) {
    setFlash(msg);
    setTimeout(() => setFlash(null), 2500);
  }

  async function changeRoleSingle(id: string, role: string) {
    if (id === meId) {
      setErr("can't change own role");
      return;
    }
    if (role === "super_admin" && !(await confirmDialog({ message: "Promote to super-admin?", tone: "warn" }))) return;
    setBusy(true);
    setErr(null);
    const prev = users.find((u) => u.id === id)?.role ?? null;
    patch([id], { role });
    const res = await fetch(`/api/admin/users/${id}/role`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role }),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      patch([id], { role: prev });
      setErr(j.error ?? "failed");
      return;
    }
    popFlash("role updated");
  }

  async function bulkRoleChange() {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (
      bulkRole === "super_admin" &&
      !(await confirmDialog({ message: `Promote ${ids.length} user(s) to super-admin?`, tone: "warn" }))
    )
      return;
    setBusy(true);
    setErr(null);
    const prevRoles = new Map(ids.map((id) => [id, users.find((u) => u.id === id)?.role ?? null]));
    patch(ids, { role: bulkRole });
    const res = await fetch(`/api/admin/users/bulk`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ op: "role", ids, role: bulkRole }),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      // rollback
      setUsers((prev) =>
        prev.map((u) => (prevRoles.has(u.id) ? { ...u, role: prevRoles.get(u.id) ?? null } : u))
      );
      setErr(j.error ?? "bulk failed");
      return;
    }
    popFlash(`${j.updated ?? 0} role(s) updated`);
    setSelected(new Set());
  }

  async function bulkDisable(disable: boolean) {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (
      disable &&
      !(await confirmDialog({ message: `Disable ${ids.length} user(s)? They'll be signed out next request.`, confirmLabel: "Disable", tone: "danger" }))
    )
      return;
    setBusy(true);
    setErr(null);
    const now = new Date().toISOString();
    const prev = new Map(
      ids.map((id) => [id, users.find((u) => u.id === id)?.disabled_at ?? null])
    );
    patch(ids, { disabled_at: disable ? now : null });
    const res = await fetch(`/api/admin/users/bulk`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ op: "disabled", ids, disabled: disable }),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setUsers((p) =>
        p.map((u) => (prev.has(u.id) ? { ...u, disabled_at: prev.get(u.id) ?? null } : u))
      );
      setErr(j.error ?? "bulk failed");
      return;
    }
    popFlash(disable ? `${j.updated ?? 0} disabled` : `${j.updated ?? 0} re-enabled`);
    setSelected(new Set());
  }

  async function toggleDisabledSingle(id: string, disable: boolean) {
    if (id === meId) {
      setErr("can't disable self");
      return;
    }
    if (disable && !(await confirmDialog({ message: "Disable this user?", confirmLabel: "Disable", tone: "danger" }))) return;
    setBusy(true);
    setErr(null);
    const prev = users.find((u) => u.id === id)?.disabled_at ?? null;
    patch([id], { disabled_at: disable ? new Date().toISOString() : null });
    const res = await fetch(`/api/admin/users/${id}/disabled`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ disabled: disable }),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      patch([id], { disabled_at: prev });
      setErr(j.error ?? "failed");
      return;
    }
    popFlash(disable ? "disabled" : "re-enabled");
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3 border-2 border-ink p-3">
        <label className="block">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em]">Filter</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Name / email / role"
            className="mt-1 block w-72 border-2 border-ink bg-bone px-3 py-2 font-mono text-sm"
          />
        </label>
        <div className="ml-auto font-mono text-[10px] text-ink/50">
          {visible.length} of {users.length}
        </div>
      </div>

      {selected.size > 0 && (
        <div className="sticky top-[56px] z-20 flex flex-wrap items-center gap-2 border-2 border-rust bg-rust/10 p-3">
          <span className="font-mono text-xs font-bold text-rust">{selected.size} selected</span>
          <select
            value={bulkRole}
            onChange={(e) => setBulkRole(e.target.value as typeof ROLES[number])}
            className="border-2 border-ink bg-bone px-2 py-1 font-mono text-xs"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r.replace(/_/g, " ")}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={busy}
            onClick={bulkRoleChange}
            className="border-2 border-ink bg-ink px-3 py-1 font-mono text-[11px] uppercase tracking-[0.2em] text-bone disabled:opacity-40"
          >
            Set role
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => bulkDisable(true)}
            className="border-2 border-rust px-3 py-1 font-mono text-[11px] uppercase tracking-[0.2em] text-rust disabled:opacity-40"
          >
            Disable
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => bulkDisable(false)}
            className="border-2 border-moss px-3 py-1 font-mono text-[11px] uppercase tracking-[0.2em] text-moss disabled:opacity-40"
          >
            Re-enable
          </button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="border-2 border-ink/40 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.2em]"
          >
            Clear
          </button>
        </div>
      )}

      {err && (
        <div className="border-2 border-rust bg-rust/10 p-3 font-mono text-xs text-rust">
          {err}
        </div>
      )}
      {flash && (
        <div className="border-2 border-moss bg-moss/10 p-2 font-mono text-[11px] text-moss">
          {flash}
        </div>
      )}

      <div className="overflow-x-auto border-2 border-ink">
        <table className="w-full text-sm">
          <thead className="border-b-2 border-ink bg-kraft/20 text-left font-mono text-[10px] uppercase tracking-[0.2em]">
            <tr>
              <th className="w-8 px-3 py-3">
                <input
                  type="checkbox"
                  checked={allSelectedOnPage}
                  onChange={(e) => {
                    if (e.target.checked) setSelected(new Set(selectableIds));
                    else setSelected(new Set());
                  }}
                />
              </th>
              <th className="px-3 py-3">Name / email</th>
              <th className="px-3 py-3">Role</th>
              <th className="px-3 py-3">Invited</th>
              <th className="px-3 py-3">Last seen</th>
              <th className="px-3 py-3">Status</th>
              <th className="px-3 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((u) => (
              <tr
                key={u.id}
                className={`border-b border-ink/10 last:border-b-0 ${
                  selected.has(u.id) ? "bg-rust/10" : ""
                } ${u.disabled_at ? "opacity-60" : ""}`}
              >
                <td className="px-3 py-2">
                  {u.id !== meId && (
                    <input
                      type="checkbox"
                      checked={selected.has(u.id)}
                      onChange={(e) =>
                        toggle(u.id, (e.nativeEvent as MouseEvent).shiftKey)
                      }
                    />
                  )}
                </td>
                <td className="px-3 py-2">
                  <p className="font-semibold">{u.full_name ?? "—"}</p>
                  <p className="font-mono text-[10px] text-ink/60">{u.email ?? "(no email)"}</p>
                  {u.id === meId && (
                    <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-rust">
                      you
                    </p>
                  )}
                </td>
                <td className="px-3 py-2">
                  <select
                    value={u.role ?? "athlete"}
                    disabled={busy || u.id === meId}
                    onChange={(e) => changeRoleSingle(u.id, e.target.value)}
                    className="border border-ink bg-bone px-2 py-1 font-mono text-[11px] disabled:opacity-50"
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r.replace(/_/g, " ")}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2 font-mono text-[11px] text-ink/60">
                  {u.invited_at
                    ? new Date(u.invited_at).toLocaleDateString("en-IN")
                    : "—"}
                </td>
                <td className="px-3 py-2 font-mono text-[11px] text-ink/60">
                  {u.last_seen_at
                    ? new Date(u.last_seen_at).toLocaleDateString("en-IN")
                    : "—"}
                </td>
                <td className="px-3 py-2">
                  {u.disabled_at ? (
                    <span className="inline-block border border-rust bg-rust px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.2em] text-white">
                      disabled
                    </span>
                  ) : (
                    <span className="inline-block border border-moss bg-moss/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.2em] text-moss">
                      active
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  {u.id !== meId &&
                    (u.disabled_at ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => toggleDisabledSingle(u.id, false)}
                        className="border border-ink px-2 py-1 font-mono text-[10px] uppercase tracking-[0.2em] hover:bg-ink hover:text-bone"
                      >
                        Re-enable
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => toggleDisabledSingle(u.id, true)}
                        className="border border-rust px-2 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-rust hover:bg-rust hover:text-white"
                      >
                        Disable
                      </button>
                    ))}
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center font-mono text-xs text-ink/50">
                  No users match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
