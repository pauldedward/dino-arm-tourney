import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/roles";
import { createServiceClient } from "@/lib/db/supabase-service";
import { signedUrl } from "@/lib/storage";

export const runtime = "nodejs";

/**
 * GET /api/admin/payments/[id]/proof
 *
 * Operator+ only. Returns short-lived signed URL(s) for the payment's
 * proof screenshot(s) so the operator can preview before verify/reject.
 * Includes the latest mirrored proof on `payments.proof_url` and any
 * historical entries from `payment_proofs`.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await requireRole("operator", "/admin");
  const { id } = await params;

  const svc = createServiceClient();
  const { data: payment } = await svc
    .from("payments")
    .select("id, utr, proof_url, status")
    .eq("id", id)
    .maybeSingle();
  if (!payment) {
    return NextResponse.json({ error: "payment not found" }, { status: 404 });
  }

  const { data: history } = await svc
    .from("payment_proofs")
    .select("id, utr, proof_url, created_at")
    .eq("payment_id", id)
    .order("created_at", { ascending: false });

  async function sign(key: string | null): Promise<string | null> {
    if (!key) return null;
    // proof_url stores a storage key (set by /api/payment/proof[s]). If a
    // legacy row already has a full URL, return it as-is.
    if (/^https?:\/\//i.test(key)) return key;
    try {
      return await signedUrl(key, 600);
    } catch (e) {
      console.error("[payments/proof] sign failed", e);
      return null;
    }
  }

  const [latestUrl, historyUrls] = await Promise.all([
    sign(payment.proof_url),
    Promise.all(
      (history ?? []).map(async (h) => ({
        id: h.id,
        utr: h.utr,
        created_at: h.created_at,
        url: await sign(h.proof_url),
      }))
    ),
  ]);

  return NextResponse.json({
    paymentStatus: payment.status,
    latest: latestUrl ? { utr: payment.utr, url: latestUrl } : null,
    history: historyUrls,
  });
}
