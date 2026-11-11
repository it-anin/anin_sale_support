import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { transformWithEsbuild } from 'vite';

const path = fileURLToPath(new URL('./engine.ts', import.meta.url));
const { code } = await transformWithEsbuild(readFileSync(path, 'utf8'), path, { loader: 'ts' });
const { compareSheets, filterRows, findMissingMasterUnits, buildPosText, posExportRows, reportRows, parseNum, resolveMasterColumns } =
  await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

const masterHeader = ['SKU', 'NAME', 'BASE_UNIT', '', '', '', '', '', '', 'PURCHASE_UNIT', 'ทุนซื้อ'];
const promaxxHeader = ['', 'SKU', '', '', 'UNIT', 'LEVEL', 'LV0', 'OTHER'];
const master = (sku, unit, cost, base = unit, name = `ยา ${sku}`) => [sku, name, base, '', '', '', '', '', '', unit, cost];
const oldUnit = (sku, unit, cost, lv0, lv1 = null, lv5 = null) =>
  [[0, lv0], [1, lv1], [4, cost], [5, lv5]].map(([level, value]) =>
    ['', sku, '', '', unit, String(level), level === 0 ? value : '', level === 0 ? '' : value]);
const compare = (masters, oldRows) => compareSheets([masterHeader, ...masters], [promaxxHeader, ...oldRows]);

test('matches SKU and unit, scales all units from PURCHASE_UNIT/ทุนซื้อ, and reads R05.105 prices from G/H', () => {
  const result = compare([master('00123', 'กล่อง', '120', 'แผง')], [
    ...oldUnit('00123', 'กล่อง', 100, 200, 175, 150),
    ...oldUnit('00123', 'แผง', 10, 20, 18, 15),
    ...oldUnit('123', 'กล่อง', 900, 999),
  ]);
  assert.equal(result.total, 1);
  assert.equal(result.matched, 1);
  assert.equal(result.mismatched, 1);
  const [box, strip] = filterRows(result, 'all', '');
  assert.equal(box.sku, '00123');
  assert.equal(box.oldCost, 100);
  assert.equal(box.newCost, 120);
  assert.deepEqual(box.newPrices, { 0: 240, 1: 210, 5: 180 });
  assert.equal(strip.newCost, 12);
  assert.deepEqual(strip.newPrices, { 0: 24, 1: 22, 5: 18 });
  assert.equal(result.promaxxRecords, 12);
});

test('uses BASE_UNIT only as the base unit and ทุนซื้อ only as the new cost', () => {
  const [row] = filterRows(compare([master('A', 'กล่อง', '', '900')], oldUnit('A', 'กล่อง', 100, 200)), 'all', '');
  assert.equal(row.baseUnit, '900');
  assert.equal(row.newCost, null);
  assert.equal(row.newPrices[0], null);
});

test('missing reference unit keeps its supplied cost without inventing costs for other units', () => {
  const result = compare([master('A', 'ลัง', 1200, 'กล่อง')], oldUnit('A', 'กล่อง', 100, 200));
  assert.equal(result.matched, 1);
  const [box, crate] = filterRows(result, 'all', '');
  assert.equal(box.newCost, null);
  assert.equal(crate.newCost, 1200);
  assert.equal(crate.oldCost, null);
  assert.equal(crate.newPrices[0], null);
  assert.equal(buildPosText([box, crate], 4), '\uFEFFA\t1,200.00\t4\r\n');
});

test('zero divisors, blank values, and non-finite amounts produce null while zero prices remain valid', () => {
  assert.equal(parseNum(' 1,250.50 '), 1250.5);
  for (const value of ['', '  ', null, undefined, 'invalid', Infinity, NaN]) assert.equal(parseNum(value), null);
  assert.equal(parseNum(0), 0);
  const result = compare([master('ZERO', 'กล่อง', 120), master('FREE', 'กล่อง', 120)], [
    ...oldUnit('ZERO', 'กล่อง', 0, 100), ...oldUnit('ZERO', 'แผง', 10, 20),
    ...oldUnit('FREE', 'กล่อง', 100, 0),
  ]);
  const rows = filterRows(result, 'all', '');
  assert.equal(rows[0].newPrices[0], null);
  assert.equal(rows[1].newCost, null);
  assert.equal(rows[2].newPrices[0], 0);
  assert.equal(buildPosText(rows, 0), '\uFEFFFREE\t0.00\t0\r\n');
  assert.equal(buildPosText(rows, 4), '\uFEFFZERO\t120.00\t4\r\nFREE\t120.00\t4\r\n');
});

test('SKU filters classify equal, different, and missing products; search applies to individual units', () => {
  const result = compare([
    master('DIFF', 'กล่อง', 110, 'แผง'), master('SAME', 'กล่อง', 100), master('MISSING', 'กล่อง', 50),
  ], [
    ...oldUnit('DIFF', 'กล่อง', 100, 200), ...oldUnit('DIFF', 'แผง', 10, 20),
    ...oldUnit('SAME', 'กล่อง', 100, 200),
  ]);
  assert.equal(result.notFound, 1);
  assert.equal(result.matched - result.mismatched, 1);
  assert.deepEqual(filterRows(result, 'matched', '').map(row => row.sku), ['SAME']);
  assert.deepEqual(filterRows(result, 'notfound', '').map(row => row.sku), ['MISSING']);
  assert.deepEqual(filterRows(result, 'mismatch', ' แผง ').map(row => row.unit), ['แผง']);
  assert.equal(filterRows(result, 'all', 'ยา diff').length, 2);
  assert.equal(filterRows(result, 'all', 'no-such-product').length, 0);
});

test('rounds prices to whole numbers and tolerates differences up to 0.001', () => {
  const result = compare([master('A', 'กล่อง', 100), master('B', 'กล่อง', 125)], [
    ...oldUnit('A', 'กล่อง', 100, 200.0005), ...oldUnit('B', 'กล่อง', 100, 101),
  ]);
  assert.equal(result.products[0].isMismatch, false);
  assert.equal(result.products[1].rows[0].newPrices[0], 126);
});

test('TXT exports include increased, decreased and unchanged costs with unit/base restrictions and the required format', () => {
  const result = compare([
    master('UP', 'กล่อง', 1250, 'แผง'), master('DOWN', 'กล่อง', 80), master('SAME', 'กล่อง', 100),
  ], [
    ...oldUnit('UP', 'กล่อง', 1000, 2000, 1800, 1500), ...oldUnit('UP', 'แผง', 100, 200, 180, 150),
    ...oldUnit('DOWN', 'กล่อง', 100, 200, 180, 150), ...oldUnit('SAME', 'กล่อง', 100, 200, 180, 150),
  ]);
  const rows = filterRows(result, 'all', '');
  assert.equal(buildPosText(rows, 0), '\uFEFFUP\t2,500.00\t0\r\nUP\t250.00\t0\r\nDOWN\t160.00\t0\r\nSAME\t200.00\t0\r\n');
  assert.equal(buildPosText(rows, 4, { unit: 'กล่อง' }), '\uFEFFUP\t1,250.00\t4\r\nDOWN\t80.00\t4\r\nSAME\t100.00\t4\r\n');
  assert.equal(buildPosText(rows, 1, { baseUnitOnly: true }), '\uFEFFUP\t225.00\t1\r\nDOWN\t144.00\t1\r\nSAME\t180.00\t1\r\n');
  assert.equal(buildPosText(rows, 5, { unit: 'แผง' }), '\uFEFFUP\t188.00\t5\r\n');
  assert.equal(buildPosText(rows, 5, { unit: 'กล่อง' }), '\uFEFFUP\t1,875.00\t5\r\nDOWN\t120.00\t5\r\nSAME\t150.00\t5\r\n');
  assert.equal(buildPosText(filterRows(result, 'all', 'DOWN'), 0), '\uFEFFDOWN\t160.00\t0\r\n');
  assert.equal(posExportRows(rows, 0).length, 4);
});

test('selected TXT exports only the chosen SKU/unit row and preserves export restrictions', () => {
  const result = compare([master('00123', 'กล่อง', 1250, 'แผง'), master('123', 'กล่อง', 1500)], [
    ...oldUnit('00123', 'กล่อง', 1000, 2000, 1800, 1500), ...oldUnit('00123', 'แผง', 100, 200, 180, 150),
    ...oldUnit('123', 'กล่อง', 1000, 2000),
  ]);
  const rows = filterRows(result, 'all', '');
  const strip = rows.find(row => row.sku === '00123' && row.unit === 'แผง');
  const options = { rowIds: new Set([strip.id]) };
  assert.deepEqual(posExportRows(rows, 0, options).map(row => [row.sku, row.unit]), [
    ['00123', 'แผง'],
  ]);
  assert.equal(buildPosText(rows, 0, options), '\uFEFF00123\t250.00\t0\r\n');
  assert.equal(buildPosText(rows, 1, { ...options, baseUnitOnly: true }), '\uFEFF00123\t225.00\t1\r\n');
  assert.equal(buildPosText(rows, 4, options), '\uFEFF00123\t125.00\t4\r\n');
  assert.equal(buildPosText(rows, 4, { ...options, unit: 'กล่อง' }), '');
  assert.equal(buildPosText(rows, 5, { ...options, unit: 'แผง' }), '\uFEFF00123\t188.00\t5\r\n');
});

test('two units of the same SKU can be selected separately and removing one keeps the other selected', () => {
  const result = compare([master('A', 'กล่อง', 120), master('B', 'แผง', 30)], [
    ...oldUnit('A', 'กล่อง', 100, 200), ...oldUnit('A', 'แผง', 10, 20), ...oldUnit('B', 'แผง', 10, 20),
  ]);
  const rows = filterRows(result, 'all', '');
  const [box, strip] = rows;
  const rowIds = new Set([box.id, strip.id]);
  assert.equal(buildPosText(rows, 0, { rowIds }), '\uFEFFA\t240.00\t0\r\nA\t24.00\t0\r\n');
  rowIds.delete(box.id);
  assert.equal(buildPosText(rows, 0, { rowIds }), '\uFEFFA\t24.00\t0\r\n');
  assert.equal(rowIds.has(strip.id), true);
});

test('empty or unknown selection never exports all rows, while reduced and unchanged costs export when their price exists', () => {
  const result = compare([
    master('UP', 'กล่อง', 120), master('DOWN', 'กล่อง', 80), master('SAME', 'กล่อง', 100), master('MISSING', 'กล่อง', 120),
  ], [
    ...oldUnit('UP', 'กล่อง', 100, 200), ...oldUnit('DOWN', 'กล่อง', 100, 200), ...oldUnit('SAME', 'กล่อง', 100, 200),
  ]);
  const rows = filterRows(result, 'all', '');
  const idsFor = skus => new Set(rows.filter(row => skus.includes(row.sku)).map(row => row.id));
  assert.equal(buildPosText(rows, 0, { rowIds: new Set() }), '');
  assert.equal(buildPosText(rows, 0, { rowIds: new Set(['UNKNOWN']) }), '');
  assert.equal(buildPosText(rows, 0, { rowIds: idsFor(['DOWN', 'SAME', 'MISSING']) }), '\uFEFFDOWN\t160.00\t0\r\nSAME\t200.00\t0\r\n');
  assert.equal(buildPosText(rows, 1, { rowIds: idsFor(['UP']) }), '');
  assert.equal(buildPosText(rows, 4, { rowIds: idsFor(['UP', 'DOWN', 'SAME', 'MISSING']) }), '\uFEFFUP\t120.00\t4\r\nDOWN\t80.00\t4\r\nSAME\t100.00\t4\r\nMISSING\t120.00\t4\r\n');
  assert.equal(buildPosText(rows, 0), '\uFEFFUP\t240.00\t0\r\nDOWN\t160.00\t0\r\nSAME\t200.00\t0\r\n');
});

test('exports all three selected screenshot rows even though two units have lower costs', () => {
  const result = compare([
    master('100008', 'กล่อง', 468.66), master('100016', '10แผง', 147.27, 'แผง'),
  ], [
    ...oldUnit('100008', 'กล่อง', 359.52, 402, 370),
    ...oldUnit('100016', 'แผง', 15.88, 22, 17.5), ...oldUnit('100016', '10แผง', 158.76, 199, 170),
  ]);
  const rows = filterRows(result, 'all', '');
  const rowIds = new Set(rows.map(row => row.id));
  assert.equal(posExportRows(rows, 0, { rowIds }).length, 3);
  assert.equal(buildPosText(rows, 0, { rowIds }), '\uFEFF100008\t524.00\t0\r\n100016\t20.00\t0\r\n100016\t185.00\t0\r\n');
  assert.equal(buildPosText(rows, 1, { rowIds }), '\uFEFF100008\t482.00\t1\r\n100016\t16.00\t1\r\n100016\t158.00\t1\r\n');
  assert.equal(posExportRows(rows, 4, { rowIds }).length, 3);
  assert.equal(buildPosText(rows, 5, { rowIds }), '');
});

test('level 4 exports zero or supplied new costs without requiring any old cost', () => {
  const result = compare([master('ZERO', 'กล่อง', 0), master('NEW', 'กล่อง', 80), master('BLANK', 'กล่อง', '')],
    oldUnit('ZERO', 'กล่อง', 0, 100));
  const rows = filterRows(result, 'all', '');
  assert.equal(buildPosText(rows, 4), '\uFEFFZERO\t0.00\t4\r\nNEW\t80.00\t4\r\n');
  assert.equal(buildPosText(rows, 0), '');
});

test('selected unit export supports more than ten rows, independently of the analysis row limit', () => {
  const skus = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(5, '0'));
  const result = compare(skus.map(sku => master(sku, 'กล่อง', 120)), skus.flatMap(sku => oldUnit(sku, 'กล่อง', 100, 200)));
  const rows = filterRows(result, 'all', '');
  const lines = buildPosText(rows, 0, { rowIds: new Set(rows.slice(0, 11).map(row => row.id)) }).slice(1).trimEnd().split('\r\n');
  assert.equal(lines.length, 11);
  assert.deepEqual(lines.map(line => line.split('\t')[0]), skus.slice(0, 11));
});

test('Excel report includes every filtered row including reduced costs and missing SKUs, preserving SKU text', () => {
  const result = compare([master('00001', 'กล่อง', 80), master('00002', 'แผง', 25)], oldUnit('00001', 'กล่อง', 100, 200));
  const report = reportRows(filterRows(result, 'all', ''));
  assert.equal(report.length, 2);
  assert.equal(report[0]['รหัสสินค้า'], '00001');
  assert.equal(report[0]['ทุนใหม่'], 80);
  assert.equal(report[1]['ทุนเก่า'], null);
  assert.equal(report[1]['ราคาระดับ 0 ใหม่'], null);
  assert.equal(Object.keys(report[0]).length, 11);
});

test('rejects empty, malformed and ambiguous master files before generating price exports', () => {
  const validMaster = [masterHeader, master('A', 'กล่อง', 100)];
  const validOld = [promaxxHeader, ...oldUnit('A', 'กล่อง', 100, 200)];
  assert.throws(() => compareSheets([], validOld), /Product Master/);
  assert.throws(() => compareSheets(validMaster, [['SKU'], ['A']]), /R05\.105/);
  assert.throws(() => compareSheets([masterHeader, master('A', '', 100)], validOld), /คอลัมน์ PURCHASE_UNIT/);
  assert.throws(() => compareSheets([masterHeader, master('A', 'กล่อง', 100), master('A', 'กล่อง', 150)], validOld), /SKU A ซ้ำ/);
  assert.throws(() => compareSheets(validMaster, [promaxxHeader, ['', 'A', '', '', 'กล่อง', '9', 100, 100]]), /ไม่พบข้อมูล R05\.105/);
});

test('preflight finds every empty PURCHASE_UNIT with an SKU, without inventing a unit from BASE_UNIT', () => {
  const rows = [masterHeader,
    master('00001', '', 120, 'กล่อง', 'ยารายการหนึ่ง'), master('B', '  ', 100),
    master('C', null, 100), master('D', undefined, 100), master('VALID', 'กล่อง', 120),
    master('', '', 100),
  ];
  assert.deepEqual(findMissingMasterUnits(rows), [
    { sku: '00001', name: 'ยารายการหนึ่ง' }, { sku: 'B', name: 'ยา B' },
    { sku: 'C', name: 'ยา C' }, { sku: 'D', name: 'ยา D' },
  ]);
  assert.deepEqual(findMissingMasterUnits([]), []);
  assert.deepEqual(findMissingMasterUnits([masterHeader, master('VALID', 'กล่อง', 120)]), []);
});

test('missing PURCHASE_UNIT rows are skipped only with explicit consent, and never enter totals or exports', () => {
  const masters = [masterHeader, master('MISSING', '', 999), master('VALID', 'กล่อง', 120)];
  const oldRows = [promaxxHeader, ...oldUnit('MISSING', 'กล่อง', 100, 200), ...oldUnit('VALID', 'กล่อง', 100, 200)];
  assert.throws(() => compareSheets(masters, oldRows), /คอลัมน์ PURCHASE_UNIT/);
  assert.throws(() => compareSheets(masters, oldRows, { skipMissingUnits: false }), /คอลัมน์ PURCHASE_UNIT/);
  const result = compareSheets(masters, oldRows, { skipMissingUnits: true });
  assert.equal(result.total, 1);
  assert.equal(result.matched, 1);
  assert.equal(result.mismatched, 1);
  assert.equal(result.notFound, 0);
  assert.deepEqual(result.skippedMissingUnits, [{ sku: 'MISSING', name: 'ยา MISSING' }]);
  const rows = filterRows(result, 'all', '');
  assert.equal(buildPosText(rows, 0), '\uFEFFVALID\t240.00\t0\r\n');
  assert.deepEqual(reportRows(rows).map(row => row['รหัสสินค้า']), ['VALID']);
});

test('skips only invalid rows of a repeated SKU and still rejects duplicate rows that both have PURCHASE_UNIT', () => {
  const oldRows = [promaxxHeader, ...oldUnit('A', 'กล่อง', 100, 200)];
  const result = compareSheets([masterHeader, master('A', '', 999), master('A', 'กล่อง', 120)], oldRows, { skipMissingUnits: true });
  assert.equal(result.total, 1);
  assert.equal(result.products[0].rows[0].newCost, 120);
  assert.equal(result.skippedMissingUnits.length, 1);
  assert.throws(() => compareSheets([masterHeader, master('A', 'กล่อง', 120), master('A', 'กล่อง', 150)], oldRows,
    { skipMissingUnits: true }), /SKU A ซ้ำ/);
});

test('cannot return an empty comparison if every product is missing PURCHASE_UNIT', () => {
  const oldRows = [promaxxHeader, ...oldUnit('A', 'กล่อง', 100, 200)];
  assert.throws(() => compareSheets([masterHeader, master('A', ' ', 120)], oldRows, { skipMissingUnits: true }),
    /ไม่มีรายการที่มีหน่วยในคอลัมน์ PURCHASE_UNIT/);
  const result = compareSheets([masterHeader, master('A', 'กล่อง', 120)], oldRows);
  assert.deepEqual(result.skippedMissingUnits, []);
});

test('reads the example Product Master layout with SUPPLIER_SITE inserted before PURCHASE_UNIT and ทุนซื้อ', () => {
  const headers = ['SKU', 'Name', 'BASE_UNIT', 'ABC', 'XYZ', 'ABCXYZ', 'MULTIPLY', 'SUPPLIER',
    'SUPPLIER_SITE', 'Set_Deal', 'PURCHASE_UNIT', 'ทุนซื้อ', 'Buying_deal_normal', 'Buying_deal_free', 'Group', 'Group %', 'BREAK_PACK'];
  const row = ['00123', 'ยาทดสอบ', 'แผง', 'P', 'X', 'PX', 10, '0066', 'สำนักงานใหญ่', 9999,
    'กล่อง', '1,200.50', 1, 0, '', '', 'Y'];
  const result = compareSheets([headers, row], [promaxxHeader,
    ...oldUnit('00123', 'กล่อง', 1000, 2000), ...oldUnit('00123', 'แผง', 100, 200)]);
  const [box, strip] = filterRows(result, 'all', '');
  assert.equal(box.sku, '00123');
  assert.equal(box.name, 'ยาทดสอบ');
  assert.equal(box.unit, 'กล่อง');
  assert.equal(box.baseUnit, 'แผง');
  assert.equal(box.newCost, 1200.5);
  assert.ok(Math.abs(strip.newCost - 120.05) < 1e-9);
  assert.deepEqual(findMissingMasterUnits([headers, row]), []);
  assert.equal(buildPosText([box, strip], 4, { baseUnitOnly: true }), '\uFEFF00123\t120.05\t4\r\n');
});

test('accepts five columns in any order, ignoring header case, surrounding whitespace and a CSV BOM', () => {
  const sheet = [[' ทุนซื้อ ', '\uFEFFsku ', 'purchase_unit', ' base_unit ', ' nAmE '],
    [120, '00001', 'กล่อง', 'แผง', 'ยา ทดสอบ']];
  const oldRows = [promaxxHeader, ...oldUnit('00001', 'กล่อง', 100, 200), ...oldUnit('00001', 'แผง', 10, 20)];
  const expected = compare([master('00001', 'กล่อง', 120, 'แผง', 'ยา ทดสอบ')], oldRows.slice(1));
  const actual = compareSheets(sheet, oldRows);
  assert.deepEqual(actual, expected);
  assert.deepEqual(reportRows(filterRows(actual, 'all', '')), reportRows(filterRows(expected, 'all', '')));
});

test('missing-unit preflight and confirmed skipping use the resolved SKU, name and purchase unit', () => {
  const headers = ['ทุนซื้อ', 'Name', 'PURCHASE_UNIT', 'SKU', 'BASE_UNIT', 'UNIT', 'COST'];
  const rows = [headers, [999, 'ไม่มีหน่วย', '  ', '00001', 'กล่อง', 'หน่วยที่ห้ามใช้', 500],
    [120, 'มีหน่วย', 'กล่อง', '00002', 'แผง', '', 500]];
  const oldRows = [promaxxHeader, ...oldUnit('00001', 'กล่อง', 100, 200), ...oldUnit('00002', 'กล่อง', 100, 200)];
  assert.deepEqual(findMissingMasterUnits(rows), [{ sku: '00001', name: 'ไม่มีหน่วย' }]);
  assert.throws(() => compareSheets(rows, oldRows), /SKU 00001.*PURCHASE_UNIT/);
  const result = compareSheets(rows, oldRows, { skipMissingUnits: true });
  assert.equal(result.total, 1);
  assert.deepEqual(result.skippedMissingUnits, [{ sku: '00001', name: 'ไม่มีหน่วย' }]);
  assert.equal(result.products[0].rows[0].newCost, 120);
  assert.equal(buildPosText(filterRows(result, 'all', ''), 0), '\uFEFF00002\t240.00\t0\r\n');
});

test('rejects every missing required header, without falling back to the former column positions', () => {
  const oldRows = [promaxxHeader, ...oldUnit('A', 'กล่อง', 100, 200)];
  for (const name of ['SKU', 'NAME', 'BASE_UNIT', 'PURCHASE_UNIT', 'ทุนซื้อ']) {
    const headers = masterHeader.map(header => header === name ? 'UNKNOWN' : header);
    const rows = [headers, master('A', 'กล่อง', 120)];
    const expected = new RegExp(`ไม่พบคอลัมน์ที่จำเป็น: ${name}`);
    assert.throws(() => resolveMasterColumns(headers), expected);
    assert.throws(() => findMissingMasterUnits(rows), expected);
    assert.throws(() => compareSheets(rows, oldRows), expected);
  }
  assert.throws(() => resolveMasterColumns(['SKU']), /NAME, BASE_UNIT, PURCHASE_UNIT, ทุนซื้อ/);
});

test('rejects duplicate required headers even when their case and whitespace differ', () => {
  const oldRows = [promaxxHeader, ...oldUnit('A', 'กล่อง', 100, 200)];
  for (const name of ['SKU', 'NAME', 'BASE_UNIT', 'PURCHASE_UNIT', 'ทุนซื้อ']) {
    const headers = [...masterHeader, ` ${name.toLowerCase()} `];
    const rows = [headers, [...master('A', 'กล่อง', 120), 'ambiguous']];
    const expected = new RegExp(`ชื่อคอลัมน์ซ้ำ: ${name}`);
    assert.throws(() => resolveMasterColumns(headers), expected);
    assert.throws(() => findMissingMasterUnits(rows), expected);
    assert.throws(() => compareSheets(rows, oldRows), expected);
  }
});
