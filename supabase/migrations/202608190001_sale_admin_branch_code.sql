-- เพิ่มรหัส 'SALE_ADMIN' ให้ทำงานแบบเดียวกับรหัสสาขา SRC/KKL/SSS ในเมนู Order / Request Item /
-- New Product / Ticket — ทั้งเป็น "ผู้กระทำ" (แจ้งเตือนจัดซื้อ+คลัง) และ "ผู้รับ" (รับแจ้งกลับ)
--
-- ต่อจาก 202608170001 (เพิ่ม PURCHASING เป็นผู้รับ) และ 202608180001 (เพิ่ม WAREHOUSE เป็นผู้รับ)
-- รอบนี้ต่างออกไปตรงที่ SALE_ADMIN เป็น **ผู้กระทำ**ด้วย จึงต้องขยาย `actor_code` ด้วย ซึ่งไฟล์
-- 202608180001 จงใจไม่แตะ (ดูคอมเมนต์หัวข้อ 2 ในไฟล์นั้น)
--
-- ⚠️ ต้องรัน migration นี้ "ก่อน" deploy frontend ที่ล็อกอินด้วยรหัส Sale Admin ได้
--    ไม่งั้นจะพังแบบเงียบ ๆ 2 ทาง ไม่มี error ให้เห็นสักทาง:
--      · actor: `case` ใน RPC จะ fallback เขียน actor_code เป็น 'PURCHASING' แทน
--        → แจ้งเตือนถึงจริงแต่ระบุผู้กระทำผิดคน (จัดซื้อเห็นว่าตัวเองแจ้งเตือนตัวเอง)
--      · recipient: filter จะกรอง 'SALE_ADMIN' ทิ้งแล้ว return void
--        → ปุ่ม "🔔 อัพเดท" ของ Sale Admin ขึ้นมาแต่ค้างที่ 0 ตลอด
--    ลำดับกลับกันปลอดภัย: ไม่มี caller เดิมส่ง 'SALE_ADMIN' schema เดิมจึงเป็น no-op

-- ── 1. ขยาย CHECK ของผู้รับ (คอลัมน์ชื่อ branch แต่ความหมายคือ "ผู้รับแจ้งเตือน") ──
alter table public.ss_branch_notification_events
  drop constraint if exists ss_branch_notification_events_branch_check;
alter table public.ss_branch_notification_events
  add constraint ss_branch_notification_events_branch_check
  check (branch in ('SRC', 'KKL', 'SSS', 'SALE_ADMIN', 'PURCHASING', 'WAREHOUSE'));

alter table public.ss_branch_notifications
  drop constraint if exists ss_branch_notifications_branch_check;
alter table public.ss_branch_notifications
  add constraint ss_branch_notifications_branch_check
  check (branch in ('SRC', 'KKL', 'SSS', 'SALE_ADMIN', 'PURCHASING', 'WAREHOUSE'));

-- ── 2. ขยาย CHECK ของผู้กระทำ ──
-- ตัวนี้คือตัวที่ทำให้ Sale Admin "แจ้งเตือนจัดซื้อและคลังได้" ตามที่ผู้ใช้ขอ
-- ถ้าลืมข้อนี้ insert เข้าตารางเหตุการณ์จะโดน CHECK ปฏิเสธทั้งแถว (ทั้งที่ผู้รับถูกต้อง)
alter table public.ss_branch_notification_events
  drop constraint if exists ss_branch_notification_events_actor_code_check;
alter table public.ss_branch_notification_events
  add constraint ss_branch_notification_events_actor_code_check
  check (actor_code in ('WAREHOUSE', 'PURCHASING', 'SRC', 'KKL', 'SSS', 'SALE_ADMIN'));

-- ── 3. seed แถวสรุปของ Sale Admin ──
-- RPC upsert ให้เองอยู่แล้ว แต่ seed ไว้เพื่อให้ realtime filter (branch=eq.SALE_ADMIN)
-- มีแถวเกาะตั้งแต่นาทีแรก ไม่ต้องรอ event แรก
insert into public.ss_branch_notifications (branch)
values ('SALE_ADMIN')
on conflict (branch) do nothing;

-- ── 4. RPC สร้างเหตุการณ์ — ขยาย filter ทั้ง 3 จุดในฟังก์ชันเดียว ──
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
      when upper(trim(coalesce(target_actor_code, ''))) in ('WAREHOUSE', 'PURCHASING', 'SRC', 'KKL', 'SSS', 'SALE_ADMIN')
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
  where upper(trim(value)) in ('SRC', 'KKL', 'SSS', 'SALE_ADMIN', 'PURCHASING', 'WAREHOUSE');

  -- ⚠️ filter ตรงนี้ต้องตรงกับข้างบนเป๊ะ ๆ — ถ้าลืมขยายจุดนี้จุดเดียว เหตุการณ์จะลงตาราง
  --    แต่ last_update_at ไม่ขยับ → realtime ไม่ยิง badge ขึ้นช้า 30 วิ แบบสุ่ม หาสาเหตุยากมาก
  insert into public.ss_branch_notifications (branch, last_update_at)
  select distinct upper(trim(value)), event_time
  from unnest(coalesce(target_branches, array[]::text[])) as branches(value)
  where upper(trim(value)) in ('SRC', 'KKL', 'SSS', 'SALE_ADMIN', 'PURCHASING', 'WAREHOUSE')
  on conflict (branch) do update
    set last_update_at = excluded.last_update_at;
end;
$$;

-- overload 7-arg ไม่ต้องแก้ — body เรียก 9-arg ต่อ จึงได้อานิสงส์อัตโนมัติ

-- ── 5. RPC มาร์คว่าอ่านแล้ว — ให้ Sale Admin ใช้ได้ ──
-- ถ้าลืมข้อนี้ drawer เปิดได้ เห็นรายการครบ แต่ badge ไม่มีวันเคลียร์ (return void เงียบ ๆ)
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
  if normalized_branch not in ('SRC', 'KKL', 'SSS', 'SALE_ADMIN', 'PURCHASING', 'WAREHOUSE') then return; end if;

  update public.ss_branch_notification_events
  set read_at = read_time
  where branch = normalized_branch and read_at is null;

  insert into public.ss_branch_notifications (branch, last_read_at)
  values (normalized_branch, read_time)
  on conflict (branch) do update
    set last_read_at = excluded.last_read_at;
end;
$$;

-- ── 6. Retention ของ ss_orders — 4 จุด ต้องขยายพร้อมกันทั้งหมด ──
-- Order ของ Sale Admin ต้องถูกลบอัตโนมัติหลังครบตรา 3 ขั้น + 1 เดือน เหมือน Order ของสาขา
-- ⚠️ แก้แค่ trigger ไม่แก้ฟังก์ชันลบ = workflow_completed_at ถูกตั้งแต่ไม่มีอะไรถูกลบจริง
--    แก้แค่ฟังก์ชันลบไม่แก้ trigger = workflow_completed_at เป็น null ตลอด ตัวลบไม่เจอแถวเลย
create or replace function public.ss_track_order_workflow_completion()
returns trigger language plpgsql set search_path = public as $$
declare
  all_steps_done boolean :=
    upper(trim(coalesce(new.branch, ''))) in ('SRC', 'KKL', 'SSS', 'SALE_ADMIN')
    and coalesce(new.arrived_branch, '') like '%แล้ว%'
    and coalesce(new.arrived_branch, '') not like '%ยังไม่%'
    and coalesce(new.customer_notified, '') like '%แล้ว%'
    and coalesce(new.customer_notified, '') not like '%ยังไม่%'
    and coalesce(new.delivered, '') like '%แล้ว%'
    and coalesce(new.delivered, '') not like '%ยังไม่%';
  old_all_steps_done boolean := false;
begin
  if tg_op = 'UPDATE' then
    old_all_steps_done :=
      upper(trim(coalesce(old.branch, ''))) in ('SRC', 'KKL', 'SSS', 'SALE_ADMIN')
      and coalesce(old.arrived_branch, '') like '%แล้ว%'
      and coalesce(old.arrived_branch, '') not like '%ยังไม่%'
      and coalesce(old.customer_notified, '') like '%แล้ว%'
      and coalesce(old.customer_notified, '') not like '%ยังไม่%'
      and coalesce(old.delivered, '') like '%แล้ว%'
      and coalesce(old.delivered, '') not like '%ยังไม่%';
  end if;

  if all_steps_done then
    if tg_op = 'INSERT' then
      new.workflow_completed_at := now();
    elsif not old_all_steps_done or old.workflow_completed_at is null then
      new.workflow_completed_at := now();
    else
      new.workflow_completed_at := old.workflow_completed_at;
    end if;
  else
    new.workflow_completed_at := null;
  end if;
  return new;
end;
$$;

create or replace function public.ss_delete_expired_completed_orders()
returns bigint language plpgsql security definer set search_path = public as $$
declare deleted_count bigint;
begin
  delete from ss_branch_notification_events as event
  using ss_orders as order_row
  where event.table_name = 'ss_orders'
    and event.record_id = order_row.id::text
    and order_row.workflow_completed_at < now() - interval '1 month'
    and upper(trim(coalesce(order_row.branch, ''))) in ('SRC', 'KKL', 'SSS', 'SALE_ADMIN')
    and order_row.arrived_branch like '%แล้ว%' and order_row.arrived_branch not like '%ยังไม่%'
    and order_row.customer_notified like '%แล้ว%' and order_row.customer_notified not like '%ยังไม่%'
    and order_row.delivered like '%แล้ว%' and order_row.delivered not like '%ยังไม่%';

  delete from ss_orders
  where workflow_completed_at < now() - interval '1 month'
    and upper(trim(coalesce(branch, ''))) in ('SRC', 'KKL', 'SSS', 'SALE_ADMIN')
    and arrived_branch like '%แล้ว%' and arrived_branch not like '%ยังไม่%'
    and customer_notified like '%แล้ว%' and customer_notified not like '%ยังไม่%'
    and delivered like '%แล้ว%' and delivered not like '%ยังไม่%';
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

-- ── 7. บันทึกความหมายใหม่ของคอลัมน์ไว้ใน DB (โผล่ใน Supabase table editor) ──
comment on column public.ss_branch_notification_events.branch is
  'ผู้รับแจ้งเตือน — SRC/KKL/SSS = สาขาหน้าร้าน, SALE_ADMIN = Sale Admin, PURCHASING = จัดซื้อ, WAREHOUSE = คลังสินค้า (ชื่อคอลัมน์เป็นชื่อเดิมตั้งแต่ตอนมีแค่สาขา ไม่เปลี่ยนเพราะมี query/RPC/retention/realtime filter อ้างอยู่หลายจุด)';
comment on column public.ss_branch_notifications.branch is
  'ผู้รับแจ้งเตือน — SRC/KKL/SSS = สาขาหน้าร้าน, SALE_ADMIN = Sale Admin, PURCHASING = จัดซื้อ, WAREHOUSE = คลังสินค้า (ดูคำอธิบายที่ ss_branch_notification_events.branch)';
comment on column public.ss_branch_notification_events.actor_code is
  'ผู้กระทำ — WAREHOUSE/PURCHASING (ทิศ แผนก → สาขา) หรือ SRC/KKL/SSS/SALE_ADMIN (ทิศ สาขา → จัดซื้อ/คลังสินค้า)';

-- ── 8. สิ่งที่จงใจ "ไม่แตะ" ในรอบนี้ ──
--  · ss_backorders.branch    — CHECK ยังเป็น ('SRC','KKL','SSS') ตามขอบเขตที่ตกลงกับผู้ใช้
--    (Sale Admin ไม่ใช้เมนู BackOrder — ฝั่งเว็บซ่อนเมนูด้วย currentRole = 'saleadmin')
--  · outbound_requests.branch — CHECK ยังเป็น ('SRC','KKL','SSS') เช่นกัน
--    (Sale Admin ไม่ใช้หน้าเบิกด่วน — ฝั่งเว็บกันด้วย branchNotSupported ใน OutboundPage.tsx)
--    ⚠️ ถ้าวันหลังจะเปิด 2 อย่างนี้ให้ Sale Admin ต้องขยาย CHECK 2 ตัวนี้ก่อนเสมอ
--       ทั้ง 2 ตารางยังไม่เคยมีคู่ drop/add constraint มาก่อน ต้องเขียนขึ้นใหม่เอง
--  · ss_orders.recipient_department — เป็น enum ของ "แผนกผู้รับงาน" ไม่ใช่รหัสสาขา ไม่เกี่ยวกัน
--  · ss_orders/ss_request_items/ss_new_products/ss_tickets.branch — ไม่มี CHECK อยู่แล้ว
--  · RLS policy ทุกตัว — ทั้งแอปใช้ anon key เดียว คุมสิทธิ์ฝั่ง UI ไม่ได้แยกตาม role จริง
--  · grant — create or replace function รักษา grant เดิมไว้ให้อยู่แล้ว

-- ไม่ backfill ย้อนหลัง — ยังไม่เคยมีแถวไหนใช้รหัส SALE_ADMIN มาก่อน เริ่มนับจากศูนย์

-- realtime publication ไม่ต้องแตะ — ทั้ง 2 ตารางอยู่ใน supabase_realtime แล้ว
-- (publication เป็นระดับตาราง ไม่ใช่ระดับแถว)

notify pgrst, 'reload schema';
