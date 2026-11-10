/**
 * Stock แบบ on-demand: หน้าเว็บขอ → SELECT ProMaxx → snapshot ใน Supabase.
 * อ้างอิง R01.102.REP (d_01102_classic_p22112018), ไม่ต้อง Export CSV.
 * node stock-agent.mjs [--print-sql | --dry-run | --once]
 * การติดตั้ง: วิธีติดตั้ง-agent-สต๊อค.md
 */
import sql from 'mssql';
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { readFileSync, appendFileSync, statSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:net';
import {
  WAREHOUSE_MAP, assertReadOnlySql, cleanText, createSyncRunner, loadConfig,
  publicErrorMessage, readEnvValue, timestampMs, unansweredRequestMs, warehouseKey,
} from './pending-docs-agent.mjs';

const SUPABASE_URL = 'https://eogqnedbdpjuptwlqudn.supabase.co';
const QUERY_TIMEOUT_MS = 60_000;
const REQUEST_POLL_MS = 30_000;
const LOG_FILE = new URL('./stock-agent.log', import.meta.url);
const INSTANCE_LOCK_NAME = 'anin-stock-agent-eogqnedbdpjuptwlqudn';

// IPC ภายในเครื่องเท่านั้น ไม่มีพอร์ต TCP/API. OS ปล่อย lock ให้เองเมื่อ process ถูกปิด.
// ชื่อไม่ผูกกับโฟลเดอร์ → สำเนา Agent ที่เปิดจากคนละโฟลเดอร์ในเครื่องเดียวกันก็เปิดซ้ำไม่ได้.
export function stockAgentLockPath(name = INSTANCE_LOCK_NAME, platform = process.platform) {
  return platform === 'win32' ? `\\\\.\\pipe\\${name}` : `\0${name}`;
}

export async function acquireStockAgentLock(path = stockAgentLockPath()) {
  const server = createServer(socket => socket.destroy());
  const close = () => new Promise(done => server.close(() => done()));
  try {
    await new Promise((ready, reject) => {
      server.once('error', reject);
      server.listen({ path, exclusive: true }, () => {
        server.removeListener('error', reject);
        ready();
      });
    });
  } catch (error) {
    await close();
    if (error.code === 'EADDRINUSE') return null;
    throw error;
  }
  // Lock อยู่ตลอดอายุ process แต่ไม่ขวางการออกเมื่อ --once/dry-run หรือ startup ล้มเหลว.
  server.unref();
  let closing;
  return { release: () => (closing ??= close()) };
}

// ใช้เลขสาขา+คลังคู่กันเสมอ — SYSWAREHOUSEID ซ้ำข้ามสาขา.
const warehouseFilter = Object.keys(WAREHOUSE_MAP).map(key => {
  const [branch, warehouse] = key.split(':').map(Number);
  if (!Number.isInteger(branch) || !Number.isInteger(warehouse)) throw new Error('WAREHOUSE_MAP ไม่ถูกต้อง');
  return `(H.SYSBRANCHID = ${branch} AND H.SYSWAREHOUSEID = ${warehouse})`;
}).join(' OR ');

// สูตรเดียวกับ CF_QUANTITY / CF_PRICE / CF_UNITNAME ใน R01.102:
// รวม movement ครั้งเดียวแทน scalar SUM ต่อสินค้า×คลัง; ไม่จำกัดวันที่ เพราะเป็นยอดคงเหลือสะสม.
// ไม่ตัด VOUCHERTYPE 'TW', ไม่กรอง qty > 0 — รายงานมีทั้งยอดศูนย์และติดลบ.
// CF_PRICE แบบแยกสาขาใช้ COMPANY.WORKSYSBRANCHID ตามรายงาน ไม่ใช่สาขาของคลัง.
// ส่ง decimal เป็นข้อความเพื่อเก็บความละเอียดเดิม ไม่แปลงผ่าน floating point ของ JS.
export const STOCK_SQL = `
SELECT W.SYSBRANCHID AS branch_id,
       W.SYSWAREHOUSEID AS warehouse_id,
       I.ITEMID AS sku,
       I.ITEMNAME AS name,
       CONVERT(varchar(60), Q.qty) AS qty,
       (SELECT U.UNITNAME
          FROM ITEMUNIT IU JOIN UNITNAME U ON U.SYSUNITID = IU.SYSUNITID
         WHERE IU.SYSITEMID = I.SYSITEMID AND IU.MULTIPLE = 1) AS unit,
       CONVERT(varchar(60), CASE I.FONEPRICEALLBRANCH
         WHEN 1 THEN
           (SELECT IP.PRICE FROM ITEMPRICELEVEL IP
             WHERE IP.SYSITEMID = I.SYSITEMID AND IP.LEVELNO = 0
               AND IP.SYSUNITID = (SELECT MAX(IU.SYSUNITID) FROM ITEMUNIT IU
                                    WHERE IU.SYSITEMID = I.SYSITEMID AND IU.MULTIPLE = 1))
         WHEN 0 THEN
           (SELECT IP.PRICE FROM ITEMPRICELEVELONBRANCH IP
             WHERE IP.SYSBRANCHID = (SELECT COMPANY.WORKSYSBRANCHID FROM COMPANY)
               AND IP.SYSITEMID = I.SYSITEMID AND IP.LEVELNO = 0
               AND IP.SYSUNITID = (SELECT MAX(IU.SYSUNITID) FROM ITEMUNIT IU
                                    WHERE IU.SYSITEMID = I.SYSITEMID AND IU.MULTIPLE = 1))
       END) AS price
FROM (
  SELECT H.SYSBRANCHID, H.SYSWAREHOUSEID, D.SYSITEMID,
         SUM(D.BASEQUANTITY * V.FSTOCKMAIN) AS qty
    FROM TRANS H
    JOIN TRANDETAILITEM D ON D.SYSTRANNO = H.SYSTRANNO
    JOIN VOUCHER V ON V.SYSVOUCHERID = H.SYSVOUCHERID
   WHERE H.FTaxInvoiceReplacement = 0 AND H.FVoidTaxInvoice = 0
     AND V.FSTOCKMAIN <> 0 AND D.FPROCESS = 1
     AND H.FCANCEL = 0 AND H.FAPPROVE = 1
     AND (${warehouseFilter})
   GROUP BY H.SYSBRANCHID, H.SYSWAREHOUSEID, D.SYSITEMID
) Q
JOIN ITEMS I ON I.SYSITEMID = Q.SYSITEMID
JOIN WAREHOUSE W ON W.SYSBRANCHID = Q.SYSBRANCHID AND W.SYSWAREHOUSEID = Q.SYSWAREHOUSEID
WHERE I.ITEMID NOT IN ('DEPOSIT', 'DEPOSIT-NV')
  AND I.FEFFECTSTOCK = 1 AND I.FSHOWONREPORT = 1 AND I.FUSED = 1
  AND Q.qty IS NOT NULL
ORDER BY W.SYSBRANCHID, W.SYSWAREHOUSEID, I.ITEMID
`;

function decimalText(value, { optional = false } = {}) {
  if (optional && (value === null || value === undefined || value === '')) return '';
  const text = String(value ?? '').trim();
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(text)) throw new Error('จำนวนหรือราคาจาก ProMaxx ไม่ใช่ตัวเลข');
  const [whole, fraction = ''] = text.replace(/^\+/, '').split('.');
  const normalized = `${whole}${fraction.replace(/0+$/, '') ? `.${fraction.replace(/0+$/, '')}` : ''}`;
  return /^-?0$/.test(normalized) ? '0' : normalized;
}

export function normalizeStockRows(rows) {
  const keys = new Set();
  const items = rows.map(row => {
    const branch = WAREHOUSE_MAP[warehouseKey(row.branch_id, row.warehouse_id)];
    const sku = cleanText(row.sku);
    if (!branch || !sku) throw new Error('พบคลังหรือ SKU ที่ไม่ถูกต้อง — ไม่แทนที่ข้อมูลสต๊อค');
    const key = JSON.stringify([branch, sku]);
    if (keys.has(key)) throw new Error(`SKU ซ้ำในคลังเดียวกัน: ${branch} / ${sku}`);
    keys.add(key);
    return {
      branch, sku, name: cleanText(row.name), qty: decimalText(row.qty),
      unit: cleanText(row.unit), price: decimalText(row.price, { optional: true }),
    };
  });
  // คลังที่ใช้งานอยู่มี movement แม้ยอดเป็นศูนย์; ชุดว่างอาจเป็นการต่อฐานข้อมูลผิด.
  if (!items.length) throw new Error('ไม่พบข้อมูลสต๊อค — เก็บข้อมูลชุดเดิมไว้ กรุณาตรวจฐานข้อมูลและรายงาน R01.102');
  return items;
}

export function stockSnapshotHash(items) {
  const key = item => JSON.stringify([item.branch, item.sku]);
  const sorted = [...items].sort((a, b) => key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);
  return createHash('sha256').update(JSON.stringify(sorted)).digest('hex');
}

function checkResult(result, operation = 'stock_sync') {
  if (!result.error) return result.data;
  const error = new Error(`[${operation}] ${result.error.message}`);
  error.name = 'SupabaseError';
  error.code = result.error.code;
  error.operation = operation;
  throw error;
}

export function stockPublicErrorMessage(error) {
  if (error?.name === 'SupabaseError') {
    if (error.code === '57014' || /statement timeout/i.test(error.message ?? '')) {
      return 'Supabase บันทึกสต๊อคเกินเวลาที่กำหนด กรุณาลองอีกครั้ง';
    }
    if (['55P03', '40P01', '40001'].includes(error.code)) {
      return 'มีงานบันทึกสต๊อคซ้อนกัน กรุณาลองอีกครั้ง';
    }
  }
  return publicErrorMessage(error);
}

export async function pushStockSnapshot(client, items, { force = false } = {}) {
  if (!items.length) throw new Error('ไม่ส่ง snapshot สต๊อคว่าง');
  const hash = stockSnapshotHash(items);
  if (!force && checkResult(await client.rpc('mark_stock_unchanged', { p_hash: hash }), 'mark_stock_unchanged') === true) {
    return { changed: false, hash };
  }
  const count = checkResult(await client.rpc('replace_stock_snapshot', { p_rows: items, p_hash: hash }), 'replace_stock_snapshot');
  if (count !== items.length) throw new Error('จำนวนสต๊อคที่บันทึกไม่ตรงกับที่ส่ง');
  return { changed: true, hash };
}

let envText;
function getEnv(name) {
  if (process.env[name]) return process.env[name].trim();
  if (envText === undefined) {
    try { envText = readFileSync(new URL('./.env', import.meta.url), 'utf8'); }
    catch { envText = ''; }
  }
  return readEnvValue(envText, name);
}

function log(message) {
  const line = `[${new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}] [PID ${process.pid}] ${message}`;
  console.log(line);
  try {
    if (statSync(LOG_FILE, { throwIfNoEntry: false })?.size > 5 * 1024 * 1024) {
      renameSync(LOG_FILE, new URL('./stock-agent.log.old', import.meta.url));
    }
    appendFileSync(LOG_FILE, `${line}\n`);
  } catch { /* log ล้มไม่ทำให้ Agent หยุด */ }
}

function createSource(config) {
  let pool;
  const close = async () => {
    const previous = pool;
    pool = null;
    if (previous) await previous.close().catch(() => {});
  };
  return {
    async fetchRows() {
      try {
        if (!pool) {
          pool = new sql.ConnectionPool({
            ...config.mssql, requestTimeout: QUERY_TIMEOUT_MS,
            pool: { max: 1, min: 0, idleTimeoutMillis: 60_000 },
            options: { ...config.mssql.options, appName: 'anin-stock-agent' },
          });
          pool.on('error', err => log(`MSSQL pool: ${err.message}`));
          await pool.connect();
        }
        return (await pool.request().query(assertReadOnlySql(STOCK_SQL))).recordset;
      } catch (err) { await close(); throw err; }
    },
    close,
  };
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.includes('--print-sql')) { console.log(assertReadOnlySql(STOCK_SQL).trim()); return; }
  const lock = await acquireStockAgentLock();
  if (!lock) {
    log('Stock Agent อีกตัวกำลังทำงานอยู่บนเครื่องนี้ — ไม่เปิดตัวซ้ำ');
    return;
  }
  let daemonStarted = false;
  try {
    await runAgent(argv);
    daemonStarted = !argv.includes('--dry-run') && !argv.includes('--once');
  } finally {
    if (!daemonStarted) await lock.release();
  }
}

async function runAgent(argv) {
  const dryRun = argv.includes('--dry-run');
  const once = argv.includes('--once');
  const config = loadConfig(getEnv, { requireSupabase: !dryRun });
  const source = createSource(config);
  log(`▶ Stock Agent (${dryRun ? 'dry-run' : once ? 'รอบเดียว' : 'รอคำขอ'})`);
  const readStock = async () => {
    const start = Date.now();
    const items = normalizeStockRows(await source.fetchRows());
    const counts = Object.values(WAREHOUSE_MAP).map(branch => `${branch} ${items.filter(r => r.branch === branch).length}`).join(' · ');
    log(`อ่านได้ ${items.length} รายการ (${((Date.now() - start) / 1000).toFixed(2)} วิ) · ${counts}`);
    return items;
  };
  if (dryRun) {
    try { await readStock(); log('ตรวจสำเร็จ — ไม่ได้เขียน Supabase'); }
    finally { await source.close(); }
    return;
  }

  const client = createClient(SUPABASE_URL, config.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const statusRow = checkResult(await client.from('stock_sync').select('*').eq('id', 1).maybeSingle());
  if (!statusRow || !Object.hasOwn(statusRow, 'data_hash')) {
    throw new Error('รัน stock-sync-setup.sql ใน Supabase ก่อนเริ่ม Stock Agent');
  }
  if (Number(statusRow.sync_version ?? 0) < 2) {
    throw new Error('Stock ยังใช้ RPC รุ่นเดิม — รัน stock-sync-setup.sql รุ่นแก้ timeout ก่อน แล้วเปิด Agent ใหม่');
  }
  const syncOnce = async (reason, { force = false } = {}) => {
    try {
      const items = await readStock();
      const { changed } = await pushStockSnapshot(client, items, { force });
      log(`${changed ? '✅ ส่งชุดใหม่' : '✓ ข้อมูลเหมือนเดิม ไม่ส่งซ้ำ'} — ${reason}`);
      return true;
    } catch (err) {
      log(`❌ ${reason}: ${err.stack ?? err}`);
      const message = err?.name === 'RequestError' && err?.code === 'ETIMEOUT'
        ? `อ่านสต๊อคจาก ProMaxx นานเกิน ${QUERY_TIMEOUT_MS / 1000} วินาที`
        : stockPublicErrorMessage(err);
      // ใช้เวลาของ DB เช่นเดียวกับ refresh_requested_at; ไม่เผยชื่อเครื่อง/IP จาก driver.
      try { checkResult(await client.rpc('report_stock_sync_error', { p_message: message }), 'report_stock_sync_error'); }
      catch (error) { log(`บันทึกสถานะผิดพลาดไม่ได้: ${error.message}`); }
      return false;
    }
  };
  if (once) {
    try { process.exitCode = await syncOnce('--once', { force: true }) ? 0 : 1; }
    finally { await source.close(); }
    return;
  }

  const runner = createSyncRunner(syncOnce);
  let lastRequestMs = unansweredRequestMs(statusRow) === null ? timestampMs(statusRow.refresh_requested_at) : null;
  let pollRunning = false;
  let pollFailed = false;
  const onRequest = row => {
    const requested = timestampMs(row?.refresh_requested_at);
    if (requested !== null && (lastRequestMs === null || requested > lastRequestMs)) {
      lastRequestMs = requested;
      void runner.request('หน้า Stock ขอข้อมูลล่าสุด');
    }
  };
  const catchUp = async () => {
    if (pollRunning) return;
    pollRunning = true;
    try {
      const row = checkResult(await client.from('stock_sync').select('refresh_requested_at').eq('id', 1).maybeSingle());
      if (!row) throw new Error('ไม่พบแถวสถานะ');
      if (pollFailed) log('✓ อ่านคำขอได้อีกครั้ง');
      pollFailed = false;
      onRequest(row);
    } catch (err) {
      if (!pollFailed) log(`อ่านคำขอไม่ได้: ${err.message} — ไม่ถาม MSSQL`);
      pollFailed = true;
    } finally { pollRunning = false; }
  };

  onRequest(statusRow);
  log('💤 รอเปิดหน้า Stock / กดรีเฟรช — ไม่มีคำขอ = ไม่ถาม MSSQL');
  let realtimeDownSince = Date.now();
  const channel = client.channel('stock-agent')
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'stock_sync' }, payload => onRequest(payload.new))
    .subscribe(status => {
      if (status === 'SUBSCRIBED') { realtimeDownSince = null; log('🔌 Realtime พร้อม'); void catchUp(); }
      else if (realtimeDownSince === null) realtimeDownSince = Date.now();
    });
  // อ่านคำขอใน Supabase เท่านั้น — ไม่ใช่รอบถาม MSSQL.
  const poll = setInterval(() => {
    void catchUp();
    if (realtimeDownSince !== null && Date.now() - realtimeDownSince > 10 * 60_000) {
      log('Realtime หลุดนาน — ออกให้ .bat เปิดใหม่');
      void shutdown(1);
    }
  }, REQUEST_POLL_MS);
  const shutdown = async code => {
    clearInterval(poll);
    await client.removeChannel(channel).catch(() => {});
    await source.close();
    process.exit(code);
  };
  process.on('SIGINT', () => void shutdown(0));
  process.on('SIGTERM', () => void shutdown(0));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(err => { log(`❌ ${err.stack ?? err}`); process.exitCode = 1; });
}
