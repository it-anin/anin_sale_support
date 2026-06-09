-- สร้างตาราง customer_history ใน Supabase
CREATE TABLE IF NOT EXISTS customer_history (
  id           bigserial PRIMARY KEY,
  first_name   text,
  last_name    text,
  sku          text,
  product_name text,
  uploaded_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE customer_history ENABLE ROW LEVEL SECURITY;

-- อนุญาต read สาธารณะ (anon อ่านได้)
CREATE POLICY "public read customer_history" ON customer_history FOR SELECT USING (true);

-- ❌ ไม่เปิด public write — มี PII (เบอร์โทร/ชื่อลูกค้า)
-- การอัพโหลดทำผ่าน service_role key ใน upload-customer-history.mjs เท่านั้น
-- (service_role bypass RLS ไม่ต้องมี write policy)
