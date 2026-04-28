import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function AdminHomePage() {
  const admin = createAdminClient();
  const { count: regCount } = await admin
    .from("registrations")
    .select("*", { count: "exact", head: true });
  const { count: payPending } = await admin
    .from("payments")
    .select("*", { count: "exact", head: true })
    .eq("status", "submitted");
  const { count: weighedIn } = await admin
    .from("registrations")
    .select("*", { count: "exact", head: true })
    .eq("status", "weighed_in");
  const { count: eventsCount } = await admin
    .from("events")
    .select("*", { count: "exact", head: true });

  return (
    <div className="space-y-8">
      <h1 className="font-display text-5xl tracking-tight2">Console</h1>

      <div className="grid grid-cols-2 gap-px bg-ink md:grid-cols-4">
        <Tile n={String(eventsCount ?? 0)} l="Events" />
        <Tile n={String(regCount ?? 0)} l="Registrations" />
        <Tile n={String(payPending ?? 0)} l="Payments to verify" />
        <Tile n={String(weighedIn ?? 0)} l="Weighed in" />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card href="/admin/events" title="Events" body="Create, publish, close." />
        <Card href="/admin/events/all-registrations" title="Registrations" body="Verify payments, edit rows." />
        <Card href="/admin/weighin" title="Weigh-in" body="Record measured weight + photo." />
        <Card href="/admin/categories" title="Categories" body="Preview brackets. Generate fixtures." />
        <Card href="/admin/print" title="Print" body="Nominal, category, ID cards, fixtures." />
      </div>
    </div>
  );
}

function Tile({ n, l }: { n: string; l: string }) {
  return (
    <div className="bg-bone p-6">
      <p className="tnum font-display text-4xl tracking-tight2">{n}</p>
      <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.3em] text-ink/60">{l}</p>
    </div>
  );
}

function Card({ href, title, body }: { href: string; title: string; body: string }) {
  return (
    <Link href={href} className="block border-2 border-ink p-5 hover:bg-volt">
      <p className="font-display text-2xl tracking-tight2">{title}</p>
      <p className="mt-1 font-mono text-xs text-ink/70">{body}</p>
    </Link>
  );
}
