/**
 * Per-channel + Para-aware entry fee helper.
 *
 * Each event has an `entry_fee_default_inr` (the online/per-hand fee),
 * an optional `entry_fee_offline_inr` counter-desk override, and an
 * optional `entry_fee_para_inr` Para-only override (offline only — the
 * public form doesn't know the class at submit time).
 *
 * Resolution order:
 *   * online channel              → default
 *   * offline + non-Para entry    → offline ?? default
 *   * offline + Para entry        → para ?? offline ?? default
 *
 * NULL on any override means "fall through to the next tier" so existing
 * events keep their current behaviour without a backfill.
 */

export type RegistrationChannel = "online" | "offline";

export interface FeeSource {
  entry_fee_default_inr: number | null | undefined;
  entry_fee_offline_inr?: number | null | undefined;
  entry_fee_para_inr?: number | null | undefined;
}

export interface FeeOpts {
  /** Whether the entry being priced is a Para entry. Only affects
   *  offline pricing — online always uses the default. */
  isPara?: boolean;
}

function clampInt(n: number | null | undefined): number {
  if (n == null) return 0;
  return Math.max(0, Math.round(n));
}

/**
 * Per-hand fee for the given channel + entry kind. Returns 0 when no
 * applicable column is set (free events). Negative inputs are clamped to 0.
 */
export function feeFor(
  channel: RegistrationChannel,
  event: FeeSource,
  opts: FeeOpts = {}
): number {
  const defaultFee = clampInt(event.entry_fee_default_inr);
  if (channel === "online") return defaultFee;

  // Offline — Para gets first crack at the para override.
  if (opts.isPara && event.entry_fee_para_inr != null) {
    return clampInt(event.entry_fee_para_inr);
  }
  if (event.entry_fee_offline_inr != null) {
    return clampInt(event.entry_fee_offline_inr);
  }
  return defaultFee;
}

/**
 * Convenience: every per-hand fee variant in one shot. Useful for the
 * counter desk header pill that shows "₹X online · ₹Y desk · ₹Z para".
 */
export function feeBothChannels(event: FeeSource): {
  online: number;
  offline: number;
  para: number;
} {
  return {
    online: feeFor("online", event),
    offline: feeFor("offline", event),
    para: feeFor("offline", event, { isPara: true }),
  };
}
