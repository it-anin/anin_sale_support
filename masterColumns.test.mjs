import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { transformWithEsbuild } from 'vite';
import XLSX from 'xlsx';

// masterColumns.ts เป็น TypeScript — Node รุ่นเก่ารันตรง ๆ ไม่ได้ จึงแปลงด้วย esbuild ของ vite (ติดมากับโปรเจกต์อยู่แล้ว)
// แล้ว import จาก data URL · ไฟล์นั้น import 'xlsx' แค่ type จึงไม่มี import เหลือหลังแปลง
const tsPath = fileURLToPath(new URL('./masterColumns.ts', import.meta.url));
const { code } = await transformWithEsbuild(readFileSync(tsPath, 'utf8'), tsPath, { loader: 'ts' });
const {
  MASTER_HEADER_MAP, MASTER_STANDARD_HEADERS, MASTER_NO_HEADER_LABEL,
  diffMasterHeaders, masterColumnKinds, normalizeHeader, readMasterHeaderCells,
} = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

/** แถวหัวคอลัมน์ของไฟล์จริง Product_Master_1.xlsx (ผู้ใช้ส่งให้ตรวจ 2569-10-29 · Sheet1 · A1:P3737 · 16 คอลัมน์) เรียงตามไฟล์
 *  ⚠️ ค่าอ้างอิงนี้ตั้งใจเขียนซ้ำไว้ในเทส — ถ้าแก้ MASTER_STANDARD_HEADERS ในโค้ด เทสข้อแรกจะแดงจนกว่าจะแก้ตรงนี้ด้วย
 *     (กันแก้มาตรฐานโดยไม่ตั้งใจ) · เวลาไฟล์จริงเปลี่ยนรูปแบบ: แก้ทั้งสองที่ให้ตรงไฟล์ใหม่ */
const REAL_HEADERS = [
  'SKU', 'Name', 'BASE_UNIT', 'ABC', 'XYZ', 'ABCXYZ', 'MULTIPLY', 'SUPPLIER', 'Set_Deal', 'PURCHASE_UNIT',
  'ทุนซื้อ', 'Buying_deal_normal', 'Buying_deal_free', 'Group', 'Group %', 'BREAK_PACK',
];
const STANDARD = [...REAL_HEADERS];
const letter = i => String.fromCharCode(65 + i);                    // ใช้กับคอลัมน์ A–Z เท่านั้น
/** แถวหัวคอลัมน์จากรายชื่อ — เซลล์ A1, B1, … ตามลำดับ */
const headerRow = names => names.map((text, i) => ({ text, cell: `${letter(i)}1`, hasData: true }));
const without = (list, name) => list.filter(n => n !== name);
const replaced = (list, from, to) => list.map(n => (n === from ? to : n));
const ZWSP = String.fromCharCode(0x200b);
const NBSP = String.fromCharCode(0xa0);

test('ลิสต์มาตรฐานในโค้ดตรงกับหัวคอลัมน์ของไฟล์จริงทุกตัว ตามลำดับ', () => {
  assert.deepEqual([...MASTER_STANDARD_HEADERS], REAL_HEADERS);
});

test('ไฟล์ที่หัวคอลัมน์ตรงตามมาตรฐาน (หัวจริง 16 ช่อง) ผ่าน (null)', () => {
  assert.equal(diffMasterHeaders(headerRow(STANDARD)), null);
});

test('ตัวพิมพ์ต่างจากไฟล์จริงยังผ่าน — ไฟล์จริงตัวพิมพ์ไม่สม่ำเสมออยู่แล้ว (MULTIPLY / Set_Deal / Buying_deal_normal)', () => {
  assert.equal(diffMasterHeaders(headerRow(STANDARD.map(n => n.toLowerCase()))), null);
  assert.equal(diffMasterHeaders(headerRow(STANDARD.map(n => n.toUpperCase()))), null);
  // ตัวพิมพ์แบบคอมเมนต์ใน salesupport-setup.sql (Multiply, Supplier, Purchase_Unit, Buying_Deal_Normal ...)
  const sqlStyle = replaced(replaced(replaced(replaced(replaced(replaced(STANDARD,
    'MULTIPLY', 'Multiply'), 'SUPPLIER', 'Supplier'), 'PURCHASE_UNIT', 'Purchase_Unit'),
    'Buying_deal_normal', 'Buying_Deal_Normal'), 'Buying_deal_free', 'Buying_Deal_Free'), 'BREAK_PACK', 'Break_Pack');
  assert.equal(diffMasterHeaders(headerRow(sqlStyle)), null);
});

test('สลับลำดับคอลัมน์ / เว้นวรรคเกิน / ตัวอักษรล่องหน / ตัวเต็มความกว้าง ยังผ่าน — ไม่ตรวจลำดับ', () => {
  const messy = [...STANDARD].reverse().map((n, i) => (i % 3 === 0 ? `  ${n}${NBSP}` : i % 3 === 1 ? n : n.replace('_', `${ZWSP}_`)));
  assert.equal(diffMasterHeaders(headerRow(messy)), null);
  assert.equal(diffMasterHeaders(headerRow(replaced(STANDARD, 'Group %', 'Group  %'))), null);
  assert.equal(diffMasterHeaders(headerRow(replaced(STANDARD, 'Group %', 'Ｇｒｏｕｐ ％'))), null, 'ตัวเต็มความกว้างเทียบเท่า (NFKC)');
});

test('XYZ / ABCXYZ / BREAK_PACK (ไฟล์จริงมี แต่ importer ไม่นำเข้า) ต้องอยู่ในมาตรฐาน — ไม่งั้นไฟล์จริงถูกดีดกลับ', () => {
  const diff = diffMasterHeaders(headerRow(STANDARD.filter(n => !['XYZ', 'ABCXYZ', 'BREAK_PACK'].includes(n))));
  assert.deepEqual(diff.removed, ['XYZ', 'ABCXYZ', 'BREAK_PACK'], 'ไฟล์ที่ไม่มีสามช่องนี้ = ลบ (ไม่ใช่ผ่าน)');
  assert.deepEqual(diff.added, []);
});

test('เปลี่ยนชื่อ → changed พร้อมเซลล์ของชื่อใหม่', () => {
  const diff = diffMasterHeaders(headerRow(replaced(STANDARD, 'ทุนซื้อ', 'ทุนล่าสุด')));
  assert.deepEqual(diff, { added: [], changed: [{ from: 'ทุนซื้อ', to: 'ทุนล่าสุด', cell: 'K1' }], removed: [] });
});

test('ลบคอลัมน์กลางไฟล์ → removed อย่างเดียว ไม่ทำให้คอลัมน์ที่เลื่อนตำแหน่งกลายเป็น "เปลี่ยนชื่อ"', () => {
  const diff = diffMasterHeaders(headerRow(without(STANDARD, 'Set_Deal')));
  assert.deepEqual(diff, { added: [], changed: [], removed: ['Set_Deal'] });
});

test('เพิ่มคอลัมน์ท้ายไฟล์ / แทรกกลางไฟล์ → added พร้อมเซลล์ตามตำแหน่งจริง', () => {
  assert.deepEqual(diffMasterHeaders(headerRow([...STANDARD, 'Remark'])),
    { added: [{ name: 'Remark', cell: 'Q1' }], changed: [], removed: [] });
  const middle = [...STANDARD.slice(0, 4), 'Remark', ...STANDARD.slice(4)];
  assert.deepEqual(diffMasterHeaders(headerRow(middle)),
    { added: [{ name: 'Remark', cell: 'E1' }], changed: [], removed: [] });
});

test('มี Distributor / Distributor Name ในไฟล์ → นับเป็น "เพิ่ม" (ไฟล์จริงไม่มีสองช่องนี้ ระบบเติมจากไฟล์ Supplier เอง)', () => {
  assert.deepEqual(diffMasterHeaders(headerRow([...STANDARD, 'Distributor', 'Distributor Name'])), {
    added: [{ name: 'Distributor', cell: 'Q1' }, { name: 'Distributor Name', cell: 'R1' }],
    changed: [],
    removed: [],
  });
});

test('Barcode_Unit / SKU Name (ช่องในตารางที่ไฟล์จริงไม่มี) ถ้าโผล่ในไฟล์ → "เพิ่ม" — กันกลับไปใช้ลิสต์ที่เคยเดาผิด', () => {
  const diff = diffMasterHeaders(headerRow([...STANDARD, 'Barcode_Unit', 'SKU Name']));
  assert.deepEqual(diff.added.map(a => a.name), ['Barcode_Unit', 'SKU Name']);
  assert.deepEqual(diff.removed, []);
});

test('ชุดเดียวกับตัวอย่างในแกลเลอรี: เพิ่ม 2 + เปลี่ยน 1 + ลบ 1', () => {
  const file = [...replaced(without(STANDARD, 'Group %'), 'ทุนซื้อ', 'ทุนล่าสุด'), 'Remark', 'Updated_By'];
  assert.deepEqual(diffMasterHeaders(headerRow(file)), {
    added: [{ name: 'Remark', cell: 'P1' }, { name: 'Updated_By', cell: 'Q1' }],
    changed: [{ from: 'ทุนซื้อ', to: 'ทุนล่าสุด', cell: 'K1' }],
    removed: ['Group %'],
  });
});

test('คอลัมน์ที่หายกับคอลัมน์ที่โผล่ใหม่อยู่คนละที่ → "ลบ" + "เพิ่ม" แยกกัน ไม่จับคู่เป็นเปลี่ยนชื่อมั่ว', () => {
  const diff = diffMasterHeaders(headerRow([...without(STANDARD, 'Set_Deal'), 'Remark']));
  assert.deepEqual(diff, { added: [{ name: 'Remark', cell: 'P1' }], changed: [], removed: ['Set_Deal'] });
});

test('หายกับโผล่ใหม่ที่ช่องเดียวกัน → นับเป็นเปลี่ยนชื่อ (แยกจากการลบ+เพิ่มคนละที่ไม่ได้ในทางตรรกะ)', () => {
  const file = [...STANDARD];
  file.splice(file.indexOf('Group %'), 1, 'Remark');
  assert.deepEqual(diffMasterHeaders(headerRow(file)),
    { added: [], changed: [{ from: 'Group %', to: 'Remark', cell: 'O1' }], removed: [] });
});

test('เปลี่ยนชื่อติดกันหลายช่อง จับคู่ตามลำดับ', () => {
  const file = replaced(replaced(STANDARD, 'Group', 'กลุ่ม'), 'Group %', 'กลุ่ม %');
  assert.deepEqual(diffMasterHeaders(headerRow(file))?.changed, [
    { from: 'Group', to: 'กลุ่ม', cell: 'N1' },
    { from: 'Group %', to: 'กลุ่ม %', cell: 'O1' },
  ]);
});

test('ช่องเดียวกันแต่หายกับโผล่ไม่เท่ากัน → ไม่เดาว่าเปลี่ยนชื่อ แจ้งเป็น "ลบ" + "เพิ่ม" ตามจริง', () => {
  // หาย 1 (ทุนซื้อ) โผล่ 2 (ทุนล่าสุด + หมายเหตุ) ที่ช่องเดียวกัน
  const oneGoneTwoNew = [...STANDARD];
  oneGoneTwoNew.splice(oneGoneTwoNew.indexOf('ทุนซื้อ'), 1, 'ทุนล่าสุด', 'หมายเหตุ');
  assert.deepEqual(diffMasterHeaders(headerRow(oneGoneTwoNew)), {
    added: [{ name: 'ทุนล่าสุด', cell: 'K1' }, { name: 'หมายเหตุ', cell: 'L1' }],
    changed: [],
    removed: ['ทุนซื้อ'],
  });
  // หาย 2 ติดกัน (Set_Deal, PURCHASE_UNIT) โผล่ 1 (Unit)
  const twoGoneOneNew = [...STANDARD];
  twoGoneOneNew.splice(twoGoneOneNew.indexOf('Set_Deal'), 2, 'Unit');
  assert.deepEqual(diffMasterHeaders(headerRow(twoGoneOneNew)), {
    added: [{ name: 'Unit', cell: 'I1' }],
    changed: [],
    removed: ['Set_Deal', 'PURCHASE_UNIT'],
  });
});

test('ไฟล์รายการเยอะ: ลบ 4 + เพิ่ม 6 ที่ปลายไฟล์ไม่ถูกรายงานเป็น "เปลี่ยนชื่อ" (บั๊กที่เจอตอนทดสอบในแอปจริง)', () => {
  const file = [
    'SKU', 'Name', 'BASE_UNIT', 'ABC Class', 'XYZ', 'ABCXYZ', 'MULTIPLY', 'Vendor', 'PURCHASE_UNIT', 'ทุนล่าสุด',
    'Buying_deal_normal', 'ชื่อเต็ม', 'Remark', 'Updated_By', 'Brand', 'Color', 'Note',
  ];
  const diff = diffMasterHeaders(headerRow(file));
  // มีแค่สองจุดที่ยืนยันได้ว่าเป็นการเปลี่ยนชื่อ (หาย 1 โผล่ 1 ในช่องเดียวกัน)
  assert.deepEqual(diff.changed, [
    { from: 'ABC', to: 'ABC Class', cell: 'D1' },
    { from: 'ทุนซื้อ', to: 'ทุนล่าสุด', cell: 'J1' },
  ]);
  assert.deepEqual(diff.removed, ['SUPPLIER', 'Set_Deal', 'Buying_deal_free', 'Group', 'Group %', 'BREAK_PACK']);
  assert.deepEqual(diff.added.map(a => a.cell), ['H1', 'L1', 'M1', 'N1', 'O1', 'P1', 'Q1']);
});

test('ชื่อซ้ำในไฟล์ → ตัวแรกจับคู่ ตัวที่สองนับเป็นคอลัมน์ที่เพิ่ม', () => {
  assert.deepEqual(diffMasterHeaders(headerRow([...STANDARD, 'ABC'])),
    { added: [{ name: 'ABC', cell: 'Q1' }], changed: [], removed: [] });
});

test('หัวว่างแต่มีข้อมูล → เพิ่ม "(ไม่มีหัวคอลัมน์)" · หัวว่างและไม่มีข้อมูล → ไม่นับเป็นคอลัมน์', () => {
  const ghost = { text: '', cell: 'Q1', hasData: false };
  assert.equal(diffMasterHeaders([...headerRow(STANDARD), ghost]), null);
  const forgotten = { text: '', cell: 'Q1', hasData: true };
  assert.deepEqual(diffMasterHeaders([...headerRow(STANDARD), forgotten]),
    { added: [{ name: MASTER_NO_HEADER_LABEL, cell: 'Q1' }], changed: [], removed: [] });
});

test('ไฟล์ที่ไม่เกี่ยวกับ Product Master เลย (ไม่ตรงสักตัว) → เพิ่ม+ลบล้วน ไม่มีเปลี่ยนชื่อมั่ว', () => {
  const diff = diffMasterHeaders(headerRow(['รหัส', 'ยอดขาย', 'วันที่']));
  assert.equal(diff.changed.length, 0);
  assert.deepEqual(diff.added.map(a => a.name), ['รหัส', 'ยอดขาย', 'วันที่']);
  assert.deepEqual(diff.removed, STANDARD);
});

test('ไฟล์รายสาขา (จำลอง: Multiply Size · ไม่มีทุนซื้อ) ถูกดีดกลับ — กันเลือกผิดไฟล์', () => {
  const branch = ['SKU', 'Name', 'BASE_UNIT', 'ABC', 'Multiply Size'];
  const diff = diffMasterHeaders(headerRow(branch));
  // หาย 12 โผล่ 1 ในช่องเดียวกัน → ไม่เดาว่า MULTIPLY เปลี่ยนชื่อเป็น Multiply Size · แต่ชัดว่าเป็นไฟล์ผิด (ขาดทุนซื้อและอีกเกือบทั้งหมด)
  assert.deepEqual(diff.added, [{ name: 'Multiply Size', cell: 'E1' }]);
  assert.deepEqual(diff.changed, []);
  assert.equal(diff.removed.length, 12);
  assert.ok(diff.removed.includes('ทุนซื้อ') && diff.removed.includes('MULTIPLY'));
});

test('masterColumnKinds ตามชนิดที่พบจริง', () => {
  const k = diff => masterColumnKinds(diff);
  assert.equal(k({ added: [1], changed: [1], removed: [1] }), 'เพิ่ม/เปลี่ยน/ลบ');
  assert.equal(k({ added: [1], changed: [1], removed: [] }), 'เพิ่ม/เปลี่ยน');
  assert.equal(k({ added: [], changed: [], removed: [1] }), 'ลบ');
  assert.equal(k({ added: [1], changed: [], removed: [1] }), 'เพิ่ม/ลบ');
});

test('normalizeHeader', () => {
  assert.equal(normalizeHeader(`  Group${NBSP} ${NBSP}% `), 'group %');
  assert.equal(normalizeHeader(`SKU${ZWSP} Name`), 'sku name');
});

test('หัวมาตรฐาน: 13 ตัวมี regex ใน MASTER_HEADER_MAP ลงคอลัมน์ไม่ซ้ำกัน · อีก 3 ตัวที่ importer ไม่นำเข้าต้องไม่มี regex', () => {
  const mapped = [];
  const unmapped = [];
  for (const name of MASTER_STANDARD_HEADERS) {
    const hit = MASTER_HEADER_MAP.find(([re]) => re.test(name.trim()));
    if (hit) mapped.push(hit[1]);
    else unmapped.push(name);
  }
  // ถ้าเพิ่มคอลัมน์ใหม่ในมาตรฐานแล้วลืมใส่ regex → importer ข้ามคอลัมน์นั้นเงียบ ๆ · ถ้าเพิ่ม regex ให้ XYZ ฯลฯ ในอนาคต → เทสนี้เตือนให้ย้ายออกจากลิสต์นี้
  assert.deepEqual(unmapped, ['XYZ', 'ABCXYZ', 'BREAK_PACK']);
  assert.equal(new Set(mapped).size, mapped.length, 'มีหัวสองตัวที่ไปลงคอลัมน์เดียวกัน');
  assert.deepEqual([...mapped].sort(), [
    'abc', 'base_unit', 'buying_deal_free', 'buying_deal_normal', 'cost', 'group_name', 'group_percent',
    'multiply', 'name', 'purchase_unit', 'set_deal', 'sku', 'supplier',
  ]);
});

// ── readMasterHeaderCells ──

test('readMasterHeaderCells: แถวหัวไม่ใช่แถว 1 / ไม่เริ่มที่คอลัมน์ A → เซลล์เป็นที่อยู่จริงของ Excel', () => {
  const ws = {
    '!ref': 'B3:F10',
    A3: { t: 's', v: 'นอกช่วง' },                                    // อยู่ซ้ายของช่วง → ไม่นับ
    B2: { t: 's', v: 'อยู่เหนือแถวหัว' },                              // อยู่เหนือแถวหัว → ไม่นับ
    B3: { t: 's', v: 'SKU' },
    C3: { t: 's', v: 'Name', w: 'Name' },
    D3: { t: 'n', v: 123 },                                           // หัวเป็นตัวเลข
    F3: { t: 's', v: '   ' },                                         // หัวว่าง (มีแต่ช่องว่าง) แต่ F5 มีข้อมูล
    B4: { t: 's', v: '100001' },
    F5: { t: 's', v: 'x' },
    E7: { t: 's', v: '' },                                            // คอลัมน์ E ไม่มีอะไรเลย → ไม่นับ
    '!cols': [{ wch: 10 }],
  };
  assert.deepEqual(readMasterHeaderCells(ws), [
    { text: 'SKU', cell: 'B3', hasData: true },
    { text: 'Name', cell: 'C3', hasData: false },
    { text: '123', cell: 'D3', hasData: false },
    { text: '', cell: 'F3', hasData: true },
  ]);
});

test('readMasterHeaderCells: ใช้ข้อความที่เห็นใน Excel (w) ก่อนค่าดิบ (v)', () => {
  const ws = { '!ref': 'A1:A2', A1: { t: 'n', v: 0.5, w: '50%' }, A2: { t: 'n', v: 1 } };
  assert.equal(readMasterHeaderCells(ws)[0].text, '50%');
});

test('readMasterHeaderCells: ไม่มี !ref / ชีทว่าง → []', () => {
  assert.deepEqual(readMasterHeaderCells({}), []);
  assert.deepEqual(readMasterHeaderCells({ '!ref': 'A1' }), []);
});

test('readMasterHeaderCells: ตัวอักษรคอลัมน์เกิน Z (AA, AB)', () => {
  const ws = { '!ref': 'A1:AB1', A1: { v: 'SKU' }, Z1: { v: 'Last' }, AA1: { v: 'Extra1' }, AB1: { v: 'Extra2' } };
  assert.deepEqual(readMasterHeaderCells(ws).map(c => c.cell), ['A1', 'Z1', 'AA1', 'AB1']);
});

test('readMasterHeaderCells: ช่วง !ref ยาวทั้งชีท (A1:XFD1048576) ต้องไม่ช้า — วนตามเซลล์ที่มีจริง ไม่วนตามช่วง', () => {
  const ws = { '!ref': 'A1:XFD1048576' };
  STANDARD.forEach((name, c) => { ws[`${letter(c)}1`] = { t: 's', v: name }; });
  for (let r = 2; r <= 20000; r++) STANDARD.forEach((_, c) => { ws[`${letter(c)}${r}`] = { t: 's', v: `v${r}` }; });
  const started = Date.now();
  const cells = readMasterHeaderCells(ws);
  const took = Date.now() - started;
  assert.equal(cells.length, STANDARD.length);
  assert.equal(diffMasterHeaders(cells), null);
  assert.ok(took < 3000, `ใช้เวลา ${took} ms`);
});

test('ไฟล์ xlsx จริง (เขียน → อ่านผ่าน SheetJS): เปลี่ยนชื่อ + เพิ่ม + ลบ ได้เซลล์ตรงกับที่ Excel แสดง', () => {
  const header = [...replaced(without(STANDARD, 'Group %'), 'ทุนซื้อ', 'ทุนล่าสุด'), 'Remark'];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, header.map((_, i) => `r${i}`)]), 'Sheet1');
  const read = XLSX.read(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  const diff = diffMasterHeaders(readMasterHeaderCells(read.Sheets[read.SheetNames[0]]));
  assert.deepEqual(diff, {
    added: [{ name: 'Remark', cell: 'P1' }],
    changed: [{ from: 'ทุนซื้อ', to: 'ทุนล่าสุด', cell: 'K1' }],
    removed: ['Group %'],
  });
});

test('ไฟล์ xlsx หัวตรงมาตรฐาน หน้าตาเหมือนไฟล์จริง (16 คอลัมน์ · คอลัมน์ Group/Group % มีข้อมูลน้อย · มีคอลัมน์ว่างต่อท้ายที่จัดรูปแบบไว้) ผ่าน', () => {
  const rows = [STANDARD];
  for (let r = 1; r <= 300; r++) {
    // ไฟล์จริง: คอลัมน์ Group / Group % มีค่าเพียงไม่กี่แถว (69 จาก 3,736) ที่เหลือว่าง
    rows.push(STANDARD.map(h => (h === 'Group' || h === 'Group %' ? (r % 50 === 0 ? 'x' : '') : `${h}-${r}`)));
  }
  const ws = XLSX.utils.aoa_to_sheet(rows.map(row => [...row, '', '']));
  ws['!ref'] = `A1:${letter(STANDARD.length + 1)}${rows.length}`;      // ขยายช่วงให้คลุมคอลัมน์ว่างสองช่อง
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  const read = XLSX.read(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  assert.equal(diffMasterHeaders(readMasterHeaderCells(read.Sheets[read.SheetNames[0]])), null);
});
