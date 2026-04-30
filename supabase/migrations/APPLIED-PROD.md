# Migrations applied to `dino-prod`

In-repo log of which migrations have been run against the production
Supabase project. Append a new line **in the same PR** that adds the
migration. See [PLAN-DEPLOY.md](../../PLAN-DEPLOY.md) §4.

Format: `NNNN_filename.sql — YYYY-MM-DD — applied by <name> via <method>`

Methods: `sql-editor` (paste into Supabase dashboard) or `cli`
(`supabase db push` / `scripts/apply-migrations.mjs`).

---

## Legacy baseline (applied via `supabase/schema.sql` first-day setup)

Files `0001_init.sql` through `0044_para_entry_fee.sql` are considered
the production baseline as of **2026-04-30** (the day prod went live).
Do **not** edit these files. Any further changes go in `0045_*.sql` and
later.

```
0001_init.sql                         — baseline — schema.sql first-day paste
0002_hubs_eventlog.sql                — baseline
0003_week1.sql                        — baseline
0004_event_poster.sql                 — baseline
0005_audit_log_event_set_null.sql     — baseline
0006_athlete_registration_auth.sql    — baseline
0007_role_simplification.sql          — baseline
0008_registration_v2.sql              — baseline
0009_per_class_hand.sql               — baseline
0010_drop_registrations_para_class_check.sql — baseline
0011_registration_public_token.sql    — baseline
0012_payment_proofs.sql               — baseline
0013_realtime.sql                     — baseline
0014_event_circular.sql               — baseline
0015_aadhaar_full.sql                 — baseline
0016_registrations_perf_indexes.sql   — baseline
0017_event_summary_perf.sql           — baseline
0018_payment_mode.sql                 — baseline
0019_event_dashboard_rpc.sql          — baseline
0020_backfill_offline_payment_method.sql — baseline
0021_rebrand_iaff_to_pafi.sql         — baseline
0022_double_elim_brackets.sql         — baseline
0022_id_card_text_sizes.sql           — baseline
0023_event_bracket_format.sql         — baseline
0024_fixtures_best_of.sql             — baseline
0024_payment_installments.sql         — baseline
0025_assign_chest_no_trigger.sql      — baseline
0026_district_team_chest_blocks.sql   — baseline
0027_payment_collections_payer_label.sql — baseline
0028_payment_summary_view.sql         — baseline
0029_registration_checkin_status.sql  — baseline
0030_fixture_runtime.sql              — baseline
0031_fixture_runtime_lockdown.sql     — baseline
0032_category_table_no.sql            — baseline
0033_fixture_runtime_fix.sql          — baseline
0034_fill_next_slot_fix.sql           — baseline
0035_fill_next_slot_chain.sql         — baseline
0036_offline_entry_fee_and_channel.sql — baseline
0037_payment_summary_waivers.sql      — baseline
0038_weight_bump_up.sql               — baseline
0039_registration_status_split.sql    — baseline
0040_weight_overrides.sql             — baseline
0041_chest_blocks_start_1000.sql      — baseline
0042_profile_erased_at.sql            — baseline
0043_user_hard_delete.sql             — baseline
0044_para_entry_fee.sql               — baseline
```

## Post-launch migrations

<!-- Append below this line. Keep newest at the bottom. -->
