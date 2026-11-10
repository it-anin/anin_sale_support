import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { PRICE_SQL, buildPriceProducts, loadPriceConfig, priceHash, pushPriceSnapshot, scheduledPriceDate, createPriceJobs, createPriceFailureReporter } from './price-agent.mjs';
import { assertReadOnlySql } from './pending-docs-agent.mjs';

const row = (extra = {}) => ({
  barcode: '08850000000001  ', sku: '100001 ', name: ' ยาทดสอบ 500 mg\r\nหมายเหตุ ',
  unit: ' แผง ', price: '9.0000 ', category: ' ยากิน ', base_multiple: '1.0000', ...extra,
});
const env = values => name => values[name] ?? null;
const credentials = { MSSQL_SERVER: 'local-test', MSSQL_DATABASE: 'test', MSSQL_USER: 'readonly', MSSQL_PASSWORD: 'test-only' };

test('R05.106 query is SELECT-only and uses the report price, unit key and exclusions', () => {
  assert.equal(assertReadOnlySql(PRICE_SQL), PRICE_SQL);
  assert.match(PRICE_SQL, /ITEMBARCODE\.FMLPRICE AS price/);
  assert.match(PRICE_SQL, /ITEMUNIT\.SYSITEMID = ITEMS\.SYSITEMID\s+AND ITEMUNIT\.SYSUNITID = ITEMBARCODE\.SYSUNITID/);
  assert.match(PRICE_SQL, /ITEMS\.ITEMID NOT IN \('DEPOSIT','DEPOSIT-NV'\)/);
  assert.match(PRICE_SQL, /ITEMS\.FShowOnReport = 1/);
  assert.doesNotMatch(PRICE_SQL, /ITEMPRICELEVEL|MULTIPLE\s*=\s*1|NOLOCK/i);
});

test('normalizes all seven report fields like the CSV import, retaining leading zeroes', () => {
  assert.deepEqual(buildPriceProducts([row()]), [{
    barcode: '08850000000001', sku: '100001', name: 'ยาทดสอบ 500 mg', unit: 'แผง',
    price: 9, category: 'ยากิน', base_multiple: 1,
  }]);
  const [product] = buildPriceProducts([row({ price: '', category: null, base_multiple: null })]);
  assert.equal(product.price, 0);
  assert.equal(product.category, 'ทั่วไป');
  assert.equal(product.base_multiple, null);
});

test('keeps all pack sizes and barcodes for the same SKU/unit', () => {
  const products = buildPriceProducts([
    row(), row({ barcode: 'second', base_multiple: 10, price: 85 }), row({ barcode: 'third' }),
  ]);
  assert.equal(products.length, 3);
  assert.ok(products.some(p => p.base_multiple === 10));
});

test('rejects empty, incomplete and conflicting snapshots before any writes', () => {
  assert.throws(() => buildPriceProducts([]), /no products/);
  assert.throws(() => buildPriceProducts([row({ barcode: '' })]), /barcode\/SKU/);
  assert.throws(() => buildPriceProducts([row({ sku: null })]), /barcode\/SKU/);
  assert.throws(() => buildPriceProducts([row({ price: Infinity })]), /Invalid price/);
  assert.throws(() => buildPriceProducts([row(), row({ price: 12 })]), /Conflicting/);
  assert.equal(buildPriceProducts([row(), row()]).length, 1);
});

test('hash ignores SQL ordering and changes for every meaningful report field', () => {
  const products = buildPriceProducts([row(), row({ barcode: 'second' })]);
  assert.equal(priceHash(products), priceHash([...products].reverse()));
  for (const [field, value] of Object.entries({ barcode: 'other', sku: '200001', name: 'other', unit: 'box', price: 10, category: 'other', base_multiple: 10 })) {
    assert.notEqual(priceHash(buildPriceProducts([row()])), priceHash(buildPriceProducts([row({ [field]: value })])), field);
  }
});

function client(unchanged, errorAt) {
  const calls = [];
  return {
    calls,
    async rpc(name, args) {
      calls.push({ name, args });
      return { data: name === 'mark_price_unchanged' ? unchanged : 1, error: name === errorAt ? { message: 'test failure' } : null };
    },
  };
}

test('unchanged data sends only a hash, including after a new Agent process starts', async () => {
  for (let restart = 0; restart < 2; restart++) {
    const db = client(true);
    const result = await pushPriceSnapshot(db, buildPriceProducts([row()]));
    assert.equal(result.changed, false);
    assert.equal(db.calls.length, 1);
    assert.equal(db.calls[0].name, 'mark_price_unchanged');
    assert.deepEqual(db.calls[0].args, { p_hash: result.hash, p_request_id: '0' });
  }
});

test('changed/invalidated server hash sends one complete atomic snapshot', async () => {
  const db = client(false);
  const products = buildPriceProducts([row()]);
  assert.equal((await pushPriceSnapshot(db, products)).changed, true);
  assert.deepEqual(db.calls.map(call => call.name), ['mark_price_unchanged', 'sync_price_products']);
  assert.deepEqual(db.calls[1].args, { p_rows: products, p_hash: priceHash(products), p_request_id: '0' });
});

test('a failed server hash check never falls through to uploading', async () => {
  const db = client(false, 'mark_price_unchanged');
  await assert.rejects(pushPriceSnapshot(db, buildPriceProducts([row()])), { name: 'SupabaseError' });
  assert.equal(db.calls.length, 1);
  await assert.rejects(pushPriceSnapshot(client(false, 'sync_price_products'), buildPriceProducts([row()])), /test failure/);
});

test('configuration shares MSSQL settings, ignores the retired poll interval and requires a server-only key', () => {
  const config = loadPriceConfig(env({ ...credentials, SUPABASE_SERVICE_KEY: 'test-key', MSSQL_INSTANCE: 'SQLEXPRESS', MSSQL_ENCRYPT: 'false' }));
  assert.equal(config.mssql.options.appName, 'anin-price-agent');
  assert.equal(config.mssql.options.instanceName, 'SQLEXPRESS');
  assert.equal(config.mssql.options.encrypt, false);
  assert.throws(() => loadPriceConfig(env({ ...credentials, VITE_SUPABASE_ANON_KEY: 'public-key' })), /SUPABASE_SERVICE_KEY/);
  assert.doesNotThrow(() => loadPriceConfig(env(credentials), { requireSupabase: false }));
  assert.doesNotThrow(() => loadPriceConfig(env({ ...credentials, PRICE_POLL_SECONDS: '1' }), { requireSupabase: false }));
});

test('--print-sql works without credentials and prints only the guarded SELECT', () => {
  const output = execFileSync(process.execPath, ['price-agent.mjs', '--print-sql'], {
    cwd: new URL('.', import.meta.url), encoding: 'utf8', env: { PATH: process.env.PATH },
  });
  assert.equal(output.trim(), PRICE_SQL.trim());
});

test('manual requests are acknowledged by the same RPC transaction, for both changed and unchanged data', async () => {
  for (const unchanged of [true, false]) {
    const db = client(unchanged);
    await pushPriceSnapshot(db, buildPriceProducts([row()]), '17');
    assert.ok(db.calls.every(call => call.args.p_request_id === '17'));
  }
});

test('daily eligibility is exactly 08:00 Asia/Bangkok, independent of the host timezone', () => {
  assert.equal(scheduledPriceDate(new Date('2026-11-10T00:59:59Z')), null);
  assert.equal(scheduledPriceDate(new Date('2026-11-10T01:00:00Z')), '2026-11-10');
  assert.equal(scheduledPriceDate(new Date('2026-11-10T01:00:59Z')), '2026-11-10');
  assert.equal(scheduledPriceDate(new Date('2026-11-10T01:01:00Z')), null);
  assert.equal(scheduledPriceDate(new Date('2026-11-10T08:00:00Z')), null); // 15:00 Thai
  assert.equal(scheduledPriceDate(new Date('2026-11-10T17:00:00Z')), null); // Midnight Thai
});

test('idle status polling, startup, completed requests and navigation do not read MSSQL', async () => {
  const calls = [];
  const jobs = createPriceJobs({ claimDaily: async () => { throw new Error('unexpected claim'); }, syncOnce: async job => calls.push(job) });
  for (const time of ['00:59:59', '01:01:00', '03:00:00', '08:00:00', '17:00:00']) {
    await jobs.tick(new Date(`2026-11-10T${time}Z`));
    await jobs.observe({ request_id: 0, completed_request_id: 0 });
    await jobs.observe({ request_id: 5, completed_request_id: 5 });
  }
  assert.deepEqual(calls, []);
  await jobs.stop();
});

test('daily claims run once per day and survive an Agent restart', async () => {
  const claimed = new Set(), calls = [];
  const create = () => createPriceJobs({
    claimDaily: async day => { if (claimed.has(day)) return false; claimed.add(day); return true; },
    syncOnce: async job => calls.push(job),
  });
  const first = create();
  await first.tick(new Date('2026-11-10T01:00:00Z'));
  await first.tick(new Date('2026-11-10T01:00:30Z'));
  await first.stop();
  const restarted = create();
  await restarted.tick(new Date('2026-11-10T01:00:45Z'));
  assert.equal(calls.length, 1);
  await restarted.tick(new Date('2026-11-11T01:00:01Z'));
  assert.deepEqual(calls.map(job => job.day), ['2026-11-10', '2026-11-11']);
  await restarted.stop();
});

test('an Admin request runs immediately outside 08:00 and repeated queue events do not run it twice', async () => {
  const calls = [];
  const jobs = createPriceJobs({ claimDaily: async () => false, syncOnce: async job => calls.push(job) });
  await jobs.tick(new Date('2026-11-10T09:32:00Z'));
  await jobs.observe({ request_id: 7, completed_request_id: 6 });
  await jobs.observe({ request_id: 7, completed_request_id: 6 });
  await jobs.observe({ request_id: 7, completed_request_id: 7 });
  await jobs.observe({ request_id: 8, completed_request_id: 7 });
  assert.deepEqual(calls.map(job => job.requestId), ['7', '8']);
  await jobs.stop();
});

test('MSSQL jobs never overlap and newer queued requests are coalesced', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const calls = [];
  let active = 0, maxActive = 0;
  const jobs = createPriceJobs({ claimDaily: async () => false, syncOnce: async job => {
    active++; maxActive = Math.max(maxActive, active); calls.push(job.requestId);
    if (calls.length === 1) await gate;
    active--;
  } });
  const work = jobs.observe({ request_id: 1, completed_request_id: 0 });
  void jobs.observe({ request_id: 1, completed_request_id: 0 });
  void jobs.observe({ request_id: 2, completed_request_id: 1 });
  void jobs.observe({ request_id: 3, completed_request_id: 1 });
  release();
  await work;
  assert.deepEqual(calls, ['1', '3']);
  assert.equal(maxActive, 1);
  await jobs.stop();
});

test('stale queue events cannot replay requests that were already completed before startup', async () => {
  const calls = [];
  const jobs = createPriceJobs({ claimDaily: async () => false, syncOnce: async job => calls.push(job) });
  await jobs.observe({ request_id: 10, completed_request_id: 10 });
  await jobs.observe({ request_id: 9, completed_request_id: 8 });
  await jobs.observe({ request_id: 10, completed_request_id: 9 });
  assert.deepEqual(calls, []);
  await jobs.observe({ request_id: 11, completed_request_id: 10 });
  assert.deepEqual(calls.map(job => job.requestId), ['11']);
  await jobs.stop();
});

test('a failed daily claim retries only the Supabase claim within 08:00, without reading MSSQL', async () => {
  let attempts = 0, queries = 0;
  const jobs = createPriceJobs({ claimDaily: async () => {
    if (++attempts === 1) throw new Error('temporary queue failure');
    return true;
  }, syncOnce: async () => { queries++; } });
  await assert.rejects(jobs.tick(new Date('2026-11-10T01:00:01Z')), /temporary/);
  assert.equal(queries, 0);
  await jobs.tick(new Date('2026-11-10T01:00:03Z'));
  assert.equal(queries, 1);
  await jobs.stop();
});

test('a failed MSSQL daily run is not retried on every tick or outside the schedule', async () => {
  let queries = 0;
  const jobs = createPriceJobs({ claimDaily: async () => true, syncOnce: async () => { queries++; throw new Error('MSSQL unavailable'); } });
  await assert.rejects(jobs.tick(new Date('2026-11-10T01:00:01Z')), /MSSQL/);
  await jobs.tick(new Date('2026-11-10T01:00:20Z'));
  await jobs.tick(new Date('2026-11-10T01:02:00Z'));
  assert.equal(queries, 1);
  await jobs.stop();
});

test('failed Admin completion is retried after a Supabase outage without repeating MSSQL work', async () => {
  const calls = [];
  let failing = true;
  const reporter = createPriceFailureReporter({ async rpc(name, args) {
    calls.push({ name, args });
    return { data: null, error: failing ? { message: 'temporary cloud outage' } : null };
  } });
  await assert.rejects(reporter.report('7', 'MSSQL unavailable'), /cloud outage/);
  failing = false;
  await reporter.flush();
  await reporter.flush();
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.name === 'complete_price_refresh'));
  assert.deepEqual(calls[1].args, { p_request_id: '7', p_error: 'MSSQL unavailable' });
});
