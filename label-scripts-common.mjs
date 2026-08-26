// ============================================================
// helper ร่วมของสคริปต์กู้คืนข้อมูลฉลากยา (label-backup / label-rollback-import / label-restore-th)
//
// 🚨 ต้องใช้ VITE_SUPABASE_ANON_KEY เท่านั้น — SUPABASE_SERVICE_KEY ได้ "permission denied for schema label"
//    เพราะ supabase-setup.sql ให้ GRANT USAGE ON SCHEMA label แค่ anon, authenticated ไม่เคยให้ service_role
// ============================================================

import { readFileSync } from 'fs';
import * as XLSX from 'xlsx';
import { createClient } from '@supabase/supabase-js';

export function loadEnv(file = '.env') {
  const out = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const i = line.indexOf('=');
    if (i < 0 || line.trim().startsWith('#')) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/\r/g, '').replace(/^"|"$/g, '');
  }
  return out;
}

export function labelClient() {
  const env = loadEnv();
  if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY) {
    throw new Error('ไม่พบ VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY ใน .env');
  }
  // schema label + anon key — ชุดเดียวกับ supabaseLabelWrite ใน druglabel/supabase.ts
  return createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
    db: { schema: 'label' },
    auth: { persistSession: false },
  });
}

/** ดึงทุกแถว — Supabase คืน default 1000 แถวต่อ query ต้องวน .range() จนหมด */
export async function fetchAll(sb, table, columns) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select(columns).range(from, from + 999);
    if (error) throw new Error(`อ่าน ${table} ไม่สำเร็จ: ${error.message}`);
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

// ---------- parse ชีท Data_Static ----------
// ⚠️ กติกาต้องตรงกับ parseLabelSheet ใน druglabel/DrugLabelPage.tsx เป๊ะๆ
//    ถ้า key ที่ได้ไม่ตรงกัน สคริปต์ rollback จะชี้ผิดแถว
export const IMPORT_COL = { sku: 0, indication: 3, usage: 4, warning: 5, storage: 6, generic_name: 7, trade1: 8, trade2: 9 };
export const TRADE_NAME_SEP = ' / ';
export const IMPORT_SHEET = 'Data_Static';

export function parseLabelWorkbook(path, sheetName = IMPORT_SHEET) {
  const wb = XLSX.read(readFileSync(path));
  const found = wb.SheetNames.find(n => n.trim().toLowerCase() === sheetName.toLowerCase());
  if (!found) throw new Error(`ไม่พบชีท "${sheetName}" — ชีทที่มี: ${wb.SheetNames.join(', ')}`);

  const aoa = XLSX.utils.sheet_to_json(wb.Sheets[found], { header: 1, defval: '', blankrows: false, raw: false });
  if (aoa.length < 2) throw new Error('ไฟล์ไม่มีข้อมูล');
  const dataRows = aoa.slice(1);   // ข้ามแถวหัวคอลัมน์เสมอ

  const cell = (r, i) => {
    const v = String(r[i] ?? '').trim();
    return v === '-' ? '' : v;
  };

  const rows = [];
  const seen = new Set();
  let skippedNoSku = 0, skippedEmpty = 0, dupInFile = 0;

  for (const r of dataRows) {
    let sku = cell(r, IMPORT_COL.sku);
    if (!sku) { skippedNoSku++; continue; }
    if (/^\d{1,5}$/.test(sku)) sku = sku.padStart(6, '0');

    const t1 = cell(r, IMPORT_COL.trade1);
    const t2 = cell(r, IMPORT_COL.trade2);
    const row = {
      sku,
      trade_name:   t1 && t2 ? `${t1}${TRADE_NAME_SEP}${t2}` : (t1 || t2),
      generic_name: cell(r, IMPORT_COL.generic_name),
      usage:        cell(r, IMPORT_COL.usage),
      indication:   cell(r, IMPORT_COL.indication),
      warning:      cell(r, IMPORT_COL.warning),
      storage:      cell(r, IMPORT_COL.storage),
      usage_ref:    cell(r, IMPORT_COL.usage).slice(0, 100),
    };
    if (!row.trade_name && !row.generic_name && !row.usage && !row.indication && !row.warning && !row.storage) {
      skippedEmpty++; continue;
    }
    const key = `${row.sku}|${row.usage_ref}`;
    if (seen.has(key)) { dupInFile++; continue; }
    seen.add(key);
    rows.push(row);
  }
  return { sheetName: found, rows, keys: seen, totalDataRows: dataRows.length, skippedNoSku, skippedEmpty, dupInFile };
}

/** แบ่ง medicines เป็น 4 กลุ่มตามที่ใช้ในแผนกู้คืน */
export function classify(medicines, fileKeys, hasOtherLang) {
  const A = [], B = [], C = [], D = [];
  for (const m of medicines) {
    const inFile = fileKeys.has(`${m.sku}|${m.usage_ref ?? ''}`);
    const other  = hasOtherLang.has(m.id);
    if (inFile && other) A.push(m);
    else if (inFile)     B.push(m);
    else if (other)      C.push(m);
    else                 D.push(m);
  }
  return { A, B, C, D };
}

export const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
