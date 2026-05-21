-- Migration: Add Korean ('ko') to lang CHECK constraint
-- วิธีใช้: Run ใน Supabase SQL Editor

-- ลบ CHECK constraint เดิมและสร้างใหม่ให้รวม 'ko'
ALTER TABLE label.medicine_translations
  DROP CONSTRAINT IF EXISTS medicine_translations_lang_check;

ALTER TABLE label.medicine_translations
  ADD CONSTRAINT medicine_translations_lang_check
  CHECK (lang IN ('th', 'en', 'zh', 'ja', 'my', 'km', 'ko'));
