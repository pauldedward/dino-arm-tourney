#!/usr/bin/env node
// DEPRECATED as of 2026-04-30.
//
// supabase/schema.sql is no longer generated from supabase/migrations/legacy/*.sql.
// It is now a hand-curated, dev-introspected baseline (see
// supabase/migrations/README.md for the rebuild story). Running this bundler
// would overwrite the real schema, so it now exits without touching anything.
//
// New workflow: see supabase/migrations/README.md.

console.error(
  "[build-schema-bundle] DEPRECATED. supabase/schema.sql is hand-curated since 2026-04-30. Refusing to overwrite. See supabase/migrations/README.md.",
);
process.exit(1);
