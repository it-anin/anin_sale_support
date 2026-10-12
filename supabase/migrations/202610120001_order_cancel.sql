-- ยกเลิก Order พร้อมสาเหตุ — ปุ่ม "ยกเลิก" ใน popup รายละเอียด Order แบบเดียวกับ BackOrder
-- (ของ BackOrder อยู่ที่ migration 202608200001_backorder_cancel.sql — คอลัมน์ชื่อ/ความหมายเดียวกันเป๊ะ
--  ฝั่งเว็บจึงใช้โค้ดชุดเดียวกับทั้ง 2 ตาราง)
--
-- กดได้เฉพาะสาขาหน้าร้าน SRC/KKL/SSS (ไม่รวม Sale Admin) — คุมสิทธิ์ที่หน้าเว็บ (ORDER_CANCEL_BRANCHES)
-- ไม่ใช่ที่ DB เหมือนตาราง ss_* อื่น ๆ ที่ RLS เป็น anon `for all`
--
-- 🚨 ทำไมต้องเป็นคอลัมน์แยก ห้ามเขียนคำว่า "ยกเลิก" ทับลง arrived_branch/customer_notified/delivered
--    1. สาขาต้องกด "ยกเลิก" ซ้ำเพื่อคืนสถานะได้ — ถ้าทับค่าเดิม ตราที่เคยประทับไว้หายถาวร
--    2. trigger ss_track_order_workflow_completion + ss_delete_expired_completed_orders() ตัดสิน "จบงาน"
--       ด้วย pattern `like '%แล้ว%'` — ถ้าเขียน "ยกเลิกแล้ว" ครบ 3 ช่อง Order จะถูกนับว่าจบงาน
--       แล้วโดนงาน cron ลบทิ้งหลัง 1 เดือน
--
-- ⚠️ Order ที่ยกเลิกแล้ว "ไม่ถูกลบอัตโนมัติ" — งานลบรายเดือนลบเฉพาะใบที่ครบ 3 ตรา ใบที่ยกเลิกกลางทาง
--    จึงค้างอยู่ตลอดเหมือน Order ที่ยังไม่จบทั่วไป (migration นี้จงใจไม่แตะนโยบายลบ)
--
-- ⚠️ cancelled_at เป็น null = ยังไม่ยกเลิก (ฝั่งเว็บใช้ `!!row.cancelled_at` ตัดสิน)
--    เก็บเป็น timestamptz ไม่ใช่ boolean เพื่อให้ได้เวลาที่ยกเลิกมาแสดงผลฟรีในตัวเดียวกัน
--
-- 🚨 ต้องรัน migration นี้ "ก่อน" deploy frontend — ตัวนับเมนูย่อย 3 ขั้นใต้ปุ่ม Order select
--    `cancelled_at` ตรง ๆ ถ้ายังไม่มีคอลัมน์ query พังทั้งก้อน แล้วเมนูย่อยหายเงียบ ๆ
--    (ต่างจาก BackOrder ที่ก่อน migration แค่กดปุ่มยกเลิกไม่ผ่าน)

alter table public.ss_orders add column if not exists cancelled_at timestamptz;
alter table public.ss_orders add column if not exists cancel_reason text;

comment on column public.ss_orders.cancelled_at is
  'เวลาที่สาขา (SRC/KKL/SSS) กดยกเลิก Order — null = ยังไม่ยกเลิก · ยกเลิกแล้วตรา 3 ขั้น ฟอร์มคลัง และฟอร์มจัดซื้อถูกล็อก';
comment on column public.ss_orders.cancel_reason is
  'สาเหตุที่ยกเลิก — บังคับกรอกที่ฟอร์ม (คอลัมน์ยัง nullable เพราะแถวเก่าก่อน migration นี้ไม่มีค่า)';

notify pgrst, 'reload schema';
