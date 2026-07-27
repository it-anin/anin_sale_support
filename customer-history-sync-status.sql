-- เพิ่มสถานะการตรวจสอบล่าสุดสำหรับ badge หน้า Customer History
-- รันครั้งเดียวใน Supabase Dashboard -> SQL Editor
-- ตารางนี้มีเพียง 1 แถว และ uploader จะอัปเดตแม้รอบนั้นไม่มีข้อมูลลูกค้าเปลี่ยน

CREATE TABLE IF NOT EXISTS public.customer_history_sync_status (
  id                   smallint PRIMARY KEY CHECK (id = 1),
  last_checked_at      timestamptz NOT NULL DEFAULT now(),
  last_changed_at      timestamptz,
  csv_rows             bigint NOT NULL DEFAULT 0,
  candidate_rows       bigint NOT NULL DEFAULT 0,
  inserted_count       integer NOT NULL DEFAULT 0,
  updated_count        integer NOT NULL DEFAULT 0,
  unchanged_count      integer NOT NULL DEFAULT 0,
  skipped_count        integer NOT NULL DEFAULT 0,
  full_scan            boolean NOT NULL DEFAULT false,
  latest_purchase_date timestamp
);

ALTER TABLE public.customer_history_sync_status ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public read customer_history sync status"
  ON public.customer_history_sync_status;
CREATE POLICY "public read customer_history sync status"
  ON public.customer_history_sync_status
  FOR SELECT
  USING (true);

GRANT SELECT ON TABLE public.customer_history_sync_status TO anon, authenticated;

