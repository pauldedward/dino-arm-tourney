import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import WeighInForm from "./WeighInForm";

export const dynamic = "force-dynamic";

export default async function WeighInDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const admin = createAdminClient();
  const { data: reg } = await admin
    .from("registrations")
    .select("id, chest_no, full_name, division, declared_weight_kg, photo_url, status, events(name, slug)")
    .eq("id", id)
    .maybeSingle();
  if (!reg) notFound();
  const { data: history } = await admin
    .from("weigh_ins")
    .select("id, measured_kg, weighed_at, live_photo_url")
    .eq("registration_id", id)
    .order("weighed_at", { ascending: false });

  return (
    <div className="space-y-6">
      <Link href="/admin/weighin" className="font-mono text-[10px] uppercase tracking-[0.3em] text-ink/60 hover:text-ink">
        ← Queue
      </Link>
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[260px_1fr]">
        <div className="space-y-3">
          {reg.photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={reg.photo_url} alt="" className="w-full border-2 border-ink" />
          ) : (
            <div className="grid h-64 place-items-center border-2 border-ink font-mono text-xs text-ink/40">No photo</div>
          )}
          <p className="font-display text-3xl tnum tracking-tight2">#{reg.chest_no}</p>
          <p className="font-display text-xl">{reg.full_name}</p>
          <p className="font-mono text-xs uppercase tracking-[0.3em]">{reg.division}</p>
          <p className="font-mono text-xs">Declared: <strong className="tnum">{reg.declared_weight_kg} kg</strong></p>
        </div>
        <WeighInForm registrationId={id} />
      </div>

      {history && history.length > 0 && (
        <div className="border-2 border-ink p-4">
          <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.3em] text-ink/60">History</p>
          <ul className="space-y-1 text-sm">
            {history.map((h) => (
              <li key={h.id} className="font-mono text-xs">
                {new Date(h.weighed_at).toLocaleString()} — {h.measured_kg} kg
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
