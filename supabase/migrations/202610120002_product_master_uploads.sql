-- ประวัติการอัปโหลด Product Master (ปุ่ม 📤 อัปโหลด Product Master เมนู Products หน้า Sale Support)
-- ปฏิทิน "อัปโหลดล่าสุด" ในแถบเครื่องมือเมนู Products อ่านแถวล่าสุดของตารางนี้
-- (ดีไซน์ "Calendar Tile" แบบที่ 8 จาก public/product-master-timestamp-designs.html)
--
-- ทำไมต้องมีตารางใหม่: product_master ไม่มีเวลาอัปเดต — created_at ขยับเฉพาะตอนมี SKU ใหม่
-- อัปโหลดทับ SKU เดิมไม่เปลี่ยนอะไรที่บอกเวลาได้เลย
--
-- เว็บ insert 1 แถวต่อการอัปโหลดที่ "สำเร็จครบทุกก้อน" (confirmMasterUpload) — พังกลางทางไม่บันทึก
-- จำนวนต่าง ๆ มาจากหน้าสรุปการเปลี่ยนแปลงที่คำนวณไว้แล้วก่อนกดยืนยัน
--
-- สิทธิ์: อ่าน + เพิ่มเท่านั้น (append-only) ไม่มี update/delete จากเว็บ — เป็นประวัติ ไม่ควรแก้ย้อนหลังได้
-- ⚠️ รันก่อนหรือหลัง deploy frontend ก็ได้: ถ้ายังไม่มีตาราง เว็บซ่อนปฏิทินไปเฉย ๆ และอัปโหลดยังทำงานปกติ
--    (ขึ้นคำเตือนว่าบันทึกเวลาไม่สำเร็จ) — ไม่มี query ไหนพังทั้งก้อน

create table if not exists public.product_master_uploads (
  id              uuid primary key default gen_random_uuid(),
  uploaded_at     timestamptz not null default now(),   -- เวลาฝั่ง server ไม่เชื่อนาฬิกาเครื่องผู้ใช้
  uploader        text,      -- ชื่อที่ผู้ใช้เห็นตอนอัปโหลด เช่น 'จัดซื้อ' / 'คลังสินค้า' / 'SRC'
  file_name       text,
  sku_count       integer,   -- SKU ในไฟล์ (หลังตัดแถวไม่มี SKU / SKU ซ้ำ)
  new_count       integer,
  changed_count   integer,   -- จำนวน SKU ที่มีอย่างน้อย 1 ช่องเปลี่ยน
  unchanged_count integer,
  cleared_count   integer    -- จำนวน "ช่อง" ที่ถูกล้างเป็นค่าว่างเพราะไฟล์เว้นว่าง
);

create index if not exists product_master_uploads_uploaded_at_idx
  on public.product_master_uploads (uploaded_at desc);

alter table public.product_master_uploads enable row level security;
drop policy if exists "anon read product_master_uploads" on public.product_master_uploads;
create policy "anon read product_master_uploads" on public.product_master_uploads
  for select using (true);
drop policy if exists "anon insert product_master_uploads" on public.product_master_uploads;
create policy "anon insert product_master_uploads" on public.product_master_uploads
  for insert with check (true);
grant select, insert on public.product_master_uploads to anon, authenticated;

comment on table public.product_master_uploads is
  'ประวัติการอัปโหลด Product Master จากหน้าเว็บ (1 แถว/ครั้งที่สำเร็จ) — ปฏิทิน "อัปโหลดล่าสุด" เมนู Products อ่านแถวล่าสุด';

notify pgrst, 'reload schema';
