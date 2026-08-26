// ============================================================
// กู้คำแปลภาษาไทย + usage_ref ของแถวเดิมที่ถูกการนำเข้าเขียนทับ (กลุ่ม A)
//
//   node label-restore-th.mjs              # dry-run (default)
//   node label-restore-th.mjs --confirm    # เขียนจริง
//
// แหล่งข้อมูลเดิม = import-labels.sql (ชุดที่นำเข้าครั้งแรก ยังเก็บข้อความไทยต้นฉบับไว้)
//
// ⚠️ จับคู่ด้วย "SKU" ไม่ใช่ (sku, usage_ref) — เพราะเส้นทาง reuse ของ import
//    ไปเปลี่ยน usage_ref ของแถวเดิมเป็นค่าจากไฟล์แล้ว คีย์เดิมจึงหายไป
//    เข้มงวดไว้: กู้เฉพาะ SKU ที่มีแถวเดียวทั้งใน DB และใน import-labels.sql เท่านั้น
//    ที่เหลือเขียนลง CSV ให้คนตรวจเอง ไม่เดา
// ============================================================

import { readFileSync, writeFileSync } from 'fs';
import { labelClient, fetchAll, parseLabelWorkbook } from './label-scripts-common.mjs';

const args    = process.argv.slice(2);
const confirm = args.includes('--confirm');
const fileArg = args.indexOf('--file');
const XLSX_PATH = fileArg >= 0 ? args[fileArg + 1] : 'C:/Users/BigYa-spare/Downloads/ANIN LABEL MASTER (1).xlsx';
const sb = labelClient();

// ต้องใช้ไฟล์ที่นำเข้าเป็นตัวชี้ว่าแถวไหน "ถูกทับ" (กลุ่ม A) — แถวที่ไม่ตรงไฟล์คือกลุ่ม C ที่ import ไม่เคยแตะ
const fileKeys = parseLabelWorkbook(XLSX_PATH).keys;
console.log(`ไฟล์ที่นำเข้า: ${XLSX_PATH} → ${fileKeys.size} คีย์`);

// ---------- อ่านข้อความไทยต้นฉบับจาก import-labels.sql ----------
// รูปแบบแถว: ('sku', 'usage_ref', 'th', 'trade', 'generic', 'usage', 'indication', 'warning', 'storage'),
const sql = readFileSync('import-labels.sql', 'utf8');
const FIELD = String.raw`'((?:[^']|'')*)'`;
const RE = new RegExp(String.raw`^\s*\(${FIELD},\s*${FIELD},\s*'th',\s*${FIELD},\s*${FIELD},\s*${FIELD},\s*${FIELD},\s*${FIELD},\s*${FIELD}\)`, 'gm');
const un = s => (s === null || s === undefined ? null : s.replace(/''/g, "'"));

const origBySku = new Map();
for (const m of sql.matchAll(RE)) {
  const sku = un(m[1]);
  const rec = {
    sku, usage_ref: un(m[2]),
    trade_name: un(m[3]), generic_name: un(m[4]), usage: un(m[5]),
    indication: un(m[6]), warning: un(m[7]), storage: un(m[8]),
  };
  if (!origBySku.has(sku)) origBySku.set(sku, []);
  origBySku.get(sku).push(rec);
}
console.log(`import-labels.sql: พบข้อความไทยต้นฉบับ ${[...origBySku.values()].flat().length} แถว (${origBySku.size} SKU)`);

// ---------- สถานะปัจจุบัน ----------
console.log('กำลังดึงข้อมูลจาก Supabase...');
const medicines = await fetchAll(sb, 'medicines', 'id, sku, usage_ref');
const trans     = await fetchAll(sb, 'medicine_translations',
  'id, medicine_id, lang, trade_name, generic_name, usage, indication, warning, storage');

const hasOther = new Set(trans.filter(t => t.lang !== 'th').map(t => t.medicine_id));
const thByMed  = new Map(trans.filter(t => t.lang === 'th').map(t => [t.medicine_id, t]));
const enByMed  = new Map(trans.filter(t => t.lang === 'en').map(t => [t.medicine_id, t]));

const skuCount = new Map();
for (const m of medicines) skuCount.set(m.sku, (skuCount.get(m.sku) ?? 0) + 1);

// กลุ่ม A = มีคำแปลภาษาอื่น (ของเดิม) AND คีย์ตรงไฟล์ (= ถูก import แตะ)
// แถวที่มีภาษาอื่นแต่ไม่ตรงไฟล์คือกลุ่ม C ซึ่ง import ไม่เคยแตะ ต้องไม่ยุ่งด้วย
const withOther = medicines.filter(m => hasOther.has(m.id) && fileKeys.has(`${m.sku}|${m.usage_ref ?? ''}`));
const groupC    = medicines.filter(m => hasOther.has(m.id) && !fileKeys.has(`${m.sku}|${m.usage_ref ?? ''}`));

const restore = [];   // กู้อัตโนมัติได้
const manual  = [];   // ต้องตรวจเอง
for (const m of withOther) {
  const th = thByMed.get(m.id);
  const list = origBySku.get(m.sku);
  if (!list) { manual.push({ m, th, reason: 'ไม่มีใน import-labels.sql' }); continue; }
  if (list.length !== 1 || skuCount.get(m.sku) !== 1) {
    manual.push({ m, th, reason: `SKU มีหลาย variant (DB ${skuCount.get(m.sku)} · SQL ${list.length})` });
    continue;
  }
  const o = list[0];
  const same = th && th.trade_name === o.trade_name && th.generic_name === o.generic_name &&
               th.usage === o.usage && th.indication === o.indication &&
               th.warning === o.warning && th.storage === o.storage && m.usage_ref === o.usage_ref;
  if (same) continue;   // ไม่ถูกทับ ไม่ต้องแตะ
  restore.push({ m, th, orig: o });
}

console.log(`\n=== กลุ่ม A (มีภาษาอื่น + คีย์ตรงไฟล์ = ถูกทับ) ${withOther.length} แถว ===`);
console.log(`  กู้อัตโนมัติได้             = ${restore.length}`);
console.log(`  ต้องตรวจเอง (เขียนลง CSV)  = ${manual.length}`);
console.log(`  ตรงต้นฉบับอยู่แล้ว ไม่ต้องแตะ = ${withOther.length - restore.length - manual.length}`);
console.log(`  (กลุ่ม C ${groupC.length} แถวที่ import ไม่เคยแตะ — ข้ามไป ไม่ยุ่งด้วย)`);

if (restore.length) {
  console.log('\nตัวอย่าง 5 แถวที่จะกู้ (ปัจจุบัน → ต้นฉบับ):');
  for (const r of restore.slice(0, 5)) {
    console.log(`  ${r.m.sku}`);
    console.log(`     ชื่อการค้า: ${(r.th?.trade_name ?? '-')}  →  ${r.orig.trade_name ?? '-'}`);
    console.log(`     ชื่อยา    : ${(r.th?.generic_name ?? '-')}  →  ${r.orig.generic_name ?? '-'}`);
  }
}

// ---------- กู้ "ชื่อการค้า" ของแถวที่เหลือจากคำแปลภาษาอังกฤษ ----------
// ตรวจกับ import-labels.sql แล้ว: ชื่อการค้า th กับ en ตรงกัน 167/167 = 100% (เป็นชื่อแบรนด์ ไม่ได้แปล)
// จึงคืนได้อย่างมั่นใจ · ส่วน "ชื่อยา" ตรงกันแค่ 144/167 = 86% ไม่พอให้เดา ปล่อยไว้ใน CSV
const tradeFromEn = [];
for (const item of manual) {
  const en = enByMed.get(item.m.id);
  if (!en?.trade_name) continue;
  if (item.th?.trade_name === en.trade_name) continue;   // ตรงอยู่แล้ว
  tradeFromEn.push({ ...item, newTrade: en.trade_name });
}
console.log(`\n  ในนี้กู้ "ชื่อการค้า" จากภาษาอังกฤษได้อีก ${tradeFromEn.length} แถว (ช่องอื่นยังต้องกรอกเอง)`);
if (tradeFromEn.length) {
  for (const t of tradeFromEn.slice(0, 3)) {
    console.log(`     ${t.m.sku}: ${t.th?.trade_name ?? '-'}  →  ${t.newTrade}`);
  }
}

// ---------- CSV รายการที่ต้องแก้เอง ----------
const csvEsc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
const csv = [
  ['sku', 'เหตุผล', 'usage_ref ปัจจุบัน', 'th ชื่อการค้า (ผิด)', 'th ชื่อยา', 'th วิธีใช้',
   'en ชื่อการค้า', 'en ชื่อยา', 'en วิธีใช้', 'en ข้อบ่งใช้', 'en ข้อควรระวัง', 'en การเก็บรักษา'].join(','),
  ...manual.map(({ m, th, reason }) => {
    const en = enByMed.get(m.id);
    return [m.sku, reason, m.usage_ref, th?.trade_name, th?.generic_name, th?.usage,
            en?.trade_name, en?.generic_name, en?.usage, en?.indication, en?.warning, en?.storage].map(csvEsc).join(',');
  }),
].join('\n');
writeFileSync('label-restore-manual.csv', '﻿' + csv, 'utf8');   // BOM ให้ Excel อ่านไทยถูก
console.log(`\nเขียน label-restore-manual.csv แล้ว (${manual.length} แถว พร้อมคำแปลอังกฤษไว้ใช้กรอกกลับ)`);

if (!confirm) {
  console.log(`\n[dry-run] ยังไม่เขียนอะไร — รันซ้ำด้วย --confirm เพื่อกู้ ${restore.length} แถวเต็ม + ชื่อการค้าอีก ${tradeFromEn.length} แถว`);
  process.exit(0);
}

let done = 0;
for (const { m, orig } of restore) {
  // คืน usage_ref ของ medicines ด้วย ไม่ใช่แค่คำแปล — import เปลี่ยนค่านี้ไปตอนเส้นทาง reuse
  const { error: mErr } = await sb.from('medicines').update({ usage_ref: orig.usage_ref }).eq('id', m.id);
  if (mErr) throw new Error(`อัปเดต medicines ${m.sku} ไม่สำเร็จ: ${mErr.message}`);

  const { error: tErr } = await sb.from('medicine_translations').upsert({
    medicine_id: m.id, lang: 'th',
    trade_name: orig.trade_name, generic_name: orig.generic_name, usage: orig.usage,
    indication: orig.indication, warning: orig.warning, storage: orig.storage,
  }, { onConflict: 'medicine_id,lang' });
  if (tErr) throw new Error(`อัปเดตคำแปล ${m.sku} ไม่สำเร็จ: ${tErr.message}`);

  done++;
  process.stdout.write(`\r  กู้แล้ว ${done}/${restore.length}`);
}
console.log(`\n✅ กู้ภาษาไทยเต็มรูปแบบ ${done} แถว`);

let doneTrade = 0;
for (const t of tradeFromEn) {
  const { error } = await sb.from('medicine_translations')
    .update({ trade_name: t.newTrade }).eq('medicine_id', t.m.id).eq('lang', 'th');
  if (error) throw new Error(`อัปเดตชื่อการค้า ${t.m.sku} ไม่สำเร็จ: ${error.message}`);
  doneTrade++;
  process.stdout.write(`\r  กู้ชื่อการค้า ${doneTrade}/${tradeFromEn.length}`);
}
if (tradeFromEn.length) console.log(`\n✅ กู้ชื่อการค้าจากภาษาอังกฤษอีก ${doneTrade} แถว`);

console.log(`\nเหลือ ${manual.length} แถวใน label-restore-manual.csv ที่ต้องตรวจ/กรอกช่องที่เหลือเอง`);
console.log('   (ชื่อยา / วิธีใช้ / ข้อบ่งใช้ / ข้อควรระวัง / การเก็บรักษา — ในไฟล์มีคำแปลอังกฤษให้เทียบ)');
