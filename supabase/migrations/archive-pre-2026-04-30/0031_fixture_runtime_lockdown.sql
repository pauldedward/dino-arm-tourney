-- 0031_fixture_runtime_lockdown.sql
-- The two RPCs added in 0030 are only ever invoked from server routes
-- using the service-role key (which bypasses GRANTs). Exposing them on
-- /rest/v1/rpc to anon/authenticated would let any signed-in athlete
-- close other people's matches. Revoke EXECUTE so the public API
-- surface drops them.
revoke execute on function apply_fixture_complete(uuid, char, int, int, text, uuid) from anon, authenticated, public;
revoke execute on function fill_next_slot(uuid, int, uuid, uuid, timestamptz) from anon, authenticated, public;
