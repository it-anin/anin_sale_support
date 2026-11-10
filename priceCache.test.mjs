import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { transformWithEsbuild } from 'vite';

const path = fileURLToPath(new URL('./priceCache.ts', import.meta.url));
const { code } = await transformWithEsbuild(readFileSync(path, 'utf8'), path, { loader: 'ts' });
const { loadCurrentPriceRows, currentPriceProduct, refreshPriceMap } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const product = (extra = {}) => ({ barcode: '001', sku: '100001', name: 'Medicine', unit: 'แผง', price: 9, category: 'ยา', ...extra });
const requested = new Set(['001']);

test('updates cached price/name while retaining selected quantity and shelf location', () => {
  const old = product({ quantity: 7, location: 'A14', rowIndex: 5 });
  const current = new Map([['100001-แผง', old]]);
  const fresh = new Map([['001', product({ price: 12, name: 'New name' })]]);
  const updated = refreshPriceMap(current, fresh, requested).get('100001-แผง');
  assert.deepEqual(updated, { ...old, price: 12, name: 'New name' });
});

test('unchanged cached data retains object/map identity', () => {
  const old = product();
  const previous = new Map([['100001-แผง', old]]);
  const fresh = new Map([['001', product()]]);
  assert.equal(currentPriceProduct(old, fresh, requested), old);
  assert.equal(refreshPriceMap(previous, fresh, requested), previous);
});

test('deleted barcodes are removed, including from the live preview', () => {
  const previous = new Map([['100001-แผง', product()]]);
  assert.equal(refreshPriceMap(previous, new Map(), requested).size, 0);
  assert.equal(currentPriceProduct(product(), new Map(), requested), null);
});

test('SKU/unit edits rekey saved items without losing the quantity', () => {
  const previous = new Map([['100001-แผง', product({ quantity: 4 })]]);
  const fresh = new Map([['001', product({ sku: '200001', unit: 'กล่อง' })]]);
  const next = refreshPriceMap(previous, fresh, requested);
  assert.equal(next.has('100001-แผง'), false);
  assert.equal(next.get('200001-กล่อง').quantity, 4);
});

test('does not remove products added while a refresh was in flight', () => {
  const added = product({ barcode: '002', sku: '100002' });
  const previous = new Map([['100001-แผง', product()], ['100002-แผง', added]]);
  const next = refreshPriceMap(previous, new Map(), requested);
  assert.equal(next.size, 1);
  assert.equal(next.get('100002-แผง'), added);
});

test('refresh reads only requested unique barcodes in batches of at most 100', async () => {
  const calls = [];
  const db = { from(table) {
    assert.equal(table, 'products');
    return { select() { return this; }, async in(column, values) {
      assert.equal(column, 'barcode');
      calls.push(values);
      return { data: values.map(barcode => product({ barcode })), error: null };
    } };
  } };
  const barcodes = Array.from({ length: 205 }, (_, i) => String(i));
  const rows = await loadCurrentPriceRows(db, [...barcodes, '1', '']);
  assert.equal(rows.size, 205);
  assert.deepEqual(calls.map(batch => batch.length), [100, 100, 5]);
});

test('a failed batch rejects the refresh rather than returning partial data as deletions', async () => {
  const db = { from() { return { select() { return this; }, async in() {
    return { data: null, error: new Error('network failure') };
  } }; } };
  await assert.rejects(loadCurrentPriceRows(db, ['001']), /network failure/);
});
