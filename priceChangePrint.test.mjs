import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { transformWithEsbuild } from 'vite';

const tsPath = fileURLToPath(new URL('./priceChangePrint.ts', import.meta.url));
const { code } = await transformWithEsbuild(readFileSync(tsPath, 'utf8'), tsPath, { loader: 'ts' });
const { loadPriceChangePrintProducts } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

const barcodeOf = i => String(8850000000000 + i);
const product = (i, extra = {}) => ({
  id: i, barcode: barcodeOf(i), sku: String(i), name: `สินค้า ${i}`, unit: 'กล่อง', price: 25, ...extra,
});
const change = (i, extra = {}) => ({
  id: i, batch_id: 'selected-batch', barcode: barcodeOf(i), sku: String(i), new_price: 10, ...extra,
});

// จำลอง PostgREST: กรอง, เรียง, แบ่งหน้า และจำกัด 1,000 แถวต่อคำขอเหมือน backend
function database(log, products, fail = () => null) {
  const calls = [];
  return {
    calls,
    from(table) {
      const filters = [];
      const orders = [];
      const query = {
        select() { return query; },
        eq(column, value) { filters.push([column, value]); return query; },
        in(column, values) { filters.push([column, values]); return query; },
        order(column, options) { orders.push([column, options.ascending]); return query; },
        async range(from, to) {
          const call = { table, filters, from, to };
          calls.push(call);
          const error = fail(call);
          if (error) return { data: null, error: { message: error } };
          const source = table === 'price_change_log' ? log : products;
          const rows = source.filter(row => filters.every(([column, value]) =>
            Array.isArray(value) ? value.includes(row[column]) : row[column] === value));
          rows.sort((a, b) => {
            for (const [column, ascending] of orders) {
              const cmp = a[column] < b[column] ? -1 : a[column] > b[column] ? 1 : 0;
              if (cmp) return ascending ? cmp : -cmp;
            }
            return 0;
          });
          return { data: rows.slice(from, Math.min(to + 1, from + 1000)), error: null };
        },
      };
      return query;
    },
  };
}

test('loads all 2,003 batch items across server pages, uses current prices and one label each', async () => {
  const log = Array.from({ length: 2003 }, (_, i) => change(i));
  const products = Array.from({ length: 2003 }, (_, i) => product(i));
  const db = database([...log, change(9999, { batch_id: 'another-batch' })], products);
  const labels = await loadPriceChangePrintProducts(db, 'selected-batch');
  assert.equal(labels.length, 2003);
  assert.equal(new Set(labels.map(p => p.barcode)).size, 2003);
  assert.ok(labels.every(p => p.price === 25 && p.quantity === 1));
  assert.deepEqual(db.calls.filter(c => c.table === 'price_change_log').map(c => c.from), [0, 1000, 2000]);
  assert.ok(db.calls.filter(c => c.table === 'products').every(c =>
    c.filters[0][0] === 'barcode' && c.filters[0][1].length <= 100));
});

test('keeps separate barcode units of the same SKU and selects the latest product row', async () => {
  const db = database([change(1), change(2), change(1, { id: 3 })], [
    product(1, { sku: 'SAME', unit: 'แผง', price: 5 }),
    product(1, { id: 100, sku: 'SAME', unit: 'แผง', price: 0 }),
    product(2, { sku: 'SAME', unit: 'กล่อง', price: 50 }),
  ]);
  const labels = await loadPriceChangePrintProducts(db, 'selected-batch');
  assert.deepEqual(labels.map(p => [p.sku, p.unit, p.price, p.quantity]), [
    ['SAME', 'แผง', 0, 1], ['SAME', 'กล่อง', 50, 1],
  ]);
  assert.deepEqual(labels.map(p => p.rowIndex), [0, 1]);
});

test('does not return a partial print set if a current product is missing', async () => {
  await assert.rejects(loadPriceChangePrintProducts(database([change(1), change(2)], [product(1)]), 'selected-batch'),
    /ไม่พบสินค้าปัจจุบัน 1 รายการ/);
});

test('rejects missing or invalid current prices instead of printing a false zero price', async () => {
  for (const price of [null, undefined, NaN, Infinity]) {
    await assert.rejects(loadPriceChangePrintProducts(database([change(1)], [product(1, { price })]), 'selected-batch'),
      /ราคาสินค้า SKU 1 ไม่ถูกต้อง/);
  }
});

test('propagates errors on later history pages instead of printing only the first page', async () => {
  const log = Array.from({ length: 1001 }, (_, i) => change(i));
  const db = database(log, [], c => c.table === 'price_change_log' && c.from === 1000 ? 'network error' : null);
  await assert.rejects(loadPriceChangePrintProducts(db, 'selected-batch'), /โหลดรายการราคาเปลี่ยนไม่สำเร็จ: network error/);
  assert.ok(db.calls.every(c => c.table === 'price_change_log'));
});

test('propagates errors on later product chunks without returning earlier labels', async () => {
  const log = Array.from({ length: 101 }, (_, i) => change(i));
  const products = Array.from({ length: 101 }, (_, i) => product(i));
  let productCalls = 0;
  const db = database(log, products, c => c.table === 'products' && ++productCalls === 2 ? 'service unavailable' : null);
  await assert.rejects(loadPriceChangePrintProducts(db, 'selected-batch'), /โหลดสินค้าสำหรับพิมพ์ไม่สำเร็จ: service unavailable/);
});

test('reports an expired or empty batch before querying products', async () => {
  const db = database([change(1, { batch_id: 'another-batch' })], [product(1)]);
  await assert.rejects(loadPriceChangePrintProducts(db, 'selected-batch'), /ไม่พบรายการราคาเปลี่ยนในรอบนี้/);
  assert.equal(db.calls.length, 1);
});

test('does not silently omit a batch row without a barcode', async () => {
  await assert.rejects(loadPriceChangePrintProducts(database([change(1, { barcode: '' })], []), 'selected-batch'),
    /ไม่มีบาร์โค้ด/);
});
