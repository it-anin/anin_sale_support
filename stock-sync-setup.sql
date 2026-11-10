-- Stock แบบ on-demand — รันใน Supabase SQL Editor ก่อนเริ่ม stock-agent.mjs.
-- หยุด Task Export/Upload Stock CSV เดิมก่อนเปลี่ยนมาใช้ Agent (ผู้เขียน snapshot ต้องมีตัวเดียว).
-- รันซ้ำได้; ไม่ลบข้อมูลเดิมระหว่างติดตั้ง. MSSQL ของ ProMaxx ไม่ต้องสร้าง/แก้ไขอะไร.
begin;

create table if not exists public.stock (
  id bigserial primary key,
  branch text not null,
  sku text not null,
  name text,
  qty text,
  unit text,
  price text,
  uploaded_at timestamptz not null default now()
);
-- คีย์ธรรมชาติสำหรับเทียบเฉพาะรายการที่เปลี่ยน; ถ้ามีข้อมูลซ้ำให้หยุดติดตั้ง ไม่ลบทิ้งเอง.
create unique index if not exists stock_branch_sku_unique_idx on public.stock (branch, sku);
drop index if exists public.stock_branch_sku_idx;
alter table public.stock enable row level security;
drop policy if exists "public read stock" on public.stock;
create policy "public read stock" on public.stock for select to anon, authenticated using (true);
grant select on public.stock to anon, authenticated;

create table if not exists public.stock_sync (
  id smallint primary key check (id = 1),
  sync_version smallint not null default 2,
  refresh_requested_at timestamptz,
  last_success_at timestamptz,
  last_checked_at timestamptz,
  data_hash text,
  last_error text,
  last_error_at timestamptz,
  row_count integer not null default 0
);
alter table public.stock_sync add column if not exists sync_version smallint not null default 2;
insert into public.stock_sync (id) values (1) on conflict (id) do nothing;
alter table public.stock_sync enable row level security;
drop policy if exists "public read stock sync" on public.stock_sync;
create policy "public read stock sync" on public.stock_sync for select to anon, authenticated using (true);
grant select on public.stock_sync to anon, authenticated;
revoke insert, update, delete on public.stock, public.stock_sync from anon, authenticated;
grant all on public.stock, public.stock_sync to service_role;
grant usage, select on sequence public.stock_id_seq to service_role;

-- ความสามารถเขียนเพียงอย่างเดียวของเว็บ: ขอ refresh 1 แถวที่กำหนดตายตัวและมี throttle.
-- ต้องเป็น definer เพราะ anon ไม่มี UPDATE; ไม่มี dynamic SQL และ search_path ว่าง.
create or replace function public.request_stock_refresh(p_auto boolean default false)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare requested timestamptz;
begin
  update public.stock_sync set refresh_requested_at = now()
   where id = 1 and case
     when p_auto then coalesce(greatest(refresh_requested_at, last_success_at, last_checked_at), '-infinity')
                           < now() - interval '2 minutes'
     else coalesce(refresh_requested_at, '-infinity') < now() - interval '10 seconds'
   end
   returning refresh_requested_at into requested;
  return requested;
end;
$$;
revoke all on function public.request_stock_refresh(boolean) from public, anon, authenticated;
grant execute on function public.request_stock_refresh(boolean) to anon, authenticated;

-- ใช้สิทธิ์ service_role ของผู้เรียกโดยตรง; รับ snapshot ครบ แต่เขียนเฉพาะ delta ใน transaction เดียว.
-- ชื่อ/parameters/ผลลัพธ์เดิม → Agent รุ่นเก่ายังใช้ได้เมื่อรัน SQL รุ่นนี้.
create or replace function public.replace_stock_snapshot(p_rows jsonb, p_hash text)
returns integer language plpgsql security invoker set search_path = '' as $$
declare
  n integer;
  written integer;
  removed integer;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'ข้อมูลสต๊อคต้องเป็น array';
  end if;
  if jsonb_array_length(p_rows) = 0 or coalesce(p_hash, '') = '' then
    raise exception 'ไม่แทนที่สต๊อคด้วยชุดว่างหรือไม่มี hash';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_rows) as r(branch text, sku text, qty text, price text)
     where r.branch is null or r.branch not in ('คลังสินค้า', 'SRC', 'KKL', 'SSS')
        or coalesce(btrim(r.sku), '') = '' or r.qty is null or r.qty !~ '^[+-]?[0-9]+([.][0-9]+)?$'
        or (coalesce(r.price, '') <> '' and r.price !~ '^[+-]?[0-9]+([.][0-9]+)?$')
  ) then raise exception 'พบข้อมูลสต๊อคไม่ถูกต้อง'; end if;
  if exists (
    select 1 from jsonb_to_recordset(p_rows) as r(branch text, sku text)
     group by r.branch, r.sku having count(*) > 1
  ) then raise exception 'SKU ซ้ำในคลังเดียวกัน'; end if;

  -- ล็อกสถานะก่อนเทียบ delta; งานที่รอจะเห็นผลของงานก่อนหน้าและไม่เขียนแถวเดิมซ้ำ.
  perform 1 from public.stock_sync where id = 1 for update;
  if not found then raise exception 'ไม่พบแถวสถานะสต๊อค'; end if;

  with incoming as materialized (
    select r.branch, r.sku, r.name, r.qty, r.unit, r.price
      from jsonb_to_recordset(p_rows) as r(branch text, sku text, name text, qty text, unit text, price text)
  ), deleted as (
    delete from public.stock s
     where s.id is not null and not exists (
       select 1 from incoming r where r.branch = s.branch and r.sku = s.sku
     )
     returning s.id
  ), upserted as (
    insert into public.stock as target (branch, sku, name, qty, unit, price, uploaded_at)
      select r.branch, r.sku, r.name, r.qty, r.unit, r.price, now()
        from incoming r
        left join public.stock existing on existing.branch = r.branch and existing.sku = r.sku
       where existing.id is null
          or (existing.name, existing.qty, existing.unit, existing.price)
             is distinct from (r.name, r.qty, r.unit, r.price)
    on conflict (branch, sku) do update
      set name = excluded.name, qty = excluded.qty, unit = excluded.unit,
          price = excluded.price, uploaded_at = excluded.uploaded_at
      where (target.name, target.qty, target.unit, target.price)
            is distinct from (excluded.name, excluded.qty, excluded.unit, excluded.price)
    returning target.id
  )
  select (select count(*) from incoming), (select count(*) from upserted), (select count(*) from deleted)
    into n, written, removed;

  update public.stock_sync
     set last_success_at = case when written > 0 or removed > 0 or last_success_at is null
                                then now() else last_success_at end,
         last_checked_at = now(), data_hash = p_hash,
         last_error = null, last_error_at = null, row_count = n where id = 1;
  return n;
end;
$$;
revoke all on function public.replace_stock_snapshot(jsonb, text) from public, anon, authenticated;
grant execute on function public.replace_stock_snapshot(jsonb, text) to service_role;

create or replace function public.mark_stock_unchanged(p_hash text)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  update public.stock_sync set last_checked_at = now(), last_error = null, last_error_at = null
   where id = 1 and data_hash = p_hash;
  return found;
end;
$$;
revoke all on function public.mark_stock_unchanged(text) from public, anon, authenticated;
grant execute on function public.mark_stock_unchanged(text) to service_role;

create or replace function public.report_stock_sync_error(p_message text)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  update public.stock_sync set last_error = left(p_message, 200), last_error_at = now() where id = 1;
end;
$$;
revoke all on function public.report_stock_sync_error(text) from public, anon, authenticated;
grant execute on function public.report_stock_sync_error(text) to service_role;

-- publish แค่สถานะ 1 แถว ไม่ publish สต๊อคหลายหมื่นแถว.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') and not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'stock_sync'
  ) then alter publication supabase_realtime add table public.stock_sync; end if;
end $$;
-- อยู่ใน transaction เดียวกับการติดตั้ง RPC → Agent รุ่นใหม่ตรวจความพร้อมก่อนอ่าน ProMaxx.
update public.stock_sync set sync_version = 2 where id = 1 and sync_version <> 2;
notify pgrst, 'reload schema';
commit;
