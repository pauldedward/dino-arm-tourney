# Match-day operations

This is the on-the-day cheat sheet for running the Dino Arm Tourney
console **without internet**. Print it and keep it at the registration desk.

## 1. Pre-event (laptop with internet)

```pwsh
cd web
npm install
npm run build
node scripts/cache-photos.mjs            # mirror athlete photos to public/cached
```

If a particular event slug is needed:

```pwsh
node scripts/cache-photos.mjs --event tn-state-2026
```

Cached files land under `web/public/cached/<registration_id>.jpg`.
The app falls back to the cached path automatically when the R2 URL fails.

## 2. Start the LAN server

```pwsh
cd web
npm start -- -H 0.0.0.0 -p 3000
```

Find your laptop's LAN IP:

```pwsh
ipconfig | Select-String IPv4
```

Share the URL with operators (e.g. `http://192.168.1.21:3000`). Generate a
QR code for it with `npm run qr -- http://192.168.1.21:3000` (optional —
any QR generator works).

## 3. Operator briefing

| Action | Where |
|---|---|
| Verify UPI payment | `/admin/events/all-registrations` → click ✓ |
| Record weigh-in | `/admin/weighin` → tap athlete |
| Print ID cards | `/admin/print` → ID cards |
| Print fixtures | `/admin/print` → Fixtures (after Generate) |

## 4. Offline behaviour

- Weigh-in submissions queue locally (IndexedDB) when offline.
- The header shows **Offline · N queued** in red when disconnected.
- They flush automatically on reconnect or every 15 seconds.
- **Don't close the browser tab** while the queue is non-empty.

## 5. Troubleshooting

- **PDF won't open**: check that the event has registrations. The
  `Generate fixtures` button must be pressed before the Fixtures PDF works.
- **Camera blocked**: the weigh-in page needs `getUserMedia`. Use HTTPS
  or `localhost`. On a LAN, install a self-signed cert or accept the
  browser's permission prompt manually on each operator device.
- **Forgot operator password**: super-admin can re-invite from
  `/admin/users` (issues a new temp password).

## 6. Post-event

- Export CSVs from `/admin/events/all-registrations` and
  `/admin/audit` (super-admin only).
- Archive Supabase project if you don't need realtime updates.
