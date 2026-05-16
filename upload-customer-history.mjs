/**
 * upload-customer-history.mjs
 * อ่านไฟล์ CSV ประวัติลูกค้าแล้วอัพโหลดเข้า Supabase
 * รันโดย: node upload-customer-history.mjs
 * ตั้งเวลา: Task Scheduler ทุก 5 นาที (หรือตามต้องการ)
 *
 * CSV Columns (zero-indexed):
 *   B(1) = ชื่อ (first_name)
 *   C(2) = นามสกุล (last_name)
 *   I(8) = SKU
 *   J(9) = ชื่อสินค้า (product_name)
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';

// ─── CONFIG ───────────────────────────────────────────────
const CSV_PATH = 'C:\\Users\\Arm\\Documents\\update_stock\\customer_history.csv';

const SUPABASE_URL = 'https://eogqnedbdpjuptwlqudn.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVvZ3FuZWRiZHBqdXB0d2xxdWRuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4MTc5MzUsImV4cCI6MjA5MTM5MzkzNX0.M9g4iCV7T0xoWdStNO4DNiT15m5dsEWcKc3ZV1TMlhE';
// ──────────────────────────────────────────────────────────

function parseCSV(text) {
  const lines = [];
  let field = '', row = [], inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuote) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') inQuote = false;
      else field += ch;
    } else {
      if (ch === '"' && field === '') { inQuote = true; }
      else if (ch === ',') { row.push(field); field = ''; }
      else if (ch === '\n') { row.push(field); lines.push(row); row = []; field = ''; }
      else if (ch !== '\r') field += ch;
    }
  }
  if (field || row.length) { row.push(field); lines.push(row); }
  return lines;
}

async function main() {
  const timestamp = new Date().toLocaleString('th-TH');
  console.log(`[${timestamp}] เริ่มต้นอัพโหลดประวัติลูกค้า...`);

  if (!existsSync(CSV_PATH)) {
    console.error(`❌ ไม่พบไฟล์: ${CSV_PATH}`);
    process.exit(1);
  }

  const text = readFileSync(CSV_PATH, 'utf-8');
  const rows = parseCSV(text);
  console.log(`   อ่านได้ ${rows.length - 1} แถว (ไม่นับ header)`);

  const items = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length < 10) continue;

    const rawPhone     = row[1]?.trim() || '';
    const phone        = (rawPhone.length === 8 || rawPhone.length === 9) ? '0' + rawPhone : rawPhone;
    const first_name   = row[2]?.trim() || '';
    const last_name    = row[3]?.trim() || '';
    const sku          = row[8]?.trim() || '';
    const product_name = (row[9]?.trim() || '').split(/[\r\n]/)[0].trim();

    if (!first_name && !last_name) continue;

    items.push({ phone, first_name, last_name, sku, product_name });
  }

  if (items.length === 0) {
    console.error('❌ ไม่พบข้อมูล — ตรวจสอบ ColB (ชื่อ) และ ColC (นามสกุล)');
    process.exit(1);
  }

  console.log(`   พบข้อมูล ${items.length} รายการ กำลังอัพโหลด...`);

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  const { error: delErr } = await supabase.from('customer_history').delete().neq('id', 0);
  if (delErr) { console.error('❌ ลบข้อมูลเก่าไม่สำเร็จ:', delErr.message); process.exit(1); }

  const CHUNK = 500;
  for (let i = 0; i < items.length; i += CHUNK) {
    const { error } = await supabase.from('customer_history').insert(items.slice(i, i + CHUNK));
    if (error) { console.error('❌ insert ไม่สำเร็จ:', error.message); process.exit(1); }
  }

  console.log(`✅ อัพโหลดสำเร็จ ${items.length} รายการ`);
}

main().catch(err => { console.error('❌', err.message); process.exit(1); });
