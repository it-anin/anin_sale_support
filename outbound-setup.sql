-- สร้างตาราง outbound_requests สำหรับหน้า Quick Outbound (เบิกด่วน)
-- แชร์ข้อมูลข้ามเครื่อง/โปรไฟล์ผ่าน Supabase แทน localStorage เดิม
-- แก้บั๊ก 2569-08-18: สาขาลงข้อมูลแล้วคลังสินค้า/จัดซื้อไม่เห็น เพราะของเดิมเก็บใน
-- localStorage ของเบราว์เซอร์เท่านั้น ไม่เคยเขียนลง Supabase เลย

CREATE TABLE IF NOT EXISTS outbound_requests (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  branch        text        NOT NULL CHECK (branch IN ('SRC', 'KKL', 'SSS')),
  sku           text,
  barcode       text,
  name          text,
  unit          text,
  not_found     boolean     NOT NULL DEFAULT false,
  qty           numeric,
  request_date  date,
  document_no   text,
  location      text,
  entered_at    timestamptz NOT NULL DEFAULT now(),
  requested     boolean     NOT NULL DEFAULT false,
  requested_at  timestamptz,
  approved      boolean     NOT NULL DEFAULT false,
  approved_at   timestamptz,
  out_of_stock  boolean     NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_outbound_requests_branch ON outbound_requests (branch);

-- เปิด RLS + policy แบบเดียวกับตารางปฏิบัติการอื่นในแอปนี้ (products / product_category / ss_*)
-- ทั้งแอปใช้ anon key เดียวกันหมด คุมสิทธิ์ที่ฝั่ง UI ด้วยรหัส/โปรไฟล์ ไม่ได้แยก RLS ตาม role จริง
ALTER TABLE outbound_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public read outbound requests" ON outbound_requests;
CREATE POLICY "public read outbound requests" ON outbound_requests
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "public write outbound requests" ON outbound_requests;
CREATE POLICY "public write outbound requests" ON outbound_requests
  FOR ALL USING (true) WITH CHECK (true);

-- ให้แถวที่เปลี่ยนแปลงยิง realtime event ไปทุกโปรไฟล์ที่เปิดหน้านี้อยู่ (ไม่ต้อง refresh เอง)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'outbound_requests'
     ) then
    alter publication supabase_realtime add table public.outbound_requests;
  end if;
end $$;

notify pgrst, 'reload schema';
