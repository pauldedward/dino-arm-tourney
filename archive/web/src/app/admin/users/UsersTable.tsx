"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

const ROLES = [
  "athlete",
  "operator",
  "weigh_in_official",
  "organiser",
  "federation_admin",
  "super_admin",
  "referee",
  "medical",
  "accounts",
];

type Row = {
  id: string;
  full_name: string | null;
  email: string | null;
  role: string;
  disabled_at: string | null;
  created_at: string;
  last_seen_at: string | null;
};

export default function UsersTable({ rows, currentUserId }: { rows: Row[]; currentUserId: string }) {
  const router = useRouter();
  const [busy, start] = useTransition();

  function changeRole(id: string, role: string) {
    start(async () => {
      await fetch(`/api/users/${id}/role`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role }),
      });
      router.refresh();
    });
  }
  function toggle(id: string, disabled: boolean) {
    start(async () => {
      await fetch(`/api/users/${id}/${disabled ? "enable" : "disable"}`, { method: "PATCH" });
      router.refresh();
    });
  }

  return (
    <div className="border-2 border-ink overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b-2 border-ink bg-ink/5">
          <tr className="text-left font-mono text-[10px] uppercase tracking-[0.2em]">
            <th className="px-3 py-2">Name</th>
            <th className="px-3 py-2">Email</th>
            <th className="px-3 py-2">Role</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isSelf = r.id === currentUserId;
            return (
              <tr key={r.id} className="border-b border-ink/10">
                <td className="px-3 py-2">{r.full_name}</td>
                <td className="px-3 py-2 font-mono text-xs">{r.email}</td>
                <td className="px-3 py-2">
                  <select
                    disabled={busy || isSelf}
                    value={r.role}
                    onChange={(e) => changeRole(r.id, e.target.value)}
                    className="border-2 border-ink bg-bone px-2 py-1 font-mono text-xs disabled:opacity-50"
                  >
                    {ROLES.map((role) => (
                      <option key={role} value={role}>{role}</option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2">
                  {r.disabled_at ? (
                    <span className="border border-ink px-1 font-mono text-[10px] text-blood">disabled</span>
                  ) : (
                    <span className="border border-ink px-1 font-mono text-[10px]">active</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  {!isSelf && (
                    <button
                      disabled={busy}
                      onClick={() => toggle(r.id, !!r.disabled_at)}
                      className="font-mono text-xs underline hover:text-blood"
                    >
                      {r.disabled_at ? "Enable" : "Disable"}
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
