/**
 * Per-channel entry fee helper.
 *
 * Each event has an `entry_fee_default_inr` (the online/per-hand fee) and
 * an optional `entry_fee_offline_inr`. When the offline override is null
 * the offline channel falls back to the online fee, so existing events
 * keep their current behaviour without a backfill.
 */

export type RegistrationChannel = "online" | "offline";

export interface FeeSource {
  entry_fee_default_inr: number | null | undefined;
  entry_fee_offline_inr?: number | null | undefined;
}

/**
 * Per-hand fee for the given channel. Returns 0 when neither column is set
 * (free events). Negative inputs are clamped to 0.
 */
export function feeFor(channel: RegistrationChannel, event: FeeSource): number {
  const online = Math.max(0, Math.round(event.entry_fee_default_inr ?? 0));
  if (channel === "online") return online;
  const offline = event.entry_fee_offline_inr;
  if (offline == null) return online;
  return Math.max(0, Math.round(offline));
}

/**
 * Convenience: both per-hand fees in one shot. Useful for the counter
 * desk header pill that shows "₹X online · ₹Y desk".
 */
export function feeBothChannels(event: FeeSource): {
  online: number;
  offline: number;
} {
  return {
    online: feeFor("online", event),
    offline: feeFor("offline", event),
  };
}
