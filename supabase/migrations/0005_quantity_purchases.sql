-- ============================================================================
-- 0005_quantity_purchases.sql — Quantity-aware products + purchase import
--
-- Adds to `products`:
--   * quantity_count   — number of physical units bought (default 1);
--   * consumed_count   — units already consumed (0..quantity_count);
--   * notes            — free-text notes (edit form);
--   * import_method    — how the product was entered: barcode | receipt_barcode
--                        | ocr | manual (used to audit receipt imports);
--   * purchase_id      — optional link to the purchases row that produced it.
--
-- Makes `expiration_date` nullable: products imported from a receipt have NO
-- known expiration (it is never invented) — the user sets it later from the
-- product list. Existing rows keep their value; every product filter / cron
-- already treats NULL dates as "no expiry" (SQL comparisons exclude NULL).
--
-- New tables:
--   * purchases        — one shopping trip (store, date, total, import method,
--                        receipt identifier when available);
--   * purchase_items   — line items of a purchase (barcode, name, quantity,
--                        unit price, total price, optional product link).
--
-- Semantics of `price`: unit price (€ paid per single unit). Waste is then
-- computed as price * (quantity_count - consumed_count), so a 3-pack of milk
-- where 2 units were consumed wastes 1 × unit price, not 3 × it.
--
-- All changes are idempotent and backward compatible: existing rows get
-- quantity_count = 1 / consumed_count = 0, i.e. exactly the old behavior.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- PRODUCTS: new columns
-- ---------------------------------------------------------------------------
alter table public.products add column if not exists quantity_count integer not null default 1;
alter table public.products add column if not exists consumed_count integer not null default 0;
alter table public.products add column if not exists notes text;
alter table public.products add column if not exists import_method text not null default 'manual';
alter table public.products add column if not exists purchase_id uuid;
alter table public.products alter column expiration_date drop not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'products_quantity_count_positive') then
    alter table public.products add constraint products_quantity_count_positive check (quantity_count >= 1);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'products_consumed_range') then
    alter table public.products add constraint products_consumed_range check (consumed_count >= 0 and consumed_count <= quantity_count);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'products_import_method_check') then
    alter table public.products add constraint products_import_method_check
      check (import_method in ('barcode','receipt_barcode','ocr','manual'));
  end if;
end $$;

comment on column public.products.price is
  'Prezzo unitario effettivamente pagato (€). Lo spreco vale price * (quantity_count - consumed_count).';

-- ============================================================================
-- PURCHASES (one shopping trip)
-- ============================================================================
create table if not exists public.purchases (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  store             text,
  purchase_date     date not null default current_date,
  total             numeric(10,2),
  import_method     text not null default 'manual'
                    check (import_method in ('barcode','receipt_barcode','ocr','manual')),
  receipt_identifier text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ============================================================================
-- PURCHASE ITEMS (one receipt line)
-- ============================================================================
create table if not exists public.purchase_items (
  id          uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.purchases (id) on delete cascade,
  product_id  uuid references public.products (id) on delete set null,
  barcode     text,
  name        text not null,
  brand       text,
  category    text,
  quantity    integer not null default 1 check (quantity >= 1),
  unit_price  numeric(10,2) not null default 0,
  total_price numeric(10,2) not null default 0,
  created_at  timestamptz not null default now()
);

-- Link products to their originating purchase.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'products_purchase_id_fkey') then
    alter table public.products
      add constraint products_purchase_id_fkey
      foreign key (purchase_id) references public.purchases (id) on delete set null;
  end if;
end $$;

-- ============================================================================
-- TRIGGERS
-- ============================================================================
drop trigger if exists purchases_set_updated_at on public.purchases;
create trigger purchases_set_updated_at
  before update on public.purchases
  for each row execute function public.set_updated_at();

-- Waste attribution must never be NULL: products without an expiration date
-- fall back to their creation date (they can only be wasted manually).
create or replace function public.set_wasted_at()
returns trigger as $$
begin
  if new.status = 'wasted' and new.wasted_at is null then
    new.wasted_at = coalesce(new.expiration_date, new.created_at::date);
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists products_set_wasted_at on public.products;
create trigger products_set_wasted_at
  before insert or update of status, expiration_date on public.products
  for each row execute function public.set_wasted_at();

-- ============================================================================
-- ROW LEVEL SECURITY (every user only touches their own rows)
-- ============================================================================
alter table public.purchases      enable row level security;
alter table public.purchase_items enable row level security;

drop policy if exists "purchases_select_own" on public.purchases;
create policy "purchases_select_own" on public.purchases
  for select using (auth.uid() = user_id);

drop policy if exists "purchases_insert_own" on public.purchases;
create policy "purchases_insert_own" on public.purchases
  for insert with check (auth.uid() = user_id);

drop policy if exists "purchases_update_own" on public.purchases;
create policy "purchases_update_own" on public.purchases
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "purchases_delete_own" on public.purchases;
create policy "purchases_delete_own" on public.purchases
  for delete using (auth.uid() = user_id);

-- purchase_items has no user_id column: ownership flows through the purchase.
drop policy if exists "purchase_items_select_own" on public.purchase_items;
create policy "purchase_items_select_own" on public.purchase_items
  for select using (
    exists (select 1 from public.purchases p where p.id = purchase_id and p.user_id = auth.uid())
  );

drop policy if exists "purchase_items_insert_own" on public.purchase_items;
create policy "purchase_items_insert_own" on public.purchase_items
  for insert with check (
    exists (select 1 from public.purchases p where p.id = purchase_id and p.user_id = auth.uid())
  );

drop policy if exists "purchase_items_update_own" on public.purchase_items;
create policy "purchase_items_update_own" on public.purchase_items
  for update using (
    exists (select 1 from public.purchases p where p.id = purchase_id and p.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.purchases p where p.id = purchase_id and p.user_id = auth.uid())
  );

drop policy if exists "purchase_items_delete_own" on public.purchase_items;
create policy "purchase_items_delete_own" on public.purchase_items
  for delete using (
    exists (select 1 from public.purchases p where p.id = purchase_id and p.user_id = auth.uid())
  );

-- ============================================================================
-- INDEXES
-- ============================================================================
create index if not exists idx_purchases_user_date  on public.purchases (user_id, purchase_date);
create index if not exists idx_purchase_items_purch  on public.purchase_items (purchase_id);
create index if not exists idx_purchase_items_product on public.purchase_items (product_id);