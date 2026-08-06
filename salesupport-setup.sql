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
  arrived_branch   text,                    -- 1.19 ของถึงสาขา
  customer_notified text,                   -- 1.20 แจ้งลูกค้า
  delivered        text,                    -- 1.21 ส่งมอบสินค้า
  phone            text,                    -- 1.22 เบอร์โทรติดต่อ (ค่าที่กรอก)
  contact_channel  text,                    -- 1.22 ช่องทางการติดต่อ (Tel./Line/WhatsApp)
  created_at       timestamptz default now() -- 1.23 TimeStamp
);

-- เผื่อกรณีรันไฟล์เวอร์ชันเก่าไปแล้ว: เพิ่มคอลัมน์ช่องทางติดต่อย้อนหลัง
alter table ss_orders add column if not exists contact_channel text;
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

-- ── RLS: ให้ anon key อ่าน/เพิ่ม/แก้ไขได้ (เหมือนตารางอื่นของแอป) ──
alter table ss_orders        enable row level security;
alter table ss_request_items enable row level security;
alter table ss_new_products  enable row level security;
alter table ss_tickets       enable row level security;

drop policy if exists "anon all ss_orders"        on ss_orders;
drop policy if exists "anon all ss_request_items" on ss_request_items;
drop policy if exists "anon all ss_new_products"  on ss_new_products;
drop policy if exists "anon all ss_tickets"       on ss_tickets;

create policy "anon all ss_orders"        on ss_orders        for all using (true) with check (true);
create policy "anon all ss_request_items" on ss_request_items for all using (true) with check (true);
create policy "anon all ss_new_products"  on ss_new_products  for all using (true) with check (true);
create policy "anon all ss_tickets"       on ss_tickets       for all using (true) with check (true);

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
