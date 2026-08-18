-- แจ้งเตือนจัดซื้อเมื่อสาขาลงข้อมูลเมนู Order (ทิศทางใหม่: สาขา → จัดซื้อ)
--
-- เดิมตารางเหตุการณ์นี้เดินทางเดียว "แผนก → สาขา" เท่านั้น จึงล็อกไว้ 2 ชั้น:
--   branch     CHECK IN ('SRC','KKL','SSS')          → เก็บ 'PURCHASING' เป็นผู้รับไม่ได้
--   actor_code CHECK IN ('WAREHOUSE','PURCHASING')   → บันทึกสาขาเป็นผู้กระทำไม่ได้
-- migration นี้ขยายทั้ง 2 ชั้น + ขยาย filter ใน RPC ให้ยอมรับ 'PURCHASING' เป็นเป้าหมาย
--
-- ⚠️ ต้องรัน migration นี้ "ก่อน" deploy frontend ที่เรียก notifyPurchasingUpdate
--    ไม่งั้น RPC จะกรอง 'PURCHASING' ทิ้งแล้ว return void โดยไม่มี error → แจ้งเตือนหายเงียบ
--    ลำดับกลับกันปลอดภัย: ไม่มี caller เดิมส่ง 'PURCHASING' เป็นเป้าหมาย schema ใหม่จึงเป็น no-op

-- ── 1. ขยาย CHECK ของผู้รับ (คอลัมน์ชื่อ branch แต่ความหมายคือ "ผู้รับแจ้งเตือน") ──
alter table public.ss_branch_notification_events
  drop constraint if exists ss_branch_notification_events_branch_check;
alter table public.ss_branch_notification_events
  add constraint ss_branch_notification_events_branch_check
  check (branch in ('SRC', 'KKL', 'SSS', 'PURCHASING'));

alter table public.ss_branch_notifications
  drop constraint if exists ss_branch_notifications_branch_check;
alter table public.ss_branch_notifications
  add constraint ss_branch_notifications_branch_check
  check (branch in ('SRC', 'KKL', 'SSS', 'PURCHASING'));

-- ── 2. ขยาย CHECK ของผู้กระทำ ให้สาขาเป็นผู้กระทำได้ ──
-- ⚠️ ไม่ใส่ 'WAREHOUSE' ในรายการ "ผู้รับ" ข้างบนโดยตั้งใจ — คลังสินค้ายังใช้
--    recipient_department บน ss_orders เหมือนเดิม แถวที่มีผู้รับเป็น WAREHOUSE
--    จะไม่มีใครอ่าน ถ้าวันหลังย้ายคลังมาใช้ระบบนี้ ต้องเพิ่ม 'WAREHOUSE' ที่:
--    (ก) CHECK ข้อ 1 ทั้ง 2 ตาราง  (ข) filter ทั้ง 2 จุดใน RPC ข้อ 4
--    (ค) ss_mark_branch_notifications_read ข้อ 5  (ง) notificationSource ใน App.tsx
alter table public.ss_branch_notification_events
  drop constraint if exists ss_branch_notification_events_actor_code_check;
alter table public.ss_branch_notification_events
  add constraint ss_branch_notification_events_actor_code_check
  check (actor_code in ('WAREHOUSE', 'PURCHASING', 'SRC', 'KKL', 'SSS'));

-- ── 3. seed แถวสรุปของจัดซื้อ ──
-- RPC upsert ให้เองอยู่แล้ว แต่ seed ไว้เพื่อให้ realtime filter (branch=eq.PURCHASING)
-- มีแถวเกาะตั้งแต่นาทีแรก ไม่ต้องรอ event แรก
insert into public.ss_branch_notifications (branch)
values ('PURCHASING')
on conflict (branch) do nothing;

-- ── 4. RPC สร้างเหตุการณ์ — ขยาย filter 2 จุด + ให้ actor ผ่านค่าจริงไปได้ ──
create or replace function public.ss_create_branch_notifications(
  target_branches text[],
  target_actor_code text,
  target_menu_id text,
  target_table_name text,
  target_record_id text,
  event_title text,
  event_detail text,
  event_item_sku text,
  event_item_name text
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  event_time timestamptz := now();
begin
  insert into public.ss_branch_notification_events
    (branch, actor_code, menu_id, table_name, record_id, title, detail,
     item_sku, item_name, created_at)
  select distinct
    upper(trim(value)),
    -- ส่งค่าจริงผ่านไปถ้าอยู่ในชุดที่รู้จัก · คง else 'PURCHASING' ไว้ตามเดิม
    -- → 17 call site เดิม (ส่ง 'WAREHOUSE'/'PURCHASING' ตรง ๆ) พฤติกรรมไม่เปลี่ยนเลย
    case
      when upper(trim(coalesce(target_actor_code, ''))) in ('WAREHOUSE', 'PURCHASING', 'SRC', 'KKL', 'SSS')
        then upper(trim(target_actor_code))
      else 'PURCHASING'
    end,
    coalesce(nullif(trim(target_menu_id), ''), 'salesupport'),
    coalesce(nullif(trim(target_table_name), ''), 'unknown'),
    nullif(trim(target_record_id), ''),
    coalesce(nullif(trim(event_title), ''), 'อัปเดตข้อมูล'),
    nullif(trim(event_detail), ''),
    nullif(trim(event_item_sku), ''),
    nullif(trim(event_item_name), ''),
    event_time
  from unnest(coalesce(target_branches, array[]::text[])) as branches(value)
  where upper(trim(value)) in ('SRC', 'KKL', 'SSS', 'PURCHASING');

  -- ⚠️ filter ตรงนี้ต้องตรงกับข้างบนเป๊ะ ๆ — ถ้าลืมขยายจุดนี้จุดเดียว เหตุการณ์จะลงตาราง
  --    แต่ last_update_at ไม่ขยับ → realtime ไม่ยิง badge ขึ้นช้า 30 วิ แบบสุ่ม หาสาเหตุยากมาก
  insert into public.ss_branch_notifications (branch, last_update_at)
  select distinct upper(trim(value)), event_time
  from unnest(coalesce(target_branches, array[]::text[])) as branches(value)
  where upper(trim(value)) in ('SRC', 'KKL', 'SSS', 'PURCHASING')
  on conflict (branch) do update
    set last_update_at = excluded.last_update_at;
end;
$$;

-- overload 7-arg ไม่ต้องแก้ — body เรียก 9-arg ต่อ จึงได้อานิสงส์อัตโนมัติ

-- ── 5. RPC มาร์คว่าอ่านแล้ว — ให้จัดซื้อใช้ได้ ──
create or replace function public.ss_mark_branch_notifications_read(target_branch text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  read_time timestamptz := now();
  normalized_branch text := upper(trim(target_branch));
begin
  if normalized_branch not in ('SRC', 'KKL', 'SSS', 'PURCHASING') then return; end if;

  update public.ss_branch_notification_events
  set read_at = read_time
  where branch = normalized_branch and read_at is null;

  insert into public.ss_branch_notifications (branch, last_read_at)
  values (normalized_branch, read_time)
  on conflict (branch) do update
    set last_read_at = excluded.last_read_at;
end;
$$;

-- ── 6. บันทึกความหมายใหม่ของคอลัมน์ไว้ใน DB (โผล่ใน Supabase table editor) ──
comment on column public.ss_branch_notification_events.branch is
  'ผู้รับแจ้งเตือน ไม่ใช่ "สาขา" อย่างเดียวแล้ว — SRC/KKL/SSS = สาขา, PURCHASING = จัดซื้อ (ชื่อคอลัมน์เป็นชื่อเดิมตั้งแต่ตอนมีแค่สาขา ไม่เปลี่ยนเพราะมี query/RPC/retention/realtime filter อ้างอยู่หลายจุด)';
comment on column public.ss_branch_notifications.branch is
  'ผู้รับแจ้งเตือน — SRC/KKL/SSS = สาขา, PURCHASING = จัดซื้อ (ดูคำอธิบายที่ ss_branch_notification_events.branch)';
comment on column public.ss_branch_notification_events.actor_code is
  'ผู้กระทำ — WAREHOUSE/PURCHASING (ทิศ แผนก → สาขา) หรือ SRC/KKL/SSS (ทิศ สาขา → จัดซื้อ)';

-- ── 7. Backfill Order ที่ค้างอยู่ ณ ตอน cutover ──
-- พอ frontend ใหม่โหลด จัดซื้อเลิกนับจาก recipient_read_at ทันที ใบที่ค้าง ณ วินาทีนั้น
-- จะหายจาก badge และไม่โผล่ใน drawer เพราะไม่มีแถวเหตุการณ์ — สร้างย้อนหลังให้
-- ครอบด้วย not exists จึงรันซ้ำได้ (ตามธรรมเนียม migration ของโปรเจกต์นี้)
insert into public.ss_branch_notification_events
  (branch, actor_code, menu_id, table_name, record_id, title, detail, item_sku, item_name, created_at)
select
  'PURCHASING',
  upper(trim(o.branch)),
  'order',
  'ss_orders',
  o.id::text,
  'สาขาเพิ่ม Order ใหม่',
  -- concat_ws คืน '' (ไม่ใช่ null) เมื่อทุกตัวเป็น null → ครอบ nullif อีกชั้นให้เป็น null จริง
  nullif(concat_ws(' · ', nullif(trim(coalesce(o.sku, '')), ''), nullif(trim(coalesce(o.product_name, '')), '')), ''),
  nullif(trim(coalesce(o.sku, '')), ''),
  nullif(trim(coalesce(o.product_name, '')), ''),
  coalesce(o.created_at, now())
from public.ss_orders o
where o.recipient_department in ('PURCHASING', 'BOTH')
  and o.recipient_read_at is null
  and upper(trim(coalesce(o.branch, ''))) in ('SRC', 'KKL', 'SSS')
  and not exists (
    select 1 from public.ss_branch_notification_events e
    where e.branch = 'PURCHASING'
      and e.table_name = 'ss_orders'
      and e.record_id = o.id::text
  );

-- ให้ badge ของจัดซื้อเด้งทันทีหลัง backfill (ถ้ามีแถวถูกสร้างจริง)
insert into public.ss_branch_notifications (branch, last_update_at)
select 'PURCHASING', now()
where exists (
  select 1 from public.ss_branch_notification_events
  where branch = 'PURCHASING' and read_at is null
)
on conflict (branch) do update
  set last_update_at = excluded.last_update_at;

-- realtime publication ไม่ต้องแตะ — ทั้ง 2 ตารางอยู่ใน supabase_realtime แล้ว
-- (publication เป็นระดับตาราง ไม่ใช่ระดับแถว)

notify pgrst, 'reload schema';
