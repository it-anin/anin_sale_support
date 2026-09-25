/**
 * r05106.ts — อ่านไฟล์ R05.106 (CSV จาก ProMaxx) สำหรับปุ่มอัปโหลดด่วนหน้าป้ายราคา
 *
 * 🔗 ลอกมาจาก upload-products.mjs ของ repo it-anin/botr05106 (parseCSV /
 *    PRODUCT_CSV_COLUMNS / resolveProductCsvColumns / buildProductRows) — ห้ามแก้ตรรกะแยกกัน
 *    ถ้า ProMaxx เปลี่ยนหัวคอลัมน์ ต้องแก้ทั้ง 2 ที่
 *    ฝั่งเขียน DB ไม่ได้ลอก: ทั้งคู่จบที่ swap_products_from_import() ตัวเดียวกัน
 *    (เว็บเรียกผ่าน RPC upload_products_from_web — supabase/migrations/202609250001)
 */

export type ProductImportRow = {
  barcode: string;
  sku: string;
  name: string;
  unit: string;
  price: number;
  category: string;
  base_multiple: number | null;
};

// ⚠️ ค้นคอลัมน์จาก "ชื่อหัว" เท่านั้น ไม่มี fallback ตำแหน่ง — fallback ทำให้ไฟล์ผิดรูปแบบหลุดผ่าน
//    แล้วทับ products ทิ้งทั้งตาราง
const PRODUCT_CSV_COLUMNS = [
  { key: 'barcode',      header: 'CF_BARCODE',               label: 'บาร์โค้ด' },
  { key: 'price',        header: 'CF_FMLPRICE',              label: 'ราคา' },
  { key: 'sku',          header: 'CF_ITEMID',                label: 'SKU' },
  { key: 'name',         header: 'CF_ITEMNAME',              label: 'ชื่อสินค้า' },
  { key: 'unit',         header: 'CF_UNITNAME',              label: 'หน่วย' },
  { key: 'baseMultiple', header: 'CF_BASEMULTIPLE',          label: 'ตัวคูณหน่วย' },
  // หมวดอยู่คอลัมน์ Q ไม่ใช่ C — C คือ CF_COMMENTS (โน้ตอิสระ ว่าง 99.5% ของแถว)
  { key: 'category',     header: 'CF_ITEMGROUPL1_GROUPNAME', label: 'หมวด' },
] as const;

type ColKey = typeof PRODUCT_CSV_COLUMNS[number]['key'];

/**
 * - `"` เปิด quoted mode เฉพาะตอน field === '' → inch mark กลางชื่อ (2") ไม่พัง
 * - ใน quoted mode `\n` ถูกเก็บเป็นตัวอักษร → ชื่อสินค้าที่มีขึ้นบรรทัดใหม่ไม่ทำให้แถวแตก
 */
function parseCSV(text: string): string[][] {
  const lines: string[][] = [];
  let field = '', row: string[] = [], inQuote = false;
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

function resolveColumns(headerRow: string[] | undefined): Record<ColKey, number> {
  const head = (headerRow ?? []).map(h => String(h ?? '').trim().toUpperCase());
  const idx = {} as Record<ColKey, number>;
  const missing: string[] = [];
  for (const col of PRODUCT_CSV_COLUMNS) {
    const i = head.indexOf(col.header);
    if (i < 0) missing.push(`${col.header} (${col.label})`);
    else idx[col.key] = i;
  }
  if (missing.length > 0) {
    const found = head.filter(Boolean);
    throw new Error(
      `ไฟล์นี้ไม่ใช่รายงาน R05.106\n`
      + `ไม่พบคอลัมน์: ${missing.join(', ')}\n`
      + `หัวคอลัมน์ที่เจอ: ${found.slice(0, 8).join(', ')}${found.length > 8 ? ' ...' : ''}\n`
      + `→ ยังไม่ได้แตะข้อมูลเดิม`,
    );
  }
  return idx;
}

/** อ่านข้อความไฟล์ทั้งก้อน → แถวพร้อมส่ง RPC · ไฟล์ผิดรูปแบบ throw ก่อนแตะ DB */
export function parseR05106(text: string): { rows: ProductImportRow[]; csvRows: number; skipped: number } {
  // ตัด BOM — ไม่ตัดแล้วหัวคอลัมน์แรกเป็น ﻿CF_BARCODE แล้วเช็คหัวพัง
  const data = parseCSV(text.replace(/^﻿/, ''));
  if (data.length < 2) throw new Error('ไฟล์ไม่มีข้อมูล');
  const col = resolveColumns(data[0]);

  // ⚠️ ไม่ dedupe — คู่ sku-unit ซ้ำ ~80 คู่ในข้อมูลจริงเป็นของถูกต้อง (docs/database.md)
  const rows: ProductImportRow[] = [];
  let skipped = 0;
  for (let i = 1; i < data.length; i++) {
    const row = data[i] ?? [];
    const barcode = (row[col.barcode] ?? '').trim();
    const sku = (row[col.sku] ?? '').trim();
    if (!barcode || !sku) { skipped++; continue; }
    const bm = parseFloat(row[col.baseMultiple]);
    rows.push({
      barcode,
      sku,
      name: (row[col.name] ?? '').trim().split(/[\r\n]/)[0].trim(),
      unit: (row[col.unit] ?? '').trim(),
      price: parseFloat(row[col.price]) || 0,
      category: (row[col.category] ?? '').trim() || 'ทั่วไป',
      base_multiple: Number.isFinite(bm) ? bm : null,
    });
  }
  if (rows.length === 0) throw new Error('ไม่พบแถวที่มีทั้งบาร์โค้ดและ SKU');
  return { rows, csvRows: data.length - 1, skipped };
}
