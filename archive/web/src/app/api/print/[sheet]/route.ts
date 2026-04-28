import { NextRequest, NextResponse } from "next/server";
import { renderToStream } from "@react-pdf/renderer";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSession, isOperator } from "@/lib/auth";
import { NominalSheet } from "@/lib/pdf/NominalSheet";
import { CategorySheet, type CategoryRow } from "@/lib/pdf/CategorySheet";
import { IdCardSheet } from "@/lib/pdf/IdCardSheet";
import { FixturesSheet, type FixtureRow } from "@/lib/pdf/FixturesSheet";
import { PendingDuesSheet } from "@/lib/pdf/PendingDuesSheet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Sheet = "nominal" | "category" | "idcard" | "fixtures" | "dues";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ sheet: string }> }
) {
  const sess = await getSession();
  if (!isOperator(sess.role)) return new NextResponse("Forbidden", { status: 403 });
  const { sheet } = await ctx.params;
  const eventId = req.nextUrl.searchParams.get("event_id");
  if (!eventId) return new NextResponse("event_id required", { status: 400 });

  const admin = createAdminClient();
  const { data: event } = await admin.from("events").select("*").eq("id", eventId).maybeSingle();
  if (!event) return new NextResponse("Event not found", { status: 404 });

  let stream: NodeJS.ReadableStream;
  let filename: string;

  switch (sheet as Sheet) {
    case "nominal": {
      const { data: rows } = await admin
        .from("registrations")
        .select("chest_no, full_name, division, district, team, declared_weight_kg, age_categories, status")
        .eq("event_id", eventId)
        .order("full_name");
      stream = await renderToStream(NominalSheet({ event, rows: (rows ?? []) as never }));
      filename = `nominal-${event.slug}.pdf`;
      break;
    }
    case "category": {
      const { data: ents } = await admin
        .from("entries")
        .select("category_code, registrations!inner(chest_no, full_name, district, event_id)")
        .eq("registrations.event_id", eventId)
        .order("category_code");
      const grouped = new Map<string, CategoryRow["athletes"]>();
      for (const e of (ents ?? []) as unknown as Array<{
        category_code: string;
        registrations: { chest_no: number | null; full_name: string | null; district: string | null };
      }>) {
        const arr = grouped.get(e.category_code) ?? [];
        arr.push({
          chest_no: e.registrations.chest_no,
          full_name: e.registrations.full_name,
          district: e.registrations.district,
        });
        grouped.set(e.category_code, arr);
      }
      const categories: CategoryRow[] = [...grouped.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([category_code, athletes]) => ({ category_code, athletes }));
      stream = await renderToStream(CategorySheet({ event, categories }));
      filename = `category-${event.slug}.pdf`;
      break;
    }
    case "idcard": {
      const { data: rows } = await admin
        .from("registrations")
        .select("chest_no, full_name, division, district, team, declared_weight_kg, photo_url")
        .eq("event_id", eventId)
        .order("chest_no");
      stream = await renderToStream(IdCardSheet({ event, rows: (rows ?? []) as never }));
      filename = `id-cards-${event.slug}.pdf`;
      break;
    }
    case "fixtures": {
      const { data: fxs } = await admin
        .from("fixtures")
        .select("category_code, round_no, match_no, entry_a:entries!fixtures_entry_a_id_fkey(registrations(chest_no, full_name)), entry_b:entries!fixtures_entry_b_id_fkey(registrations(chest_no, full_name))")
        .eq("event_id", eventId)
        .order("category_code")
        .order("round_no")
        .order("match_no");
      const grouped = new Map<string, Map<number, FixtureRow["rounds"][number]["matches"]>>();
      for (const f of (fxs ?? []) as unknown as Array<{
        category_code: string;
        round_no: number;
        match_no: number;
        entry_a: { registrations: { chest_no: number | null; full_name: string | null } } | null;
        entry_b: { registrations: { chest_no: number | null; full_name: string | null } } | null;
      }>) {
        let cat = grouped.get(f.category_code);
        if (!cat) {
          cat = new Map();
          grouped.set(f.category_code, cat);
        }
        const arr = cat.get(f.round_no) ?? [];
        arr.push({
          match_no: f.match_no,
          a: f.entry_a?.registrations ? `#${f.entry_a.registrations.chest_no} ${f.entry_a.registrations.full_name}` : null,
          b: f.entry_b?.registrations ? `#${f.entry_b.registrations.chest_no} ${f.entry_b.registrations.full_name}` : null,
        });
        cat.set(f.round_no, arr);
      }
      const categories: FixtureRow[] = [...grouped.entries()].map(([category_code, rounds]) => ({
        category_code,
        rounds: [...rounds.entries()].sort(([a], [b]) => a - b).map(([round_no, matches]) => ({ round_no, matches })),
      }));
      stream = await renderToStream(FixturesSheet({ event, categories }));
      filename = `fixtures-${event.slug}.pdf`;
      break;
    }
    case "dues": {
      const { data: rows } = await admin
        .from("payments")
        .select("amount_inr, status, registrations!inner(chest_no, full_name, district, team, event_id)")
        .eq("registrations.event_id", eventId)
        .in("status", ["pending", "submitted", "rejected"]);
      const dueRows = ((rows ?? []) as unknown as Array<{
        amount_inr: number;
        status: string;
        registrations: { chest_no: number | null; full_name: string | null; district: string | null; team: string | null };
      }>).map((r) => ({
        chest_no: r.registrations.chest_no,
        full_name: r.registrations.full_name,
        district: r.registrations.district,
        team: r.registrations.team,
        amount_inr: r.amount_inr,
        status: r.status,
      }));
      stream = await renderToStream(PendingDuesSheet({ event, rows: dueRows }));
      filename = `pending-dues-${event.slug}.pdf`;
      break;
    }
    default:
      return new NextResponse("Unknown sheet", { status: 400 });
  }

  // Convert Node stream to Web stream for NextResponse.
  const webStream = nodeToWeb(stream);
  return new NextResponse(webStream, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}

function nodeToWeb(node: NodeJS.ReadableStream): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      node.on("data", (chunk: Buffer | string) => {
        controller.enqueue(typeof chunk === "string" ? new TextEncoder().encode(chunk) : new Uint8Array(chunk));
      });
      node.on("end", () => controller.close());
      node.on("error", (err) => controller.error(err));
    },
  });
}
