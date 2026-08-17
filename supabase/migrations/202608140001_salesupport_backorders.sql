-- BackOrder: pending customer items handled by the warehouse (ABC != P).
-- Visible to branch and warehouse profiles only; purchasing never sees this menu.
create table if not exists public.ss_backorders (
  id                uuid primary key default gen_random_uuid(),
  sku               text,                                  -- SKU
  product_name      text,                                  -- ชื่อสินค้า
  branch            text not null check (branch in ('SRC', 'KKL', 'SSS')),
  customer_name     text,                                  -- ชื่อลูกค้า
  paid_date         date,                                  -- วันที่ลูกค้าชำระ
  sale_bill_no      text,                                  -- เลขที่บิล
  pickup_date       date,                                  -- วันที่นัดรับ
  note              text,                                  -- หมายเหตุ
  outbound_date     date,                                  -- Outbound วันที่ส่งของ (คลังกรอก)
  arrived_branch    text not null default 'ยังไม่ถึง',      -- ของถึงสาขา
  customer_notified text not null default 'ยังไม่แจ้ง',     -- แจ้งลูกค้า
  delivered         text not null default 'ยังไม่ส่งมอบ',   -- ส่งมอบสินค้า
  created_at        timestamptz not null default now()
);

create index if not exists ss_backorders_branch_created_idx
  on public.ss_backorders (branch, created_at desc);

alter table public.ss_backorders enable row level security;
drop policy if exists "anon all ss_backorders" on public.ss_backorders;
create policy "anon all ss_backorders"
  on public.ss_backorders
  for all
  using (true)
  with check (true);

notify pgrst, 'reload schema';
