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
const CSV_CANDIDATES = [
  'C:\\Users\\AninMainPC\\Desktop\\run-upload-stock\\customer_history.csv',
  'C:\\Users\\AninMainPC\\Desktop\\run-upload-stock\\customer_history.CSV',
  'C:\\Users\\Arm\\Documents\\update_stock\\customer_history.csv',
  'C:\\Users\\BigYa-spare\\Documents\\update_stock\\customer_history.csv',
  'C:\\Users\\BigYa-spare\\Documents\\update_stock\\customer_history.CSV',
];
const CSV_PATH = CSV_CANDIDATES.find(p => existsSync(p)) || CSV_CANDIDATES[0];

const SUPABASE_URL = 'https://eogqnedbdpjuptwlqudn.supabase.co';

// service_role key — bypass RLS (ใช้ฝั่ง server เท่านั้น ห้าม commit ลง git)
// อ่านจาก env SUPABASE_SERVICE_KEY ก่อน ถ้าไม่มีลองอ่านจากไฟล์ .env ข้างสคริปต์
function getServiceKey() {
  if (process.env.SUPABASE_SERVICE_KEY) return process.env.SUPABASE_SERVICE_KEY.trim();
  try {
    const envText = readFileSync(new URL('./.env', import.meta.url), 'utf-8');
    const m = envText.match(/^\s*SUPABASE_SERVICE_KEY\s*=\s*(.+)\s*$/m);
    if (m) return m[1].trim();
  } catch { /* ไม่มีไฟล์ .env ก็ข้าม */ }
  return null;
}
const SUPABASE_KEY = getServiceKey();
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

  if (!SUPABASE_KEY) {
    console.error('❌ ไม่พบ service_role key — ตั้งค่า SUPABASE_SERVICE_KEY ใน env หรือไฟล์ .env');
    console.error('   เอา key จาก: Supabase Dashboard → Settings → API → service_role');
    process.exit(1);
  }

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

  const appendMode = process.argv.includes('--append');

  if (!appendMode) {
    console.log('   ลบข้อมูลเก่า (chunked)...');
    let deleted = 0;
    while (true) {
      const { data: batch, error: selErr } = await supabase
        .from('customer_history').select('id').limit(1000);
      if (selErr) { console.error('❌ select ids ไม่สำเร็จ:', selErr.message); process.exit(1); }
      if (!batch || batch.length === 0) break;
      const ids = batch.map(r => r.id);
      const { error: delErr } = await supabase.from('customer_history').delete().in('id', ids);
      if (delErr) { console.error('❌ ลบข้อมูลเก่าไม่สำเร็จ:', delErr.message); process.exit(1); }
      deleted += ids.length;
      if (deleted % 10000 === 0) console.log(`   ลบไปแล้ว ${deleted} แถว`);
    }
    console.log(`   ลบเก่าทั้งหมด ${deleted} แถว`);
  } else {
    console.log('   โหมด --append: ข้ามการลบข้อมูลเก่า');
  }

  const CHUNK = 500;
  for (let i = 0; i < items.length; i += CHUNK) {
    const { error } = await supabase.from('customer_history').insert(items.slice(i, i + CHUNK));
    if (error) { console.error('❌ insert ไม่สำเร็จ:', error.message); process.exit(1); }
  }

  console.log(`✅ อัพโหลดสำเร็จ ${items.length} รายการ`);
}

main().catch(err => { console.error('❌', err.message); process.exit(1); });
