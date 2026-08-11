-- ============================================================
-- Product Category — หมวดสินค้า 1-9 จากไฟล์ Location (คอลัมน์ F) แยกตามสาขา
-- ใช้กับ: ปุ่ม "เลือกตามหมวด" หน้าป้ายราคา + ปุ่ม "อัปโหลดไฟล์ Location" ในเมนูนั้น
-- วิธีใช้: Supabase Dashboard → SQL Editor → วางทั้งไฟล์ → Run (รันซ้ำได้ ไม่ลบข้อมูล)
--
-- ⚠️ ไฟล์นี้มี migration ในตัว — ถ้าเคยรันเวอร์ชันแรก (PK = sku เดี่ยว ไม่มี branch)
--    รันไฟล์นี้ทับได้เลย ระบบจะเพิ่มคอลัมน์ branch และเปลี่ยน PK ให้เอง
-- ============================================================

CREATE TABLE IF NOT EXISTS product_category (
  sku           text        NOT NULL,
  branch        text        NOT NULL,   -- SRC / KKL / SSS เท่านั้น (สาขาหน้าร้าน)
                                        -- ไม่มี 'คลังสินค้า' — คลังไม่ได้ติดป้ายราคาที่ชั้นวาง
                                        -- จึงเป็นชุดที่สั้นกว่า stock.branch ที่มี 4 สาขา
  category_no   smallint    NOT NULL CHECK (category_no BETWEEN 1 AND 9),
  category_name text,        -- ข้อความดิบจากไฟล์ (ดูเฉย ๆ ไม่ใช้เป็น key)
  location      text,        -- ตำแหน่งชั้นวาง คอลัมน์ A ของไฟล์ Location (เช่น A14 / 1A12)
  uploaded_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (sku, branch)
);

-- migration: ตารางที่สร้างก่อนมีคอลัมน์นี้
ALTER TABLE product_category ADD COLUMN IF NOT EXISTS location text;

-- ── migration จากเวอร์ชันแรก (PK = sku เดี่ยว ไม่มี branch) ──
-- ข้อมูลเวอร์ชันแรกไม่มีสาขากำกับ จึงระบุไม่ได้ว่าเป็นของสาขาไหน
-- ใส่ '(legacy)' เป็นหมุดหมายไว้ให้ SET NOT NULL ผ่าน แล้วอัปโหลดไฟล์สาขาทับใหม่
-- (ไม่ใช้ 'คลังสินค้า' แล้ว เพราะตัดคลังออกจากฟีเจอร์นี้ไปแล้ว)
-- บน DB ปัจจุบันเป็น no-op — branch เป็น NOT NULL มีค่าครบทุกแถวอยู่แล้ว
ALTER TABLE product_category ADD COLUMN IF NOT EXISTS branch text;
UPDATE product_category SET branch = '(legacy)' WHERE branch IS NULL;
ALTER TABLE product_category ALTER COLUMN branch SET NOT NULL;

DO $$
BEGIN
  -- ถ้า PK ยังเป็นคอลัมน์เดียว (sku) → เปลี่ยนเป็น (sku, branch)
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'product_category'::regclass
      AND contype  = 'p'
      AND array_length(conkey, 1) = 1
  ) THEN
    ALTER TABLE product_category DROP CONSTRAINT product_category_pkey;
    ALTER TABLE product_category ADD PRIMARY KEY (sku, branch);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS product_category_no_idx     ON product_category (branch, category_no);
-- products.sku ไม่มี index มาก่อน — จำเป็นสำหรับ join ใน view ข้างล่าง
CREATE INDEX IF NOT EXISTS products_sku_idx            ON products (sku);

-- ── ตัวคูณหน่วย (คอลัมน์ H = CF_BASEMULTIPLE ในไฟล์ R05.106) ──
-- 1 = หน่วยเล็กสุด (base) · >1 = หน่วยใหญ่ที่บรรจุหลายหน่วยเล็ก เช่น กล่อง = 10 แผง
-- ใช้กรองในหน้า "เลือกตามหมวด" ให้เหลือป้ายเดียวต่อ SKU
-- ⚠️ เก็บทุกแถวไว้ในตาราง ไม่กรองตอนอัปโหลด — ไม่งั้นสแกนบาร์โค้ดกล่องจะค้นหาไม่เจอ
ALTER TABLE products ADD COLUMN IF NOT EXISTS base_multiple numeric;

-- ============================================================
-- RLS
-- ============================================================
-- ต่างจาก stock / customer_history ตรงที่ตารางนี้ "เว็บเป็นคนเขียนเอง" ด้วย anon key
-- (ไม่ได้อัปโหลดผ่าน .mjs + service_role) ถ้าไม่เปิด write policy ปุ่มอัปโหลดจะ 403 เงียบ ๆ
-- ข้อมูลนี้ (SKU → เลขหมวด) อ่อนไหวน้อยกว่าตาราง products ที่เปิด "public write" อยู่แล้วพร้อมราคา
-- pattern เดียวกับ app_page_settings / ss_*
ALTER TABLE product_category ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public read product category" ON product_category;
CREATE POLICY "public read product category" ON product_category
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "public write product category" ON product_category;
CREATE POLICY "public write product category" ON product_category
  FOR ALL USING (true) WITH CHECK (true);

-- ============================================================
-- Views
-- ============================================================
-- ⚠️ ถ้า Supabase เป็น PostgreSQL 14 หรือเก่ากว่า `WITH (security_invoker = true)` จะ error
--    → ลบ clause นั้นออกได้เลย (ทั้ง products และ product_category เป็น SELECT USING (true) อยู่แล้ว)

-- ไม่ทำ FOREIGN KEY ไป products(sku) โดยตั้งใจ:
--   1) products.sku ไม่ unique (7,907 unique จาก 10,843 แถว) → เป็น FK target ไม่ได้
--   2) handleFileUpload ใน App.tsx ลบ products ทั้งตารางทุกครั้งที่อัปโหลด CSV สินค้า
--      ถ้ามี FK จะพังหรือ cascade ลบหมวดทิ้ง
-- INNER JOIN ข้างล่างซ่อน SKU กำพร้าให้อยู่แล้ว
DROP VIEW IF EXISTS public.v_product_category_counts;
DROP VIEW IF EXISTS public.v_products_by_category;

-- กรองเหลือเฉพาะหน่วยเล็กสุด (base_multiple = 1) → 1 ป้ายต่อ SKU
--   ก่อนกรอง 10,761 คู่ sku-unit → หลังกรอง 7,905 คู่ (= จำนวน SKU พอดี) ไม่มี SKU ไหนหาย
-- COALESCE: แถวที่อัปโหลดก่อนมีคอลัมน์นี้จะเป็น NULL → ถือว่าเป็นหน่วยเล็กสุดไว้ก่อน
--   (พฤติกรรมเท่าเดิม) ตัวกรองจะเริ่มทำงานจริงหลังอัปโหลด R05.106 รอบใหม่
CREATE VIEW public.v_products_by_category
WITH (security_invoker = true) AS
SELECT p.id, p.barcode, p.sku, p.name, p.unit, p.price,
       c.branch, c.category_no, c.category_name, c.location
FROM products p
JOIN product_category c ON c.sku = p.sku
WHERE COALESCE(p.base_multiple, 1) = 1;

GRANT SELECT ON public.v_products_by_category TO anon, authenticated;

-- นับจำนวนแถวต่อสาขา+หมวด → badge ทุกสาขาทุกหมวดในคำขอเดียว (สูงสุด 4×9 = 36 แถว)
CREATE VIEW public.v_product_category_counts
WITH (security_invoker = true) AS
SELECT branch, category_no, count(*)::int AS product_rows
FROM public.v_products_by_category
GROUP BY branch, category_no;

GRANT SELECT ON public.v_product_category_counts TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- ตรวจสอบหลังอัปโหลดไฟล์ Location
-- ============================================================
-- SELECT branch, count(*) FROM product_category GROUP BY branch ORDER BY branch;
-- SELECT branch, category_no, product_rows FROM v_product_category_counts ORDER BY branch, category_no;
