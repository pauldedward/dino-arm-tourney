import { requireRole } from "@/lib/auth/roles";
import { createServiceClient } from "@/lib/db/supabase-service";
import Pagination from "@/components/admin/Pagination";
import UsersTable from "./UsersTable";
import InviteForm from "./InviteForm";

export const dynamic = "force-dynamic";

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200] as const;
const DEFAULT_PAGE_SIZE = 50;

type Search = {
  page?: string;
  pageSize?: string;
  role?: string;
  q?: string;
};

export default async function UsersPage({
  searchParams,
}: {
  searchParams?: Promise<Search>;
}) {
  const me = await requireRole("super_admin", "/admin/users");
  const sp = (searchParams ? await searchParams : {}) as Search;

  const pageSizeRaw = Number.parseInt(sp.pageSize ?? "", 10);
  const pageSize = (PAGE_SIZE_OPTIONS as readonly number[]).includes(pageSizeRaw)
    ? pageSizeRaw
    : DEFAULT_PAGE_SIZE;
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const q = (sp.q ?? "").trim();

  const svc = createServiceClient();
  let query = svc
    .from("profiles")
    .select(
      "id, email, full_name, role, invited_at, last_seen_at, disabled_at, created_at",
      { count: "estimated" }
    )
    .order("role", { ascending: false })
    .order("created_at", { ascending: false })
    .range(from, to);
  if (sp.role) query = query.eq("role", sp.role);
  if (q) {
    const like = `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`;
    query = query.or(`full_name.ilike.${like},email.ilike.${like}`);
  }
  const { data: users, count } = await query;
  const total = count ?? users?.length ?? 0;

  const buildHref = (overrides: Partial<Search>) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) {
      if (typeof v === "string" && v) next.set(k, v);
    }
    for (const [k, v] of Object.entries(overrides)) {
      if (v == null || v === "") next.delete(k);
      else next.set(k, v);
    }
    const qs = next.toString();
    return `/admin/users${qs ? `?${qs}` : ""}`;
  };

  const ROLE_FILTERS: Array<{ value: string; label: string }> = [
    { value: "", label: "All" },
    { value: "super_admin", label: "Super admin" },
    { value: "operator", label: "Operator" },
    { value: "athlete", label: "Athlete" },
  ];

  return (
    <div className="space-y-8">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.4em] text-ink/50">Super admin</p>
        <h1 className="mt-2 font-display text-5xl font-black tracking-tight">Users</h1>
        <p className="mt-2 font-mono text-xs text-ink/60">
          Invite operators, change roles, disable accounts. Promoting to
          super-admin requires double confirmation.
        </p>
      </div>
      <InviteForm />

      <form
        method="get"
        className="flex flex-wrap items-end gap-3 border-2 border-ink p-3"
      >
        {sp.role ? (
          <input type="hidden" name="role" value={sp.role} />
        ) : null}
        {sp.pageSize ? (
          <input type="hidden" name="pageSize" value={sp.pageSize} />
        ) : null}
        <label className="block">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em]">
            Search (server-wide)
          </span>
          <input
            name="q"
            defaultValue={q}
            placeholder="name or email"
            className="mt-1 block w-72 border-2 border-ink bg-bone px-3 py-2 font-mono text-sm"
          />
        </label>
        <button
          type="submit"
          className="h-10 border-2 border-ink bg-ink px-4 font-mono text-[10px] font-bold uppercase tracking-[0.3em] text-bone hover:bg-rust hover:border-rust"
        >
          Apply
        </button>
        {q ? (
          <a
            href={buildHref({ q: "", page: "1" })}
            className="h-10 border-2 border-ink/30 px-3 leading-[2.4rem] font-mono text-[10px] uppercase tracking-[0.2em] hover:border-ink"
          >
            Clear
          </a>
        ) : null}
        <div className="ml-auto flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em]">
          <span className="text-ink/50">Role</span>
          {ROLE_FILTERS.map((f) => {
            const active = (sp.role ?? "") === f.value;
            return (
              <a
                key={f.value || "all"}
                href={buildHref({ role: f.value, page: "1" })}
                className={`border px-2 py-1 ${active ? "border-ink bg-ink text-bone" : "border-ink/40 text-ink/70 hover:border-ink hover:text-ink"}`}
              >
                {f.label}
              </a>
            );
          })}
        </div>
      </form>

      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        itemLabel="users"
        options={PAGE_SIZE_OPTIONS}
        linkBase={{ path: "/admin/users", params: sp }}
      />

      <UsersTable users={users ?? []} meId={me.userId} />

      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        itemLabel="users"
        options={PAGE_SIZE_OPTIONS}
        compact
        linkBase={{ path: "/admin/users", params: sp }}
      />
    </div>
  );
}
