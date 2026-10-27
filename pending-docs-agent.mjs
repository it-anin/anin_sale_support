/**
 * pending-docs-agent.mjs
 * Agent ของหน้า "ตรวจสอบเอกสารค้าง" — ดึงใบโอนสินค้าออกที่สาขายังไม่กด "ส่ง" จาก MSSQL ของ ProMaxx
 * แล้วส่งขึ้น Supabase ให้หน้าเว็บ (PendingDocsPage.tsx) แสดง
 *
 * รันค้างไว้ตลอด:  node pending-docs-agent.mjs            (Task Scheduler เรียกผ่าน run-pending-docs-agent.bat)
 * ทดสอบ query:     node pending-docs-agent.mjs --dry-run  (อ่าน MSSQL อย่างเดียว ไม่เขียน Supabase)
 * ซิงค์รอบเดียว:   node pending-docs-agent.mjs --once
 * เอา SQL ไปลองใน SSMS: node pending-docs-agent.mjs --print-sql
 *
 * ทำงานยังไง: หน้าเว็บเรียก RPC request_pending_docs_refresh() → แถว pending_docs_sync เปลี่ยน
 *   → Agent ได้ยินทาง Supabase Realtime (ต่อออกจากร้านอย่างเดียว ไม่มีช่องให้อินเทอร์เน็ตเข้ามา)
 *   → SELECT จาก MSSQL → RPC replace_pending_transfers() → หน้าเว็บได้ realtime แล้วโหลดใหม่
 *   + ซิงค์สำรองเองทุก 5 นาที เผื่อ realtime หลุด
 *
 * 🚨 MSSQL ของ ProMaxx: SELECT เท่านั้น ห้ามเขียน/สร้างอะไรเด็ดขาด (ข้อมูลต้องเปลี่ยนผ่าน ProMaxx เท่านั้น)
 *    → assertReadOnlySql() เช็คก่อนส่งทุกครั้ง + ตอนรันจริงใช้ login อ่านอย่างเดียว web_readonly
 * ต้องรัน pending-docs-setup.sql ใน Supabase ก่อน · วิธีติดตั้งเต็ม: วิธีติดตั้ง-agent-เอกสารค้าง.md
 */

import sql from 'mssql';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, appendFileSync, existsSync, statSync, renameSync } from 'fs';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

// ─── CONFIG ───────────────────────────────────────────────
const SUPABASE_URL = 'https://eogqnedbdpjuptwlqudn.supabase.co';
const DEFAULT_DAYS = 90;                    // ย้อนหลังกี่วัน (เปลี่ยนได้ด้วย PENDING_TRANSFER_DAYS ใน .env)
const BACKUP_SYNC_MS = 5 * 60_000;          // ซิงค์สำรองทุก 5 นาทีแม้ไม่มีใครเปิดหน้า
const QUERY_TIMEOUT_MS = 20_000;
// realtime ต่อไม่ติดนานเกินนี้ → ออกให้ .bat เปิดใหม่ (ได้ connection สด)
// ⚠️ ต้องนานกว่า BACKUP_SYNC_MS — ถ้า firewall ร้านบล็อก websocket ถาวร ระหว่างรอยังต้องได้ซิงค์สำรองบ้าง
const REALTIME_DOWN_RESTART_MS = 10 * 60_000;
const LOG_FILE = new URL('./pending-docs-agent.log', import.meta.url);
const LOG_MAX_BYTES = 5 * 1024 * 1024;

// SYSBRANCHID ของ ProMaxx → รหัสในแอป (ต้องตรงกับ Profile.branch ใน auth.ts ไม่งั้นสาขาจะไม่เห็นใบของตัวเอง)
// ⚠️ เติมเลขจริงจากผล `SELECT SYSBRANCHID, NAME FROM BRANCH` ใน SSMS (คู่มือขั้นที่ 1) แล้วลบ // ออก
//    ระหว่างที่ยังว่าง จะลองจับคู่จากชื่อสาขาใน BRANCH_NAME_MAP แทน
export const BRANCH_ID_MAP = {
  // 0: 'คลังสินค้า',
  // 1: 'SRC',
  // 2: 'KKL',
  // 3: 'SSS',
};

// ชื่อสาขาใน ProMaxx ชุดเดียวกับที่ไฟล์สต๊อคใช้ (BRANCH_MAP ใน upload-stock.mjs) — เทียบแบบไม่สนตัวพิมพ์
export const BRANCH_NAME_MAP = {
  'warehouse':   'คลังสินค้า',
  'front store': 'SRC',
  'main kkl':    'KKL',
  'main sss':    'SSS',
};

// ใบโอนสินค้าออก (VOUCHERTYPE 'TB' + VOUCHERINOUT 'O') ที่ยังไม่มีใบแจ้งโอน = สาขายังไม่กด "ส่ง"
// ดัดแปลงจากรายงาน R16.150 (d_16150_h20190121) ของ SeniorSoft:
//   - NOT EXISTS ตรงกับ "CF_SYSREFERENCETRANNO ว่าง" ของรายงาน — เช็คแค่มี/ไม่มี เพราะคำนำหน้าเลขใบแจ้งโอนไม่ตายตัว
//   - ตัด TRANLINKTRANNO / cf_countintranno ของรายงานเดิมออก: ใบที่ยังไม่ส่งไม่มีใบแจ้งโอนให้ใครมาเชื่อม นับได้ 0 เสมอ
//   - จำกัดวันที่ใน SQL — รายงานเดิมดึงใบโอนทุกใบตั้งแต่เริ่มระบบแล้วค่อยกรองใน ProMaxx
//     ซึ่งหนักเกินไปสำหรับ SQL Server Express ที่ใช้ทรัพยากรร่วมกับ POS ทุกสาขา
//   - วันที่ส่งเป็นข้อความ YYYY-MM-DD (style 23) กัน driver ตีความ datetime เป็น UTC แล้วเลื่อน 7 ชม.
export const TRANSFER_SQL = `
SELECT TRANS.SYSTRANNO AS sys_tran_no,
       TRANS.TRANNO AS doc_no,
       CONVERT(char(10), TRANS.TRANDATE, 23) AS doc_date,
       TRANS.SYSBRANCHID AS from_branch_id,
       BRANCH.NAME AS from_branch_name,
       TRANEXTRAINFO.REFTRANFERSYSBRANCH AS to_branch_id,
       DEST.NAME AS to_branch_name,
       TRANDETAILITEM.ORDINARY AS line_no,
       TRANDETAILITEM.SCANCODE AS item_code,
       TRANDETAILITEM.ITEMNAME AS item_name,
       TRANDETAILITEM.SERIALNO AS serial_no,
       TRANDETAILITEM.QUANTITY AS qty
FROM TRANS
JOIN VOUCHER ON VOUCHER.SYSVOUCHERID = TRANS.SYSVOUCHERID
JOIN TRANEXTRAINFO ON TRANEXTRAINFO.SYSTRANNO = TRANS.SYSTRANNO
JOIN BRANCH ON BRANCH.SYSBRANCHID = TRANS.SYSBRANCHID
JOIN TRANDETAILITEM ON TRANDETAILITEM.SYSTRANNO = TRANS.SYSTRANNO
JOIN ITEMS ON ITEMS.SYSITEMID = TRANDETAILITEM.SYSITEMID
LEFT JOIN BRANCH DEST ON DEST.SYSBRANCHID = TRANEXTRAINFO.REFTRANFERSYSBRANCH
WHERE VOUCHER.VOUCHERTYPE = 'TB'
  AND VOUCHER.VOUCHERINOUT = 'O'
  AND TRANS.FCANCEL = 0
  AND TRANS.TRANDATE >= DATEADD(day, -@days, CAST(GETDATE() AS date))
  AND NOT EXISTS (SELECT 1 FROM TRANS REF WHERE REF.SYSTRANNO = TRANEXTRAINFO.SYSREFERENCETRANNO)
ORDER BY TRANS.TRANDATE, TRANS.TRANNO, TRANDETAILITEM.ORDINARY
`;
// ──────────────────────────────────────────────────────────

// ─── ค่าจาก .env ───────────────────────────────────────────
// อ่าน env ก่อน ถ้าไม่มีลองอ่านจากไฟล์ .env ข้างสคริปต์ (ไฟล์เดียวกับที่ upload-stock.mjs ใช้)
// ⚠️ ห้ามตั้งชื่อขึ้นต้น VITE_ — Vite จะฝังค่าลงไฟล์ JS ของเว็บที่ใครก็เปิดอ่านได้
export function readEnvValue(text, name) {
  const m = String(text ?? '').match(new RegExp(`^\\s*${name}\\s*=(.*)$`, 'm'));
  if (!m) return null;
  let value = m[1].trim();
  if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.endsWith(value[0])) {
    value = value.slice(1, -1);
  }
  return value || null;
}

let envFileText;
function getEnv(name) {
  if (process.env[name]) return process.env[name].trim();
  if (envFileText === undefined) {
    try {
      envFileText = readFileSync(new URL('./.env', import.meta.url), 'utf-8');
    } catch {
      envFileText = '';
    }
  }
  return readEnvValue(envFileText, name);
}

export function loadConfig(env = getEnv, { requireSupabase = true } = {}) {
  const required = ['MSSQL_SERVER', 'MSSQL_DATABASE', 'MSSQL_USER', 'MSSQL_PASSWORD'];
  if (requireSupabase) required.push('SUPABASE_SERVICE_KEY');
  const missing = required.filter(name => !env(name));
  if (missing.length) {
    throw new Error(`ไม่พบค่า ${missing.join(', ')} ใน environment หรือไฟล์ .env (ดูวิธีตั้งในคู่มือ)`);
  }

  const days = Number.parseInt(env('PENDING_TRANSFER_DAYS') ?? '', 10);
  return {
    serviceKey: env('SUPABASE_SERVICE_KEY'),
    days: Number.isFinite(days) && days >= 1 && days <= 3650 ? days : DEFAULT_DAYS,
    mssql: buildMssqlConfig(env),
  };
}

export function buildMssqlConfig(env) {
  const instanceName = env('MSSQL_INSTANCE');
  const port = Number.parseInt(env('MSSQL_PORT') ?? '', 10);
  const tdsVersion = env('MSSQL_TDS_VERSION');
  const config = {
    server: env('MSSQL_SERVER'),
    database: env('MSSQL_DATABASE'),
    user: env('MSSQL_USER'),
    password: env('MSSQL_PASSWORD'),
    connectionTimeout: 15_000,
    requestTimeout: QUERY_TIMEOUT_MS,
    // pool เล็ก — SQL Server Express ใช้ทรัพยากรร่วมกับ POS ทุกสาขา และ Agent ถามทีละคำสั่งอยู่แล้ว
    pool: { max: 2, min: 0, idleTimeoutMillis: 60_000 },
    options: {
      // SQL Server รุ่นเก่า (2008/2012) ที่มีแต่ TLS 1.0 → ตั้ง MSSQL_ENCRYPT=false
      encrypt: String(env('MSSQL_ENCRYPT') ?? 'true').toLowerCase() !== 'false',
      trustServerCertificate: true,           // SQL Server ในร้านใช้ cert ที่สร้างเอง
      appName: 'anin-pending-docs-agent',     // ชื่อที่เห็นใน Activity Monitor ของ SSMS
    },
  };
  // Express ส่วนใหญ่ติดตั้งเป็น named instance (เช่น SQLEXPRESS) — หาพอร์ตผ่าน SQL Server Browser
  if (instanceName) config.options.instanceName = instanceName;
  else if (Number.isFinite(port)) config.port = port;
  if (tdsVersion) config.options.tdsVersion = tdsVersion;
  return config;
}
// ──────────────────────────────────────────────────────────

// 🚨 ด่านสุดท้ายก่อนส่งคำสั่งเข้า MSSQL — ยอมให้เฉพาะ SELECT คำสั่งเดียว
// กันคนแก้ TRANSFER_SQL ในอนาคตแล้วเผลอใส่คำสั่งเขียน (ตัว login web_readonly ก็บล็อกซ้ำอีกชั้น)
const WRITE_KEYWORDS = /\b(INSERT|UPDATE|DELETE|MERGE|DROP|ALTER|CREATE|TRUNCATE|EXEC|EXECUTE|GRANT|REVOKE|DENY|INTO|BACKUP|RESTORE|DBCC|SHUTDOWN|KILL)\b/i;

export function assertReadOnlySql(text) {
  const code = String(text ?? '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\r\n]*/g, ' ');
  if (!/^\s*SELECT\b/i.test(code)) {
    throw new Error('🚨 ส่งได้เฉพาะคำสั่ง SELECT — MSSQL ของ ProMaxx ห้ามเขียนเด็ดขาด');
  }
  if (code.includes(';')) {
    throw new Error('🚨 ห้ามมีหลายคำสั่งใน SQL เดียว (พบเครื่องหมาย ;)');
  }
  const found = code.match(WRITE_KEYWORDS);
  if (found) {
    throw new Error(`🚨 พบคำสั่ง ${found[1].toUpperCase()} — MSSQL ของ ProMaxx ห้ามเขียน/สร้างอะไรเด็ดขาด`);
  }
  return text;
}

// ช่อง char ของ ProMaxx เติมช่องว่างท้ายมาจนเต็มความยาว — ตัดทิ้งก่อนเก็บ/แสดง
export function cleanText(raw) {
  return String(raw ?? '').replace(/\s+/g, ' ').trim();
}

export function normalizeDate(raw) {
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return null;
    const pad = n => String(n).padStart(2, '0');
    return `${raw.getFullYear()}-${pad(raw.getMonth() + 1)}-${pad(raw.getDate())}`;
  }
  const text = cleanText(raw);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

/** แปลงสาขา ProMaxx → รหัสในแอป · `known: false` = map ไม่ได้ (ใบยังอยู่ครบ แต่สาขาจะไม่เห็นใบของตัวเอง) */
export function resolveBranch(id, name, idMap = BRANCH_ID_MAP, nameMap = BRANCH_NAME_MAP) {
  if (id !== null && id !== undefined && Object.hasOwn(idMap, String(id))) {
    return { code: idMap[String(id)], known: true };
  }
  const label = cleanText(name);
  const byName = nameMap[label.toLowerCase()];
  if (byName) return { code: byName, known: true };
  return { code: label || (id !== null && id !== undefined ? `สาขา #${id}` : ''), known: false };
}

/** แถวจาก SQL (1 แถว = 1 รายการสินค้า) → ใบโอน 1 ใบต่อ SYSTRANNO พร้อม items สำหรับ popup */
export function groupTransferRows(rows, branchOf = resolveBranch) {
  const docs = new Map();
  const unknownBranches = new Map();

  const branch = (id, name) => {
    const result = branchOf(id, name);
    if (!result.known) unknownBranches.set(`${id}|${cleanText(name)}`, { id, name: cleanText(name) });
    return result.code;
  };

  for (const row of rows) {
    const key = cleanText(row.sys_tran_no);
    if (!key) continue;

    let doc = docs.get(key);
    if (!doc) {
      doc = {
        sys_tran_no: row.sys_tran_no,
        doc_no: cleanText(row.doc_no),
        doc_date: normalizeDate(row.doc_date),
        from_branch: branch(row.from_branch_id, row.from_branch_name),
        to_branch: branch(row.to_branch_id, row.to_branch_name),
        item_count: 0,
        items: [],
      };
      docs.set(key, doc);
    }

    const qty = Number(row.qty);
    const lineNo = Number(row.line_no);
    const item = {
      line_no: Number.isFinite(lineNo) ? lineNo : null,
      code: cleanText(row.item_code),
      name: cleanText(row.item_name),
      qty: row.qty === null || row.qty === undefined || !Number.isFinite(qty) ? null : qty,
    };
    const serial = cleanText(row.serial_no);
    if (serial) item.serial = serial;
    doc.items.push(item);
  }

  for (const doc of docs.values()) {
    doc.items.sort((a, b) => (a.line_no ?? Infinity) - (b.line_no ?? Infinity));
    doc.item_count = doc.items.length;
  }

  return { docs: [...docs.values()], unknownBranches: [...unknownBranches.values()] };
}

/**
 * ข้อความ error ที่เขียนลง Supabase (หน้าเว็บโชว์) — ตั้งใจไม่ใส่ข้อความดิบของ driver
 * เพราะ pending_docs_sync อ่านได้ด้วย anon key ซึ่งเป็นสาธารณะ ข้อความดิบมีชื่อเครื่อง/IP ใน LAN
 * รายละเอียดเต็มอยู่ใน pending-docs-agent.log ที่เครื่อง Agent เท่านั้น
 */
export function publicErrorMessage(err) {
  const code = err?.code;
  if (err?.name === 'SupabaseError') return 'ส่งข้อมูลขึ้น Supabase ไม่สำเร็จ';
  if (err?.name === 'ConnectionError') {
    if (code === 'ELOGIN') return 'MSSQL ปฏิเสธการล็อกอิน (เช็คชื่อผู้ใช้/รหัสใน .env)';
    if (code === 'EINSTLOOKUP') return 'หา instance ของ SQL Server ไม่เจอ (เช็ค MSSQL_INSTANCE / SQL Server Browser)';
    if (code === 'ETIMEOUT') return 'ต่อ MSSQL ไม่ทัน (เครื่องเซิร์ฟเวอร์ปิดอยู่ หรือเน็ตในร้านมีปัญหา)';
    return 'ต่อ MSSQL ไม่ได้';
  }
  if (err?.name === 'RequestError') {
    if (code === 'ETIMEOUT') return `query MSSQL นานเกิน ${QUERY_TIMEOUT_MS / 1000} วิ`;
    if (err.number === 229 || err.number === 230) return 'login นี้ไม่มีสิทธิ์อ่านตารางที่ต้องใช้';
    return 'คำสั่ง SQL ผิดพลาด (ดู log ที่เครื่อง Agent)';
  }
  return 'Agent ทำงานผิดพลาด (ดู log ที่เครื่อง Agent)';
}

/** เวลาจาก Supabase → มิลลิวินาที · รองรับทั้งแบบ PostgREST (ISO) และแบบมีช่องว่าง/+00 · อ่านไม่ออก = null */
export function timestampMs(value) {
  if (!value) return null;
  const text = String(value).trim()
    .replace(' ', 'T')
    .replace(/([+-]\d{2})$/, '$1:00')
    .replace(/(\.\d{3})\d+/, '$1');
  const ms = Date.parse(text);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * ทำทีละรอบ (single-flight) — คำขอที่เข้ามาระหว่างกำลังซิงค์ ยุบเหลือ "ทำซ้ำอีก 1 รอบ" หลังรอบนี้จบ
 * ทำให้ MSSQL ไม่โดน query ซ้อนกัน แม้หลายเครื่องเปิดหน้าพร้อมกัน
 */
export function createSyncRunner(syncOnce) {
  let running = null;
  let again = false;
  return {
    request(reason) {
      if (running) {
        again = true;
        return running;
      }
      running = (async () => {
        let why = reason;
        do {
          again = false;
          await syncOnce(why);
          why = 'มีคำขอเข้ามาระหว่างรอบก่อน';
        } while (again);
      })().finally(() => {
        running = null;
      });
      return running;
    },
  };
}

// ─── log ──────────────────────────────────────────────────
// เขียนซ้ำลงไฟล์ด้วย เพราะตอน Task Scheduler รันแบบไม่มีคนล็อกอิน จะไม่มีหน้าจอให้ดู
function log(message) {
  const line = `[${new Date().toLocaleString('th-TH')}] ${message}`;
  console.log(line);
  try {
    appendFileSync(LOG_FILE, `${line}\n`);
  } catch {
    // เขียน log ไม่ได้ไม่ควรทำให้ Agent หยุด
  }
}

function rotateLogIfLarge() {
  try {
    if (existsSync(LOG_FILE) && statSync(LOG_FILE).size > LOG_MAX_BYTES) {
      renameSync(LOG_FILE, new URL('./pending-docs-agent.log.old', import.meta.url));
    }
  } catch {
    // หมุน log ไม่ได้ก็เขียนต่อไฟล์เดิม
  }
}
// ──────────────────────────────────────────────────────────

function createMssqlSource(config) {
  let poolPromise = null;

  const reset = async () => {
    const current = poolPromise;
    poolPromise = null;
    if (current) {
      try {
        await (await current).close();
      } catch {
        // pool พังอยู่แล้ว ปิดไม่ได้ก็ไม่เป็นไร รอบหน้าสร้างใหม่
      }
    }
  };

  const getPool = () => {
    if (!poolPromise) {
      const pool = new sql.ConnectionPool(config.mssql);
      // error ของ connection ที่ว่างอยู่ — pool ยังใช้ต่อได้ ถ้าใช้ไม่ได้จริง fetchRows จะ reset เอง
      pool.on('error', err => log(`⚠️ MSSQL pool error: ${err.message}`));
      poolPromise = pool.connect().catch(err => {
        poolPromise = null;
        throw err;
      });
    }
    return poolPromise;
  };

  return {
    async fetchRows() {
      try {
        const pool = await getPool();
        const request = pool.request();
        request.input('days', sql.Int, config.days);
        const result = await request.query(assertReadOnlySql(TRANSFER_SQL));
        return result.recordset;
      } catch (err) {
        await reset(); // เครือข่ายหลุด/เซิร์ฟเวอร์รีสตาร์ท → รอบหน้าต่อใหม่สดๆ
        throw err;
      }
    },
    close: reset,
  };
}

async function fetchPendingDocs(source) {
  const started = Date.now();
  const rows = await source.fetchRows();
  const { docs, unknownBranches } = groupTransferRows(rows);
  return { rows, docs, unknownBranches, seconds: (Date.now() - started) / 1000 };
}

function warnUnknownBranches(unknownBranches) {
  if (!unknownBranches.length) return;
  const list = unknownBranches.map(b => `#${b.id ?? '?'} "${b.name}"`).join(', ');
  log(`⚠️ สาขาที่ map ไม่ได้: ${list} — ใบเหล่านี้คลังสินค้า/จัดซื้อยังเห็น แต่สาขาจะไม่เห็น · เติม BRANCH_ID_MAP ในไฟล์นี้`);
}

function printDryRun(config, { rows, docs, unknownBranches, seconds }) {
  const byBranch = new Map();
  for (const doc of docs) byBranch.set(doc.from_branch, (byBranch.get(doc.from_branch) ?? 0) + 1);

  const branchesSeen = new Map();
  for (const row of rows) {
    for (const [id, name] of [[row.from_branch_id, row.from_branch_name], [row.to_branch_id, row.to_branch_name]]) {
      const key = `${id}|${cleanText(name)}`;
      if (!branchesSeen.has(key)) branchesSeen.set(key, { id, name: cleanText(name), code: resolveBranch(id, name).code });
    }
  }

  console.log('');
  console.log('── สรุป dry-run (อ่าน MSSQL อย่างเดียว ไม่ได้เขียน Supabase) ──');
  console.log(`   ย้อนหลัง ${config.days} วัน · query ใช้เวลา ${seconds.toFixed(2)} วิ`);
  console.log(`   รายการสินค้า ${rows.length.toLocaleString()} แถว → ใบโอนค้างส่ง ${docs.length.toLocaleString()} ใบ`);
  console.log(`   แยกตามต้นทาง: ${[...byBranch].map(([b, n]) => `${b} ${n}`).join(' · ') || '-'}`);
  console.log('   สาขาที่พบ (SYSBRANCHID → ชื่อใน ProMaxx → รหัสในเว็บ):');
  for (const b of branchesSeen.values()) console.log(`     ${b.id ?? '?'} → "${b.name}" → ${b.code}`);
  if (unknownBranches.length) console.log('   ⚠️ มีสาขาที่ map ไม่ได้ — เติม BRANCH_ID_MAP ด้านบนของไฟล์นี้');
  console.log('   ตัวอย่าง 3 ใบแรก:');
  for (const doc of docs.slice(0, 3)) {
    const first = doc.items[0];
    console.log(`     ${doc.doc_no} | ${doc.doc_date ?? '-'} | ${doc.from_branch} → ${doc.to_branch} | ${doc.item_count} รายการ`
      + (first ? ` | เช่น ${first.code} / ${first.name} × ${first.qty}` : ''));
  }
  if (seconds > 1) console.log('   ⚠️ query ช้ากว่า 1 วิ — SQL Server Express ใช้ร่วมกับ POS ลองลด PENDING_TRANSFER_DAYS');
}

/** SQL ตัวเดียวกับที่ Agent ใช้ พร้อมตัวแปร @days — ก๊อปไปวางใน SSMS ได้ทันที (ไม่ต้องคัดลอก SQL ไปเก็บซ้ำในคู่มือ) */
export function sqlForSsms(days = DEFAULT_DAYS) {
  return `SET STATISTICS TIME ON;\nDECLARE @days int = ${days};\n${assertReadOnlySql(TRANSFER_SQL).trim()}\n`;
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.includes('--print-sql')) {
    const days = Number.parseInt(getEnv('PENDING_TRANSFER_DAYS') ?? '', 10);
    console.log(sqlForSsms(Number.isFinite(days) && days >= 1 && days <= 3650 ? days : DEFAULT_DAYS));
    return;
  }
  const dryRun = argv.includes('--dry-run');
  const once = argv.includes('--once');
  rotateLogIfLarge();
  log(`▶ เริ่ม Agent เอกสารค้าง (${dryRun ? 'dry-run' : once ? 'ซิงค์รอบเดียว' : 'รันค้าง'})`);

  const config = loadConfig(getEnv, { requireSupabase: !dryRun });
  const source = createMssqlSource(config);

  if (dryRun) {
    try {
      printDryRun(config, await fetchPendingDocs(source));
    } finally {
      await source.close();
    }
    return;
  }

  const supabase = createClient(SUPABASE_URL, config.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const reportError = async message => {
    const { error } = await supabase
      .from('pending_docs_sync')
      .update({ last_error: message, last_error_at: new Date().toISOString() })
      .eq('id', 1);
    if (error) log(`⚠️ บันทึก error ลง Supabase ไม่สำเร็จ: ${error.message}`);
  };

  const syncOnce = async reason => {
    try {
      const { docs, unknownBranches, seconds } = await fetchPendingDocs(source);
      warnUnknownBranches(unknownBranches);
      const { error } = await supabase.rpc('replace_pending_transfers', { p_rows: docs });
      if (error) {
        const supabaseError = new Error(error.message);
        supabaseError.name = 'SupabaseError';
        throw supabaseError;
      }
      log(`✅ ${reason} — ใบโอนค้างส่ง ${docs.length} ใบ (query ${seconds.toFixed(2)} วิ)`);
      return true;
    } catch (err) {
      log(`❌ ${reason} — ${err.name ?? 'Error'}${err.code ? ` ${err.code}` : ''}: ${err.message}`);
      await reportError(publicErrorMessage(err)).catch(e => log(`⚠️ ${e.message}`));
      return false;
    }
  };

  if (once) {
    const ok = await syncOnce('ซิงค์รอบเดียว (--once)');
    await source.close();
    process.exitCode = ok ? 0 : 1;
    return;
  }

  // อ่านเวลาคำขอล่าสุดไว้ก่อน — ไม่งั้น event แรกที่เกิดจาก Agent บันทึกผลเองจะถูกนับเป็นคำขอใหม่
  // (อ่านไม่ได้ = ยังไม่ได้รัน pending-docs-setup.sql หรือเน็ตยังไม่พร้อม → ออกให้ .bat ลองใหม่)
  const { data: syncRow, error: syncReadError } = await supabase
    .from('pending_docs_sync')
    .select('refresh_requested_at')
    .eq('id', 1)
    .maybeSingle();
  if (syncReadError || !syncRow) {
    throw new Error(`อ่านตาราง pending_docs_sync ไม่ได้ — รัน pending-docs-setup.sql ใน Supabase แล้วหรือยัง? (${syncReadError?.message ?? 'ไม่พบแถว id = 1'})`);
  }

  const runner = createSyncRunner(syncOnce);
  // ซิงค์ทันทีไม่รอ realtime — ถ้า websocket โดนบล็อก หน้าเว็บยังได้ข้อมูลจากรอบนี้ + รอบสำรอง
  void runner.request('เริ่มทำงาน');
  let lastRequestMs = timestampMs(syncRow.refresh_requested_at);
  let realtimeOk = false;
  let realtimeDownSince = Date.now();

  const channel = supabase
    .channel('pending-docs-agent')
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'pending_docs_sync' }, payload => {
      // แถวนี้เปลี่ยนจากหลายทาง (Agent เองตอนบันทึกผล/error ด้วย) — ทำงานเฉพาะตอนเว็บตั้งคำขอใหม่กว่าเดิม
      const requestedMs = timestampMs(payload.new?.refresh_requested_at);
      if (requestedMs !== null && (lastRequestMs === null || requestedMs > lastRequestMs)) {
        lastRequestMs = requestedMs;
        void runner.request('หน้าเว็บขอข้อมูลสด');
      }
    })
    .subscribe((status, err) => {
      if (status === 'SUBSCRIBED') {
        realtimeOk = true;
        log('🔌 ต่อ Supabase Realtime แล้ว — รอคำขอจากหน้าเว็บ');
        void runner.request('เพิ่งต่อ Realtime (เก็บตกคำขอที่หลุดไป)');
      } else {
        if (realtimeOk) realtimeDownSince = Date.now(); // นับจากตอนเริ่มหลุด ไม่นับใหม่ทุกครั้งที่สถานะเปลี่ยน
        realtimeOk = false;
        log(`⚠️ Realtime ${status}${err ? `: ${err.message}` : ''} — ระหว่างนี้ยังซิงค์สำรองทุก 5 นาที`);
      }
    });

  const backupTimer = setInterval(() => void runner.request('ซิงค์สำรองทุก 5 นาที'), BACKUP_SYNC_MS);

  // supabase-js ต่อใหม่เองเกือบทุกกรณี — ถ้าหลุดนานผิดปกติ ออกจากโปรแกรมให้ .bat เปิดใหม่ (ได้ connection สด)
  const watchdog = setInterval(() => {
    if (!realtimeOk && Date.now() - realtimeDownSince > REALTIME_DOWN_RESTART_MS) {
      log('🔁 Realtime ต่อไม่ติดเกิน 10 นาที — ปิดตัวเองให้ run-pending-docs-agent.bat เปิดใหม่ (เป็นซ้ำๆ = firewall ร้านบล็อก websocket?)');
      process.exit(2);
    }
  }, 30_000);

  const shutdown = async signal => {
    log(`⏹ ได้รับ ${signal} — ปิด Agent`);
    clearInterval(backupTimer);
    clearInterval(watchdog);
    await supabase.removeChannel(channel).catch(() => {});
    await source.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

const isDirectRun = process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isDirectRun) {
  process.on('unhandledRejection', err => log(`⚠️ unhandledRejection: ${err?.stack ?? err}`));
  main().catch(err => {
    const hint = err?.name === 'ConnectionError' || err?.name === 'RequestError'
      ? `${publicErrorMessage(err)} — `
      : '';
    log(`❌ ${hint}${err.message}`);
    process.exitCode = 1;
  });
}
