-- สร้างตาราง customer_history ใน Supabase
CREATE TABLE IF NOT EXISTS customer_history (
  id           bigserial PRIMARY KEY,
  first_name   text,
  last_name    text,
  sku          text,
  product_name text,
  uploaded_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE customer_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read customer_history"  ON customer_history FOR SELECT USING (true);
CREATE POLICY "public write customer_history" ON customer_history FOR ALL    USING (true);
