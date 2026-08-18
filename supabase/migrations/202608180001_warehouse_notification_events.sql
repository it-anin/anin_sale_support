-- แจ้งเตือนคลังสินค้าเมื่อสาขาลงข้อมูล/กดตราเมนู Order + BackOrder (ทิศทางใหม่: สาขา → คลังสินค้า)
--
-- ตารางเหตุการณ์นี้เดินทางได้แค่ "แผนก → สาขา" กับ "สาขา → จัดซื้อ" มาก่อน (ดู
-- 202608170001_purchasing_notification_events.sql) — คอมเมนต์ในไฟล์นั้นบอกไว้ตรงๆ ว่า
-- ถ้าวันหลังย้ายคลังมาใช้ระบบนี้ ต้องแก้ 4 จุด: (ก) CHECK ผู้รับ 2 ตาราง (ข) filter 2 จุดใน RPC
-- (ค) ss_mark_branch_notifications_read (ง) notificationSource-เทียบเท่าใน App.tsx — migration นี้
-- ทำ (ก)(ข)(ค); (ง) ทำแยกใน App.tsx เป็น effect ต่างหาก ไม่ใช้ notificationSource ตัวเดิม
-- (คลังสินค้าต้องมี 2 ตัวนับพร้อมกัน: "Order ใหม่" เดิมจาก ss_orders + "อัพเดท" ใหม่จากตารางนี้)
--
-- ⚠️ ต้องรัน migration นี้ "ก่อน" deploy frontend ที่เรียก notifyWarehouseUpdate
--    ไม่งั้น RPC จะกรอง 'WAREHOUSE' ทิ้งแล้ว return void โดยไม่มี error → ปุ่ม "🔔 อัพเดท" ของคลัง
--    ขึ้นมาแต่ค้างที่ 0 ตลอด ไม่ error ให้เห็น หาสาเหตุยาก
--    ลำดับกลับกันปลอดภัย: ไม่มี caller เดิมส่ง 'WAREHOUSE' เป็นเป้าหมาย schema เดิมจึงเป็น no-op

-- ── 1. ขยาย CHECK ของผู้รับ (คอลัมน์ชื่อ branch แต่ความหมายคือ "ผู้รับแจ้งเตือน") ──
alter table public.ss_branch_notification_events
  drop constraint if exists ss_branch_notification_events_branch_check;
alter table public.ss_branch_notification_events
  add constraint ss_branch_notification_events_branch_check
  check (branch in ('SRC', 'KKL', 'SSS', 'PURCHASING', 'WAREHOUSE'));

alter table public.ss_branch_notifications
  drop constraint if exists ss_branch_notifications_branch_check;
alter table public.ss_branch_notifications
  add constraint ss_branch_notifications_branch_check
  check (branch in ('SRC', 'KKL', 'SSS', 'PURCHASING', 'WAREHOUSE'));

-- ── 2. actor_code ไม่ต้องแตะ ── 'WAREHOUSE' อยู่ในชุดนั้นอยู่แล้วตั้งแต่ต้น
--    (เดิมใช้เป็นผู้กระทำในทิศ "แผนก → สาขา") migration นี้แค่เพิ่ม 'WAREHOUSE' ฝั่ง "ผู้รับ" เท่านั้น

-- ── 3. seed แถวสรุปของคลังสินค้า ──
-- RPC upsert ให้เองอยู่แล้ว แต่ seed ไว้เพื่อให้ realtime filter (branch=eq.WAREHOUSE)
-- มีแถวเกาะตั้งแต่นาทีแรก ไม่ต้องรอ event แรก
insert into public.ss_branch_notifications (branch)
values ('WAREHOUSE')
on conflict (branch) do nothing;

-- ── 4. RPC สร้างเหตุการณ์ — ขยาย filter 2 จุดให้ยอมรับ 'WAREHOUSE' เป็นเป้าหมาย ──
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
  where upper(trim(value)) in ('SRC', 'KKL', 'SSS', 'PURCHASING', 'WAREHOUSE');

  -- ⚠️ filter ตรงนี้ต้องตรงกับข้างบนเป๊ะ ๆ — ถ้าลืมขยายจุดนี้จุดเดียว เหตุการณ์จะลงตาราง
  --    แต่ last_update_at ไม่ขยับ → realtime ไม่ยิง badge ขึ้นช้า 30 วิ แบบสุ่ม หาสาเหตุยากมาก
  insert into public.ss_branch_notifications (branch, last_update_at)
  select distinct upper(trim(value)), event_time
  from unnest(coalesce(target_branches, array[]::text[])) as branches(value)
  where upper(trim(value)) in ('SRC', 'KKL', 'SSS', 'PURCHASING', 'WAREHOUSE')
  on conflict (branch) do update
    set last_update_at = excluded.last_update_at;
end;
$$;

-- overload 7-arg ไม่ต้องแก้ — body เรียก 9-arg ต่อ จึงได้อานิสงส์อัตโนมัติ

-- ── 5. RPC มาร์คว่าอ่านแล้ว — ให้คลังสินค้าใช้ได้ ──
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
  if normalized_branch not in ('SRC', 'KKL', 'SSS', 'PURCHASING', 'WAREHOUSE') then return; end if;

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
  'ผู้รับแจ้งเตือน — SRC/KKL/SSS = สาขา, PURCHASING = จัดซื้อ, WAREHOUSE = คลังสินค้า (ชื่อคอลัมน์เป็นชื่อเดิมตั้งแต่ตอนมีแค่สาขา ไม่เปลี่ยนเพราะมี query/RPC/retention/realtime filter อ้างอยู่หลายจุด)';
comment on column public.ss_branch_notifications.branch is
  'ผู้รับแจ้งเตือน — SRC/KKL/SSS = สาขา, PURCHASING = จัดซื้อ, WAREHOUSE = คลังสินค้า (ดูคำอธิบายที่ ss_branch_notification_events.branch)';
comment on column public.ss_branch_notification_events.actor_code is
  'ผู้กระทำ — WAREHOUSE/PURCHASING (ทิศ แผนก → สาขา) หรือ SRC/KKL/SSS (ทิศ สาขา → จัดซื้อ/คลังสินค้า)';

-- ⚠️ ไม่ backfill เหตุการณ์ย้อนหลังเหมือน migration ของจัดซื้อ — ทิศนี้ไม่ได้ "แทนที่" ปุ่ม
--    "Order ใหม่" เดิมของคลัง (ยังใช้ ss_orders.recipient_department คู่ขนานต่อไป) จึงไม่มีของเดิม
--    ที่ต้อง cutover ให้ต่อเนื่อง เริ่มนับจากศูนย์ตั้งแต่ event แรกหลัง migration นี้พอ

-- realtime publication ไม่ต้องแตะ — ทั้ง 2 ตารางอยู่ใน supabase_realtime แล้ว
-- (publication เป็นระดับตาราง ไม่ใช่ระดับแถว)

notify pgrst, 'reload schema';
