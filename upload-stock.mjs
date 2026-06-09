/**
 * upload-stock.mjs
 * อ่านไฟล์ All_stock.csv แล้วอัพโหลดข้อมูลสต๊อคเข้า Supabase
 * รันโดย: node upload-stock.mjs
 * ตั้งเวลา: Task Scheduler ทุก 5 นาที
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';

// ─── CONFIG ───────────────────────────────────────────────
// ลองไฟล์ CSV จากหลาย path ตามลำดับ — ใช้ path แรกที่เจอ
const CSV_CANDIDATES = [
  'C:\\Users\\Arm\\Documents\\update_stock\\All_stock.csv',
  'C:\\Users\\BigYa-spare\\Documents\\update_stock\\All_stock.csv',
  'C:\\Users\\BigYa-spare\\Documents\\update_stock\\All_stock.CSV',
];

let CSV_PATH;
for (const candidate of CSV_CANDIDATES) {
  if (existsSync(candidate)) {
    CSV_PATH = candidate;
    break;
  }
}

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

const BRANCH_MAP = {
  'warehouse':   'คลังสินค้า',
  'front store': 'SRC',
  'main kkl':    'KKL',
  'main sss':    'SSS',
};

function mapBranch(raw) {
  return BRANCH_MAP[raw.toLowerCase().trim()] ?? null;
}

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
      if (ch === '"' && field === '') { inQuote = true; }  // เริ่ม quoted field เฉพาะตอนเริ่มฟิลด์
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
  console.log(`[${timestamp}] เริ่มต้นอัพโหลดสต๊อค...`);

  if (!SUPABASE_KEY) {
    console.error('❌ ไม่พบ service_role key — ตั้งค่า SUPABASE_SERVICE_KEY ใน env หรือไฟล์ .env');
    console.error('   เอา key จาก: Supabase Dashboard → Settings → API → service_role');
    process.exit(1);
  }

  console.log(`   ใช้ไฟล์: ${CSV_PATH}`);

  // ตรวจสอบไฟล์
  if (!CSV_PATH) {
    console.error(`❌ ไม่พบไฟล์ All_stock.csv ในเส้นทาง:`);
    CSV_CANDIDATES.forEach(p => console.error(`   - ${p}`));
    process.exit(1);
  }

  // อ่านและ parse CSV
  const text = readFileSync(CSV_PATH, 'utf-8');
  const rows = parseCSV(text);
  console.log(`   อ่านได้ ${rows.length - 1} แถว (ไม่นับ header)`);

  const items = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length < 5) continue;

    const rawBranch = row[3]?.trim() || '';
    const branch = mapBranch(rawBranch);
    if (!branch) continue;

    const sku = row[4]?.trim() || '';
    if (!sku) continue;

    items.push({
      branch,
      sku,
      name:  (row[5]?.trim() || '').split(/[\r\n]/)[0].trim(),
      qty:    row[6]?.trim() || '',
      unit:   row[7]?.trim() || '',
      price:  row[8]?.trim() || '',
    });
  }

  if (items.length === 0) {
    const colDValues = [...new Set(rows.slice(1).map(r => r[3]?.trim()).filter(Boolean))].slice(0, 5);
    console.error(`❌ ไม่พบข้อมูล — ค่าใน ColD ที่พบ: ${colDValues.join(', ')}`);
    process.exit(1);
  }

  console.log(`   พบสินค้า ${items.length} รายการ กำลังอัพโหลด...`);

  // อัพโหลด Supabase
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  const { error: delErr } = await supabase.from('stock').delete().neq('id', 0);
  if (delErr) { console.error('❌ ลบข้อมูลเก่าไม่สำเร็จ:', delErr.message); process.exit(1); }

  const CHUNK = 500;
  for (let i = 0; i < items.length; i += CHUNK) {
    const { error } = await supabase.from('stock').insert(items.slice(i, i + CHUNK));
    if (error) { console.error('❌ insert ไม่สำเร็จ:', error.message); process.exit(1); }
  }

  console.log(`✅ อัพโหลดสำเร็จ ${items.length} รายการ`);
}

main().catch(err => { console.error('❌', err.message); process.exit(1); });
