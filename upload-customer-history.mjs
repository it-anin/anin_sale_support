/**
 * upload-customer-history.mjs
 * อ่านรายงานประวัติลูกค้าแบบสะสม แล้วอัปโหลดเฉพาะข้อมูลใหม่/ข้อมูลที่ใหม่กว่าเข้า Supabase
 *
 * รันประจำวัน: node upload-customer-history.mjs
 * ตรวจย้อนหลังทั้งหมด: node upload-customer-history.mjs --full-scan
 * --append ยังคงรองรับเพื่อความเข้ากันได้ และทำงานเหมือนโหมดประจำวัน
 *
 * ต้องรัน customer-history-incremental-migration.sql ใน Supabase ก่อนใช้งาน
 *
 * CSV Columns (zero-indexed):
 *   B(1)   = วันที่ซื้อ (purchase_date) — format D/M/YYYY H:MM:SS
 *   X(23)  = SKU
 *   Y(24)  = ชื่อสินค้า (product_name)
 *   AJ(35) = เบอร์โทร (phone)
 *   AK(36) = ชื่อ (first_name)
 *   AL(37) = นามสกุล (last_name)
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

// ─── CONFIG ───────────────────────────────────────────────
const CSV_CANDIDATES = [
  'C:\\Users\\AninMainPC\\Desktop\\run-upload-stock\\customer_history.csv',
  'C:\\Users\\AninMainPC\\Desktop\\run-upload-stock\\customer_history.CSV',
  'C:\\Users\\Arm\\Documents\\update_stock\\customer_history.csv',
  'C:\\Users\\BigYa-spare\\Desktop\\run-upload-stock\\customer_history.csv',
  'C:\\Users\\BigYa-spare\\Desktop\\run-upload-stock\\customer_history.CSV',
  'C:\\Users\\BigYa-spare\\Documents\\update_stock\\customer_history.csv',
  'C:\\Users\\BigYa-spare\\Documents\\update_stock\\customer_history.CSV',
];

const SUPABASE_URL = 'https://eogqnedbdpjuptwlqudn.supabase.co';
const READ_CHUNK = 50;
const WRITE_CHUNK = 500;
const OVERLAP_DAYS = 7;

function getServiceKey() {
  if (process.env.SUPABASE_SERVICE_KEY) return process.env.SUPABASE_SERVICE_KEY.trim();
  try {
    const envText = readFileSync(new URL('./.env', import.meta.url), 'utf-8');
    const m = envText.match(/^\s*SUPABASE_SERVICE_KEY\s*=\s*(.+)\s*$/m);
    if (m) return m[1].trim();
  } catch {
    // ไม่มีไฟล์ .env ก็ข้าม
  }
  return null;
}
// ──────────────────────────────────────────────────────────

function cleanDisplayText(raw, firstLineOnly = false) {
  let value = String(raw ?? '').trim();
  if (firstLineOnly) value = value.split(/[\r\n]/)[0];
  return value.replace(/\s+/g, ' ').trim();
}

export function normalizePhone(raw) {
  let digits = String(raw ?? '').replace(/\D/g, '');
  if ((digits.length === 8 || digits.length === 9) && !digits.startsWith('0')) {
    digits = `0${digits}`;
  }
  return digits;
}

export function normalizeKeyText(raw) {
  return cleanDisplayText(raw).toLocaleLowerCase('th-TH');
}

function keySegment(prefix, value) {
  return `${prefix}${Buffer.byteLength(value, 'utf8')}:${value}`;
}

export function makeDedupeKey({ phone, first_name, last_name, sku, product_name }) {
  const normalizedPhone = normalizePhone(phone);
  const firstNameKey = normalizeKeyText(first_name);
  const lastNameKey = normalizeKeyText(last_name);
  const skuKey = normalizeKeyText(sku);
  const productNameKey = normalizeKeyText(product_name);

  const customerKey = normalizedPhone
    ? keySegment('p', normalizedPhone)
    : `${keySegment('f', firstNameKey)}${keySegment('l', lastNameKey)}`;
  const productKey = skuKey
    ? keySegment('s', skuKey)
    : keySegment('d', productNameKey);

  if ((!normalizedPhone && !firstNameKey && !lastNameKey) || (!skuKey && !productNameKey)) {
    return null;
  }
  return `${customerKey}${productKey}`;
}

export function parseThaiDateTime(raw) {
  const match = String(raw ?? '').trim().match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/,
  );
  if (!match) return null;

  const [, dRaw, mRaw, yRaw, hhRaw = '0', mmRaw = '0', ssRaw = '0'] = match;
  const d = Number(dRaw);
  const m = Number(mRaw);
  const y = Number(yRaw);
  const hh = Number(hhRaw);
  const mm = Number(mmRaw);
  const ss = Number(ssRaw);
  if (m < 1 || m > 12 || d < 1 || d > 31 || hh > 23 || mm > 59 || ss > 59) return null;

  const date = new Date(Date.UTC(y, m - 1, d, hh, mm, ss));
  if (
    date.getUTCFullYear() !== y
    || date.getUTCMonth() !== m - 1
    || date.getUTCDate() !== d
    || date.getUTCHours() !== hh
    || date.getUTCMinutes() !== mm
    || date.getUTCSeconds() !== ss
  ) {
    return null;
  }

  const pad = n => String(n).padStart(2, '0');
  return `${y}-${pad(m)}-${pad(d)}T${pad(hh)}:${pad(mm)}:${pad(ss)}`;
}

export function parseCSV(text) {
  const lines = [];
  let field = '';
  let row = [];
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuote) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuote = false;
      } else {
        field += ch;
      }
    } else if (ch === '"' && field === '') {
      inQuote = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      lines.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') {
      field += ch;
    }
  }
  if (field || row.length) {
    row.push(field);
    lines.push(row);
  }
  return lines;
}

export function prepareItems(rows) {
  const latestByKey = new Map();
  const stats = {
    csvRows: Math.max(0, rows.length - 1),
    validRows: 0,
    duplicateRows: 0,
    skippedRows: 0,
    skipReasons: {
      shortRow: 0,
      invalidDate: 0,
      missingCustomer: 0,
      missingProduct: 0,
    },
  };

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length < 38) {
      stats.skippedRows++;
      stats.skipReasons.shortRow++;
      continue;
    }

    const purchase_date = parseThaiDateTime(row[1]);
    if (!purchase_date) {
      stats.skippedRows++;
      stats.skipReasons.invalidDate++;
      continue;
    }

    const phone = normalizePhone(row[35]);
    const first_name = cleanDisplayText(row[36]);
    const last_name = cleanDisplayText(row[37]);
    const sku = cleanDisplayText(row[23]);
    const product_name = cleanDisplayText(row[24], true);

    if (!phone && !first_name && !last_name) {
      stats.skippedRows++;
      stats.skipReasons.missingCustomer++;
      continue;
    }
    if (!sku && !product_name) {
      stats.skippedRows++;
      stats.skipReasons.missingProduct++;
      continue;
    }

    const item = { purchase_date, phone, first_name, last_name, sku, product_name };
    const dedupe_key = makeDedupeKey(item);
    if (!dedupe_key) {
      stats.skippedRows++;
      continue;
    }

    stats.validRows++;
    const next = { ...item, dedupe_key };
    const previous = latestByKey.get(dedupe_key);
    if (previous) stats.duplicateRows++;
    if (!previous || next.purchase_date >= previous.purchase_date) {
      latestByKey.set(dedupe_key, next);
    }
  }

  return { items: [...latestByKey.values()], stats };
}

export function calculateCutoff(latestPurchaseDate, overlapDays = OVERLAP_DAYS) {
  if (!latestPurchaseDate) return null;
  const datePart = String(latestPurchaseDate).slice(0, 10);
  const date = new Date(`${datePart}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() - overlapDays);
  return date.toISOString().slice(0, 19);
}

const MUTABLE_FIELDS = [
  'purchase_date',
  'phone',
  'first_name',
  'last_name',
  'sku',
  'product_name',
];

export function classifyChanges(candidates, existingRows) {
  const existingByKey = new Map(existingRows.map(row => [row.dedupe_key, row]));
  const changed = [];
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;

  for (const candidate of candidates) {
    const existing = existingByKey.get(candidate.dedupe_key);
    if (!existing) {
      inserted++;
      changed.push(candidate);
      continue;
    }

    const existingDate = String(existing.purchase_date ?? '').slice(0, 19);
    const isNewer = candidate.purchase_date > existingDate;
    const sameDateCorrection = candidate.purchase_date === existingDate
      && MUTABLE_FIELDS.some(field => (candidate[field] ?? '') !== (existing[field] ?? ''));

    if (isNewer || sameDateCorrection) {
      updated++;
      changed.push(candidate);
    } else {
      unchanged++;
    }
  }

  return { changed, inserted, updated, unchanged };
}

async function fetchLatestPurchaseDate(supabase) {
  const { data, error } = await supabase
    .from('customer_history')
    .select('purchase_date')
    .not('purchase_date', 'is', null)
    .order('purchase_date', { ascending: false })
    .limit(1);
  if (error) throw new Error(`อ่านวันที่ล่าสุดไม่สำเร็จ: ${error.message}`);
  return data?.[0]?.purchase_date ?? null;
}

async function fetchExistingRows(supabase, candidates) {
  const fields = `dedupe_key,${MUTABLE_FIELDS.join(',')}`;
  const existing = [];
  for (let i = 0; i < candidates.length; i += READ_CHUNK) {
    const keys = candidates.slice(i, i + READ_CHUNK).map(item => item.dedupe_key);
    const { data, error } = await supabase
      .from('customer_history')
      .select(fields)
      .in('dedupe_key', keys);
    if (error) {
      if (error.message.includes('dedupe_key')) {
        throw new Error(
          'ไม่พบคอลัมน์ dedupe_key — กรุณารัน customer-history-incremental-migration.sql ใน Supabase ก่อน',
        );
      }
      throw new Error(`อ่านข้อมูลเดิมไม่สำเร็จ: ${error.message}`);
    }
    if (data) existing.push(...data);
  }
  return existing;
}

async function writeChanges(supabase, changed) {
  const uploadedAt = new Date().toISOString();
  for (let i = 0; i < changed.length; i += WRITE_CHUNK) {
    const batch = changed.slice(i, i + WRITE_CHUNK).map(item => ({
      ...item,
      uploaded_at: uploadedAt,
    }));
    const { error } = await supabase
      .from('customer_history')
      .upsert(batch, { onConflict: 'dedupe_key', ignoreDuplicates: false });
    if (error) throw new Error(`upsert ไม่สำเร็จ: ${error.message}`);
  }
}

export function buildSyncStatusPayload({ stats, result, fullScan, latestPurchaseDate, checkedAt }) {
  const payload = {
    id: 1,
    last_checked_at: checkedAt,
    csv_rows: stats.csvRows,
    candidate_rows: result.candidateRows,
    inserted_count: result.inserted,
    updated_count: result.updated,
    unchanged_count: result.unchanged,
    skipped_count: stats.skippedRows,
    full_scan: fullScan,
    latest_purchase_date: latestPurchaseDate || null,
  };
  if (result.inserted + result.updated > 0) {
    payload.last_changed_at = checkedAt;
  }
  return payload;
}

async function recordSyncStatus(supabase, status) {
  const { error } = await supabase
    .from('customer_history_sync_status')
    .upsert(status, { onConflict: 'id', ignoreDuplicates: false });
  if (error) {
    throw new Error(
      `บันทึกเวลา sync ไม่สำเร็จ: ${error.message} — กรุณารัน customer-history-sync-status.sql ใน Supabase`,
    );
  }
}

function logSummary(stats, result) {
  console.log('');
  console.log('── สรุป ─────────────────────────────');
  console.log(`   CSV ทั้งหมด          ${stats.csvRows.toLocaleString()} แถว`);
  console.log(`   ผ่าน validation      ${stats.validRows.toLocaleString()} แถว`);
  console.log(`   ยุบแถวซ้ำใน CSV      ${stats.duplicateRows.toLocaleString()} แถว`);
  console.log(`   นอกช่วงตรวจรายวัน    ${result.outsideWindow.toLocaleString()} แถว`);
  console.log(`   เพิ่มใหม่             ${result.inserted.toLocaleString()} แถว`);
  console.log(`   อัปเดต               ${result.updated.toLocaleString()} แถว`);
  console.log(`   ไม่เปลี่ยนแปลง       ${result.unchanged.toLocaleString()} แถว`);
  console.log(`   ข้าม                 ${stats.skippedRows.toLocaleString()} แถว`);
  if (stats.skippedRows) {
    console.log(
      `      แถวไม่ครบ=${stats.skipReasons.shortRow}, วันที่ผิด=${stats.skipReasons.invalidDate}, `
      + `ไม่มีลูกค้า=${stats.skipReasons.missingCustomer}, ไม่มีสินค้า=${stats.skipReasons.missingProduct}`,
    );
  }
}

export async function main(argv = process.argv.slice(2)) {
  const timestamp = new Date().toLocaleString('th-TH');
  const fullScan = argv.includes('--full-scan');
  console.log(`[${timestamp}] เริ่มอัปโหลดประวัติลูกค้าแบบ incremental...`);
  console.log(`   โหมด: ${fullScan ? 'ตรวจย้อนหลังทั้งหมด' : `ประจำวัน (ย้อนหลัง ${OVERLAP_DAYS} วัน)`}`);

  const supabaseKey = getServiceKey();
  if (!supabaseKey) {
    throw new Error('ไม่พบ SUPABASE_SERVICE_KEY ใน environment หรือไฟล์ .env');
  }

  const csvPath = CSV_CANDIDATES.find(path => existsSync(path));
  if (!csvPath) {
    throw new Error(`ไม่พบ customer_history.csv ใน path:\n${CSV_CANDIDATES.map(p => `   - ${p}`).join('\n')}`);
  }
  console.log(`   ใช้ไฟล์: ${csvPath}`);

  const rows = parseCSV(readFileSync(csvPath, 'utf-8'));
  const { items, stats } = prepareItems(rows);
  if (items.length === 0) {
    logSummary(stats, { outsideWindow: 0, inserted: 0, updated: 0, unchanged: 0 });
    throw new Error('ไม่พบข้อมูลที่ผ่าน validation');
  }

  const supabase = createClient(SUPABASE_URL, supabaseKey);
  const latestPurchaseDate = await fetchLatestPurchaseDate(supabase);
  const cutoff = fullScan ? null : calculateCutoff(latestPurchaseDate);
  const candidates = cutoff
    ? items.filter(item => item.purchase_date >= cutoff)
    : items;
  const outsideWindow = items.length - candidates.length;

  if (cutoff) console.log(`   ตรวจข้อมูลตั้งแต่: ${cutoff.replace('T', ' ')}`);
  console.log(`   เปรียบเทียบกับ Supabase ${candidates.length.toLocaleString()} รายการ...`);

  const existingRows = await fetchExistingRows(supabase, candidates);
  const result = classifyChanges(candidates, existingRows);
  if (result.changed.length) {
    console.log(`   กำลังบันทึก ${result.changed.length.toLocaleString()} รายการ...`);
    await writeChanges(supabase, result.changed);
  }

  const checkedAt = new Date().toISOString();
  await recordSyncStatus(supabase, buildSyncStatusPayload({
    stats,
    result: { ...result, candidateRows: candidates.length },
    fullScan,
    latestPurchaseDate: items.reduce(
      (latest, item) => item.purchase_date > latest ? item.purchase_date : latest,
      '',
    ),
    checkedAt,
  }));

  logSummary(stats, { ...result, outsideWindow });
  console.log(`✅ สำเร็จ — เพิ่ม ${result.inserted} / อัปเดต ${result.updated}`);
  return { stats, ...result, outsideWindow };
}

const isDirectRun = process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isDirectRun) {
  main().catch(error => {
    console.error(`❌ ${error.message}`);
    process.exitCode = 1;
  });
}
