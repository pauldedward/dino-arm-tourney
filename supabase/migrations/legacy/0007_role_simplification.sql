-- ─────────────────────────────────────────────────────────────────────────────
-- 0007_role_simplification
-- Collapse roles to three: athlete, operator, super_admin.
-- Federation_admin / organiser / weigh_in_official / referee / medical /
-- accounts all fold into 'operator'. super_admin and athlete untouched.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Remap existing rows BEFORE tightening the check constraint.
update profiles
set role = 'operator'
where role in ('federation_admin','organiser','weigh_in_official',
               'referee','medical','accounts');

-- 2. Replace check constraint.
alter table profiles
  drop constraint if exists profiles_role_check;
alter table profiles
  add constraint profiles_role_check
    check (role in ('athlete','operator','super_admin'));

-- 3. Simplify role_at_least helper.
create or replace function role_at_least(min_role text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from profiles p
    where p.id = auth.uid()
      and p.disabled_at is null
      and case min_role
        when 'operator'    then p.role in ('operator','super_admin')
        when 'super_admin' then p.role = 'super_admin'
        else false
      end
  );
$$;
