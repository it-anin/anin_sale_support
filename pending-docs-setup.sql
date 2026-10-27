-- ============================================================
-- หน้า "ตรวจสอบเอกสารค้าง" (2569-10-27) — ใบโอนสินค้าออกที่สาขายังไม่กด "ส่ง" ใน ProMaxx
-- อ้างอิงรายงาน R16.150 ของ SeniorSoft (ใบแจ้งโอน = CF_SYSREFERENCETRANNO ยังว่าง)
-- วิธีใช้: Supabase Dashboard → SQL Editor → วางทั้งไฟล์ → Run (รันซ้ำได้ ไม่ทับข้อมูล)
--
-- ทางเดินข้อมูล:
--   pending-docs-agent.mjs (เครื่องในร้าน) อ่าน MSSQL แบบ SELECT อย่างเดียว — ตรวจเองทุก 5 นาที + ตอนเว็บขอ
--     → ข้อมูลเปลี่ยน: replace_pending_transfers() → pending_transfers → หน้าเว็บโหลดตารางใหม่
--     → เหมือนเดิม:   mark_pending_docs_unchanged() บันทึกแค่เวลาที่ตรวจ → หน้าเว็บไม่ต้องโหลดซ้ำ
--   เว็บขอข้อมูลสดผ่าน request_pending_docs_refresh() → Agent ได้ยินทาง realtime ของ pending_docs_sync
-- 🚨 MSSQL ของ ProMaxx ห้ามเขียน/สร้างอะไรเด็ดขาด — ทุกอย่างที่ต้อง "เก็บ" อยู่ในไฟล์นี้ฝั่ง Supabase เท่านั้น
--    MSSQL จึงบอกเองไม่ได้ว่าข้อมูลเปลี่ยน (ต้องเปิด Change Tracking/Trigger = เขียน MSSQL) → Agent ต้อง "ไปถาม" ตามรอบ
-- ============================================================


-- ── 1. snapshot ใบโอนค้างส่ง (1 แถว = 1 ใบ) ──
create table if not exists public.pending_transfers (
  sys_tran_no  bigint      primary key,                   -- TRANS.SYSTRANNO (รหัสภายใน ProMaxx ไม่ซ้ำ)
  doc_no       text        not null,                      -- TRANS.TRANNO (เลขที่ใบโอน)
  doc_date     date,                                      -- TRANS.TRANDATE (ตัดเวลาทิ้งแล้ว)
  from_branch  text,                                      -- คลังสินค้า/SRC/KKL/SSS ตามคลังต้นทาง (WAREHOUSE_MAP ใน pending-docs-agent.mjs — คลังนอก map ไม่ถูกส่งมา)
  to_branch    text,                                      -- รหัสในแอป หรือชื่อดิบจาก BRANCH.NAME ถ้าปลายทางอยู่นอก map
  item_count   integer     not null default 0,
  items        jsonb       not null default '[]'::jsonb,  -- [{line_no, code, name, qty, serial}]
  synced_at    timestamptz not null default now()
);

create index if not exists idx_pending_transfers_from_branch on public.pending_transfers (from_branch);

alter table public.pending_transfers enable row level security;

drop policy if exists "public read pending transfers" on public.pending_transfers;
create policy "public read pending transfers" on public.pending_transfers
  for select using (true);

-- ❌ ไม่มี write policy (แบบตาราง stock) — เขียนผ่าน replace_pending_transfers() ด้วย service_role เท่านั้น
grant select on table public.pending_transfers to anon, authenticated;


-- ── 2. สถานะการซิงค์ (1 แถวตลอดกาล) — ตัวกลางที่เว็บกับ Agent ใช้คุยกัน ──
create table if not exists public.pending_docs_sync (
  id                    smallint    primary key check (id = 1),
  refresh_requested_at  timestamptz,             -- เว็บขอข้อมูลสดล่าสุด (Agent ฟังคอลัมน์นี้ผ่าน realtime)
  last_success_at       timestamptz,             -- Agent ส่งชุดใบโอนใหม่ล่าสุด (= ข้อมูลเปลี่ยน) → เว็บโหลดตารางใหม่เมื่อค่านี้ขยับ
  last_checked_at       timestamptz,             -- Agent อ่าน MSSQL สำเร็จล่าสุด เปลี่ยนหรือไม่ก็ตาม = "ข้อมูล ณ" บนหน้าเว็บ
  data_hash             text,                    -- ลายนิ้วมือ (sha256) ของชุดที่อยู่ใน pending_transfers — Agent เทียบก่อนส่ง
  last_error            text,                    -- error ล่าสุดจาก Agent (ล้างเป็น null ทุกครั้งที่ตรวจสำเร็จ)
  last_error_at         timestamptz,
  row_count             integer     not null default 0
);

-- ตารางที่สร้างก่อนมีโหมด "ส่งเฉพาะตอนข้อมูลเปลี่ยน" ไม่มี 2 คอลัมน์นี้ (Agent รุ่นใหม่เช็คแล้วไม่ยอมทำงานจนกว่าจะรันไฟล์นี้ซ้ำ)
alter table public.pending_docs_sync add column if not exists last_checked_at timestamptz;
alter table public.pending_docs_sync add column if not exists data_hash text;

insert into public.pending_docs_sync (id) values (1)
on conflict (id) do nothing;

alter table public.pending_docs_sync enable row level security;

drop policy if exists "public read pending docs sync" on public.pending_docs_sync;
create policy "public read pending docs sync" on public.pending_docs_sync
  for select using (true);

grant select on table public.pending_docs_sync to anon, authenticated;


-- ── 3. เว็บขอข้อมูลสด (anon เรียกได้) ──
-- throttle กัน MSSQL Express (ใช้ทรัพยากรร่วมกับ POS ทุกสาขา) โดนยิงถี่:
--   คนสั่งเอง (p_auto = false: เปิดหน้า / F5 / 🔄) → ห่างจากคำขอก่อนหน้า ≥ 10 วิ
--   อัตโนมัติ (p_auto = true: หน้าที่เปิดค้างส่งแบบเงียบทุก 1 นาที + ตอนกลับมาที่แท็บ)
--     → ผ่านเฉพาะตอนไม่มีทั้งคำขอและผลการตรวจเลยเกิน 7 นาที = Agent เงียบผิดปกติ (ปกติตรวจเองทุก 5 นาที)
--     → ไว้จับว่าเครื่องในร้านดับ (เว็บรอ 15 วิแล้วขึ้น "เครื่องในร้านไม่ตอบ") · ตอนปกติไม่ทำให้ถาม MSSQL เพิ่มเลย
--     ไม่นับ last_error_at โดยตั้งใจ — Agent เขียนค่านั้นด้วยนาฬิกาเครื่องตัวเอง ถ้าเครื่องนั้นเวลาเดินเร็ว ตัวจับเครื่องดับจะช้าตาม
--     (MSSQL ล่มนานๆ = คำขอนี้ผ่านทุก 7 นาที ให้ Agent ลองใหม่ + หน้าเว็บได้ข้อความ error สดๆ — ภาระเท่าการต่อไม่ติด 1 ครั้ง)
--     ⚠️ 7 นาทีต้องมากกว่ารอบตรวจของ Agent (CHECK_INTERVAL_MS 5 นาที + CHECK_TICK_MS 30 วิ ใน pending-docs-agent.mjs)
--        ไม่งั้นหน้าที่เปิดค้างจะส่งคำขอแทรกก่อนรอบของ Agent = ถาม MSSQL ซ้ำโดยไม่ได้อะไร (มีเทสเช็คให้)
-- คืนเวลาคำขอใหม่ หรือ null = ไม่ได้ตั้งคำขอใหม่ (มีคำขอ/ข้อมูลสดอยู่แล้ว — รอผลรอบเดิมได้เลย)
-- ⚠️ anon key เป็นสาธารณะ ใครก็เรียก RPC นี้ได้ — throttle ที่นี่จึงเป็นด่านจริงด่านเดียวที่กัน ERP
create or replace function public.request_pending_docs_refresh(p_auto boolean default false)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  requested timestamptz;
begin
  update public.pending_docs_sync
     set refresh_requested_at = now()
   where id = 1
     and case
           when p_auto then coalesce(greatest(refresh_requested_at, last_success_at, last_checked_at), '-infinity')
                              < now() - interval '7 minutes'
           else coalesce(refresh_requested_at, '-infinity') < now() - interval '10 seconds'
         end
  returning refresh_requested_at into requested;

  return requested;
end;
$$;

revoke all on function public.request_pending_docs_refresh(boolean) from public;
grant execute on function public.request_pending_docs_refresh(boolean) to anon, authenticated;


-- ── 4. Agent แทนที่ snapshot ทั้งชุด — เฉพาะตอนข้อมูลเปลี่ยน (service_role เท่านั้น) ──
-- 1 transaction: ลบชุดเดิม + ใส่ชุดใหม่ + อัปเดตสถานะ → พังตรงไหน rollback หมด
-- หน้าเว็บจึงไม่มีวันเห็นตารางว่าง/ครึ่งๆ กลางๆ (ต่างจาก delete-all แล้ว insert ทีละก้อนแบบ upload-stock.mjs)
-- p_hash = ลายนิ้วมือของชุดนี้ (Agent คำนวณ) เก็บไว้ให้ mark_pending_docs_unchanged() เทียบรอบหน้า
-- รุ่นก่อนรับแค่ p_rows → ลบทิ้งก่อน ไม่งั้นมี 2 ตัวชื่อซ้ำ แล้ว PostgREST เลือกไม่ได้ว่าจะเรียกตัวไหน
--   (p_hash มีค่าเริ่มต้น → Agent รุ่นก่อนที่ยังไม่ได้ git pull เรียกด้วย p_rows อย่างเดียวได้เหมือนเดิม)
drop function if exists public.replace_pending_transfers(jsonb);

create or replace function public.replace_pending_transfers(p_rows jsonb, p_hash text default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'ข้อมูลที่ส่งมาไม่ใช่รายการใบโอน';
  end if;

  -- ⚠️ ต้องมี WHERE — safeupdate ปฏิเสธ DELETE ที่ไม่มี WHERE
  delete from public.pending_transfers where sys_tran_no is not null;

  insert into public.pending_transfers
    (sys_tran_no, doc_no, doc_date, from_branch, to_branch, item_count, items, synced_at)
  select r.sys_tran_no, r.doc_no, r.doc_date, r.from_branch, r.to_branch,
         coalesce(r.item_count, 0), coalesce(r.items, '[]'::jsonb), now()
  from jsonb_to_recordset(p_rows) as r(
    sys_tran_no bigint, doc_no text, doc_date date, from_branch text, to_branch text,
    item_count integer, items jsonb
  );

  get diagnostics n = row_count;

  update public.pending_docs_sync
     set last_success_at = now(), last_checked_at = now(), data_hash = p_hash,
         last_error = null, last_error_at = null, row_count = n
   where id = 1;

  return n;
end;
$$;

-- Supabase แจก execute ให้ anon/authenticated อัตโนมัติ — ต้อง revoke เองไม่งั้นใครก็ลบ snapshot ได้
revoke all on function public.replace_pending_transfers(jsonb, text) from public, anon, authenticated;
grant execute on function public.replace_pending_transfers(jsonb, text) to service_role;


-- ── 5. Agent ตรวจแล้วข้อมูลเหมือนเดิม (service_role เท่านั้น) ──
-- ลายนิ้วมือตรงกับชุดที่อยู่ใน pending_transfers → บันทึกแค่เวลาที่ตรวจ ไม่แตะตารางใบโอน
--   → หน้าเว็บรู้ว่าข้อมูลยังสด ("ข้อมูล ณ" ขยับ) แต่ last_success_at ไม่ขยับ = ไม่โหลดตารางซ้ำ
--   ⚠️ ห้ามให้ฟังก์ชันนี้แตะ last_success_at — ไม่งั้นทุกเครื่องที่เปิดหน้าค้างโหลดตารางใหม่ทุกรอบเหมือนเดิม
-- คืน false = ไม่ตรง (ข้อมูลเปลี่ยน / ชุดเดิมมาจาก Agent รุ่นก่อนที่ไม่มี hash) → Agent เรียก replace_pending_transfers ต่อ
-- เทียบใน DB ไม่ใช่ในหน่วยความจำของ Agent → รีสตาร์ท Agent / --once ส่งไปแล้ว ก็ไม่ส่งชุดเดิมซ้ำ
-- เวลาใช้ now() ของ DB — Agent ห้ามส่งเวลาเครื่องตัวเอง: เว็บเทียบกับ refresh_requested_at (เวลา DB)
--   ถ้านาฬิกาเครื่อง Agent ช้าไม่กี่วิ คำขอจะดูเหมือนไม่เคยได้คำตอบ ป้ายค้าง "เครื่องในร้านไม่ตอบ"
create or replace function public.mark_pending_docs_unchanged(p_hash text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.pending_docs_sync
     set last_checked_at = now(), last_error = null, last_error_at = null
   where id = 1
     and data_hash = p_hash;

  return found;
end;
$$;

-- ⚠️ ห้ามให้ anon เรียกได้ — data_hash อ่านได้สาธารณะ ใครก็จะทำให้หน้าเว็บเชื่อว่าเครื่องในร้านยังตรวจอยู่ทั้งที่ดับไปแล้ว
revoke all on function public.mark_pending_docs_unchanged(text) from public, anon, authenticated;
grant execute on function public.mark_pending_docs_unchanged(text) to service_role;


-- ── 6. Realtime ──
-- ⚠️ publish เฉพาะ pending_docs_sync (1 แถว) ไม่ใช่ pending_transfers
--    replace ทีละหลายร้อยแถวจะกลายเป็น realtime หลายร้อยข้อความรวด (บทเรียนเดียวกับ price_change_seen)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'pending_docs_sync'
     ) then
    alter publication supabase_realtime add table public.pending_docs_sync;
  end if;
end $$;


-- ── 7. ปุ่มนำทาง — ซ่อนไว้ก่อน จน Agent ในร้านทำงานได้จริง ──
-- เปิดปุ่มเมื่อพร้อม:
--   update app_page_settings set visible = true, updated_at = now() where page_id = 'pendingdocs';
insert into public.app_page_settings (page_id, visible) values ('pendingdocs', false)
on conflict (page_id) do nothing;


notify pgrst, 'reload schema';
