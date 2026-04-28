"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/db/supabase-browser";

type RealtimeTable =
  | "registrations"
  | "payments"
  | "payment_proofs"
  | "weigh_ins"
  | "events"
  | "fixtures"
  | "entries";

/**
 * Drop-in realtime "auto-refresh" for server-rendered pages.
 *
 * Opens ONE Supabase websocket channel per page and listens for
 * `postgres_changes` on the tables you pass. On any event it calls
 * `router.refresh()` so the parent RSC re-runs and React reconciles
 * the diff — no full page reload, no client-side state duplication.
 *
 * Important RLS detail:
 *   Realtime payloads obey RLS. The realtime server checks the JWT
 *   carried on the WebSocket. We explicitly call `realtime.setAuth(...)`
 *   before subscribing so the user's role is honoured (operators see
 *   admin-only tables; athletes see only their own rows).
 *
 * Performance notes:
 *   - The browser Supabase client is module-cached → one socket per tab.
 *   - Refreshes are debounced (250ms) so a burst of inserts = one refetch.
 *   - Pass `eventId` whenever the page is event-scoped so the server-side
 *     `event_id=eq.<uuid>` filter narrows the payload stream.
 *
 * Set `localStorage.LIVE_REFRESH_DEBUG = "1"` to log channel status and
 * each received payload to the console for diagnosis.
 *
 * Tables must be in the `supabase_realtime` publication
 * (see supabase/migrations/0013_realtime.sql).
 */
export default function LiveRefresh({
  tables,
  eventId,
  debounceMs = 250,
}: {
  tables: ReadonlyArray<RealtimeTable>;
  eventId?: string;
  debounceMs?: number;
}) {
  const router = useRouter();
  // Stable dep key so a new array literal each render doesn't resubscribe.
  const tablesKey = [...tables].sort().join(",");
  const tablesRef = useRef(tables);
  tablesRef.current = tables;

  useEffect(() => {
    const sb = createClient();
    const debug =
      typeof window !== "undefined" &&
      window.localStorage?.getItem("LIVE_REFRESH_DEBUG") === "1";
    const log = (...a: unknown[]) => {
      if (debug) console.log("[LiveRefresh]", ...a);
    };

    let channel: ReturnType<typeof sb.channel> | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), debounceMs);
    };

    async function subscribe() {
      // Bind the current session JWT to the realtime socket so RLS
      // recognises the user's role. Without this, restricted tables
      // (registrations, payments, weigh_ins) emit nothing for the client.
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token ?? null;
      if (token) sb.realtime.setAuth(token);
      if (cancelled) return;

      const name = `live:${eventId ?? "all"}:${tablesKey}`;
      channel = sb.channel(name);

      for (const table of tablesRef.current) {
        channel.on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table,
            ...(eventId && tableHasEventId(table)
              ? { filter: `event_id=eq.${eventId}` }
              : {}),
          },
          (payload) => {
            log("event", table, payload.eventType);
            schedule();
          }
        );
      }

      channel.subscribe((status, err) => {
        log("status", name, status, err ?? "");
      });
    }

    subscribe();

    // Refresh the realtime auth when the user's token rotates.
    const { data: authSub } = sb.auth.onAuthStateChange((_event, session) => {
      if (session?.access_token) sb.realtime.setAuth(session.access_token);
    });

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (channel) sb.removeChannel(channel);
      authSub.subscription.unsubscribe();
    };
  }, [router, eventId, debounceMs, tablesKey]);

  return null;
}

// `events` is keyed by id (no event_id column); payment_proofs/weigh_ins
// reference `registration_id`. We can only pre-filter at the realtime
// server for tables that actually have an `event_id` column.
function tableHasEventId(table: RealtimeTable): boolean {
  return (
    table === "registrations" ||
    table === "payments" ||
    table === "fixtures" ||
    table === "entries"
  );
}
