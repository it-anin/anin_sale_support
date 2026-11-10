import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { transformWithEsbuild } from 'vite';

const path = fileURLToPath(new URL('./engine.ts', import.meta.url));
const { code } = await transformWithEsbuild(readFileSync(path, 'utf8'), path, { loader: 'ts' });
const { compareSheets, filterRows, buildPosText, posExportRows, reportRows, parseNum } =
  await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

const masterHeader = ['SKU', 'NAME', 'BASE_UNIT', '', '', '', '', '', '', 'UNIT', 'COST'];
const promaxxHeader = ['', 'SKU', '', '', 'UNIT', 'LEVEL', 'LV0', 'OTHER'];
const master = (sku, unit, cost, base = unit, name = `ยา ${sku}`) => [sku, name, base, '', '', '', '', '', '', unit, cost];
const oldUnit = (sku, unit, cost, lv0, lv1 = null, lv5 = null) =>
  [[0, lv0], [1, lv1], [4, cost], [5, lv5]].map(([level, value]) =>
    ['', sku, '', '', unit, String(level), level === 0 ? value : '', level === 0 ? '' : value]);
const compare = (masters, oldRows) => compareSheets([masterHeader, ...masters], [promaxxHeader, ...oldRows]);

test('matches SKU and unit, scales all units from J/K, and reads level 0 from G and other levels from H', () => {
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

test('uses C only as the base unit and K only as the new cost', () => {
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
  assert.equal(buildPosText([box, crate], 4), '');
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

test('TXT exports use filtered rows, increased costs, optional unit/base restrictions, BOM, tabs, CRLF and commas', () => {
  const result = compare([
    master('UP', 'กล่อง', 1250, 'แผง'), master('DOWN', 'กล่อง', 80), master('SAME', 'กล่อง', 100),
  ], [
    ...oldUnit('UP', 'กล่อง', 1000, 2000, 1800, 1500), ...oldUnit('UP', 'แผง', 100, 200, 180, 150),
    ...oldUnit('DOWN', 'กล่อง', 100, 200), ...oldUnit('SAME', 'กล่อง', 100, 200),
  ]);
  const rows = filterRows(result, 'all', '');
  assert.equal(buildPosText(rows, 0), '\uFEFFUP\t2,500.00\t0\r\nUP\t250.00\t0\r\n');
  assert.equal(buildPosText(rows, 4, { unit: 'กล่อง' }), '\uFEFFUP\t1,250.00\t4\r\n');
  assert.equal(buildPosText(rows, 1, { baseUnitOnly: true }), '\uFEFFUP\t225.00\t1\r\n');
  assert.equal(buildPosText(rows, 5, { unit: 'แผง' }), '\uFEFFUP\t188.00\t5\r\n');
  assert.equal(buildPosText(filterRows(result, 'all', 'DOWN'), 0), '');
  assert.equal(posExportRows(rows, 0).length, 2);
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
  assert.throws(() => compareSheets(validMaster, [['SKU'], ['A']]), /Promaxx/);
  assert.throws(() => compareSheets([masterHeader, master('A', '', 100)], validOld), /คอลัมน์ J/);
  assert.throws(() => compareSheets([masterHeader, master('A', 'กล่อง', 100), master('A', 'กล่อง', 150)], validOld), /SKU A ซ้ำ/);
  assert.throws(() => compareSheets(validMaster, [promaxxHeader, ['', 'A', '', '', 'กล่อง', '9', 100, 100]]), /ไม่พบข้อมูล Promaxx/);
});
