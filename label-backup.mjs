// ============================================================
// สำรองข้อมูลฉลากยาทั้งหมดลงไฟล์ JSON — รันก่อนแตะข้อมูลเสมอ
//
//   node label-backup.mjs
//
// ได้ไฟล์ label-backup-<timestamp>.json ที่ใช้ย้อนกลับได้ทุกขั้นตอนหลังจากนี้
// ============================================================

import { writeFileSync } from 'fs';
import { labelClient, fetchAll } from './label-scripts-common.mjs';

const sb = labelClient();

console.log('กำลังดึงข้อมูล...');
const medicines    = await fetchAll(sb, 'medicines', 'id, sku, usage_ref, barcode');
const translations = await fetchAll(sb, 'medicine_translations',
  'id, medicine_id, lang, trade_name, generic_name, usage, indication, warning, storage');

const byLang = {};
for (const t of translations) byLang[t.lang] = (byLang[t.lang] ?? 0) + 1;

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const file  = `label-backup-${stamp}.json`;
writeFileSync(file, JSON.stringify({
  exported_at: new Date().toISOString(),
  counts: { medicines: medicines.length, translations: translations.length, by_lang: byLang },
  medicines,
  translations,
}, null, 2), 'utf8');

console.log(`\n✅ สำรองเสร็จ: ${file}`);
console.log(`   medicines    : ${medicines.length.toLocaleString()} แถว`);
console.log(`   translations : ${translations.length.toLocaleString()} แถว`);
console.log(`   แยกตามภาษา   : ${Object.entries(byLang).map(([l, n]) => `${l}=${n}`).join(' · ')}`);
console.log('\n⚠️ ตรวจว่าตัวเลขตรงกับที่คาดก่อนรันสคริปต์ขั้นต่อไป');
