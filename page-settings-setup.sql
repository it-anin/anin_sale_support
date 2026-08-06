-- ============================================================
-- Page Settings — เปิด/ปิดปุ่มนำทางแต่ละหน้า (ควบคุมด้วยรหัส admin)
-- ใช้กับ: ปุ่มเฟือง ⚙️ ในแถบผู้ใช้ → ใส่ VITE_ADMIN_PASSWORD → toggle 6 หน้า
-- วิธีใช้: เปิด Supabase Dashboard → SQL Editor → วางทั้งไฟล์ → Run
-- ============================================================

create table if not exists app_page_settings (
  page_id     text primary key,          -- 'pricetag' | 'druglabel' | 'stockcheck' | 'customerhistory' | 'outbound' | 'salesupport'
  visible     boolean not null default true,
  updated_at  timestamptz default now()
);

alter table app_page_settings enable row level security;

-- อ่านได้ทุกคน (anon) — ทุกเครื่องต้องรู้ว่าจะแสดงปุ่มไหน
drop policy if exists "public read page settings" on app_page_settings;
create policy "public read page settings" on app_page_settings
  for select using (true);

-- เขียนได้ทุกคน (anon) — gate จริงคือรหัส admin ฝั่ง client (เหมือน pattern products/ss_*)
drop policy if exists "public write page settings" on app_page_settings;
create policy "public write page settings" on app_page_settings
  for all using (true) with check (true);

-- seed 6 หน้า (เปิดทั้งหมดเป็นค่าเริ่มต้น) — ไม่ทับค่าที่ตั้งไว้แล้ว
insert into app_page_settings (page_id, visible) values
  ('pricetag', true),
  ('druglabel', true),
  ('stockcheck', true),
  ('customerhistory', true),
  ('outbound', true),
  ('salesupport', true)
on conflict (page_id) do nothing;

notify pgrst, 'reload schema';
