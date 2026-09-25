-- ปุ่มอัปโหลด R05.106 ด่วนจากหน้าป้ายราคา (2569-09-25) — ใช้ตอนราคาเปลี่ยนเร่งด่วน
-- ไม่รอบอทรอบ 08:30 ของ repo it-anin/botr05106
--
-- ทำไมต้องเป็น RPC ตัวใหม่: เว็บมีแค่ anon key แต่ swap_products_from_import()
-- (นิยามใน products-import-swap.sql ของ repo บอท) grant ให้ service_role เท่านั้น
-- และ products_import เปิด RLS แบบไม่มี policy — anon เขียนตารางพักไม่ได้
--
-- ⚠️ ตั้งใจ "เรียก swap ตัวเดิม" ไม่เขียน delete/insert เอง — จะได้มีทางเขียน products
--    ทางเดียวในโลก และ log_price_changes() (แจ้งเตือนราคาเปลี่ยน) ทำงานเหมือนรอบบอททุกอย่าง
--    ถ้าเว็บ delete-all → insert เองแบบสมัยก่อน การอัปโหลดด่วนจะไม่ขึ้นแจ้งเตือนเลย
--    ซึ่งเป็นรอบที่ต้องการแจ้งเตือนที่สุด
--
-- ทั้ง function = 1 transaction (staging + swap) → พังตรงไหน rollback หมด products ไม่มีทางว่าง
-- anon statement_timeout ของ Supabase คือ 3 วิ — ถ้าเกิน Postgres ยกเลิกทั้งก้อน ข้อมูลเดิมอยู่ครบ

-- ── เวลาเขียนแถวพัก: ใช้แยก "บอทกำลังอัปโหลดอยู่" ออกจาก "แถวค้างจากรอบที่ swap ล้ม" ──
-- เพิ่มคอลัมน์ก่อนแล้วค่อยตั้ง default — แถวค้างเดิม (ถ้ามี) จะได้ NULL = ถือว่าค้าง ไม่ใช่ "เพิ่งเขียน"
-- (ถ้า add column ... default now() ทีเดียว แถวเก่าจะได้เวลาตอน migrate แล้วบล็อกเว็บไป 15 นาที)
-- บอทไม่ได้ส่งคอลัมน์นี้ → ได้ now() อัตโนมัติ · swap select คอลัมน์ระบุชื่อ จึงไม่กระทบ
alter table public.products_import add column if not exists created_at timestamptz;
alter table public.products_import alter column created_at set default now();

create or replace function public.upload_products_from_web(p_rows jsonb, p_force boolean default false)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n        integer;
  existing integer;
  swapped  integer;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'ข้อมูลที่ส่งมาไม่ใช่รายการสินค้า';
  end if;

  -- กันชนกับบอท: บอทเขียน staging ทีละ chunk (คนละ transaction) แล้วค่อยเรียก swap
  -- exclusive lock บล็อก insert/delete ของบอทจนกว่าเว็บจะ commit
  lock table public.products_import in exclusive mode;

  -- มีแถวพักที่เพิ่งเขียน = บอทอยู่กลางรอบ — ถ้าล้างทิ้ง บอทจะ insert chunk ที่เหลือ
  -- แล้ว swap ด้วยข้อมูลครึ่งเดียว products หายไปครึ่งตาราง
  -- แถวเก่ากว่า 15 นาที = ค้างจากรอบที่ swap ล้ม ล้างทิ้งได้ (บอทเองก็ล้างตอนเริ่มรอบ)
  if exists (
    select 1 from public.products_import
    where created_at > now() - interval '15 minutes'
  ) then
    raise exception 'บอทกำลังอัปโหลด R05.106 อยู่ — รอสักครู่แล้วลองใหม่ (ยังไม่ได้แตะข้อมูลเดิม)';
  end if;

  -- ⚠️ ต้องมี WHERE — safeupdate ปฏิเสธ DELETE ที่ไม่มี WHERE
  delete from public.products_import where id is not null;

  insert into public.products_import (barcode, sku, name, unit, price, category, base_multiple)
  select trim(r.barcode), trim(r.sku), r.name, r.unit, coalesce(r.price, 0),
         coalesce(nullif(trim(r.category), ''), 'ทั่วไป'), r.base_multiple
  from jsonb_to_recordset(p_rows) as r(
    barcode text, sku text, name text, unit text,
    price numeric, category text, base_multiple numeric
  )
  where coalesce(trim(r.barcode), '') <> '' and coalesce(trim(r.sku), '') <> '';

  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'ไม่พบแถวที่มีทั้งบาร์โค้ดและ SKU';
  end if;

  -- ด่านเดียวกับ shrinkTooMuch() ของบอท — หน้าเว็บ confirm กับผู้ใช้แล้วถึงส่ง p_force มา
  -- แต่บังคับซ้ำที่นี่ด้วย กันคนเรียก RPC ตรง ๆ โดยไม่ผ่านหน้าเว็บ
  select count(*) into existing from public.products;
  if not p_force and existing > 0 and 1 - n::numeric / existing > 0.2 then
    -- ต่อ '%' เข้ากับตัวเลขเอง — ใน RAISE `%%` คือ % ตัวอักษร `%%%` จะออกมาเป็น "%25" กลับด้าน
    raise exception 'ไฟล์นี้น้อยกว่าข้อมูลเดิม % (เดิม % → ใหม่ %) — ยกเลิกไว้ก่อน',
      round((1 - n::numeric / existing) * 100)::text || '%', existing, n;
  end if;

  swapped := public.swap_products_from_import();
  return swapped;
end;
$$;

-- ⚠️ เปิดให้ anon โดยตั้งใจ — products เองก็ยัง public write อยู่ (anon ลบทั้งตารางได้อยู่แล้ว)
--    RPC นี้จึงไม่ได้เปิดช่องใหม่ แต่ปลอดภัยกว่าเขียนตรง เพราะมี swap ใน transaction เดียว
--    + ด่านไฟล์หด + ด่านชนบอท · swap_products_from_import เองยังเป็น service_role เท่านั้นเหมือนเดิม
revoke all on function public.upload_products_from_web(jsonb, boolean) from public;
grant execute on function public.upload_products_from_web(jsonb, boolean) to anon, authenticated;

notify pgrst, 'reload schema';
