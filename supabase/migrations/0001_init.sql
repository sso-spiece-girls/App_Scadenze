-- ============================================================================
-- 0001_init.sql — App Scadenze & Sprechi
-- Schema, triggers and Row Level Security policies.
-- Apply with: supabase db push  (or via the Supabase dashboard SQL editor)
-- ============================================================================

-- The app is designed around the Helsinki / Finland timezone (Coop.fi is the
-- Finnish S-Group chain). Set the database session timezone so date-only
-- logic and "now()" comparisons behave consistently.
ALTER DATABASE postgres SET timezone TO 'Europe/Helsinki';

-- ---------------------------------------------------------------------------
-- EXTENSIONS
-- ---------------------------------------------------------------------------
create extension if not exists "pgcrypto";

-- ============================================================================
-- PROFILES
-- ============================================================================
create table if not exists public.profiles (
  id                        uuid primary key references auth.users (id) on delete cascade,
  full_name                 text,
  notification_enabled      boolean not null default true,
  default_expiry_offset_days integer not null default 7,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

-- ============================================================================
-- PRODUCTS
-- ============================================================================
create table if not exists public.products (
  id                          uuid primary key default gen_random_uuid(),
  user_id                     uuid not null references auth.users (id) on delete cascade,
  barcode                     text not null,
  name                        text not null,
  brand                       text,
  category                    text,
  image_url                   text,
  quantity                    text,
  unit                        text,
  purchase_date               date,
  expiration_date             date not null,
  price                       numeric(10,2) not null default 0,
  price_source                text not null default 'manual' check (price_source in ('s-kaupat','openfoodfacts','manual','none','unknown')),
  price_fetched_at            timestamptz,
  price_was_manually_corrected boolean not null default false,
  status                      text not null default 'active'
                              check (status in ('active','finished','expired','wasted')),
  notification_7_days_sent    boolean not null default false,
  finished_at                 timestamptz,
  wasted_at                   timestamptz,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

comment on column public.products.status is
  'active = in dispensa; finished = consumato; expired = data raggiunta; wasted = valore considerato perso';

-- ============================================================================
-- PRODUCT CATALOG (user's private barcode -> product identity cache)
-- ============================================================================
create table if not exists public.product_catalog (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  barcode     text not null,
  name        text not null,
  brand       text,
  category    text,
  image_url   text,
  quantity    text,
  unit        text,
  source      text not null default 'openfoodfacts' check (source in ('openfoodfacts','manual')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, barcode)
);

-- ============================================================================
-- PRICE CACHE (global, read by all authenticated users; written server-side)
-- Caches Coop.fi/S-Kaupat lookups so we don't hammer the third-party API.
-- ============================================================================
create table if not exists public.price_cache (
  barcode     text primary key,
  name        text,
  brand       text,
  category    text,
  image_url   text,
  price       numeric(10,2),
  currency    text not null default 'EUR',
  price_source text not null default 's-kaupat',
  fetched_at  timestamptz not null default now(),
  raw         jsonb
);

-- ============================================================================
-- PUSH SUBSCRIPTIONS (Web Push)
-- ============================================================================
create table if not exists public.push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  endpoint      text not null unique,
  p256dh        text not null,
  auth          text not null,
  user_agent    text,
  created_at    timestamptz not null default now(),
  last_notified_at timestamptz
);

-- ============================================================================
-- TRIGGERS
-- ============================================================================
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

drop trigger if exists product_catalog_set_updated_at on public.product_catalog;
create trigger product_catalog_set_updated_at
  before update on public.product_catalog
  for each row execute function public.set_updated_at();

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- When an expiration date is pushed later, allow a fresh 7-day notification.
create or replace function public.reset_notification_flag()
returns trigger as $$
begin
  if new.expiration_date is distinct from old.expiration_date
     and new.expiration_date > old.expiration_date then
    new.notification_7_days_sent = false;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists products_reset_notification on public.products;
create trigger products_reset_notification
  before update on public.products
  for each row execute function public.reset_notification_flag();

-- Keep wasted_at consistent when a product is marked wasted by any path
-- (cron, manual action). The waste is attributed to the expiration date so
-- monthly/yearly aggregates align with when the food went bad.
create or replace function public.set_wasted_at()
returns trigger as $$
begin
  if new.status = 'wasted' and new.wasted_at is null then
    new.wasted_at = new.expiration_date;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists products_set_wasted_at on public.products;
create trigger products_set_wasted_at
  before insert or update of status, expiration_date on public.products
  for each row execute function public.set_wasted_at();

-- Auto-create a profile row for every new auth user.
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- ROW LEVEL SECURITY
-- Every user can read/write ONLY their own rows. Edge functions access the
-- data through the service role (bypasses RLS) for maintenance tasks.
-- ============================================================================
alter table public.profiles          enable row level security;
alter table public.products          enable row level security;
alter table public.product_catalog   enable row level security;
alter table public.price_cache       enable row level security;
alter table public.push_subscriptions enable row level security;

-- profiles ---------------------------------------------------------------
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- products ----------------------------------------------------------------
drop policy if exists "products_select_own" on public.products;
create policy "products_select_own" on public.products
  for select using (auth.uid() = user_id);

drop policy if exists "products_insert_own" on public.products;
create policy "products_insert_own" on public.products
  for insert with check (auth.uid() = user_id);

drop policy if exists "products_update_own" on public.products;
create policy "products_update_own" on public.products
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "products_delete_own" on public.products;
create policy "products_delete_own" on public.products
  for delete using (auth.uid() = user_id);

-- product_catalog ----------------------------------------------------------
drop policy if exists "catalog_select_own" on public.product_catalog;
create policy "catalog_select_own" on public.product_catalog
  for select using (auth.uid() = user_id);

drop policy if exists "catalog_insert_own" on public.product_catalog;
create policy "catalog_insert_own" on public.product_catalog
  for insert with check (auth.uid() = user_id);

drop policy if exists "catalog_update_own" on public.product_catalog;
create policy "catalog_update_own" on public.product_catalog
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "catalog_delete_own" on public.product_catalog;
create policy "catalog_delete_own" on public.product_catalog
  for delete using (auth.uid() = user_id);

-- price_cache --------------------------------------------------------------
-- Public catalog data: any signed-in user may read cached prices.
drop policy if exists "price_cache_select_auth" on public.price_cache;
create policy "price_cache_select_auth" on public.price_cache
  for select using (auth.role() = 'authenticated');

-- push_subscriptions -------------------------------------------------------
drop policy if exists "push_select_own" on public.push_subscriptions;
create policy "push_select_own" on public.push_subscriptions
  for select using (auth.uid() = user_id);

drop policy if exists "push_insert_own" on public.push_subscriptions;
create policy "push_insert_own" on public.push_subscriptions
  for insert with check (auth.uid() = user_id);

drop policy if exists "push_update_own" on public.push_subscriptions;
create policy "push_update_own" on public.push_subscriptions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "push_delete_own" on public.push_subscriptions;
create policy "push_delete_own" on public.push_subscriptions
  for delete using (auth.uid() = user_id);

-- ============================================================================
-- INDEXES
-- ============================================================================
create index if not exists idx_products_user_status   on public.products (user_id, status);
create index if not exists idx_products_user_expiry   on public.products (user_id, expiration_date);
create index if not exists idx_products_barcode       on public.products (barcode);
create index if not exists idx_products_expiry        on public.products (expiration_date);
create index if not exists idx_catalog_user_barcode   on public.product_catalog (user_id, barcode);
create index if not exists idx_push_user              on public.push_subscriptions (user_id);