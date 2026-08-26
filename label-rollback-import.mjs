// ============================================================
// ย้อนการนำเข้าฉลากยา — ลบเฉพาะแถวที่การอัปโหลดสร้างขึ้นใหม่
//
//   node label-rollback-import.mjs                       # dry-run (default) ไม่แตะข้อมูล
//   node label-rollback-import.mjs --confirm             # ลบจริง
//   node label-rollback-import.mjs --file "D:/x.xlsx"    # ระบุไฟล์เอง
//
// วิธีชี้ว่าแถวไหน "มาจากการอัปโหลด":
//   ตารางจริงไม่มี created_at/updated_at จึงชี้ด้วยเวลาไม่ได้ ต้องใช้ไฟล์ต้นทางเป็นตัวชี้
//   เป้าหมาย = แถวที่ (sku, usage_ref) ตรงกับไฟล์ AND ไม่มีคำแปลภาษาอื่นเลย
//   🚨 แถวที่มีคำแปลภาษาอื่น = ของเดิมที่คนคัดและแปลไว้แล้ว ห้ามลบเด็ดขาด (import เขียนแค่ lang='th')
// ============================================================

import { writeFileSync } from 'fs';
import { labelClient, fetchAll, parseLabelWorkbook, classify, chunk } from './label-scripts-common.mjs';

const args    = process.argv.slice(2);
const confirm = args.includes('--confirm');
const fileArg = args.indexOf('--file');
const XLSX_PATH = fileArg >= 0 ? args[fileArg + 1] : 'C:/Users/BigYa-spare/Downloads/ANIN LABEL MASTER (1).xlsx';

// จำนวนที่คาดไว้จากการวิเคราะห์ 2569-08-26 — ถ้าไม่ตรงแปลว่าสถานะ DB เปลี่ยนไปแล้ว ต้องหยุดตรวจก่อน
const EXPECTED = { A: 204, B: 2695, C: 94, D: 12 };

const sb = labelClient();

console.log(`ไฟล์: ${XLSX_PATH}`);
const parsed = parseLabelWorkbook(XLSX_PATH);
console.log(`ชีท ${parsed.sheetName}: ${parsed.totalDataRows} แถวข้อมูล → ใช้ได้ ${parsed.keys.size} คีย์` +
  ` (ไม่มี SKU ${parsed.skippedNoSku} · ว่าง ${parsed.skippedEmpty} · ซ้ำในไฟล์ ${parsed.dupInFile})`);

console.log('กำลังดึงข้อมูลจาก Supabase...');
const medicines    = await fetchAll(sb, 'medicines', 'id, sku, usage_ref');
const translations = await fetchAll(sb, 'medicine_translations', 'id, medicine_id, lang');
const hasOtherLang = new Set(translations.filter(t => t.lang !== 'th').map(t => t.medicine_id));

const { A, B, C, D } = classify(medicines, parsed.keys, hasOtherLang);

console.log(`\n=== medicines ${medicines.length.toLocaleString()} แถว ===`);
console.log(`  A) ตรงไฟล์ + มีคำแปลภาษาอื่น = ${A.length}\t(คาด ${EXPECTED.A})  ← ของเดิม th ถูกทับ · เก็บไว้ กู้ด้วย label-restore-th.mjs`);
console.log(`  B) ตรงไฟล์ + มีแค่ภาษาไทย   = ${B.length}\t(คาด ${EXPECTED.B})  ← เป้าหมายลบ`);
console.log(`  C) ไม่ตรงไฟล์ + ภาษาอื่น    = ${C.length}\t(คาด ${EXPECTED.C})  ← ไม่ถูกแตะ`);
console.log(`  D) ไม่ตรงไฟล์ + แค่ไทย      = ${D.length}\t(คาด ${EXPECTED.D})  ← ไม่ถูกแตะ`);
console.log(`  ลบ B แล้วจะเหลือ ${(medicines.length - B.length).toLocaleString()} แถว`);

const mismatch = Object.entries(EXPECTED).filter(([k, v]) => ({ A, B, C, D })[k].length !== v);
if (mismatch.length) {
  console.log(`\n⚠️ จำนวนไม่ตรงกับที่วิเคราะห์ไว้: ${mismatch.map(([k, v]) => `${k} คาด ${v}`).join(' · ')}`);
  console.log('   แปลว่าข้อมูลใน DB เปลี่ยนไปหลังการวิเคราะห์ — ตรวจให้แน่ใจก่อนลบ');
  if (confirm) { console.log('\n❌ หยุด: ไม่ลบเมื่อจำนวนไม่ตรง ใช้ --force ถ้ายืนยันว่าถูกต้อง'); if (!args.includes('--force')) process.exit(1); }
}

if (B.length === 0) { console.log('\nไม่มีแถวให้ลบ'); process.exit(0); }

console.log('\nตัวอย่าง 10 แถวที่จะลบ:');
const trByMed = new Map(translations.map(t => [t.medicine_id, t]));
for (const m of B.slice(0, 10)) console.log(`  ${m.sku} | ${(m.usage_ref ?? '').slice(0, 55)}`);
void trByMed;

if (!confirm) {
  console.log(`\n[dry-run] ยังไม่ลบอะไร — รันซ้ำด้วย --confirm เพื่อลบจริง ${B.length.toLocaleString()} แถว`);
  process.exit(0);
}

// --- บันทึกรายการที่จะลบไว้ก่อน เผื่อต้องย้อน ---
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
writeFileSync(`label-deleted-${stamp}.json`, JSON.stringify(B, null, 2), 'utf8');
console.log(`\nบันทึกรายการที่จะลบไว้ที่ label-deleted-${stamp}.json`);

const ids = B.map(m => m.id);

// ลบคำแปลก่อน แล้วค่อยลบตัวยา — ลำดับเดียวกับ handleDeleteMedicine ในเว็บ
// ไม่พึ่ง FK cascade เพราะตารางจริงเคยไม่ตรงกับ supabase-setup.sql มาแล้ว (เรื่อง created_at)
let doneTr = 0;
for (const part of chunk(ids, 100)) {
  const { error } = await sb.from('medicine_translations').delete().in('medicine_id', part);
  if (error) throw new Error(`ลบคำแปลไม่สำเร็จ: ${error.message}${error.code === '42501' ? '\n   → ต้อง GRANT DELETE ON label.medicine_translations TO anon ใน Supabase ก่อน' : ''}`);
  doneTr += part.length;
  process.stdout.write(`\r  ลบคำแปล ${doneTr}/${ids.length}`);
}
console.log('');

let doneMed = 0;
for (const part of chunk(ids, 100)) {
  const { error } = await sb.from('medicines').delete().in('id', part);
  if (error) throw new Error(`ลบรายการยาไม่สำเร็จ: ${error.message}${error.code === '42501' ? '\n   → ต้อง GRANT DELETE ON label.medicines TO anon ใน Supabase ก่อน' : ''}`);
  doneMed += part.length;
  process.stdout.write(`\r  ลบรายการยา ${doneMed}/${ids.length}`);
}
console.log('');

const after = await fetchAll(sb, 'medicines', 'id');
console.log(`\n✅ เสร็จ — medicines เหลือ ${after.length.toLocaleString()} แถว (คาด ${(medicines.length - B.length).toLocaleString()})`);
console.log('   ขั้นต่อไป: node label-restore-th.mjs   (กู้ภาษาไทยของแถวกลุ่ม A)');
