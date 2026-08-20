-- ยกเลิก BackOrder พร้อมสาเหตุ — สำหรับเคสที่สั่งสินค้าไม่ได้ (เลิกผลิต/ของขาด/อื่นๆ)
--
-- เติมช่องว่างที่หน้าจอฝั่งจัดซื้อบอกไว้อยู่แล้วแต่ทำไม่ได้จริง:
--   "สินค้าสั่งไม่ได้/เลิกผลิต/อื่นๆ แจ้งสาขาให้กดยกเลิกพร้อมลงรายละเอียดเพื่อยืนยันข้อมูล"
-- จัดซื้อถูกสั่งให้บอกสาขา "กดยกเลิก" มาตลอด ทั้งที่ไม่เคยมีทั้งปุ่มและคอลัมน์
--
-- 🚨 ทำไมต้องเป็นคอลัมน์แยก ห้ามเขียนคำว่า "ยกเลิก" ทับลง arrived_branch/customer_notified/delivered
--    1. ผู้ใช้ต้องกด "ยกเลิกสถานะนี้" เพื่อกลับมาทำต่อได้ — ถ้าทับค่าเดิม ตราที่เคยประทับไว้หายถาวร
--    2. trigger ss_track_order_workflow_completion ตัดสิน "จบงาน" ด้วย pattern `like '%แล้ว%'`
--       ตอนนี้ผูกกับ ss_orders เท่านั้น แต่ถ้าวันหลังมีคนขยายมาที่ ss_backorders
--       ค่าที่มีคำว่า "แล้ว" ปนจะถูกนับเป็นจบงานทันที
--
-- ⚠️ cancelled_at เป็น null = ยังไม่ยกเลิก (ฝั่งเว็บใช้ `!!row.cancelled_at` ตัดสิน)
--    เก็บเป็น timestamptz ไม่ใช่ boolean เพื่อให้ได้เวลาที่ยกเลิกมาแสดงผลฟรีในตัวเดียวกัน
--
-- ⚠️ ต้องรัน migration นี้ "ก่อน" deploy frontend — อ่านตารางยังปกติเพราะ query เป็น select('*')
--    แต่กดปุ่มยกเลิกจะเด้ง "column ss_backorders.cancelled_at does not exist" ให้เห็นบนหน้าจอ
--
-- ไม่มี CHECK เพราะ 3 คอลัมน์สถานะเดิมของตารางนี้ก็เป็น text เปล่าไม่มี CHECK เช่นกัน

alter table public.ss_backorders add column if not exists cancelled_at timestamptz;
alter table public.ss_backorders add column if not exists cancel_reason text;

comment on column public.ss_backorders.cancelled_at is
  'เวลาที่สาขากดยกเลิกรายการค้างส่ง (สั่งของไม่ได้) — null = ยังไม่ยกเลิก · ยกเลิกแล้วตรา 3 ขั้นและฟอร์มคลังถูกล็อก';
comment on column public.ss_backorders.cancel_reason is
  'สาเหตุที่ยกเลิก — บังคับกรอกที่ฟอร์ม (คอลัมน์ยัง nullable เพราะแถวเก่าก่อน migration นี้ไม่มีค่า)';

notify pgrst, 'reload schema';
