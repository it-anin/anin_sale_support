-- สร้างตาราง stock สำหรับเช็คสต๊อค
CREATE TABLE IF NOT EXISTS stock (
  id          bigserial   PRIMARY KEY,
  branch      text        NOT NULL,
  sku         text        NOT NULL,
  name        text,
  qty         text,
  unit        text,
  price       text,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

-- เปิด RLS
ALTER TABLE stock ENABLE ROW LEVEL SECURITY;

-- อนุญาต read สาธารณะ (anon อ่านได้)
CREATE POLICY "public read stock" ON stock FOR SELECT USING (true);

-- ❌ ไม่เปิด public write — การอัพโหลดทำผ่าน service_role key ใน upload-stock.mjs เท่านั้น
-- (service_role bypass RLS ไม่ต้องมี write policy)
