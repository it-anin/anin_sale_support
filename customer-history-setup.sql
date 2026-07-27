-- สร้างตาราง customer_history ใน Supabase
-- 2026-07: schema ใหม่ — เพิ่ม purchase_date (วันที่ซื้อ) ก่อนคอลัมน์ phone
-- รันทั้งไฟล์นี้ใน Supabase Dashboard -> SQL Editor ก่อนอัพโหลดไฟล์ CSV รูปแบบใหม่
DROP TABLE IF EXISTS customer_history;

CREATE TABLE customer_history (
  id            bigserial PRIMARY KEY,
  purchase_date timestamp,
  phone         text,
  first_name    text,
  last_name     text,
  sku           text,
  product_name  text,
  uploaded_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE customer_history ENABLE ROW LEVEL SECURITY;

-- อนุญาต read สาธารณะ (anon อ่านได้)
CREATE POLICY "public read customer_history" ON customer_history FOR SELECT USING (true);

-- ❌ ไม่เปิด public write — มี PII (เบอร์โทร/ชื่อลูกค้า)
-- การอัพโหลดทำผ่าน service_role key ใน upload-customer-history.mjs เท่านั้น
-- (service_role bypass RLS ไม่ต้องมี write policy)
