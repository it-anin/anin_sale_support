-- แจ้งจัดซื้อ/คลังสินค้า — สาขาเลือกตอนสร้าง BackOrder ว่าต้องการให้จัดซื้อสั่งของให้
-- หรือรอของจากคลังอย่างเดียว ค่านี้ตัดสินว่า saveBackOrder() จะยิง notifyPurchasingUpdate
-- หรือไม่ (notifyWarehouseUpdate ยิงเสมอไม่มีเงื่อนไข ไม่เกี่ยวกับคอลัมน์นี้)
--
-- ⚠️ ไม่มี default โดยตั้งใจ — ฟอร์ม Add BackOrder บังคับให้เลือกก่อนบันทึกเสมอ
--    (ไม่ใช่ dropdown ที่ default เป็นตัวเลือกแรกแบบฟิลด์อื่นในฟอร์มเดียวกัน)
--    แถวเก่าก่อน migration นี้จึงเป็น null ไปตลอด — ไม่ backfill เพราะไม่รู้ว่าตอนนั้นตั้งใจแจ้งใคร
alter table public.ss_backorders add column if not exists notify_target text
  check (notify_target in ('PURCHASING', 'WAREHOUSE'));

comment on column public.ss_backorders.notify_target is
  'PURCHASING = สาขาต้องการให้จัดซื้อสั่งสินค้าให้ (แจ้งเตือนจัดซื้อ) · WAREHOUSE = รอของจากคลังอย่างเดียว (ไม่แจ้งจัดซื้อ) · null = แถวเก่าก่อนมีฟีเจอร์นี้';

notify pgrst, 'reload schema';
