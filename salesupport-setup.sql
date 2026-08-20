-- ============================================================
-- SaleSupport — สร้างตาราง 4 เมนู: Order / Request Item / New Product / Ticket
-- วิธีใช้: เปิด Supabase Dashboard → SQL Editor → วางทั้งไฟล์ → Run
-- ============================================================

-- ── 1) Order — งานสั่งจอง/สั่งซื้อของลูกค้า ──────────────────
create table if not exists ss_orders (
  id               uuid primary key default gen_random_uuid(),
  sku              text,                    -- 1.1 SKU
  product_name     text,                    -- 1.1 ชื่อสินค้า
  branch           text,                    -- 1.2 Branch
  recipient_department text not null default 'BOTH'
    check (recipient_department in ('WAREHOUSE', 'PURCHASING', 'BOTH')), -- แผนกผู้รับ Order
  recipient_read_at timestamptz,            -- เวลาที่แผนกผู้รับเปิดดู Order
  qty              numeric,                 -- 1.3 จำนวน
  unit             text,                    -- 1.4 หน่วย
  paid_date        date,                    -- 1.5 วันที่ลูกค้าชำระ
  sale_bill_no     text,                    -- 1.6 เลขบิลขาย
  customer_name    text,                    -- 1.7 ชื่อลูกค้า
  pickup_date      date,                    -- 1.8 วันที่นัดรับ
  note             text,                    -- 1.9 หมายเหตุ
  delivery_method  text,                    -- 1.10 รับที่ร้าน/จัดส่ง
  order_type       text,                    -- 1.11 เบิก/สั่งซื้อ
  order_bill_no    text,                    -- 1.12 สั่งซื้อ/เบิก (เลขบิล)
  order_date       date,                    -- 1.13 วันที่สั่งซื้อ/เบิก
  order_source     text,                    -- 1.14 สั่งลงที่ไหน
  eta_date         date,                    -- 1.15 วันที่คาดว่าของถึง
  inbound_date     date,                    -- 1.16 Inbound วันที่รับของ
  outbound_date    date,                    -- 1.17 Outbound วันที่ส่งของ
  transfer_no      text,                    -- 1.18 เลขโอนสินค้า/เลขจัดส่ง
  arrived_branch   text not null default 'ยังไม่ถึง',     -- 1.19 ของถึงสาขา
  customer_notified text not null default 'ยังไม่แจ้ง',   -- 1.20 แจ้งลูกค้า
  delivered        text not null default 'ยังไม่ส่งมอบ',  -- 1.21 ส่งมอบสินค้า
  phone            text,                    -- 1.22 เบอร์โทรติดต่อ (ค่าที่กรอก)
  contact_channel  text,                    -- 1.22 ช่องทางการติดต่อ (Tel./Line/WhatsApp)
  workflow_completed_at timestamptz,        -- เวลาที่สาขายืนยันครบทั้ง 3 ตรา
  created_at       timestamptz default now() -- 1.23 TimeStamp
);

-- เผื่อกรณีรันไฟล์เวอร์ชันเก่าไปแล้ว: เพิ่มคอลัมน์ช่องทางติดต่อย้อนหลัง
alter table ss_orders add column if not exists contact_channel text;
alter table ss_orders add column if not exists workflow_completed_at timestamptz;
alter table ss_orders add column if not exists recipient_department text;
alter table ss_orders add column if not exists recipient_read_at timestamptz;
alter table ss_orders add column if not exists order_type text;
alter table ss_orders add column if not exists order_bill_no text;
alter table ss_orders add column if not exists order_date date;
alter table ss_orders add column if not exists order_source text;
alter table ss_orders add column if not exists eta_date date;

-- ข้อมูลเก่าก่อนมีตัวเลือกผู้รับยังให้ทั้งคลังและจัดซื้อเห็น และไม่นับเป็นงานใหม่
update ss_orders
set recipient_department = 'BOTH',
    recipient_read_at = coalesce(recipient_read_at, now())
where recipient_department is null or btrim(recipient_department) = '';

alter table ss_orders
  alter column recipient_department set default 'BOTH',
  alter column recipient_department set not null;
alter table ss_orders drop constraint if exists ss_orders_recipient_department_check;
alter table ss_orders add constraint ss_orders_recipient_department_check
  check (recipient_department in ('WAREHOUSE', 'PURCHASING', 'BOTH'));
create index if not exists ss_orders_recipient_unread_idx
  on ss_orders (recipient_department, recipient_read_at)
  where recipient_read_at is null;

-- เติมสถานะเริ่มต้นให้ Order เก่า และป้องกัน Order ใหม่มีสถานะว่าง
update ss_orders
set
  arrived_branch = coalesce(nullif(btrim(arrived_branch), ''), 'ยังไม่ถึง'),
  customer_notified = coalesce(nullif(btrim(customer_notified), ''), 'ยังไม่แจ้ง'),
  delivered = coalesce(nullif(btrim(delivered), ''), 'ยังไม่ส่งมอบ')
where arrived_branch is null or btrim(arrived_branch) = ''
   or customer_notified is null or btrim(customer_notified) = ''
   or delivered is null or btrim(delivered) = '';

alter table ss_orders
  alter column arrived_branch set default 'ยังไม่ถึง',
  alter column arrived_branch set not null,
  alter column customer_notified set default 'ยังไม่แจ้ง',
  alter column customer_notified set not null,
  alter column delivered set default 'ยังไม่ส่งมอบ',
  alter column delivered set not null;

-- เริ่มนับอายุ 1 เดือนเมื่อยืนยันครบทั้ง 3 ตรา และหยุดนับทันทีเมื่อยกเลิกตราใดตราหนึ่ง
create or replace function ss_track_order_workflow_completion()
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

drop trigger if exists ss_track_order_workflow_completion_trigger on ss_orders;
create trigger ss_track_order_workflow_completion_trigger
before insert or update of branch, arrived_branch, customer_notified, delivered, workflow_completed_at
on ss_orders for each row execute function ss_track_order_workflow_completion();

-- รายการที่ครบอยู่ก่อนติดตั้ง เริ่มนับ 1 เดือนตั้งแต่วันที่รัน SQL นี้
update ss_orders set workflow_completed_at = now()
where workflow_completed_at is null
  and upper(trim(coalesce(branch, ''))) in ('SRC', 'KKL', 'SSS', 'SALE_ADMIN')
  and arrived_branch like '%แล้ว%' and arrived_branch not like '%ยังไม่%'
  and customer_notified like '%แล้ว%' and customer_notified not like '%ยังไม่%'
  and delivered like '%แล้ว%' and delivered not like '%ยังไม่%';

create index if not exists ss_orders_workflow_completed_at_idx
  on ss_orders (workflow_completed_at) where workflow_completed_at is not null;
notify pgrst, 'reload schema';

-- ── 2) Request Item — ขอสินค้าที่ไม่มีในสต๊อก ─────────────────
create table if not exists ss_request_items (
  id              uuid primary key default gen_random_uuid(),
  product_name    text,                       -- 2.1 ชื่อสินค้า
  branch          text,                       -- 2.2 สาขา
  generic_name    text,                       -- 2.3 Generic Name
  strength        text,                       -- 2.4 ความแรง
  pack_size       text,                       -- 2.5 ขนาดบรรจุ
  qty             numeric,                    -- 2.6 จำนวนที่ต้องการ
  need_date       date,                       -- 2.7/2.8 วันที่ต้องการสินค้า
  status          text,                       -- 2.9 Status
  created_at      timestamptz default now(),  -- 2.10 DateTime
  sku             text,                       -- 2.11 SKU
  availability    text,                       -- 2.12 Availability
  note            text,                       -- 2.13 Note
  leadtime        text,                       -- 2.14 Leadtime
  exp             text,                       -- 2.15/2.16 EXP
  moq             text,                       -- 2.17 MOQ
  supplier        text,                       -- Supplier
  image_url       text,                       -- รูปสินค้า (URL จาก Storage)
  customer_name   text,                       -- ชื่อลูกค้า
  contact_channel text,                       -- ช่องทางติดต่อ (Tel./Line/WhatsApp)
  phone           text                        -- ค่าที่กรอก (เบอร์/ไอดี)
);

-- เผื่อกรณีรันไฟล์เวอร์ชันเก่าไปแล้ว: เพิ่มคอลัมน์ใหม่ย้อนหลัง
alter table ss_request_items add column if not exists supplier        text;
alter table ss_request_items add column if not exists image_url       text;
alter table ss_request_items add column if not exists customer_name   text;
alter table ss_request_items add column if not exists contact_channel text;
alter table ss_request_items add column if not exists phone           text;

-- ── 3) New Product — เสนอสินค้าใหม่เข้าร้าน ──────────────────
create table if not exists ss_new_products (
  id                uuid primary key default gen_random_uuid(),
  name_brand        text,                     -- 3.1 Name/Brand
  active_ingredient text,                     -- 3.2 ชื่อยา/สารสำคัญ
  created_at        timestamptz default now(),-- 3.3 Stamp Date
  branch            text,                     -- 3.4 Branch
  ask_qty           numeric,                  -- 3.5 Ask Qty
  pack_size         text,                     -- 3.6 ขนาดบรรจุ
  image_url         text,                     -- 3.7 รูปสินค้า (URL)
  supplier          text,                     -- 3.8 Supplier
  quoted_price      text,                     -- 3.9 ราคาที่แจ้ง
  note              text,                     -- 3.10 หมายเหตุ
  status            text                      -- 3.11 Status
);

-- ── Product Master — ฐานข้อมูลสินค้าหลัก (นำเข้าจากไฟล์ Product_Master) ──
create table if not exists product_master (
  id                 uuid primary key default gen_random_uuid(),
  sku                text not null,   -- SKU
  name               text,            -- Name / ชื่อสินค้า
  base_unit          text,            -- BASE_UNIT
  abc                text,            -- ABC
  multiply           text,            -- Multiply
  supplier           text,            -- Supplier
  set_deal           text,            -- Set_Deal
  purchase_unit      text,            -- Purchase_Unit
  barcode_unit       text,            -- Barcode_Unit
  cost               text,            -- ทุนซื้อ
  buying_deal_normal text,            -- Buying_Deal_Normal
  buying_deal_free   text,            -- Buying_Deal_Free
  group_name         text,            -- Group
  group_percent      text,            -- Group %
  sku_name           text,            -- SKU Name
  distributor        text,            -- Distributor
  distributor_name   text,            -- Distributor Name
  created_at         timestamptz default now()
);

alter table product_master enable row level security;
drop policy if exists "anon all product_master" on product_master;
create policy "anon all product_master" on product_master for all using (true) with check (true);

-- ทำให้ SKU ไม่ซ้ำ เพื่อรองรับโหมด merge (upsert ตาม SKU)
-- ลบแถว SKU ซ้ำก่อน (เก็บแถวล่าสุดไว้) แล้วค่อยสร้าง unique constraint
delete from product_master
where id not in (
  select distinct on (sku) id from product_master order by sku, created_at desc
);
alter table product_master drop constraint if exists product_master_sku_key;
alter table product_master add constraint product_master_sku_key unique (sku);

-- ── Supplier — รายชื่อผู้จำหน่าย (นำเข้าจาก Excel ผ่านหน้าเว็บ) ──
create table if not exists ss_suppliers (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,             -- ชื่อ Supplier (ใช้ autocomplete)
  details    jsonb,                     -- คอลัมน์อื่นทั้งหมดจาก Excel (เบอร์, เซลส์ ฯลฯ)
  created_at timestamptz default now()
);

alter table ss_suppliers enable row level security;
drop policy if exists "anon all ss_suppliers" on ss_suppliers;
create policy "anon all ss_suppliers" on ss_suppliers for all using (true) with check (true);

-- ── 4) Ticket — แจ้งปัญหา/สอบถาม ─────────────────────────────
create table if not exists ss_tickets (
  id          uuid primary key default gen_random_uuid(),
  department  text,                         -- 4.1 Department
  created_at  timestamptz default now(),    -- 4.2 Date Time
  branch      text,                         -- 4.3 Branch
  issue       text,                         -- 4.4 Issue
  answer      text,                         -- 4.5 Answer
  status      text                          -- 4.6 Status
);

-- ── 5) BackOrder — สินค้าค้างส่ง (ABC ≠ P) ────────────────────
-- เห็นเฉพาะโปรไฟล์สาขาและคลังสินค้า · จัดซื้อไม่เห็นเมนูนี้
-- ⚠️ ค่า default ของ 3 สถานะต้องสะกดตรงกับ ss_orders เป๊ะ ๆ
--    เพราะ stepDone() ฝั่งเว็บตัดสินด้วยการหาคำว่า "แล้ว" ในสตริง
-- ⚠️ `unit` = หน่วยของ barcode ที่สแกน/เลือกตอนสร้าง (ใน products 1 barcode ผูก 1 หน่วยเสมอ)
--    ส่วนตัวเลขคงเหลือในคอลัมน์ "คลังมีสินค้า" ดึงสดจาก stock ซึ่ง**นับด้วยหน่วยเล็กสุดเสมอ**
--    จึงอาจคนละหน่วยกับคอลัมน์นี้ เช่น SKU 100098 คลังมี 530 แผง แต่สแกนบาร์โค้ดกล่องมาก็เก็บ 'กล่อง'
create table if not exists ss_backorders (
  id                uuid primary key default gen_random_uuid(),
  sku               text,                                  -- 5.1 SKU
  product_name      text,                                  -- 5.2 ชื่อสินค้า
  unit              text,                                  -- 5.3 หน่วยตามบาร์โค้ดที่สแกน/เลือก
  pending_qty       numeric,                               -- 5.3.1 ค้างส่งลูกค้า (สาขากรอกในฟอร์ม)
  -- ผู้ลงรายการ — ไม่มี 'Warehouse' เพราะคลังเป็นผู้รับงาน ไม่ใช่ผู้ขอ
  -- ⚠️ CHECK นี้เป็น inline ในบล็อก `create table if not exists` จึงไม่มีผลกับ DB ที่สร้างไปแล้ว
  --    ทุกครั้งที่เพิ่มค่าใหม่ต้องแก้ **ทั้งตรงนี้ (ติดตั้งใหม่) และคู่ alter ด้านล่าง (DB เดิม)**
  branch            text not null check (branch in ('SRC', 'KKL', 'SSS', 'SALE_ADMIN')),
  customer_name     text,                                  -- 5.4 ชื่อลูกค้า
  phone             text,                                  -- 5.4.1 เบอร์โทรติดต่อ (ไม่มี contact_channel เหมือน ss_orders)
  paid_date         date,                                  -- 5.5 วันที่ลูกค้าชำระ
  sale_bill_no      text,                                  -- 5.6 เลขที่บิล
  pickup_date       date,                                  -- 5.7 วันที่นัดรับ
  note              text,                                  -- 5.8 หมายเหตุ
  outbound_date     date,                                  -- 5.9 Outbound วันที่ส่งของ (คลังกรอก)
  transfer_no       text,                                  -- 5.10 เลขโอนสินค้า/เลขจัดส่ง (คลังกรอก)
  arrived_branch    text not null default 'ยังไม่ถึง',      -- 5.11 ของถึงสาขา
  customer_notified text not null default 'ยังไม่แจ้ง',     -- 5.12 แจ้งลูกค้า
  delivered         text not null default 'ยังไม่ส่งมอบ',   -- 5.13 ส่งมอบสินค้า
  -- 5.14 ยกเลิกรายการ (สั่งของไม่ได้) — สาขากดเอง null = ยังไม่ยกเลิก
  -- 🚨 ต้องเป็นคอลัมน์แยก ห้ามเขียน "ยกเลิก" ทับลง 3 คอลัมน์สถานะข้างบน — ดู migration 202608200001
  cancelled_at      timestamptz,                           -- 5.14 เวลาที่ยกเลิก
  cancel_reason     text,                                  -- 5.15 สาเหตุที่ยกเลิก (บังคับกรอกที่ฟอร์ม)
  -- 5.16 แจ้งจัดซื้อ/คลังสินค้า — สาขาบังคับเลือกตอนสร้าง (ไม่มี default) ดู migration 202608200002
  notify_target     text check (notify_target in ('PURCHASING', 'WAREHOUSE')),
  created_at        timestamptz not null default now()
);

alter table ss_backorders add column if not exists unit text;
alter table ss_backorders add column if not exists transfer_no text;
alter table ss_backorders add column if not exists pending_qty numeric;
alter table ss_backorders add column if not exists phone text;
alter table ss_backorders add column if not exists cancelled_at timestamptz;
alter table ss_backorders add column if not exists cancel_reason text;
alter table ss_backorders add column if not exists notify_target text
  check (notify_target in ('PURCHASING', 'WAREHOUSE'));

-- ⚠️ คู่ alter ของ CHECK ด้านบน — จำเป็นสำหรับ DB ที่สร้างไว้ก่อนหน้า เพราะ
--    `create table if not exists` ข้าม inline CHECK ทั้งหมดถ้าตารางมีอยู่แล้ว
--    (ตารางนี้เพิ่งมีคู่ alter ครั้งแรกตอน migration 202608190002 ตอนเพิ่ม SALE_ADMIN)
alter table ss_backorders drop constraint if exists ss_backorders_branch_check;
alter table ss_backorders add constraint ss_backorders_branch_check
  check (branch in ('SRC', 'KKL', 'SSS', 'SALE_ADMIN'));

create index if not exists ss_backorders_branch_created_idx
  on ss_backorders (branch, created_at desc);

-- ── RLS: ให้ anon key อ่าน/เพิ่ม/แก้ไขได้ (เหมือนตารางอื่นของแอป) ──
alter table ss_orders        enable row level security;
alter table ss_backorders    enable row level security;
alter table ss_request_items enable row level security;
alter table ss_new_products  enable row level security;
alter table ss_tickets       enable row level security;

drop policy if exists "anon all ss_orders"        on ss_orders;
drop policy if exists "anon all ss_backorders"    on ss_backorders;
drop policy if exists "anon all ss_request_items" on ss_request_items;
drop policy if exists "anon all ss_new_products"  on ss_new_products;
drop policy if exists "anon all ss_tickets"       on ss_tickets;

create policy "anon all ss_orders"        on ss_orders        for all using (true) with check (true);
create policy "anon all ss_backorders"    on ss_backorders    for all using (true) with check (true);
create policy "anon all ss_request_items" on ss_request_items for all using (true) with check (true);
create policy "anon all ss_new_products"  on ss_new_products  for all using (true) with check (true);
create policy "anon all ss_tickets"       on ss_tickets       for all using (true) with check (true);

-- ── แจ้งเตือนหน้า SaleSupport แยกตามผู้รับ ─────────────────────
-- last_update_at อัปเดตเมื่อมีคนแก้ข้อมูลถึงผู้รับรายนั้น
-- last_read_at อัปเดตเมื่อผู้รับเปิดแผงประวัติแจ้งเตือน
-- ⚠️ คอลัมน์ชื่อ `branch` แต่ความหมายคือ "ผู้รับแจ้งเตือน" — SRC/KKL/SSS = สาขา,
--    PURCHASING = จัดซื้อ (2569-08-17 เพิ่มทิศ สาขา → จัดซื้อ), WAREHOUSE = คลังสินค้า
--    (2569-08-18 เพิ่มทิศ สาขา → คลังสินค้า — คู่ขนานกับปุ่ม "Order ใหม่" เดิม ไม่ได้แทนที่)
--    ไม่ rename เพราะมี query/RPC/retention/realtime filter อ้างชื่อนี้อยู่หลายจุด
create table if not exists ss_branch_notifications (
  branch         text primary key check (branch in ('SRC', 'KKL', 'SSS', 'SALE_ADMIN', 'PURCHASING', 'WAREHOUSE')),
  last_update_at timestamptz,
  last_read_at   timestamptz
);

insert into ss_branch_notifications (branch)
values ('SRC'), ('KKL'), ('SSS'), ('SALE_ADMIN'), ('PURCHASING'), ('WAREHOUSE')
on conflict (branch) do nothing;

alter table ss_branch_notifications enable row level security;
drop policy if exists "anon all ss_branch_notifications" on ss_branch_notifications;
create policy "anon all ss_branch_notifications" on ss_branch_notifications
  for all using (true) with check (true);

-- ⚠️ `branch` = ผู้รับ (SRC/KKL/SSS = สาขา, PURCHASING = จัดซื้อ, WAREHOUSE = คลังสินค้า)
--    `actor_code` = ผู้กระทำ (WAREHOUSE/PURCHASING = ทิศแผนก→สาขา, SRC/KKL/SSS = ทิศสาขา→จัดซื้อ/คลังสินค้า)
create table if not exists ss_branch_notification_events (
  id          uuid primary key default gen_random_uuid(),
  branch      text not null check (branch in ('SRC', 'KKL', 'SSS', 'SALE_ADMIN', 'PURCHASING', 'WAREHOUSE')),
  actor_code  text not null check (actor_code in ('WAREHOUSE', 'PURCHASING', 'SRC', 'KKL', 'SSS', 'SALE_ADMIN')),
  menu_id     text not null,
  table_name  text not null,
  record_id   text,
  title       text not null,
  detail      text,
  item_sku    text,
  item_name   text,
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);

alter table ss_branch_notification_events add column if not exists item_sku text;
alter table ss_branch_notification_events add column if not exists item_name text;

-- ⚠️ `create table if not exists` ข้าม CHECK ที่เขียน inline ไว้ข้างบนถ้าตารางมีอยู่แล้ว
--    จึงต้องมีแบบ alter คู่กันเสมอ สำหรับ DB ที่สร้างไว้ก่อนหน้า (แบบเดียวกับ ss_orders ข้างบน)
alter table ss_branch_notifications
  drop constraint if exists ss_branch_notifications_branch_check;
alter table ss_branch_notifications
  add constraint ss_branch_notifications_branch_check
  check (branch in ('SRC', 'KKL', 'SSS', 'SALE_ADMIN', 'PURCHASING', 'WAREHOUSE'));

alter table ss_branch_notification_events
  drop constraint if exists ss_branch_notification_events_branch_check;
alter table ss_branch_notification_events
  add constraint ss_branch_notification_events_branch_check
  check (branch in ('SRC', 'KKL', 'SSS', 'SALE_ADMIN', 'PURCHASING', 'WAREHOUSE'));

alter table ss_branch_notification_events
  drop constraint if exists ss_branch_notification_events_actor_code_check;
alter table ss_branch_notification_events
  add constraint ss_branch_notification_events_actor_code_check
  check (actor_code in ('WAREHOUSE', 'PURCHASING', 'SRC', 'KKL', 'SSS', 'SALE_ADMIN'));

comment on column ss_branch_notification_events.branch is
  'ผู้รับแจ้งเตือน ไม่ใช่ "สาขา" อย่างเดียวแล้ว — SRC/KKL/SSS = สาขา, PURCHASING = จัดซื้อ, WAREHOUSE = คลังสินค้า';
comment on column ss_branch_notifications.branch is
  'ผู้รับแจ้งเตือน — SRC/KKL/SSS = สาขา, PURCHASING = จัดซื้อ, WAREHOUSE = คลังสินค้า';
comment on column ss_branch_notification_events.actor_code is
  'ผู้กระทำ — WAREHOUSE/PURCHASING (ทิศ แผนก → สาขา) หรือ SRC/KKL/SSS (ทิศ สาขา → จัดซื้อ/คลังสินค้า)';

create index if not exists ss_branch_notification_events_branch_created_idx
  on ss_branch_notification_events (branch, created_at desc);
create index if not exists ss_branch_notification_events_unread_idx
  on ss_branch_notification_events (branch, read_at) where read_at is null;

alter table ss_branch_notification_events enable row level security;
drop policy if exists "anon all ss_branch_notification_events" on ss_branch_notification_events;
create policy "anon all ss_branch_notification_events" on ss_branch_notification_events
  for all using (true) with check (true);

create or replace function ss_create_branch_notifications(
  target_branches text[], target_actor_code text, target_menu_id text,
  target_table_name text, target_record_id text, event_title text, event_detail text,
  event_item_sku text, event_item_name text
)
returns void language plpgsql security invoker set search_path = public as $$
declare event_time timestamptz := now();
begin
  insert into ss_branch_notification_events
    (branch, actor_code, menu_id, table_name, record_id, title, detail, item_sku, item_name, created_at)
  select distinct
    upper(trim(value)),
    -- ส่งค่าจริงผ่านไปถ้าอยู่ในชุดที่รู้จัก · คง else 'PURCHASING' ไว้ตามเดิม
    -- → call site เดิมที่ส่ง 'WAREHOUSE'/'PURCHASING' ตรง ๆ พฤติกรรมไม่เปลี่ยน
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

  -- ⚠️ filter ตรงนี้ต้องตรงกับข้างบนเป๊ะ ๆ — ลืมขยายจุดนี้จุดเดียว เหตุการณ์จะลงตาราง
  --    แต่ last_update_at ไม่ขยับ → realtime ไม่ยิง badge ขึ้นช้า 30 วิ แบบสุ่ม
  insert into ss_branch_notifications (branch, last_update_at)
  select distinct upper(trim(value)), event_time
  from unnest(coalesce(target_branches, array[]::text[])) as branches(value)
  where upper(trim(value)) in ('SRC', 'KKL', 'SSS', 'SALE_ADMIN', 'PURCHASING', 'WAREHOUSE')
  on conflict (branch) do update set last_update_at = excluded.last_update_at;
end;
$$;

-- Keep the legacy signature for older frontend versions during deployment.
create or replace function ss_create_branch_notifications(
  target_branches text[], target_actor_code text, target_menu_id text,
  target_table_name text, target_record_id text, event_title text, event_detail text
)
returns void language plpgsql security invoker set search_path = public as $$
begin
  perform ss_create_branch_notifications(
    target_branches, target_actor_code, target_menu_id, target_table_name,
    target_record_id, event_title, event_detail, null, null
  );
end;
$$;

create or replace function ss_mark_branch_notifications_read(target_branch text)
returns void language plpgsql security invoker set search_path = public as $$
declare
  read_time timestamptz := now();
  normalized_branch text := upper(trim(target_branch));
begin
  if normalized_branch not in ('SRC', 'KKL', 'SSS', 'SALE_ADMIN', 'PURCHASING', 'WAREHOUSE') then return; end if;
  update ss_branch_notification_events set read_at = read_time
  where branch = normalized_branch and read_at is null;
  insert into ss_branch_notifications (branch, last_read_at)
  values (normalized_branch, read_time)
  on conflict (branch) do update set last_read_at = excluded.last_read_at;
end;
$$;

grant select, insert, update on ss_branch_notifications to anon, authenticated;
grant select, insert, update on ss_branch_notification_events to anon, authenticated;
grant execute on function ss_create_branch_notifications(text[], text, text, text, text, text, text) to anon, authenticated;
grant execute on function ss_create_branch_notifications(text[], text, text, text, text, text, text, text, text) to anon, authenticated;
grant execute on function ss_mark_branch_notifications_read(text) to anon, authenticated;

-- ลบเฉพาะ Order ที่ครบทั้ง 3 ตรามาแล้ว 1 เดือน พร้อมประวัติอัพเดทของ Order นั้น
create or replace function ss_delete_expired_completed_orders()
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

revoke all on function ss_delete_expired_completed_orders() from public, anon, authenticated;

-- ทำงานทุกวัน 02:30 น. เวลาไทย (19:30 UTC)
create extension if not exists pg_cron;
select cron.schedule(
  'salesupport-delete-completed-orders-after-one-month',
  '30 19 * * *',
  $$select public.ss_delete_expired_completed_orders();$$
);

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'ss_orders'
     ) then
    alter publication supabase_realtime add table public.ss_orders;
  end if;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'ss_branch_notifications'
     ) then
    alter publication supabase_realtime add table public.ss_branch_notifications;
  end if;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'ss_branch_notification_events'
     ) then
    alter publication supabase_realtime add table public.ss_branch_notification_events;
  end if;
end $$;

notify pgrst, 'reload schema';

-- ── Storage bucket สำหรับรูปสินค้าที่แนบ (public อ่านได้ผ่าน URL) ──
insert into storage.buckets (id, name, public)
values ('salesupport', 'salesupport', true)
on conflict (id) do nothing;

drop policy if exists "anon upload salesupport" on storage.objects;
drop policy if exists "anon read salesupport"   on storage.objects;

create policy "anon upload salesupport" on storage.objects
  for insert to anon, authenticated with check (bucket_id = 'salesupport');
create policy "anon read salesupport" on storage.objects
  for select to anon, authenticated using (bucket_id = 'salesupport');

-- ── ข้อมูลตัวอย่าง (ลบทิ้งได้เมื่อใช้งานจริง) ─────────────────
insert into ss_orders (sku, product_name, branch, qty, unit, paid_date, sale_bill_no, customer_name, pickup_date, delivery_method, order_type, phone, arrived_branch, customer_notified, delivered)
values
  ('10001', 'พาราเซตามอล 500mg', 'SRC', 20, 'กล่อง', '2026-07-10', 'IV-880012', 'คุณสมชาย', '2026-07-15', 'รับที่ร้าน', 'สั่งซื้อ', '081-111-2222', 'ยังไม่ถึง', 'ยังไม่แจ้ง', 'ยังไม่ส่งมอบ'),
  ('10002', 'วิตามินซี 1000mg',  'KKL', 5,  'ขวด',  '2026-07-09', 'IV-880014', 'คุณมาลี',  '2026-07-14', 'จัดส่ง',    'เบิก',     '089-333-4444', 'ถึงแล้ว',    'แจ้งแล้ว',   'ส่งมอบแล้ว');

insert into ss_request_items (product_name, branch, generic_name, strength, pack_size, qty, need_date, status, sku, availability, leadtime, moq)
values
  ('ยาแก้แพ้ Loratadine', 'SSS', 'Loratadine', '10 mg', '10x10 เม็ด', 3, '2026-07-20', 'รอตรวจสอบ', '', 'ต้องสั่ง', '7 วัน', '5 กล่อง'),
  ('น้ำเกลือล้างแผล',      'SRC', 'NSS 0.9%',   '-',     '1000 ml',    12, '2026-07-18', 'สั่งแล้ว',   '20077', 'มีของ', '3 วัน', '-');

insert into ss_new_products (name_brand, active_ingredient, branch, ask_qty, pack_size, supplier, quoted_price, status)
values
  ('ProbioMax', 'Probiotic 10 สายพันธุ์', 'KKL', 10, '30 แคปซูล', 'บ.เฮลท์ตี้ จก.', '250 บาท/กล่อง', 'รอพิจารณา'),
  ('DermCream Plus', 'Urea 10% + Ceramide', 'SRC', 6, '50 g', 'บ.สกินแคร์ไทย', '120 บาท/หลอด', 'อนุมัติแล้ว');

insert into ss_tickets (department, branch, issue, answer, status)
values
  ('IT',    'SSS', 'เครื่องพิมพ์ใบเสร็จไม่ทำงาน', '', 'รอดำเนินการ'),
  ('บัญชี', 'SRC', 'ยอดบิล IV-880001 ไม่ตรง',    'ปรับปรุงยอดแล้ว', 'เสร็จสิ้น');
