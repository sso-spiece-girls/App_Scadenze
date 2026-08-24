-- ============================================================================
-- 0002_allowlist.sql — Server-side signup allowlist
--
-- Only the emails listed below may create an account. Any other signup is
-- rejected by the database itself, so the block works even if the frontend
-- check (src/lib/access.ts) is bypassed.
--
-- Note: keep this list in sync with src/lib/access.ts.
-- ============================================================================

create or replace function auth.block_non_whitelisted_signup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if lower(new.email) not in (
    'naldilisa568@gmail.com'
  ) then
    raise exception 'AUTHORIZATION_DENIED: registration is restricted';
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_block_non_whitelisted on auth.users;
create trigger on_auth_user_block_non_whitelisted
  before insert on auth.users
  for each row execute function auth.block_non_whitelisted_signup();