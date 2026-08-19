-- เปิดเมนู BackOrder ให้ Sale Admin ลงรายการได้ (กลับมติเดิมของ 202608190001 ที่กันไว้)
--
-- 202608190001 จงใจไม่แตะ `ss_backorders.branch` เพราะตอนนั้นตกลงกันว่า Sale Admin ไม่ใช้เมนูนี้
-- ผู้ใช้ขอเปิดเพิ่มภายหลัง เพื่อใช้ BackOrder เป็นช่องทางแจ้งข้อมูลให้จัดซื้อและคลังรับทราบ
--
-- ⚠️ ตารางนี้ **ไม่เคยมีคู่ drop/add constraint มาก่อนเลยทั้ง repo** — CHECK เขียนเป็น inline
--    ในคำสั่ง `create table if not exists` ที่ salesupport-setup.sql:265 และ 202608140001:7 เท่านั้น
--    ซึ่งแปลว่า DB ที่สร้างไปแล้ว **รันไฟล์ setup ซ้ำกี่รอบก็ไม่อัปเดต CHECK** (if not exists ข้ามทั้งบล็อก)
--    ไฟล์นี้จึงต้องเขียนคู่ drop/add ขึ้นมาใหม่เอง — ชื่อที่ Postgres ตั้งให้อัตโนมัติคือ
--    `ss_backorders_branch_check` (pattern: <table>_<column>_check)
--
-- ⚠️ ต้องรัน migration นี้ "ก่อน" deploy frontend ที่เปิดเมนู BackOrder ให้ Sale Admin
--    แต่รอบนี้พังแบบ **เห็น error** ไม่ใช่เงียบเหมือน 202608190001: Sale Admin จะกรอกฟอร์มได้
--    แล้วกดบันทึกเด้ง "บันทึกไม่สำเร็จ: new row violates check constraint" ให้เห็นบนหน้าจอ

-- ── 1. ขยาย CHECK ของ ss_backorders.branch ──
alter table public.ss_backorders
  drop constraint if exists ss_backorders_branch_check;
alter table public.ss_backorders
  add constraint ss_backorders_branch_check
  check (branch in ('SRC', 'KKL', 'SSS', 'SALE_ADMIN'));

comment on column public.ss_backorders.branch is
  'ผู้ลงรายการ — SRC/KKL/SSS = สาขาหน้าร้าน, SALE_ADMIN = Sale Admin (เพิ่ม 2569-08-19) · ไม่มี Warehouse เพราะคลังเป็นผู้รับงาน ไม่ใช่ผู้ขอ';

-- ── 2. สิ่งที่ "ไม่ต้องแตะ" ในรอบนี้ ──
--  · ss_branch_notification_events.branch / .actor_code และ ss_branch_notifications.branch
--    — 202608190001 เพิ่ม 'SALE_ADMIN' ครบทั้งฝั่งผู้รับและผู้กระทำไปแล้ว
--  · RPC ss_create_branch_notifications / ss_mark_branch_notifications_read
--    — filter ทั้ง 4 จุดรับ 'SALE_ADMIN' อยู่แล้วจาก 202608190001
--    (การเปิดให้ "จัดซื้อรับแจ้งเตือน BackOrder" เป็นการแก้ฝั่งเว็บล้วน ๆ — เดิม frontend ครอบ
--     notifyPurchasingUpdate ด้วย `if (selectedOrderTable === 'ss_orders')` ไม่ใช่ข้อจำกัดของ DB
--     ตาราง/RPC ไม่เคยรู้จักคำว่า BackOrder อยู่แล้ว รับแค่รหัสผู้รับกับ record_id)
--  · outbound_requests.branch — CHECK ยังเป็น ('SRC','KKL','SSS') Sale Admin ยังไม่ใช้หน้าเบิกด่วน
--  · retention ของ ss_orders — ไม่เกี่ยวกับ ss_backorders (ตารางนี้ไม่มี workflow_completed_at)
--  · RLS policy — ทั้งแอปใช้ anon key เดียว คุมสิทธิ์ฝั่ง UI

notify pgrst, 'reload schema';
