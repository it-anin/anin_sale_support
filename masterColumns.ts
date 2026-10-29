import type { WorkSheet } from 'xlsx';

/** โครงคอลัมน์ของไฟล์ Product Master — เรื่องหัวคอลัมน์ของไฟล์อยู่ที่ไฟล์นี้ที่เดียว (2569-10-29)
 *  ผู้ใช้สั่ง: "อัปโหลด Product Master เพิ่มการตรวจคอลัมน์ไฟล์ .xlsx — ถ้าไฟล์มี เพิ่ม/เปลี่ยน/ลบ คอลัมน์
 *  ให้ขึ้น popup แจ้งว่าไม่สามารถอัปโหลดได้" → handleMasterFile (SaleSupportPage.tsx) เรียก diffMasterHeaders
 *  ก่อนอ่านแถวข้อมูล และก่อนแตะตาราง product_master · popup คือ MasterRejectNotice.tsx
 *  ⚠️ ไฟล์นี้ import 'xlsx' แค่ type (ไม่มีโค้ดตอนรัน) เพื่อให้ masterColumns.test.mjs โหลดไปเทสได้ตรง ๆ */

// จับคู่หัวคอลัมน์ในไฟล์ Product_Master → คอลัมน์ในตาราง (เรียงจากเฉพาะเจาะจงก่อน)
// ย้ายมาจาก SaleSupportPage.tsx (ไม่เปลี่ยนค่า) — ตัวนี้ "อ่านไฟล์" แบบหลวม (ไม่สนตัวพิมพ์/เว้นวรรค) ส่วนตัวตรวจด้านล่าง "ตรวจโครงไฟล์" แบบเข้ม
export const MASTER_HEADER_MAP: [RegExp, string][] = [
  [/^sku[\s_]*name$/i,      'sku_name'],
  [/^sku$/i,                'sku'],
  [/^name$|ชื่อสินค้า/i,     'name'],
  [/base[\s_]*unit/i,       'base_unit'],
  [/^abc$/i,                'abc'],
  [/multiply/i,             'multiply'],
  [/^supplier$/i,           'supplier'],
  [/set[\s_]*deal/i,        'set_deal'],
  [/purchase[\s_]*unit/i,   'purchase_unit'],
  [/barcode[\s_]*unit/i,    'barcode_unit'],
  [/ทุนซื้อ|^cost$/i,        'cost'],
  [/buying[\s_]*deal[\s_]*normal/i, 'buying_deal_normal'],
  [/buying[\s_]*deal[\s_]*free/i,   'buying_deal_free'],
  [/group\s*%|group[\s_]*percent/i, 'group_percent'],
  [/^group$/i,              'group_name'],
  [/distributor[\s_]*name/i, 'distributor_name'],
  [/^distributor$/i,        'distributor'],
];

/** หัวคอลัมน์มาตรฐานของไฟล์ Product Master — ต้องมีครบทุกตัว ไม่งั้นนับเป็น "ลบ"
 *  ⚠️ เขียนตามคอมเมนต์ท้ายแต่ละช่องใน salesupport-setup.sql (ชื่อช่องของตาราง product_master) — ยังไม่ได้เทียบกับ
 *     หัวคอลัมน์ในไฟล์จริง · ถ้าไฟล์จริงสะกดต่างจากนี้ ไฟล์ปกติจะถูกดีดกลับทุกครั้ง แต่ popup บอกเองว่าต่างตรงไหน
 *     (เพิ่ม/เปลี่ยน/ลบ + เซลล์) → แก้ลิสต์นี้ให้ตรงไฟล์จริง และต้องมี regex ใน MASTER_HEADER_MAP รองรับทุกตัวด้วย (มีเทสเช็ค)
 *  ลำดับในลิสต์ไม่ใช่ลำดับที่ไฟล์ต้องเรียง — ไม่ตรวจลำดับคอลัมน์ (importer จับคู่ตามชื่อหัว ไม่ใช่ตำแหน่ง) */
export const MASTER_REQUIRED_HEADERS = [
  'SKU', 'Name', 'BASE_UNIT', 'ABC', 'Multiply', 'Supplier', 'Set_Deal', 'Purchase_Unit', 'Barcode_Unit',
  'ทุนซื้อ', 'Buying_Deal_Normal', 'Buying_Deal_Free', 'Group', 'Group %', 'SKU Name',
] as const;

/** มีหรือไม่มีในไฟล์ก็ได้ (ไม่นับเป็น "ลบ" เมื่อหาย · ไม่นับเป็น "เพิ่ม" เมื่อมี)
 *  Distributor / Distributor Name ระบบเติมจากไฟล์ Supplier ตอนแสดงผลอยู่แล้ว (loadSupplierMap) — เลือกให้เป็นแบบนี้
 *  เพราะไม่รู้ว่าไฟล์จริงมีสองช่องนี้หรือไม่: ถ้าบังคับแล้วไฟล์จริงไม่มี ทุกไฟล์จะโดนดีดกลับ แต่ถ้าปล่อยหลวมแล้วไฟล์มี ก็ไม่เสียหายอะไร */
export const MASTER_OPTIONAL_HEADERS = ['Distributor', 'Distributor Name'] as const;

/** ชื่อที่โชว์แทนคอลัมน์ที่มีข้อมูลแต่เซลล์หัวว่าง */
export const MASTER_NO_HEADER_LABEL = '(ไม่มีหัวคอลัมน์)';

/** 1 คอลัมน์ในแถวหัวของไฟล์ */
export interface MasterHeaderCell {
  text: string;      // ข้อความหัวคอลัมน์ (เว้นวรรคซ้ำ/ตัวอักษรล่องหนถูกตัดแล้ว) · '' = เซลล์หัวว่าง
  cell: string;      // ตำแหน่งเซลล์ของหัวคอลัมน์ เช่น "J1" (แถวคือแถวหัวจริงของชีท ไม่ใช่แถว 1 เสมอ)
  hasData: boolean;  // มีข้อมูลในแถวใต้หัวไหม — ใช้แยก "คอลัมน์จริงที่ลืมใส่หัว" ออกจากคอลัมน์ว่างที่เหลือจากการจัดรูปแบบ
}

export interface MasterAddedColumn { name: string; cell: string }
export interface MasterChangedColumn { from: string; to: string; cell: string }
export interface MasterColumnDiff {
  added: MasterAddedColumn[];      // มีในไฟล์ ไม่มีในมาตรฐาน — เรียงตามคอลัมน์ในไฟล์
  changed: MasterChangedColumn[];  // เปลี่ยนชื่อ: from = ชื่อมาตรฐาน · to = ชื่อในไฟล์ · cell = เซลล์ของ to
  removed: string[];               // มีในมาตรฐาน ไม่มีในไฟล์ (ไม่มีเซลล์ เพราะไม่อยู่ในไฟล์) — เรียงตามมาตรฐาน
}

const INVISIBLE = /[\u200b-\u200d\u2060\ufeff]/g;   // zero-width + BOM — ตาดูไม่ออก แต่ทำให้ชื่อที่หน้าตาเหมือนกันเทียบแล้วไม่เท่ากัน
const cleanText = (s: string) => s.replace(INVISIBLE, '').replace(/\s+/g, ' ').trim();

/** ชื่อสำหรับเทียบ: ตัดเว้นวรรคซ้ำ/ล่องหน → NFKC (ตัวเต็มความกว้าง "Ｇｒｏｕｐ ％" และสระอำสองแบบกลายเป็นแบบเดียวกัน) → ตัวพิมพ์เล็ก
 *  ไม่สนตัวพิมพ์ใหญ่/เล็ก เพราะ importer เดิมก็ไม่สนอยู่แล้ว (regex /i) — ไฟล์ที่ต่างกันแค่ตัวพิมพ์ import ได้ผลเหมือนกันทุกประการ */
export const normalizeHeader = (s: string) => cleanText(s).normalize('NFKC').toLowerCase();

interface ExpectedColumn { name: string; key: string }
const EXPECTED_REQUIRED: ExpectedColumn[] = MASTER_REQUIRED_HEADERS.map(name => ({ name, key: normalizeHeader(name) }));
const EXPECTED_OPTIONAL: ExpectedColumn[] = MASTER_OPTIONAL_HEADERS.map(name => ({ name, key: normalizeHeader(name) }));
/** เรียง required ก่อน optional — ตัวชี้ใน EXPECTED ใช้ทั้งการจับคู่และการหา "ช่องว่างเดียวกัน" */
const EXPECTED: (ExpectedColumn & { required: boolean })[] = [
  ...EXPECTED_REQUIRED.map(e => ({ ...e, required: true })),
  ...EXPECTED_OPTIONAL.map(e => ({ ...e, required: false })),
];

// ── ที่อยู่เซลล์ (A1) — เขียนเองแทน XLSX.utils เพื่อไม่ต้อง import xlsx ตอนรัน ──
const decodeCol = (letters: string) => letters.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
const encodeCol = (col: number) => {
  let s = '';
  for (let n = col + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
const decodeCell = (addr: string) => {
  const m = /^([A-Z]+)(\d+)$/.exec(addr);
  return m ? { col: decodeCol(m[1]), row: Number(m[2]) - 1 } : null;
};
const decodeRef = (ref: string | undefined) => {
  const m = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(ref ?? '');
  if (!m) return null;
  const startCol = decodeCol(m[1]);
  const startRow = Number(m[2]) - 1;
  return { startCol, startRow, endCol: m[3] ? decodeCol(m[3]) : startCol, endRow: m[4] ? Number(m[4]) - 1 : startRow };
};

const cellText = (cell: unknown): string => {
  if (!cell || typeof cell !== 'object') return '';
  const { w, v } = cell as { w?: unknown; v?: unknown };
  const raw = w ?? v;
  return raw === undefined || raw === null ? '' : cleanText(String(raw));
};

/** อ่านแถวหัวคอลัมน์ของชีท (แถวแรกของ `!ref` — แถวเดียวกับที่ sheet_to_json ใช้เป็นชื่อคอลัมน์) พร้อมตำแหน่งเซลล์จริง
 *  คืนเฉพาะคอลัมน์ที่ "มีอะไรอยู่" (มีหัว หรือมีข้อมูลใต้หัว) — เซลล์ว่างที่เหลือจากการจัดรูปแบบไม่ถูกนับเป็นคอลัมน์
 *  ⚠️ วนตามเซลล์ที่มีอยู่จริงรอบเดียว ไม่วนตามช่วง `!ref` — ไฟล์บางตัวประกาศช่วงยาวทั้งชีท (A1:XFD1048576)
 *     ถ้าวนตามช่วงจะต้องไล่หลายพันล้านเซลล์จนเบราว์เซอร์ค้าง (มีเทสกัน) */
export function readMasterHeaderCells(ws: WorkSheet): MasterHeaderCell[] {
  const range = decodeRef(ws['!ref']);
  if (!range) return [];
  const heads = new Map<number, string>();
  const dataCols = new Set<number>();
  for (const addr of Object.keys(ws)) {
    if (addr.charCodeAt(0) === 33) continue;                         // '!ref', '!cols', '!merges' ...
    const pos = decodeCell(addr);
    if (!pos || pos.col < range.startCol || pos.col > range.endCol || pos.row < range.startRow || pos.row > range.endRow) continue;
    const text = cellText(ws[addr]);
    if (text === '') continue;
    if (pos.row === range.startRow) heads.set(pos.col, text);
    else dataCols.add(pos.col);
  }
  return [...new Set([...heads.keys(), ...dataCols])]
    .sort((a, b) => a - b)
    .map(col => ({ text: heads.get(col) ?? '', cell: `${encodeCol(col)}${range.startRow + 1}`, hasData: dataCols.has(col) }));
}

/** เทียบหัวคอลัมน์ในไฟล์กับมาตรฐาน — null = ตรงตามมาตรฐาน (อัปโหลดต่อได้)
 *
 *  1) จับคู่ตามชื่อ (ผ่าน normalizeHeader) ไม่สนลำดับคอลัมน์ · ชื่อซ้ำในไฟล์: ตัวแรกจับคู่ ตัวที่เหลือนับเป็น "เพิ่ม"
 *  2) ที่เหลือจับคู่เป็น "เปลี่ยน" เมื่อ หายกี่ตัว โผล่กี่ตัว ใน "ช่องว่างเดียวกัน" เท่ากันพอดี
 *     ช่องว่างเดียวกัน = ถัดจากคอลัมน์ที่ตรงตัวเดียวกันพอดี เช่น Barcode_Unit | ทุนซื้อ ↔ Barcode_Unit | ทุนล่าสุด
 *     (หาย 1 โผล่ 1) → เปลี่ยนชื่อ · ไม่ใช่ทุกอย่างที่ต่างกันจะเป็นการเปลี่ยน:
 *     - คอลัมน์ที่หายคนละที่กับคอลัมน์ที่โผล่ใหม่ = "ลบ" + "เพิ่ม" แยกกัน
 *       (ถ้าเทียบตามตำแหน่ง การลบ 1 คอลัมน์กลางไฟล์จะทำให้ทุกคอลัมน์หลังจากนั้นดูเหมือนถูกเปลี่ยนชื่อหมด)
 *     - ⚠️ ช่องเดียวกันแต่จำนวนไม่เท่ากัน (เช่น หาย 4 โผล่ 6 ที่ปลายไฟล์) ไม่จับคู่เลย แจ้งเป็น "ลบ" + "เพิ่ม" ตามจริง
 *       เพราะบอกไม่ได้ว่าตัวไหนแทนตัวไหน — ถ้าเดาจับคู่ตามลำดับจะอ้างว่า "เปลี่ยนชื่อ" ทั้งที่อาจเป็นลบแล้วเพิ่มใหม่
 *       (เจอตอนทดสอบกับไฟล์ตัวอย่างรายการเยอะ: ลบ 4 + เพิ่ม 5 ถูกรายงานเป็นเปลี่ยนชื่อ 4)
 *  3) ไฟล์ที่ไม่ตรงกับมาตรฐานเลยสักตัว (ไม่ใช่ไฟล์ Product Master) ไม่จับคู่ — ขึ้น "เพิ่ม" กับ "ลบ" ล้วน ไม่ขึ้นการเปลี่ยนชื่อมั่ว ๆ */
export function diffMasterHeaders(cells: MasterHeaderCell[]): MasterColumnDiff | null {
  const file = cells
    .filter(c => c.text !== '' || c.hasData)
    .map(c => ({ text: c.text || MASTER_NO_HEADER_LABEL, cell: c.cell, key: normalizeHeader(c.text) }));

  const expectedHit = EXPECTED.map(() => false);
  const fileHit = file.map(() => false);
  file.forEach((col, i) => {
    if (col.key === '') return;                                      // หัวว่าง (แต่มีข้อมูล) ไม่ตรงกับชื่อไหนแน่นอน
    const j = EXPECTED.findIndex((e, k) => !expectedHit[k] && e.key === col.key);
    if (j < 0) return;
    expectedHit[j] = true;
    fileHit[i] = true;
  });

  const noMatch = !fileHit.some(Boolean);
  const slotBefore = (hits: boolean[], keys: string[], i: number) => {
    for (let k = i - 1; k >= 0; k--) if (hits[k]) return keys[k];
    return '';
  };
  const fileKeys = file.map(f => f.key);
  const expectedKeys = EXPECTED.map(e => e.key);

  const slots = new Map<string, { exp: number[]; file: number[] }>();
  const slotFor = (key: string) => {
    let s = slots.get(key);
    if (!s) slots.set(key, (s = { exp: [], file: [] }));
    return s;
  };
  file.forEach((_, i) => {
    if (!fileHit[i]) slotFor(noMatch ? `file:${i}` : slotBefore(fileHit, fileKeys, i)).file.push(i);
  });
  EXPECTED.forEach((e, j) => {
    if (e.required && !expectedHit[j]) slotFor(noMatch ? `exp:${j}` : slotBefore(expectedHit, expectedKeys, j)).exp.push(j);
  });

  const added: { name: string; cell: string; at: number }[] = [];
  const changed: { from: string; to: string; cell: string; at: number }[] = [];
  const removed: { name: string; at: number }[] = [];
  for (const s of slots.values()) {
    const pairs = s.exp.length === s.file.length ? s.exp.length : 0;
    for (let n = 0; n < pairs; n++) {
      const f = file[s.file[n]];
      changed.push({ from: EXPECTED[s.exp[n]].name, to: f.text, cell: f.cell, at: s.file[n] });
    }
    for (const i of s.file.slice(pairs)) added.push({ name: file[i].text, cell: file[i].cell, at: i });
    for (const j of s.exp.slice(pairs)) removed.push({ name: EXPECTED[j].name, at: j });
  }
  if (!added.length && !changed.length && !removed.length) return null;

  const byAt = (a: { at: number }, b: { at: number }) => a.at - b.at;
  return {
    added: added.sort(byAt).map(({ name, cell }) => ({ name, cell })),
    changed: changed.sort(byAt).map(({ from, to, cell }) => ({ from, to, cell })),
    removed: removed.sort(byAt).map(r => r.name),
  };
}

/** คำในหัว popup "ไฟล์มี … คอลัมน์ ไม่สามารถอัปโหลดได้" — ตามชนิดที่พบจริง เช่น "เพิ่ม/เปลี่ยน" · ครบสามชนิดเป็น "เพิ่ม/เปลี่ยน/ลบ" */
export function masterColumnKinds(diff: MasterColumnDiff): string {
  return [diff.added.length && 'เพิ่ม', diff.changed.length && 'เปลี่ยน', diff.removed.length && 'ลบ'].filter(Boolean).join('/');
}
