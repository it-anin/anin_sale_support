-- ═══════════════════════════════════════════════════════════════════════════
-- แจ้งเตือนราคาเปลี่ยน หน้าป้ายราคา (Price Change Notification) — 2569-09-15
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ปัญหา: บอท botr05106 อัปโหลดทับตาราง `products` ทั้งตารางทุกวัน แต่ไม่มีใคร
--        รู้ว่ารอบนั้นราคา SKU ไหนเปลี่ยนบ้าง — badge "Last Updated" บอกแค่ว่า
--        *ตารางถูกเขียนใหม่เมื่อไหร่* ไม่ได้บอกว่า *อะไรเปลี่ยน*
--
-- 🚨 ข้อจำกัดที่กำหนดรูปร่างของไฟล์นี้ทั้งหมด:
--    `products` เขียนด้วย DELETE + INSERT ไม่ใช่ UPDATE (RPC swap_products_from_import()
--    ซึ่ง DDL อยู่คนละ repo: it-anin/botr05106 ไฟล์ products-import-swap.sql)
--    → trigger `AFTER UPDATE ON products` ไม่มีทางยิงเลยสักครั้ง
--    → ต้องเทียบ products_import (staging) กับ products **ก่อน** delete แทน
--
-- ⚠️ ไฟล์นี้ mirror กับ supabase/migrations/202609150001_price_change_log.sql
--    แก้ที่ไหนต้องแก้อีกที่ด้วย (ธรรมเนียมเดียวกับ salesupport-setup.sql)
--
-- ⚠️ ไฟล์นี้ยังไม่ทำให้ฟีเจอร์ทำงาน — ต้องเพิ่ม `perform public.log_price_changes();`
--    ลงใน swap_products_from_import() ด้วยมืออีก 1 บรรทัด (ดูท้ายไฟล์)
-- ═══════════════════════════════════════════════════════════════════════════


-- ── ตารางที่ 1: log ราคาเปลี่ยน (global — ทุกโปรไฟล์เห็นชุดเดียวกัน) ──
--
-- ⚠️ คีย์เทียบคือ `barcode` ไม่ใช่ `sku` หรือ `(sku, unit)` — ตรวจข้อมูลจริง 2569-09-15
--    (10,864 แถว):
--      barcode      → 10,864 ค่า  ไม่ซ้ำเลยสักแถว ✅
--      (sku, unit)  → 10,830 ค่า  ซ้ำ 34 กลุ่ม (68 แถว)
--      sku          →  7,959 ค่า  ซ้ำ 2,485 กลุ่ม (5,390 แถว)
--    เหตุที่ (sku,unit) ซ้ำ = SKU เดียวมี EAN 2 ตัวสำหรับแพ็กเดียวกัน
--    เช่น 100379|ขวด → 8002660043375 / 8852796916032 (ราคาเท่ากันทั้งคู่)
--    ใน 34 กลุ่มนั้นมี 2 กลุ่มที่ราคาต่างกัน ซึ่งจะ diff กำกวมถ้าใช้ (sku,unit)
--    barcode ไม่มีปัญหานี้และเป็นคีย์ธรรมชาติของแถว R05.106 (ไม่มีแถวไหน barcode ว่าง)
create table if not exists public.price_change_log (
  id            bigserial primary key,
  batch_id      uuid        not null,   -- 1 รอบอัปโหลด = 1 batch (drawer จัดกลุ่มด้วยค่านี้)
  changed_at    timestamptz not null default now(),
  barcode       text        not null,
  sku           text        not null,
  name          text,
  unit          text,
  old_price     numeric     not null,
  new_price     numeric     not null,
  base_multiple numeric
);

-- ── ตารางที่ 2: watermark "อ่านถึงไหนแล้ว" รายโปรไฟล์ ──
--
-- ⚠️ ตั้งใจไม่ใช้ fan-out แบบ ss_branch_notification_events (1 แถวต่อผู้รับ)
--    เพราะเหตุการณ์ของ SaleSupport *ต่างกันจริงตามผู้รับ* แต่ "ราคาเปลี่ยน" คือ
--    ข้อเท็จจริง global ตัวเดียว ผู้รับ 6 โปรไฟล์เหมือนกันหมด
--    fan-out จะเขียน (แถวที่เปลี่ยน × 6) ต่อการอัปโหลด 1 ครั้ง — เปลี่ยน 500 SKU
--    = 3,000 แถว พร้อมข้อความไทยซ้ำกัน 6 ชุดต่อ SKU
--    watermark เขียน 500 แถว + ตารางนี้ 6 แถวตลอดกาล (upsert ทับที่เดิม)
--    unread = count(*) where changed_at > last_seen_at → index scan เดียว
--    mark read = upsert แถวเดียว (ไม่ใช่ UPDATE 3,000 แถวแบบ read_at)
create table if not exists public.price_change_seen (
  profile_id    text primary key
    check (profile_id in ('SRC', 'KKL', 'SSS', 'SALE_ADMIN', 'PURCHASING', 'WAREHOUSE')),
  last_seen_at  timestamptz not null default '1970-01-01T00:00:00Z',
  last_batch_at timestamptz   -- แตะเพื่อให้ realtime ยิง (ดู log_price_changes ด้านล่าง)
);

alter table public.price_change_seen add column if not exists last_batch_at timestamptz;

-- ⚠️ `create table if not exists` ข้าม CHECK ที่เขียน inline ไว้ข้างบนถ้าตารางมีอยู่แล้ว
--    จึงต้องมีแบบ alter คู่กันเสมอ (บทเรียนเดียวกับ ss_branch_notification_events)
--    ชุดรหัสต้องตรงกับ PROFILES ใน auth.ts เป๊ะ
alter table public.price_change_seen
  drop constraint if exists price_change_seen_profile_id_check;
alter table public.price_change_seen
  add constraint price_change_seen_profile_id_check
  check (profile_id in ('SRC', 'KKL', 'SSS', 'SALE_ADMIN', 'PURCHASING', 'WAREHOUSE'));

insert into public.price_change_seen (profile_id)
values ('SRC'), ('KKL'), ('SSS'), ('SALE_ADMIN'), ('PURCHASING'), ('WAREHOUSE')
on conflict (profile_id) do nothing;


-- ── Index ──
-- ตัวนับ unread = count(*) where changed_at > watermark → index นี้ตัวเดียวพอ
create index if not exists price_change_log_changed_at_idx
  on public.price_change_log (changed_at desc);
-- drawer จัดกลุ่มตาม batch
create index if not exists price_change_log_batch_idx
  on public.price_change_log (batch_id, changed_at desc);


-- ── RLS ──
-- ⚠️ ต่างจากตาราง ss_* ที่เป็น `for all` โดยตั้งใจ:
--    price_change_log = anon SELECT อย่างเดียว เพราะเว็บไม่เคยเขียน log เลย
--    มีแต่ log_price_changes() (security definer) ที่เขียน และไม่มีปุ่ม "ล้างประวัติ"
alter table public.price_change_log  enable row level security;
alter table public.price_change_seen enable row level security;

drop policy if exists "anon read price_change_log" on public.price_change_log;
create policy "anon read price_change_log" on public.price_change_log
  for select using (true);

drop policy if exists "anon all price_change_seen" on public.price_change_seen;
create policy "anon all price_change_seen" on public.price_change_seen
  for all using (true) with check (true);

grant select                 on public.price_change_log  to anon, authenticated;
grant select, insert, update on public.price_change_seen to anon, authenticated;


-- ── หัวใจของฟีเจอร์: เทียบ staging กับของจริง แล้วบันทึกส่วนต่าง ──
--
-- 🚨 ต้องเรียก "ก่อน" `delete from products` ใน swap_products_from_import() เท่านั้น
--    เรียกหลัง delete = products ว่าง → join ไม่เจออะไร → log ว่างเงียบ ๆ ไม่มี error
--    (นี่คือวิธีพลาดที่เป็นไปได้มากที่สุดของฟีเจอร์นี้)
--
-- ⚠️ ไม่ใช้ updated_at ตัดสินว่าแถวไหนเปลี่ยน — RPC เขียน now() ให้ทุกแถวทุกรอบ
--    (docs/database.md) จึงแยกแถวที่เปลี่ยนจริงไม่ได้ ต้องเทียบราคาตรง ๆ เท่านั้น
create or replace function public.log_price_changes()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  batch  uuid := gen_random_uuid();
  logged integer;
begin
  -- ไม่มี staging = ไม่ทำอะไร (กันเคสเรียกผิดที่/ผิดเวลา)
  if not exists (select 1 from public.products_import limit 1) then
    return 0;
  end if;

  with live as (
    -- distinct on กัน barcode ซ้ำในอนาคต — วันนี้ไม่ซ้ำเลย แต่ไม่มี unique constraint บังคับ
    select distinct on (barcode) barcode, price
    from public.products
    where barcode is not null and barcode <> ''
    order by barcode, id desc
  ),
  staged as (
    select distinct on (barcode) barcode, sku, name, unit, price, base_multiple
    from public.products_import
    where barcode is not null and barcode <> ''
    order by barcode, id desc
  )
  insert into public.price_change_log
    (batch_id, barcode, sku, name, unit, old_price, new_price, base_multiple)
  select batch, s.barcode, s.sku, s.name, s.unit, l.price, s.price, s.base_multiple
  from staged s
  -- ⚠️ join ไม่ใช่ left join โดยตั้งใจ — SKU ใหม่ (มีใน staging ไม่มีใน live) ไม่มีราคาเดิม
  --    จึงไม่ใช่ "ราคาเปลี่ยน" ไม่งั้นทุกครั้งที่ออกสินค้าใหม่จะสแปมรายการ
  --    สินค้าที่เลิกขาย (มีใน live ไม่มีใน staging) ก็ข้ามด้วยเหตุผลเดียวกัน
  join live l on l.barcode = s.barcode
  -- is distinct from ไม่ใช่ <> — `<>` คืน NULL เมื่อราคาเป็น NULL ทำให้ NULL → 25 หลุดเงียบ ๆ
  where s.price is distinct from l.price;

  get diagnostics logged = row_count;

  -- แตะแถวสรุปให้ realtime ยิง — ฝั่งเว็บ subscribe price_change_seen ไม่ใช่ price_change_log
  -- (log มีได้ทีละหลายร้อยแถว จะกลายเป็น realtime หลายร้อยข้อความรวดแล้ว refetch รัว ๆ
  --  บทเรียนเดียวกับที่ App.tsx บันทึกไว้: subscribe ตารางสรุป ไม่ใช่ _events)
  -- WHERE profile_id is not null = ทุกแถว (คอลัมน์เป็น primary key ห้าม null อยู่แล้ว)
  -- ใส่ไว้เพื่อผ่าน safeupdate/lint ที่ปฏิเสธ UPDATE ไม่มี WHERE ไม่ใช่เพราะต้องกรองจริง
  if logged > 0 then
    update public.price_change_seen set last_batch_at = now()
    where profile_id is not null;
  end if;

  return logged;
end;
$$;

-- กัน anon เรียกเอง — มีแต่ swap RPC (service_role) ที่เรียก
revoke all on function public.log_price_changes() from public, anon, authenticated;
grant execute on function public.log_price_changes() to service_role;

comment on function public.log_price_changes() is
  '🚨 ต้องเรียกก่อน delete from products ใน swap_products_from_import() เท่านั้น — เรียกหลังลบ = log ว่างเงียบ ๆ ไม่ error';


-- ── mark as read: ขยับ watermark ──
-- 1 แถว ไม่ว่าจะมี log กี่พันแถว (ต่างจาก ss_mark_branch_notifications_read
-- ที่ต้อง UPDATE ทุกแถวที่ read_at is null)
create or replace function public.mark_price_changes_seen(target_profile text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  normalized text := upper(trim(coalesce(target_profile, '')));
begin
  -- โปรไฟล์ที่ไม่รู้จัก → เงียบ ๆ ไม่ error (แบบเดียวกับ ss_mark_branch_notifications_read)
  if normalized not in ('SRC', 'KKL', 'SSS', 'SALE_ADMIN', 'PURCHASING', 'WAREHOUSE') then
    return;
  end if;

  insert into public.price_change_seen (profile_id, last_seen_at)
  values (normalized, now())
  on conflict (profile_id) do update set last_seen_at = excluded.last_seen_at;
end;
$$;

grant execute on function public.mark_price_changes_seen(text) to anon, authenticated;


-- ── Retention: เก็บประวัติ 6 เดือน ──
-- 🚨 DELETE ต้องมี WHERE เสมอ — safeupdate extension ปฏิเสธ DELETE ที่ไม่มี WHERE
--    (เจอจริงตอน swap RPC รอบแรก 2569-09-05 ดู docs/database.md)
create or replace function public.delete_expired_price_changes()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count bigint;
begin
  delete from public.price_change_log
  where changed_at < now() - interval '6 months';
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.delete_expired_price_changes() from public, anon, authenticated;

-- ทำงานทุกวัน 02:45 น. เวลาไทย (19:45 UTC) — หลัง salesupport 02:30 น. 15 นาที ไม่ให้ชนกัน
create extension if not exists pg_cron;
select cron.schedule(
  'price-change-log-retention-6-months',
  '45 19 * * *',
  $$select public.delete_expired_price_changes();$$
);


-- ── Realtime ──
-- ⚠️ publish เฉพาะ price_change_seen ไม่ใช่ price_change_log (เหตุผลอยู่ใน log_price_changes)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'price_change_seen'
     ) then
    alter publication supabase_realtime add table public.price_change_seen;
  end if;
end $$;

notify pgrst, 'reload schema';


-- ═══════════════════════════════════════════════════════════════════════════
-- ⛔ ขั้นสุดท้าย — ต้องทำด้วยมือใน Supabase SQL Editor (ไฟล์นี้ทำแทนไม่ได้)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- swap_products_from_import() มี DDL อยู่คนละ repo (it-anin/botr05106) repo นี้ไม่มีสำเนา
--
-- 1) อ่าน body ปัจจุบันก่อน:
--      select prosrc from pg_proc where proname = 'swap_products_from_import';
--
-- 2) create or replace function ใหม่ทั้งก้อน โดยเพิ่ม 1 บรรทัดนี้ **ก่อน** delete from products:
--
--      -- บันทึกราคาที่เปลี่ยน "ก่อน" ลบของเดิม (ไม่งั้นไม่มีอะไรให้เทียบ)
--      -- ⚠️ รัน products-import-swap.sql จาก it-anin/botr05106 ทับ จะลบบรรทัดนี้ทิ้งเงียบ ๆ
--      perform public.log_price_changes();
--
--    โครงที่ได้:
--      begin
--        perform public.log_price_changes();                -- ⬅️ บรรทัดเดียวที่เพิ่ม
--        delete from public.products where id is not null;  -- WHERE เดิมของ RPC (safeupdate)
--        insert into public.products (...) select ... from public.products_import;
--        ...
--      end;
--
-- 🚨 ตำแหน่งสำคัญที่สุด — วางหลัง delete = log ว่างตลอดกาลแบบไม่มี error
-- ✅ รันใน transaction เดียวกับ swap → swap rollback แล้ว log rollback ด้วย
--    ไม่มีแจ้งเตือนผีของรอบที่ไม่ได้ลงจริง
-- ═══════════════════════════════════════════════════════════════════════════
