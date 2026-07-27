-- เปลี่ยน customer_history เดิมให้รองรับ incremental upload แบบไม่ล้างตาราง
-- รันครั้งเดียวใน Supabase Dashboard -> SQL Editor ก่อนใช้ upload-customer-history.mjs เวอร์ชันใหม่
--
-- การยุบข้อมูล:
--   ลูกค้า = เบอร์โทร (ถ้ามี) ไม่เช่นนั้นใช้ชื่อ+นามสกุล
--   สินค้า = SKU (ถ้ามี) ไม่เช่นนั้นใช้ชื่อสินค้า
--   เก็บ purchase_date ล่าสุด; ถ้าวันเท่ากันเก็บ uploaded_at/id ล่าสุด

BEGIN;

ALTER TABLE customer_history
  ADD COLUMN IF NOT EXISTS dedupe_key text;

WITH normalized AS (
  SELECT
    id,
    regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') AS phone_digits,
    lower(regexp_replace(btrim(COALESCE(first_name, '')), '[[:space:]]+', ' ', 'g')) AS first_key,
    lower(regexp_replace(btrim(COALESCE(last_name, '')), '[[:space:]]+', ' ', 'g')) AS last_key,
    lower(regexp_replace(btrim(COALESCE(sku, '')), '[[:space:]]+', ' ', 'g')) AS sku_key,
    lower(regexp_replace(btrim(COALESCE(product_name, '')), '[[:space:]]+', ' ', 'g')) AS product_key
  FROM customer_history
),
key_parts AS (
  SELECT
    id,
    CASE
      WHEN length(phone_digits) IN (8, 9) AND phone_digits NOT LIKE '0%'
        THEN '0' || phone_digits
      ELSE phone_digits
    END AS normalized_phone,
    first_key,
    last_key,
    sku_key,
    product_key
  FROM normalized
),
keys AS (
  SELECT
    id,
    CASE
      WHEN
        (normalized_phone <> '' OR first_key <> '' OR last_key <> '')
        AND (sku_key <> '' OR product_key <> '')
      THEN
        CASE
          WHEN normalized_phone <> ''
            THEN 'p' || octet_length(normalized_phone) || ':' || normalized_phone
          ELSE
            'f' || octet_length(first_key) || ':' || first_key
            || 'l' || octet_length(last_key) || ':' || last_key
        END
        || CASE
          WHEN sku_key <> ''
            THEN 's' || octet_length(sku_key) || ':' || sku_key
          ELSE
            'd' || octet_length(product_key) || ':' || product_key
        END
      -- เก็บ legacy row ที่ข้อมูลไม่ครบไว้ โดยไม่รวมกับแถวอื่น
      ELSE 'legacy:' || id
    END AS dedupe_key
  FROM key_parts
)
UPDATE customer_history AS target
SET dedupe_key = keys.dedupe_key
FROM keys
WHERE target.id = keys.id;

WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY dedupe_key
      ORDER BY purchase_date DESC NULLS LAST, uploaded_at DESC, id DESC
    ) AS row_rank
  FROM customer_history
  WHERE dedupe_key NOT LIKE 'legacy:%'
)
DELETE FROM customer_history
WHERE id IN (
  SELECT id
  FROM ranked
  WHERE row_rank > 1
);

ALTER TABLE customer_history
  ALTER COLUMN dedupe_key SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS customer_history_dedupe_key_uidx
  ON customer_history (dedupe_key);

CREATE INDEX IF NOT EXISTS customer_history_purchase_date_idx
  ON customer_history (purchase_date DESC);

COMMIT;

-- ตรวจสอบหลังรัน: ต้องได้ duplicate_groups = 0
SELECT count(*) AS duplicate_groups
FROM (
  SELECT dedupe_key
  FROM customer_history
  GROUP BY dedupe_key
  HAVING count(*) > 1
) AS duplicates;

-- สำหรับ badge เวลา sync ให้รัน customer-history-sync-status.sql เพิ่มอีกหนึ่งครั้ง
