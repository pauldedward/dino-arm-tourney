-- 0011 — Public, unguessable token for registration confirmation URLs.
--
-- The thank-you / payment-proof page lives at
-- /e/<event-slug>/registered/<token>. It exposes payment status, UPI
-- deep-link, chest number, full name — sensitive enough that the URL
-- itself must act as a bearer secret. The previous URL used the raw
-- registrations.id (UUID v4); UUIDs are non-enumerable but are also a
-- DB primary key we'd rather not splash through email/QR/share links.
--
-- This migration adds a dedicated `public_token` column: 16 hex chars
-- (64 bits of entropy), unique, auto-filled on insert, and backfilled
-- for existing rows.

create extension if not exists pgcrypto;

alter table registrations
  add column if not exists public_token text;

-- Backfill any existing rows with a fresh token.
update registrations
   set public_token = encode(gen_random_bytes(8), 'hex')
 where public_token is null;

-- From now on every insert without an explicit token gets one.
alter table registrations
  alter column public_token set default encode(gen_random_bytes(8), 'hex'),
  alter column public_token set not null;

create unique index if not exists registrations_public_token_idx
  on registrations(public_token);
