import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { transformWithEsbuild } from 'vite';
import { createClient } from '@supabase/supabase-js';

async function loadModule(name) {
  const path = fileURLToPath(new URL(name, import.meta.url));
  const { code } = await transformWithEsbuild(readFileSync(path, 'utf8'), path, { loader: 'ts' });
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}
const { loadProductMaster } = await loadModule('./productMaster.ts');
const { compareSheets, findMissingMasterUnits, buildPosText } = await loadModule('./engine.ts');

function fixtureClient(rows, { cap = 1000, failAt = Infinity, onFetch } = {}) {
  const requests = [];
  const client = createClient('https://product-master.test', 'test-anon-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input));
      const from = Number(url.searchParams.get('offset') ?? 0);
      requests.push({ url, method: init?.method ?? 'GET', signal: init?.signal });
      onFetch?.(requests.length);
      if (from >= failAt) return new Response(JSON.stringify({ message: 'connection interrupted' }), { status: 503 });
      const limit = Math.min(cap, Number(url.searchParams.get('limit')));
      return new Response(JSON.stringify(rows.slice(from, from + limit)), { headers: { 'Content-Type': 'application/json' } });
    } },
  });
  return { client, requests };
}

const row = (sku, cost = '120', purchase_unit = 'กล่อง') => ({
  sku, name: `ยา ${sku}`, base_unit: 'แผง', purchase_unit, cost,
});
const oldRows = sku => [['', 'SKU', '', '', 'UNIT', 'LEVEL', 'LV0', 'OTHER'],
  ...['กล่อง', 'แผง'].flatMap((unit, index) => [0, 1, 4, 5].map(level =>
    ['', sku, '', '', unit, level, level === 0 ? 200 / (index ? 10 : 1) : '',
      level === 4 ? 100 / (index ? 10 : 1) : 150 / (index ? 10 : 1)]))];

test('loads every SKU beyond the API page limit using only the five SaleSupport fields', async () => {
  const data = Array.from({ length: 1002 }, (_, index) => row(String(index).padStart(6, '0')));
  const { client, requests } = fixtureClient(data);
  const signal = new AbortController().signal;
  const sheet = await loadProductMaster(client, signal);
  assert.equal(sheet.length, 1003);
  assert.equal(sheet[1][0], '000000');
  assert.equal(sheet.at(-1)[0], '001001');
  assert.deepEqual(requests.map(request => Number(request.url.searchParams.get('offset') ?? 0)), [0, 1000, 1002]);
  for (const request of requests) {
    assert.equal(request.method, 'GET');
    assert.equal(request.url.pathname, '/rest/v1/product_master');
    assert.equal(request.url.searchParams.get('select'), 'sku,name,base_unit,purchase_unit,cost');
    assert.equal(request.url.searchParams.get('order'), 'sku.asc');
    assert.equal(request.url.searchParams.has('abc'), false);
    assert.equal(request.signal, signal);
  }
});

test('continues after a short API page without silently truncating the master', async () => {
  const { client, requests } = fixtureClient([row('001'), row('002'), row('003')], { cap: 2 });
  const sheet = await loadProductMaster(client, new AbortController().signal);
  assert.deepEqual(sheet.slice(1).map(record => record[0]), ['001', '002', '003']);
  assert.equal(requests.length, 3);
});

test('maps cost, purchase unit and base unit into the existing comparison and TXT exports', async () => {
  const { client } = fixtureClient([row('000123', '120')]);
  const sheet = await loadProductMaster(client, new AbortController().signal);
  const result = compareSheets(sheet, oldRows('000123'));
  const [box, strip] = result.products[0].rows;
  assert.equal(box.sku, '000123');
  assert.equal(box.newCost, 120);
  assert.equal(strip.newCost, 12);
  assert.equal(strip.baseUnit, 'แผง');
  assert.equal(buildPosText([box], 0), '\uFEFF000123\t240.00\t0\r\n');
  assert.equal(buildPosText([box, strip], 4, { baseUnitOnly: true }), '\uFEFF000123\t12.00\t4\r\n');
});

test('preserves zero costs and missing units without substituting the base unit', async () => {
  const { client } = fixtureClient([row('ZERO', 0), row('EMPTY', null, null), row('SPACES', '', '   ')]);
  const sheet = await loadProductMaster(client, new AbortController().signal);
  assert.equal(sheet[1][4], 0);
  assert.equal(sheet[2][3], null);
  assert.deepEqual(findMissingMasterUnits(sheet).map(record => record.sku), ['EMPTY', 'SPACES']);
  assert.equal(compareSheets([sheet[0], sheet[1]], oldRows('ZERO')).products[0].rows[0].newCost, 0);
});

test('rejects empty tables and later-page failures rather than returning partial data', async () => {
  const empty = fixtureClient([]);
  await assert.rejects(loadProductMaster(empty.client, new AbortController().signal), /SaleSupport/);
  const failed = fixtureClient([row('001'), row('002'), row('003')], { cap: 2, failAt: 2 });
  await assert.rejects(loadProductMaster(failed.client, new AbortController().signal), /connection interrupted/);
});

test('cancels a departed page without accepting its response or loading further pages', async () => {
  const controller = new AbortController();
  const { client, requests } = fixtureClient([row('001'), row('002')], { cap: 1, onFetch: () => controller.abort() });
  await assert.rejects(loadProductMaster(client, controller.signal), { name: 'AbortError' });
  assert.equal(requests.length, 1);
  await assert.rejects(loadProductMaster(client, controller.signal), { name: 'AbortError' });
  assert.equal(requests.length, 1);
});
