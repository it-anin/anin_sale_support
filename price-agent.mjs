/**
 * R05.106: SELECT MSSQL at 08:00 Asia/Bangkok or on an Admin badge request.
 * Navigation never requests a query. No triggers/Change Tracking are installed
 * in ProMaxx. Use the same read-only MSSQL login as Pending/Stock.
 */
import { createHash } from 'node:crypto';
import { readFileSync, appendFileSync, statSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertReadOnlySql, buildMssqlConfig, readEnvValue } from './mssql-readonly.mjs';

// Source: R05.106.REP <fsql>. Select just the seven fields consumed by Price.
// CF_FMLPRICE comes from ITEMBARCODE, NOT ITEMPRICELEVEL.PRICE.
// LEFT JOINs preserve report rows with a missing unit/category lookup.
export const PRICE_SQL = `
SELECT ITEMBARCODE.BARCODE AS barcode,
       ITEMS.ITEMID AS sku,
       ITEMS.ITEMNAME AS name,
       UNITNAME.UNITNAME AS unit,
       ITEMBARCODE.FMLPRICE AS price,
       ITEMGROUPL1.GROUPNAME AS category,
       ITEMUNIT.BASEMULTIPLE AS base_multiple
FROM ITEMS
JOIN ITEMBARCODE ON ITEMBARCODE.SYSITEMID = ITEMS.SYSITEMID
LEFT JOIN ITEMUNIT ON ITEMUNIT.SYSITEMID = ITEMS.SYSITEMID
                 AND ITEMUNIT.SYSUNITID = ITEMBARCODE.SYSUNITID
LEFT JOIN UNITNAME ON UNITNAME.SYSUNITID = ITEMUNIT.SYSUNITID
LEFT JOIN ITEMGROUPL1 ON ITEMGROUPL1.SYSITEMGROUPL1ID = ITEMS.SYSITEMGROUPL1ID
WHERE ITEMS.ITEMID NOT IN ('DEPOSIT','DEPOSIT-NV')
  AND ITEMS.FShowOnReport = 1
`;

const LOG_FILE = new URL('./price-agent.log', import.meta.url);
let envFile;
function getEnv(name) {
  if (process.env[name]) return process.env[name].trim();
  if (envFile === undefined) {
    try { envFile = readFileSync(new URL('./.env', import.meta.url), 'utf8'); }
    catch { envFile = ''; }
  }
  return readEnvValue(envFile, name);
}

export function loadPriceConfig(env = getEnv, { requireSupabase = true } = {}) {
  const names = ['MSSQL_SERVER', 'MSSQL_DATABASE', 'MSSQL_USER', 'MSSQL_PASSWORD'];
  if (requireSupabase) names.push('SUPABASE_SERVICE_KEY');
  const missing = names.filter(name => !env(name));
  if (missing.length) throw new Error(`Missing ${missing.join(', ')} in environment/.env`);
  const mssql = buildMssqlConfig(env);
  mssql.requestTimeout = 60_000;
  mssql.options.appName = 'anin-price-agent';
  return {
    mssql,
    serviceKey: env('SUPABASE_SERVICE_KEY'),
    supabaseUrl: env('SUPABASE_URL') || env('VITE_SUPABASE_URL') || 'https://eogqnedbdpjuptwlqudn.supabase.co',
  };
}

const text = value => String(value ?? '').trim();
/** Match r05106.ts CSV normalization; preserve barcode leading zeroes. */
export function buildPriceProducts(rows) {
  const byBarcode = new Map();
  for (const row of rows) {
    const barcode = text(row.barcode), sku = text(row.sku);
    if (!barcode || !sku) throw new Error('R05.106 row is missing barcode/SKU; snapshot was not sent');
    const price = Number.parseFloat(row.price) || 0;
    const multiple = Number.parseFloat(row.base_multiple);
    if (!Number.isFinite(price)) throw new Error(`Invalid price for barcode ${barcode}`);
    const product = {
      barcode, sku, name: text(row.name).split(/[\r\n]/)[0].trim(), unit: text(row.unit),
      price, category: text(row.category) || 'ทั่วไป',
      base_multiple: Number.isFinite(multiple) ? multiple : null,
    };
    const previous = byBarcode.get(barcode);
    if (previous && JSON.stringify(previous) !== JSON.stringify(product)) {
      throw new Error(`Conflicting R05.106 rows for barcode ${barcode}; snapshot was not sent`);
    }
    byBarcode.set(barcode, product);
  }
  if (!byBarcode.size) throw new Error('R05.106 returned no products; snapshot was not sent');
  return [...byBarcode.values()].sort((a, b) => a.barcode < b.barcode ? -1 : a.barcode > b.barcode ? 1 : 0);
}

export function priceHash(products) {
  const sorted = [...products].sort((a, b) => a.barcode < b.barcode ? -1 : a.barcode > b.barcode ? 1 : 0);
  return createHash('sha256').update(JSON.stringify(sorted)).digest('hex');
}

function checkResult(result) {
  if (result.error) {
    const err = new Error(result.error.message);
    err.name = 'SupabaseError';
    throw err;
  }
  return result.data;
}

export async function pushPriceSnapshot(client, products, requestId = '0') {
  const hash = priceHash(products);
  // Check server state every time; a process-local hash misses web/bot writes
  // and causes uploads on every restart. No full payload for unchanged data.
  const unchanged = checkResult(await client.rpc('mark_price_unchanged', { p_hash: hash, p_request_id: requestId }));
  if (unchanged === true) return { changed: false, hash };
  checkResult(await client.rpc('sync_price_products', { p_rows: products, p_hash: hash, p_request_id: requestId }));
  return { changed: true, hash };
}

/** Bangkok has a fixed UTC+07:00 offset. Only the 08:00 minute is eligible. */
export function scheduledPriceDate(now = new Date()) {
  const local = new Date(now.getTime() + 7 * 60 * 60_000);
  return local.getUTCHours() === 8 && local.getUTCMinutes() === 0
    ? local.toISOString().slice(0, 10) : null;
}

/** Serialize daily/manual work, coalescing repeated observations of a request. */
export function createPriceJobs({ claimDaily, syncOnce }) {
  let running = null;
  let queuedRequest = 0n;
  let queuedDay = null;
  let lastStartedRequest = 0n;
  let lastCompletedRequest = 0n;
  let consideredDay = null;
  let stopped = false;
  function drain() {
    if (running || stopped) return running ?? Promise.resolve();
    running = (async () => {
      while (!stopped && (queuedRequest > 0n || queuedDay)) {
        const request = queuedRequest, day = queuedDay;
        queuedRequest = 0n;
        queuedDay = null;
        if (request > lastStartedRequest) lastStartedRequest = request;
        let daily = false;
        if (day) {
          try { daily = await claimDaily(day); }
          catch (err) {
            consideredDay = null; // Retry only the Supabase claim within 08:00.
            if (!request) throw err;
          }
        }
        if (stopped) break;
        if (daily || request > 0n) await syncOnce({ requestId: request.toString(), day: daily ? day : null });
      }
    })().finally(() => { running = null; });
    return running;
  }
  return {
    observe(row) {
      const requested = BigInt(row.request_id ?? 0), completed = BigInt(row.completed_request_id ?? 0);
      if (completed > lastCompletedRequest) lastCompletedRequest = completed;
      if (lastCompletedRequest >= queuedRequest) queuedRequest = 0n;
      if (requested > lastCompletedRequest && requested > lastStartedRequest && requested > queuedRequest) queuedRequest = requested;
      return drain();
    },
    tick(now = new Date()) {
      const day = scheduledPriceDate(now);
      if (day && day !== consideredDay) { consideredDay = day; queuedDay = day; }
      return drain();
    },
    async stop() { stopped = true; queuedRequest = 0n; queuedDay = null; await running; },
  };
}

/** Retry reporting failed Admin requests after a cloud outage, never the SELECT. */
export function createPriceFailureReporter(client) {
  const pending = new Map();
  const complete = async (requestId, message) => {
    checkResult(await client.rpc('complete_price_refresh', { p_request_id: requestId, p_error: message }));
    pending.delete(requestId);
  };
  return {
    async report(requestId, message) {
      if (requestId !== '0') pending.set(requestId, message);
      await complete(requestId, message);
    },
    async flush() {
      for (const [requestId, message] of pending) await complete(requestId, message);
    },
  };
}

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(line);
  try {
    if (statSync(LOG_FILE, { throwIfNoEntry: false })?.size > 5 * 1024 * 1024) {
      renameSync(LOG_FILE, new URL('./price-agent.previous.log', import.meta.url));
    }
    appendFileSync(LOG_FILE, line + '\n', 'utf8');
  } catch { /* Console output remains available if the log directory is read-only. */ }
}

function createSource(config, sql) {
  let pool;
  const close = async () => {
    const current = pool;
    pool = undefined;
    if (current) await current.close().catch(() => {});
  };
  return {
    async fetchRows() {
      try {
        if (!pool) {
          pool = new sql.ConnectionPool(config.mssql);
          pool.on('error', err => log(`MSSQL connection: ${err.code ?? err.name}`));
          await pool.connect();
        }
        return (await pool.request().query(assertReadOnlySql(PRICE_SQL))).recordset;
      } catch (err) {
        await close();
        throw err;
      }
    },
    close,
  };
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.some(arg => !['--print-sql', '--dry-run', '--once', '--help'].includes(arg))) {
    throw new Error('Usage: node price-agent.mjs [--print-sql | --dry-run | --once]');
  }
  if (argv.includes('--help')) {
    console.log('node price-agent.mjs [--print-sql | --dry-run | --once]\nDefault: MSSQL at 08:00 Asia/Bangkok or an Admin badge request. Navigation never requests a query.');
    return;
  }
  if (argv.includes('--print-sql')) { console.log(assertReadOnlySql(PRICE_SQL)); return; }
  const dryRun = argv.includes('--dry-run'), once = argv.includes('--once');
  const config = loadPriceConfig(getEnv, { requireSupabase: !dryRun });
  // Printing SQL/help works before npm install, without credentials or a connection.
  const [{ default: sql }, { createClient }] = await Promise.all([import('mssql'), import('@supabase/supabase-js')]);
  const source = createSource(config, sql);
  const client = dryRun ? null : createClient(config.supabaseUrl, config.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(60_000) }) },
  });
  const failures = client && createPriceFailureReporter(client);
  const stop = new AbortController();
  const shutdown = () => stop.abort();
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  let jobs, channel, scheduleTimer, queueTimer;
  try {
    if (client) {
      const status = checkResult(await client.from('price_sync').select('*').eq('id', 1).single());
      if (!status || !Object.hasOwn(status, 'request_id') || !Object.hasOwn(status, 'last_scheduled_date')) {
        throw new Error('Run the latest price-agent-setup.sql in Supabase first');
      }
    }
    const syncOnce = async ({ requestId = '0', day = null } = {}) => {
      try {
        const started = Date.now();
        const products = buildPriceProducts(await source.fetchRows());
        if (dryRun) {
          log(`Dry run: ${products.length} products; hash ${priceHash(products)}; no Supabase writes`);
        } else {
          const { changed } = await pushPriceSnapshot(client, products, requestId);
          log(`${day ? `08:00 ${day}` : requestId !== '0' ? `Admin request ${requestId}` : '--once'} — ${changed ? 'Snapshot compared/applied' : 'Unchanged; no products sent'}: ${products.length} products (${((Date.now() - started) / 1000).toFixed(2)}s)`);
        }
      } catch (err) {
        log(`${err.name ?? 'Error'}${err.code ? ` ${err.code}` : ''}: ${err.message}`);
        if (dryRun) throw err;
        const message = err.name === 'SupabaseError'
          ? 'บันทึกข้อมูลราคาไม่สำเร็จ ดู log ที่เครื่อง Agent'
          : 'อ่านข้อมูลราคาจาก MSSQL ไม่สำเร็จ ดู log ที่เครื่อง Agent';
        try {
          await failures.report(requestId, message);
        } catch { log('Could not save Agent error status'); }
        if (once) process.exitCode = 1;
      }
    };
    log(`Price Agent started (${dryRun ? 'dry-run' : once ? 'once' : '08:00 Asia/Bangkok + Admin badge; no interval SELECT'})`);
    if (dryRun || once) { await syncOnce(); return; }

    jobs = createPriceJobs({
      claimDaily: async day => checkResult(await client.rpc('claim_price_scheduled_run', { p_run_date: day })),
      syncOnce,
    });
    let reading = false;
    const checkQueue = async () => {
      if (reading || stop.signal.aborted) return;
      reading = true;
      try {
        await failures.flush();
        const status = checkResult(await client.from('price_sync').select('request_id,completed_request_id').eq('id', 1).single());
        void jobs.observe(status).catch(err => log(`Request: ${err.message}`));
      } catch (err) { log(`Could not read Supabase request queue: ${err.message}`); }
      finally { reading = false; }
    };
    channel = client.channel('price-agent-requests')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'price_sync', filter: 'id=eq.1' },
        payload => { if (!stop.signal.aborted) void jobs.observe(payload.new).catch(err => log(`Request: ${err.message}`)); })
      .subscribe(state => { if (state === 'SUBSCRIBED') void checkQueue(); });
    const tick = () => { void jobs.tick().catch(err => log(`Daily schedule: ${err.message}`)); };
    // These timers check the clock/Supabase queue only. They never SELECT MSSQL
    // unless there is an 08:00 claim or an outstanding explicit Admin request.
    scheduleTimer = setInterval(tick, 1000);
    queueTimer = setInterval(() => { void checkQueue(); }, 10_000);
    tick();
    await checkQueue();
    if (!stop.signal.aborted) await new Promise(resolveStop => stop.signal.addEventListener('abort', resolveStop, { once: true }));
  } finally {
    clearInterval(scheduleTimer);
    clearInterval(queueTimer);
    if (channel) await client.removeChannel(channel);
    if (jobs) await jobs.stop();
    process.removeListener('SIGINT', shutdown);
    process.removeListener('SIGTERM', shutdown);
    await source.close();
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(err => { log(`Price Agent stopped: ${err.message}`); process.exitCode = 1; });
}
