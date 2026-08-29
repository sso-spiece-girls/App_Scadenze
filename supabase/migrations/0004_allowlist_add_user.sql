-- ============================================================================
-- 0004_allowlist_add_user.sql — Add naldilisa93@gmail.com to the signup allowlist
--
-- 0002 was already applied to the hosted database, so the whitelist function
-- is recreated here (create or replace) with the additional allowed email.
-- Keep this list in sync with src/lib/access.ts.
-- ============================================================================

create or replace function public.block_non_whitelisted_signup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if lower(new.email) not in (
    'naldilisa568@gmail.com',
    'naldilisa93@gmail.com'
  ) then
    raise exception 'AUTHORIZATION_DENIED: registration is restricted';
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_block_non_whitelisted on auth.users;
create trigger on_auth_user_block_non_whitelisted
  before insert on auth.users
  for each row execute function public.block_non_whitelisted_signup();