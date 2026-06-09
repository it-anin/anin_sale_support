-- ════════════════════════════════════════════════════════════════
-- lock-rls-readonly.sql
-- ตัด public write ของ stock + customer_history ให้ anon อ่านได้อย่างเดียว
-- การเขียน (upload) ทำผ่าน service_role key ในสคริปต์ Node เท่านั้น
--
-- ⚠️ ลำดับสำคัญ — ทำตามนี้เพื่อไม่ให้ upload พัง:
--   1. เอา service_role key มาจาก Supabase Dashboard → Settings → API → service_role
--   2. ใส่ใน .env ของทุกเครื่อง (Arm + BigYa-spare):  SUPABASE_SERVICE_KEY=eyJ...
--   3. ทดสอบรัน  node upload-stock.mjs  ให้ผ่านก่อน (service_role ทำงานได้แม้ยังไม่ลบ policy)
--   4. ค่อยรัน SQL นี้ใน Supabase SQL Editor
-- ════════════════════════════════════════════════════════════════

-- stock: ลบ write policy เหลือแค่ read
DROP POLICY IF EXISTS "public write stock" ON stock;

-- customer_history: ลบ write policy เหลือแค่ read (มี PII — เบอร์โทร/ชื่อลูกค้า)
DROP POLICY IF EXISTS "public write customer_history" ON customer_history;

-- ตรวจสอบ policy ที่เหลือ
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE tablename IN ('stock', 'customer_history', 'products')
ORDER BY tablename, policyname;

-- ── หมายเหตุ ──────────────────────────────────────────────────────
-- products ยังคง "public write" ไว้ เพราะหน้าเว็บ admin อัพโหลดผ่าน anon key
-- ความเสี่ยงที่เหลือ: ใครมี anon key (public) ยังเขียน/ลบ products ได้
-- ถ้าต้องการปิดช่องนี้ในอนาคต ต้องย้าย products upload ไปเป็น Node script
-- (service_role) หรือ Edge Function แล้วค่อยรัน:
--   DROP POLICY IF EXISTS "public write" ON products;
