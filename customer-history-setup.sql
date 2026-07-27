-- สร้างตาราง customer_history สำหรับโปรเจกต์ใหม่
-- ถ้ามีตารางและข้อมูลเดิมอยู่แล้ว ห้าม DROP TABLE:
-- ให้รัน customer-history-incremental-migration.sql แทน

CREATE TABLE IF NOT EXISTS customer_history (
  id            bigserial PRIMARY KEY,
  purchase_date timestamp,
  phone         text,
  first_name    text,
  last_name     text,
  sku           text,
  product_name  text,
  dedupe_key    text NOT NULL,
  uploaded_at   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS customer_history_dedupe_key_uidx
  ON customer_history (dedupe_key);

CREATE INDEX IF NOT EXISTS customer_history_purchase_date_idx
  ON customer_history (purchase_date DESC);

ALTER TABLE customer_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public read customer_history" ON customer_history;
CREATE POLICY "public read customer_history"
  ON customer_history
  FOR SELECT
  USING (true);

-- ไม่มี public write policy เพราะตารางมีข้อมูลส่วนบุคคล
-- upload-customer-history.mjs ใช้ service_role key ซึ่ง bypass RLS

CREATE TABLE IF NOT EXISTS customer_history_sync_status (
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

ALTER TABLE customer_history_sync_status ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public read customer_history sync status"
  ON customer_history_sync_status;
CREATE POLICY "public read customer_history sync status"
  ON customer_history_sync_status
  FOR SELECT
  USING (true);

GRANT SELECT ON TABLE customer_history_sync_status TO anon, authenticated;
