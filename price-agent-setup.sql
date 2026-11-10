-- R05.106 MSSQL Agent. Run once in Supabase SQL Editor; safe to run again.
-- Requires products, products_import and price-change-setup.sql.
-- MSSQL is never modified. All SQL in this file runs in Supabase only.
begin;

do $$
begin
  if to_regclass('public.products') is null
     or to_regclass('public.products_import') is null
     or to_regprocedure('public.log_price_changes()') is null then
    raise exception 'Install products/products_import and price-change-setup.sql first';
  end if;
end $$;

create table if not exists public.price_sync (
  id integer primary key check (id = 1),
  data_hash text,
  data_version bigint not null default 0,
  row_count integer not null default 0,
  last_success_at timestamptz,
  last_checked_at timestamptz,
  last_error text,
  last_error_at timestamptz
);
insert into public.price_sync (id) values (1) on conflict (id) do nothing;
-- Additive upgrade from the interval-based Agent; preserve existing status/data.
alter table public.price_sync add column if not exists request_id bigint not null default 0;
alter table public.price_sync add column if not exists completed_request_id bigint not null default 0;
alter table public.price_sync add column if not exists refresh_requested_at timestamptz;
alter table public.price_sync add column if not exists last_request_completed_at timestamptz;
alter table public.price_sync add column if not exists last_request_error text;
alter table public.price_sync add column if not exists last_scheduled_date date;
alter table public.price_sync enable row level security;
drop policy if exists "read price sync" on public.price_sync;
create policy "read price sync" on public.price_sync
  for select to anon, authenticated using (true);
revoke all on public.price_sync from anon, authenticated;
grant select on public.price_sync to anon, authenticated;
grant select, update on public.price_sync to service_role;
grant select, insert, update, delete on public.products, public.products_import to service_role;
do $$
declare seq text;
begin
  foreach seq in array array[
    pg_get_serial_sequence('public.products', 'id'),
    pg_get_serial_sequence('public.products_import', 'id')
  ] loop
    if seq is not null then
      execute format('grant usage, select on sequence %s to service_role', seq);
    end if;
  end loop;
end $$;

-- Keep the existing entry point and integer return contract for the old bot
-- and upload_products_from_web. Preserve IDs/timestamps of unchanged rows.
-- Web uploads execute this as the owner of their existing definer wrapper;
-- the Agent uses service_role. No new privileged public RPC is needed.
create or replace function public.swap_products_from_import()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  n integer;
  affected integer;
  changed integer := 0;
begin
  lock table public.products_import in exclusive mode;
  lock table public.products in share row exclusive mode;
  select count(*) into n from public.products_import;
  if n = 0 then
    raise exception 'products_import is empty; live products were not changed';
  end if;
  if exists (select 1 from public.products_import
             where coalesce(trim(barcode), '') = '' or coalesce(trim(sku), '') = '')
     or exists (select 1 from public.products_import group by barcode having count(*) > 1) then
    raise exception 'Invalid or duplicate barcode in products_import';
  end if;

  -- Compare old prices before any update/delete. A later failure rolls this back too.
  perform public.log_price_changes();

  update public.products p
     set sku = s.sku, name = s.name, unit = s.unit, price = s.price,
         category = s.category, base_multiple = s.base_multiple, updated_at = now()
    from public.products_import s
   where p.barcode = s.barcode
     and (p.sku, p.name, p.unit, p.price, p.category, p.base_multiple)
         is distinct from (s.sku, s.name, s.unit, s.price, s.category, s.base_multiple);
  get diagnostics affected = row_count;
  changed := changed + affected;

  insert into public.products (barcode, sku, name, unit, price, category, base_multiple, updated_at)
  select s.barcode, s.sku, s.name, s.unit, s.price, s.category, s.base_multiple, now()
    from public.products_import s
   where not exists (select 1 from public.products p where p.barcode = s.barcode);
  get diagnostics affected = row_count;
  changed := changed + affected;

  delete from public.products p
   where not exists (select 1 from public.products_import s where s.barcode = p.barcode)
      or exists (select 1 from public.products newer where newer.barcode = p.barcode and newer.id > p.id);
  get diagnostics affected = row_count;
  changed := changed + affected;

  if changed > 0 then
    -- Clear the Agent hash for writes by the CSV bot/web too. A later Agent
    -- check must compare again instead of accepting an obsolete saved hash.
    update public.price_sync
       set data_hash = null, data_version = data_version + 1, row_count = n,
           last_success_at = now(), last_checked_at = now(),
           last_error = null, last_error_at = null
     where id = 1;
  end if;
  delete from public.products_import where id is not null;
  return n;
end;
$$;
revoke all on function public.swap_products_from_import() from public, anon, authenticated;
grant execute on function public.swap_products_from_import() to service_role;

-- Hash comparison persists across Agent restarts. Heartbeats do not change
-- data_version/last_success_at, so browsers do not reload unchanged products.
create or replace function public.mark_price_unchanged(p_hash text)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  update public.price_sync
     set last_checked_at = now(), last_error = null, last_error_at = null
   where id = 1 and data_hash = p_hash;
  return found;
end;
$$;
revoke all on function public.mark_price_unchanged(text) from public, anon, authenticated;
grant execute on function public.mark_price_unchanged(text) to service_role;

create or replace function public.sync_price_products(p_rows jsonb, p_hash text)
returns integer language plpgsql security invoker set search_path = '' as $$
declare
  n integer;
  existing integer;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array'
     or coalesce(p_hash, '') !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid R05.106 snapshot/hash';
  end if;
  lock table public.products_import in exclusive mode;
  -- Legacy bot uploads in separate chunks. Never erase an active upload.
  if exists (select 1 from public.products_import
             where created_at > now() - interval '15 minutes') then
    raise exception 'R05.106 CSV upload is in progress; retry after it finishes';
  end if;
  n := jsonb_array_length(p_rows);
  select count(*) into existing from public.products;
  if n = 0 or (existing > 0 and n < existing * 0.8) then
    raise exception 'R05.106 is empty or shrank by more than 20%%; live products were not changed';
  end if;
  delete from public.products_import where id is not null;
  insert into public.products_import (barcode, sku, name, unit, price, category, base_multiple)
  select r.barcode, r.sku, r.name, r.unit, r.price, r.category, r.base_multiple
    from jsonb_to_recordset(p_rows) as r(
      barcode text, sku text, name text, unit text, price numeric, category text, base_multiple numeric
    );
  n := public.swap_products_from_import();
  update public.price_sync
     set data_hash = p_hash, row_count = n, last_checked_at = now(),
         last_error = null, last_error_at = null
   where id = 1;
  return n;
end;
$$;
revoke all on function public.sync_price_products(jsonb, text) from public, anon, authenticated;
grant execute on function public.sync_price_products(jsonb, text) to service_role;

-- The Admin badge can queue work, but cannot read MSSQL or write products.
-- This app uses its existing client-side Admin gate (not Supabase Auth).
-- Limit callers to one outstanding request globally, and one new request/10s.
create or replace function public.request_price_refresh()
returns bigint language plpgsql security definer set search_path = '' as $$
declare s public.price_sync%rowtype;
begin
  select * into s from public.price_sync where id = 1 for update;
  if not found then raise exception 'Price Agent is not configured'; end if;
  if s.request_id > s.completed_request_id then return s.request_id; end if;
  if s.refresh_requested_at > clock_timestamp() - interval '10 seconds' then return null; end if;
  update public.price_sync
     set request_id = request_id + 1, refresh_requested_at = clock_timestamp(), last_request_error = null
   where id = 1 returning request_id into s.request_id;
  return s.request_id;
end;
$$;
revoke all on function public.request_price_refresh() from public, anon, authenticated;
grant execute on function public.request_price_refresh() to anon, authenticated;

-- Record both success and failure durably. A failed request must not repeatedly
-- query MSSQL just because the Agent polls its Supabase queue or restarts.
create or replace function public.complete_price_refresh(p_request_id bigint, p_error text)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if p_request_id < 0 then raise exception 'Invalid Price request'; end if;
  if p_request_id > 0 then
    update public.price_sync
       set completed_request_id = p_request_id, last_request_completed_at = clock_timestamp(),
           last_request_error = p_error, last_error = p_error,
           last_error_at = case when p_error is null then null else clock_timestamp() end
     where id = 1 and request_id >= p_request_id and completed_request_id < p_request_id;
  elsif p_error is not null then
    update public.price_sync set last_error = p_error, last_error_at = clock_timestamp() where id = 1;
  end if;
end;
$$;
revoke all on function public.complete_price_refresh(bigint, text) from public, anon, authenticated;
grant execute on function public.complete_price_refresh(bigint, text) to service_role;

-- Explicit overloads keep old callers working. The new Agent always includes
-- p_request_id, acknowledging the request in the same transaction as its data.
create or replace function public.mark_price_unchanged(p_hash text, p_request_id bigint)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  if not public.mark_price_unchanged(p_hash) then return false; end if;
  perform public.complete_price_refresh(p_request_id, null);
  return true;
end;
$$;
revoke all on function public.mark_price_unchanged(text, bigint) from public, anon, authenticated;
grant execute on function public.mark_price_unchanged(text, bigint) to service_role;

create or replace function public.sync_price_products(p_rows jsonb, p_hash text, p_request_id bigint)
returns integer language plpgsql security invoker set search_path = '' as $$
declare n integer;
begin
  n := public.sync_price_products(p_rows, p_hash);
  perform public.complete_price_refresh(p_request_id, null);
  return n;
end;
$$;
revoke all on function public.sync_price_products(jsonb, text, bigint) from public, anon, authenticated;
grant execute on function public.sync_price_products(jsonb, text, bigint) to service_role;

-- The trusted Agent chooses 08:00 Asia/Bangkok. Persist the claim before the
-- SELECT so multiple processes/restarts cannot repeat the daily run.
create or replace function public.claim_price_scheduled_run(p_run_date date)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  update public.price_sync set last_scheduled_date = p_run_date
   where id = 1 and p_run_date = (clock_timestamp() at time zone 'Asia/Bangkok')::date
     and last_scheduled_date is distinct from p_run_date;
  return found;
end;
$$;
revoke all on function public.claim_price_scheduled_run(date) from public, anon, authenticated;
grant execute on function public.claim_price_scheduled_run(date) to service_role;

-- Older installations may not have this staging timestamp yet.
alter table public.products_import add column if not exists created_at timestamptz;
alter table public.products_import alter column created_at set default now();

-- Publish summary status updates only, never one event per product.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'price_sync') then
    alter publication supabase_realtime add table public.price_sync;
  end if;
end $$;
notify pgrst, 'reload schema';
commit;
