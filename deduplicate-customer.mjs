/**
 * deduplicate-customer.mjs
 * เปรียบเทียบ customer2025.csv กับ customer2026.csv
 * ลบแถวที่ ColB+ColC+ColD ซ้ำกัน แล้วบันทึกเป็น customer2025_deduped.csv
 * รันโดย: node deduplicate-customer.mjs
 */

import { readFileSync, writeFileSync } from 'fs';

const FILE_2025 = 'customer2025.csv';
const FILE_2026 = 'customer2026.csv';
const OUTPUT    = 'customer2025_deduped.csv';

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

function makeKey(row) {
  const b = row[1]?.trim() || '';
  const c = row[2]?.trim() || '';
  const d = row[3]?.trim() || '';
  return `${b}|${c}|${d}`;
}

function rowToCSV(row) {
  return row.map(f => f.includes(',') || f.includes('"') ? `"${f.replace(/"/g, '""')}"` : f).join(',');
}

// อ่านไฟล์ 2026 แล้วสร้าง Set ของ key ที่มีอยู่แล้ว
const rows2026 = parseCSV(readFileSync(FILE_2026, 'utf-8'));
const keys2026 = new Set(rows2026.slice(1).map(makeKey));
console.log(`📂 2026: ${rows2026.length - 1} แถว`);

// อ่านไฟล์ 2025 แล้วกรองแถวที่ซ้ำออก
const rows2025 = parseCSV(readFileSync(FILE_2025, 'utf-8'));
const header   = rows2025[0];
const filtered = rows2025.slice(1).filter(row => !keys2026.has(makeKey(row)));

console.log(`📂 2025: ${rows2025.length - 1} แถว`);
console.log(`🗑️  ซ้ำกับ 2026: ${rows2025.length - 1 - filtered.length} แถว`);
console.log(`✅ เหลือ: ${filtered.length} แถว`);

// บันทึก output
const output = [header, ...filtered].map(rowToCSV).join('\n');
writeFileSync(OUTPUT, output, 'utf-8');
console.log(`💾 บันทึกแล้วที่: ${OUTPUT}`);
