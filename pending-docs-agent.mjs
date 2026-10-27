/**
 * pending-docs-agent.mjs
 * Agent ของหน้า "ตรวจสอบเอกสารค้าง" — ดึงใบโอนสินค้าออกที่สาขายังไม่กด "ส่ง" จาก MSSQL ของ ProMaxx
 * แล้วส่งขึ้น Supabase ให้หน้าเว็บ (PendingDocsPage.tsx) แสดง
 *
 * รันค้างไว้ตลอด:  node pending-docs-agent.mjs            (Task Scheduler เรียกผ่าน run-pending-docs-agent.bat)
 * ทดสอบ query:     node pending-docs-agent.mjs --dry-run  (อ่าน MSSQL อย่างเดียว ไม่เขียน Supabase)
 * ซิงค์รอบเดียว:   node pending-docs-agent.mjs --once     (ส่งทั้งชุดขึ้น Supabase เสมอ แม้ไม่มีอะไรเปลี่ยน)
 * เอา SQL ไปลองใน SSMS: node pending-docs-agent.mjs --print-sql
 *
 * ทำงานยังไง: Agent ถาม ProMaxx เฉพาะตอนหน้าเว็บขอ (เปิดหน้า Pending / กด 🔄 / กลับมาที่แท็บ)
 *   ไม่มีใครเปิดหน้า = ไม่แตะ MSSQL เลยทั้งวัน (ผู้ใช้สั่ง — บางวันไม่มีการโอนเลย ถามตามรอบก็เปล่าประโยชน์)
 *   หน้าเว็บเรียก RPC request_pending_docs_refresh() → แถว pending_docs_sync เปลี่ยน
 *   → Agent ได้ยินทาง Supabase Realtime (ต่อออกจากร้านอย่างเดียว ไม่มีช่องให้อินเทอร์เน็ตเข้ามา)
 *   → SELECT จาก MSSQL → เทียบ "ลายนิ้วมือ" (snapshotHash) กับชุดที่อยู่บน Supabase (pushSnapshot)
 *      เหมือนเดิม → บันทึกแค่เวลาที่ตรวจ 1 แถว หน้าเว็บไม่ต้องโหลดตารางใหม่
 *      เปลี่ยน   → RPC replace_pending_transfers() ส่งชุดใหม่ → หน้าเว็บได้ realtime แล้วโหลดใหม่
 *   MSSQL บอกเองไม่ได้ว่าข้อมูลเปลี่ยน (ต้องเปิด Change Tracking/Trigger = เขียน MSSQL ซึ่งห้าม) จึงต้อง "ไปถาม" ตามรอบ
 *
 * 🚨 MSSQL ของ ProMaxx: SELECT เท่านั้น ห้ามเขียน/สร้างอะไรเด็ดขาด (ข้อมูลต้องเปลี่ยนผ่าน ProMaxx เท่านั้น)
 *    → assertReadOnlySql() เช็คก่อนส่งทุกครั้ง + ตอนรันจริงใช้ login อ่านอย่างเดียว web_readonly
 * ต้องรัน pending-docs-setup.sql ใน Supabase ก่อน · วิธีติดตั้งเต็ม: วิธีติดตั้ง-agent-เอกสารค้าง.md
 */

import sql from 'mssql';
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';
import { readFileSync, appendFileSync, existsSync, statSync, renameSync } from 'fs';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

// ─── CONFIG ───────────────────────────────────────────────
const SUPABASE_URL = 'https://eogqnedbdpjuptwlqudn.supabase.co';
const DEFAULT_DAYS = 90;                    // ย้อนหลังกี่วัน (เปลี่ยนได้ด้วย PENDING_TRANSFER_DAYS ใน .env)
// 🚨 ห้ามใส่รอบถาม MSSQL เองกลับมา — ถามเฉพาะตอนมีคำขอจากหน้าเว็บ (ผู้ใช้สั่ง 2569-10-27 "ไม่เข้าหน้านี้ก็ไม่ต้องโหลด")
// ที่วนทุก 30 วิคือเช็คคำขอที่ค้างใน Supabase (อ่าน 1 แถว ไม่แตะ MSSQL) เผื่อ realtime ไม่ส่งคำขอมา:
//   realtime หลุดชั่วคราว / firewall ร้านบล็อก websocket / pending_docs_sync ไม่ได้อยู่ใน publication (SUBSCRIBED แต่ไม่มี event)
const REQUEST_POLL_MS = 30_000;
const QUERY_TIMEOUT_MS = 20_000;
// realtime ต่อไม่ติดนานเกินนี้ → ออกให้ .bat เปิดใหม่ (ได้ connection สด) · ระหว่างรอยังรับคำขอได้จากการเช็คทุก 30 วิ
const REALTIME_DOWN_RESTART_MS = 10 * 60_000;
const LOG_FILE = new URL('./pending-docs-agent.log', import.meta.url);
const LOG_MAX_BYTES = 5 * 1024 * 1024;

// คลังของ ProMaxx → รหัสในแอป (ต้องตรงกับ Profile.branch ใน auth.ts / แท็บ "คลังสินค้า" ใน PendingDocsPage.tsx
// ไม่งั้นไม่มีใครเห็นใบ) · คีย์ = `SYSBRANCHID:SYSWAREHOUSEID` ตามตาราง WAREHOUSE จริง (ผู้ใช้ส่งมา 2569-10-27):
//   0:0 Warehouse   ┐ อนิน สาขาแยกชากค้อ — สาขาเดียวกันใน ProMaxx แต่คนละคลัง คนละคนกด "ส่ง"
//   0:1 Front Store ┘ (ล็อกอิน SRC จึงเห็นเฉพาะใบที่ออกจาก Front Store)
//   4:0 Main KKL (อนิน สาขาเก้ากิโล) · 5:0 Main SSS (อนิน สาขาสวนเสือศรีราชา)
//   1:0 Main ONN / 2:0 Main WRD / 3:0 Main KTK — ไม่มีโปรไฟล์ในเว็บ ผู้ใช้สั่งไม่ต้องแสดงใบที่โอนออกจากคลังพวกนี้
// 🚨 SYSWAREHOUSEID ซ้ำข้ามสาขา (ทุกสาขามีคลังเลข 0) ต้องใช้คู่กับ SYSBRANCHID เสมอ ทั้งคีย์ที่นี่และ JOIN WAREHOUSE ใน SQL
//    JOIN ด้วยเลขคลังอย่างเดียว = แถวที่คลังเลข 0 ไปจับได้ 6 คลัง → แถวคูณ 6 เท่า + ได้ชื่อคลังผิด
// ⚠️ ต้นทางที่ไม่อยู่ใน map = ข้ามทั้งใบ (log ✅ บอกจำนวน) — มีคลัง/สาขาใหม่ใน ProMaxx ต้องเพิ่มที่นี่ ไม่งั้นใบของคลังนั้นไม่ขึ้นเลย
// ชื่อคลังชุดนี้คือชื่อเดียวกับคอลัมน์ D ของไฟล์สต๊อค (BRANCH_MAP ใน upload-stock.mjs) แต่จับคู่ด้วยเลข เผื่อมีคนเปลี่ยนชื่อ
export const WAREHOUSE_MAP = {
  '0:0': 'คลังสินค้า',
  '0:1': 'SRC',
  '4:0': 'KKL',
  '5:0': 'SSS',
};

// ปลายทางที่ไม่ตรงคลังใน WAREHOUSE_MAP (เช่น ใบที่ยังไม่ระบุคลังปลายทาง) → ดูจากสาขาปลายทางแทน
// สาขา 0 = คลังสินค้า ตามกฎที่ผู้ใช้ยืนยัน: KKL / SSS ต้องโอนเข้า Warehouse เท่านั้น
// ใบที่โอนผิดกฎ (เช่น KKL → SSS) แสดงตามข้อมูลจริง ไม่มีป้ายเตือน — ผู้ใช้เลือกแบบนี้
export const DEST_BRANCH_FALLBACK = {
  0: 'คลังสินค้า',
  4: 'KKL',
  5: 'SSS',
};

// ใบโอนสินค้าออก (VOUCHERTYPE 'TB' + VOUCHERINOUT 'O') ที่ยังไม่มีใบแจ้งโอน = สาขายังไม่กด "ส่ง"
// ดัดแปลงจากรายงาน R16.150 (d_16150_h20190121) ของ SeniorSoft:
//   - NOT EXISTS ตรงกับ "CF_SYSREFERENCETRANNO ว่าง" ของรายงาน — เช็คแค่มี/ไม่มี เพราะคำนำหน้าเลขใบแจ้งโอนไม่ตายตัว
//   - ตัด TRANLINKTRANNO / cf_countintranno ของรายงานเดิมออก: ใบที่ยังไม่ส่งไม่มีใบแจ้งโอนให้ใครมาเชื่อม นับได้ 0 เสมอ
//   - จำกัดวันที่ใน SQL — รายงานเดิมดึงใบโอนทุกใบตั้งแต่เริ่มระบบแล้วค่อยกรองใน ProMaxx
//     ซึ่งหนักเกินไปสำหรับ SQL Server Express ที่ใช้ทรัพยากรร่วมกับ POS ทุกสาขา
//   - วันที่ส่งเป็นข้อความ YYYY-MM-DD (style 23) กัน driver ตีความ datetime เป็น UTC แล้วเลื่อน 7 ชม.
//   - เพิ่มคลังต้นทาง/ปลายทาง (TRANS.SYSWAREHOUSEID / TRANEXTRAINFO.REFTRANFERSYSWAREHOUSE) ที่รายงานเดิมไม่มี
//     ไว้แยก Warehouse กับ Front Store ของสาขา 0 · คลังอยู่ที่หัวใบ (TRANDETAILITEM ไม่มีคอลัมน์คลัง) = 1 ใบ 1 คลัง
//     LEFT JOIN ด้วยคีย์ 2 คอลัมน์ของ WAREHOUSE (SYSBRANCHID + SYSWAREHOUSEID) → จำนวนแถวเท่ารายงานเดิมทุกแถว
export const TRANSFER_SQL = `
SELECT TRANS.SYSTRANNO AS sys_tran_no,
       TRANS.TRANNO AS doc_no,
       CONVERT(char(10), TRANS.TRANDATE, 23) AS doc_date,
       TRANS.SYSBRANCHID AS from_branch_id,
       BRANCH.NAME AS from_branch_name,
       TRANS.SYSWAREHOUSEID AS from_warehouse_id,
       SRCWH.NAME AS from_warehouse_name,
       TRANEXTRAINFO.REFTRANFERSYSBRANCH AS to_branch_id,
       DEST.NAME AS to_branch_name,
       TRANEXTRAINFO.REFTRANFERSYSWAREHOUSE AS to_warehouse_id,
       DESTWH.NAME AS to_warehouse_name,
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
LEFT JOIN WAREHOUSE SRCWH ON SRCWH.SYSBRANCHID = TRANS.SYSBRANCHID
                         AND SRCWH.SYSWAREHOUSEID = TRANS.SYSWAREHOUSEID
LEFT JOIN WAREHOUSE DESTWH ON DESTWH.SYSBRANCHID = TRANEXTRAINFO.REFTRANFERSYSBRANCH
                          AND DESTWH.SYSWAREHOUSEID = TRANEXTRAINFO.REFTRANFERSYSWAREHOUSE
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

/** คีย์ของคลังใน WAREHOUSE_MAP (`สาขา:คลัง`) — `null` ถ้าขาดเลขใดเลขหนึ่ง (เลข 0 ใช้ได้ปกติ) */
export function warehouseKey(branchId, warehouseId) {
  const branch = cleanText(branchId);
  const warehouse = cleanText(warehouseId);
  return branch && warehouse ? `${branch}:${warehouse}` : null;
}

/**
 * แปลงสาขา+คลังของ ProMaxx → รหัสในแอป
 * `known: false` = ไม่อยู่ใน map → ได้ชื่อดิบแทน (ชื่อสาขา → ชื่อคลัง → "สาขา #เลข") ไว้แสดงเป็นปลายทาง/นับใน log
 */
export function resolveWarehouse(branchId, warehouseId, names = {}, map = WAREHOUSE_MAP) {
  const key = warehouseKey(branchId, warehouseId);
  if (key && Object.hasOwn(map, key)) return { code: map[key], known: true };
  const branch = cleanText(branchId);
  const label = cleanText(names.branch) || cleanText(names.warehouse);
  return { code: label || (branch ? `สาขา #${branch}` : ''), known: false };
}

/** ปลายทาง: คลังตรง map ก่อน → ไม่ตรงใช้สาขาปลายทาง (DEST_BRANCH_FALLBACK) → ไม่รู้จักเลยได้ชื่อสาขาดิบ */
export function resolveDestination(row, map = WAREHOUSE_MAP, branchFallback = DEST_BRANCH_FALLBACK) {
  const exact = resolveWarehouse(row.to_branch_id, row.to_warehouse_id,
    { branch: row.to_branch_name, warehouse: row.to_warehouse_name }, map);
  if (exact.known) return exact.code;
  const branch = cleanText(row.to_branch_id);
  return branch && Object.hasOwn(branchFallback, branch) ? branchFallback[branch] : exact.code;
}

/**
 * แถวจาก SQL (1 แถว = 1 รายการสินค้า) → ใบโอน 1 ใบต่อ SYSTRANNO พร้อม items สำหรับ popup
 * ใบที่คลังต้นทางไม่อยู่ใน WAREHOUSE_MAP ถูกข้าม (ผู้ใช้สั่งไม่แสดง) — นับไว้ใน `skipped` ให้ log เห็น
 * ⚠️ กรองตรงนี้ ไม่ใช่ใน SQL โดยตั้งใจ: SQL ต้องเหมือนชุดที่ผู้ใช้ตรวจกับ R16.150 ใน SSMS แล้ว (คู่มือขั้น 1.4)
 */
export function groupTransferRows(rows, map = WAREHOUSE_MAP, destFallback = DEST_BRANCH_FALLBACK) {
  const docs = new Map();
  const skipped = new Map();

  for (const row of rows) {
    const key = cleanText(row.sys_tran_no);
    if (!key) continue;

    const from = resolveWarehouse(row.from_branch_id, row.from_warehouse_id,
      { branch: row.from_branch_name, warehouse: row.from_warehouse_name }, map);
    if (!from.known) {
      const skipKey = warehouseKey(row.from_branch_id, row.from_warehouse_id) ?? `${cleanText(row.from_branch_id) || '?'}:?`;
      if (!skipped.has(skipKey)) skipped.set(skipKey, { key: skipKey, name: from.code, docKeys: new Set() });
      skipped.get(skipKey).docKeys.add(key);
      continue;
    }

    let doc = docs.get(key);
    if (!doc) {
      doc = {
        sys_tran_no: row.sys_tran_no,
        doc_no: cleanText(row.doc_no),
        doc_date: normalizeDate(row.doc_date),
        from_branch: from.code,
        to_branch: resolveDestination(row, map, destFallback),
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

  return {
    docs: [...docs.values()],
    skipped: [...skipped.values()].map(({ key, name, docKeys }) => ({ key, name, docs: docKeys.size })),
  };
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
 * เวลาของคำขอที่ยังไม่มีใครตอบ (ms) หรือ null — ใช้ตอน Agent เพิ่งเริ่มทำงาน (มีคนเปิดหน้าระหว่าง Agent ปิด/รีสตาร์ท)
 * "ตอบแล้ว" = ส่งชุดใหม่ (last_success_at) หรือตรวจแล้วเหมือนเดิม (last_checked_at) หลังเวลาคำขอ
 * ไม่นับ last_error_at: คำขอที่จบด้วย error ให้ลองใหม่ได้ 1 ครั้งตอนรีสตาร์ท (และค่านั้นเป็นเวลาเครื่อง Agent ไม่ใช่เวลา DB)
 */
export function unansweredRequestMs(row) {
  const requestedMs = timestampMs(row?.refresh_requested_at);
  if (requestedMs === null) return null;
  const answeredMs = Math.max(timestampMs(row.last_success_at) ?? -Infinity, timestampMs(row.last_checked_at) ?? -Infinity);
  return requestedMs > answeredMs ? requestedMs : null;
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

/**
 * "ลายนิ้วมือ" ของชุดใบโอน — ชุดเดิมได้ค่าเดิมเสมอ · ใบ/รายการ/จำนวนเปลี่ยนแม้นิดเดียวได้ค่าใหม่
 * เรียงตาม sys_tran_no ก่อน: ลำดับใบจาก SQL สลับกันเองได้ถ้าวันที่+เลขใบซ้ำ ซึ่งไม่ได้แปลว่าข้อมูลเปลี่ยน
 */
export function snapshotHash(docs) {
  const key = doc => String(doc.sys_tran_no);
  const sorted = [...docs].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  return createHash('sha256').update(JSON.stringify(sorted)).digest('hex');
}

function supabaseError(error) {
  const err = new Error(error.message);
  err.name = 'SupabaseError';
  return err;
}

/**
 * ส่งผลการตรวจขึ้น Supabase — ส่งชุดใบโอนเฉพาะตอนต่างจากชุดที่อยู่บน Supabase
 *   เหมือนเดิม → mark_pending_docs_unchanged() บันทึกแค่เวลาที่ตรวจ 1 แถว · หน้าเว็บรู้ว่ายังสด แต่ไม่โหลดตารางใหม่
 *   ต่างกัน (หรือชุดเดิมมาจาก Agent รุ่นก่อนที่ไม่มี hash) → replace_pending_transfers() แทนที่ทั้งชุด
 * เทียบกับ hash ที่เก็บใน Supabase ไม่ใช่ในหน่วยความจำ → Agent รีสตาร์ท / --once ส่งไปแล้ว ก็ไม่ส่งชุดเดิมซ้ำ
 * force = ส่งทั้งชุดเลยไม่ต้องเทียบ (--once ใช้เป็น "บังคับส่งใหม่")
 */
export async function pushSnapshot(client, docs, { force = false } = {}) {
  const hash = snapshotHash(docs);
  if (!force) {
    const { data, error } = await client.rpc('mark_pending_docs_unchanged', { p_hash: hash });
    if (error) throw supabaseError(error);
    if (data === true) return { changed: false, hash };
  }
  const { error } = await client.rpc('replace_pending_transfers', { p_rows: docs, p_hash: hash });
  if (error) throw supabaseError(error);
  return { changed: true, hash };
}

// ─── log ──────────────────────────────────────────────────
// เขียนซ้ำลงไฟล์ด้วย เพราะตอน Task Scheduler รันแบบไม่มีคนล็อกอิน จะไม่มีหน้าจอให้ดู
// เช็คขนาดไฟล์ทุก 200 บรรทัดด้วย — Agent รันค้างได้เป็นเดือน (1 บรรทัดต่อคำขอจากหน้าเว็บ + ตอน realtime หลุด/ต่อใหม่)
// ถ้าหมุนแค่ตอนเริ่มโปรแกรม ไฟล์จะโตไม่หยุดจนกว่าจะมีคนรีสตาร์ท
let linesSinceRotateCheck = 0;
function log(message) {
  const line = `[${new Date().toLocaleString('th-TH')}] ${message}`;
  console.log(line);
  if (++linesSinceRotateCheck >= 200) {
    linesSinceRotateCheck = 0;
    rotateLogIfLarge();
  }
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
  const { docs, skipped } = groupTransferRows(rows);
  return { rows, docs, skipped, seconds: (Date.now() - started) / 1000 };
}

const skippedDocCount = skipped => skipped.reduce((sum, b) => sum + b.docs, 0);

function countBy(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].map(([value, n]) => `${value} ${n}`).join(' · ') || '-';
}

function printDryRun(config, { rows, docs, skipped, seconds }) {
  const warehousesSeen = new Map();
  for (const row of rows) {
    for (const side of ['from', 'to']) {
      const branchId = row[`${side}_branch_id`];
      const warehouseId = row[`${side}_warehouse_id`];
      const key = warehouseKey(branchId, warehouseId) ?? `${cleanText(branchId) || '?'}:?`;
      if (warehousesSeen.has(key)) continue;
      const names = { branch: row[`${side}_branch_name`], warehouse: row[`${side}_warehouse_name`] };
      warehousesSeen.set(key, { key, names, ...resolveWarehouse(branchId, warehouseId, names) });
    }
  }
  const seenSorted = [...warehousesSeen.values()].sort((a, b) => a.key.localeCompare(b.key, 'en', { numeric: true }));

  console.log('');
  console.log('── สรุป dry-run (อ่าน MSSQL อย่างเดียว ไม่ได้เขียน Supabase) ──');
  console.log(`   ย้อนหลัง ${config.days} วัน · query ใช้เวลา ${seconds.toFixed(2)} วิ`);
  console.log(`   รายการสินค้า ${rows.length.toLocaleString()} แถว → ใบโอนค้างส่งที่แสดงบนเว็บ ${docs.length.toLocaleString()} ใบ`);
  console.log(`   แยกตามต้นทาง: ${countBy(docs.map(doc => doc.from_branch))}`);
  console.log(`   เส้นทาง: ${countBy(docs.map(doc => `${doc.from_branch} → ${doc.to_branch}`))}`);
  if (skipped.length) {
    console.log(`   ไม่แสดง (คลังต้นทางไม่อยู่ใน WAREHOUSE_MAP): ${skipped.map(s => `${s.name} [${s.key}] ${s.docs} ใบ`).join(' · ')}`);
  }
  console.log('   คลังที่พบ (สาขา:คลัง → ชื่อคลัง / ชื่อสาขาใน ProMaxx → บนเว็บ):');
  for (const w of seenSorted) {
    const label = `"${cleanText(w.names.warehouse) || '-'}" / "${cleanText(w.names.branch) || '-'}"`;
    console.log(`     ${w.key} → ${label} → ${w.known ? w.code : 'ไม่อยู่ใน map (ต้นทาง = ไม่แสดง · ปลายทาง = ดูจากสาขา)'}`);
  }
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

  // อ่านแถวสถานะก่อนแตะ MSSQL — อ่านไม่ได้ = ยังไม่ได้รัน pending-docs-setup.sql หรือเน็ตยังไม่พร้อม → ออกให้ .bat ลองใหม่
  // select('*') แล้วเช็คเองว่ามีคอลัมน์ data_hash ไหม (ระบุชื่อคอลัมน์ที่ยังไม่มี PostgREST จะตอบ error ที่อ่านยากกว่า)
  const { data: syncRow, error: syncReadError } = await supabase
    .from('pending_docs_sync')
    .select('*')
    .eq('id', 1)
    .maybeSingle();
  if (syncReadError || !syncRow) {
    throw new Error(`อ่านตาราง pending_docs_sync ไม่ได้ — รัน pending-docs-setup.sql ใน Supabase แล้วหรือยัง? (${syncReadError?.message ?? 'ไม่พบแถว id = 1'})`);
  }
  // Agent รุ่นนี้ส่งข้อมูลเฉพาะตอนเปลี่ยน ต้องใช้ RPC ชุดใหม่ — ไม่หยุดตรงนี้ ทุกรอบจะ error "ส่งข้อมูลขึ้น Supabase ไม่สำเร็จ"
  // .bat เปิดใหม่ทุก 10 วิอยู่แล้ว → รัน SQL เสร็จเมื่อไร Agent ทำงานต่อเองโดยไม่ต้องไปแตะเครื่อง
  if (!Object.hasOwn(syncRow, 'data_hash')) {
    throw new Error('ตาราง pending_docs_sync ยังเป็นรุ่นเก่า — รัน pending-docs-setup.sql ใน Supabase อีกรอบ (รันซ้ำได้ ไม่ทับข้อมูล) แล้ว Agent จะทำงานต่อเอง');
  }

  const reportError = async message => {
    const { error } = await supabase
      .from('pending_docs_sync')
      .update({ last_error: message, last_error_at: new Date().toISOString() })
      .eq('id', 1);
    if (error) log(`⚠️ บันทึก error ลง Supabase ไม่สำเร็จ: ${error.message}`);
  };

  const syncOnce = async (reason, { force = false } = {}) => {
    try {
      const { docs, skipped, seconds } = await fetchPendingDocs(source);
      const { changed } = await pushSnapshot(supabase, docs, { force });
      const hidden = skippedDocCount(skipped);
      const summary = `ใบโอนค้างส่ง ${docs.length} ใบ${hidden ? ` · ไม่แสดงคลังนอก WAREHOUSE_MAP ${hidden} ใบ` : ''} (query ${seconds.toFixed(2)} วิ)`;
      if (!changed) log(`✓ ${reason} — ไม่มีอะไรเปลี่ยน ไม่ได้ส่งซ้ำ · ${summary}`);
      else log(`✅ ${reason} — ${force ? '' : 'ข้อมูลเปลี่ยน '}ส่งชุดใหม่ขึ้นเว็บแล้ว · ${summary}`);
      return true;
    } catch (err) {
      log(`❌ ${reason} — ${err.name ?? 'Error'}${err.code ? ` ${err.code}` : ''}: ${err.message}`);
      await reportError(publicErrorMessage(err)).catch(e => log(`⚠️ ${e.message}`));
      return false;
    }
  };

  if (once) {
    const ok = await syncOnce('ซิงค์รอบเดียว (--once)', { force: true });
    await source.close();
    process.exitCode = ok ? 0 : 1;
    return;
  }

  const runner = createSyncRunner(syncOnce);
  // จำคำขอล่าสุดที่ตอบไปแล้วไว้ — ไม่งั้น event แรกที่เกิดจาก Agent บันทึกผลเองจะถูกนับเป็นคำขอใหม่
  // ยกเว้นคำขอที่ยังไม่มีใครตอบ (คนเปิดหน้าตอน Agent ปิด/รีสตาร์ท) → ปล่อยให้ onRequestSeen ข้างล่างตรวจทันที
  const pendingAtStart = unansweredRequestMs(syncRow);
  let lastRequestMs = pendingAtStart === null ? timestampMs(syncRow.refresh_requested_at) : null;
  let realtimeOk = false;
  let realtimeDownSince = Date.now();
  let requestPollFailing = false;

  // แถว pending_docs_sync เปลี่ยนจากหลายทาง (Agent เองตอนบันทึกผล/error ด้วย) — ตรวจเฉพาะตอนเว็บตั้งคำขอใหม่กว่าเดิม
  // นี่คือทางเดียวที่ Agent ไปถาม MSSQL (นอกจาก --once / --dry-run)
  const onRequestSeen = (requestedAt, reason) => {
    const requestedMs = timestampMs(requestedAt);
    if (requestedMs !== null && (lastRequestMs === null || requestedMs > lastRequestMs)) {
      lastRequestMs = requestedMs;
      void runner.request(reason);
    }
  };

  if (pendingAtStart !== null) onRequestSeen(syncRow.refresh_requested_at, 'มีคำขอค้างตั้งแต่ก่อน Agent เริ่มทำงาน');
  else log('💤 ยังไม่มีคำขอ — จะถาม MSSQL เมื่อมีคนเปิดหน้า Pending / กด 🔄');

  // เก็บตกคำขอที่ realtime ไม่ได้ส่งมา — อ่านแถวสถานะใน Supabase 1 แถว มีคำขอใหม่จริงค่อยไปถาม MSSQL
  // อ่านไม่ได้ = ไม่ถาม MSSQL "เผื่อไว้" (ไม่งั้นตอน Supabase ล่ม จะถาม MSSQL ทุก 30 วิ) · log เฉพาะตอนสถานะเปลี่ยน กัน log บวม
  const catchUpMissedRequest = async reason => {
    let result;
    try {
      result = await supabase
        .from('pending_docs_sync')
        .select('refresh_requested_at')
        .eq('id', 1)
        .maybeSingle();
    } catch (err) {
      result = { data: null, error: err };
    }
    if (result.error || !result.data) {
      if (!requestPollFailing) log(`⚠️ อ่านคำขอจาก Supabase ไม่ได้ — ${result.error?.message ?? 'ไม่พบแถว id = 1'} (ลองใหม่ทุก 30 วิ)`);
      requestPollFailing = true;
      return;
    }
    if (requestPollFailing) log('✓ อ่านคำขอจาก Supabase ได้อีกครั้ง');
    requestPollFailing = false;
    onRequestSeen(result.data.refresh_requested_at, reason);
  };

  const channel = supabase
    .channel('pending-docs-agent')
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'pending_docs_sync' }, payload => {
      onRequestSeen(payload.new?.refresh_requested_at, 'หน้าเว็บขอข้อมูลสด');
    })
    .subscribe((status, err) => {
      if (status === 'SUBSCRIBED') {
        realtimeOk = true;
        log('🔌 ต่อ Supabase Realtime แล้ว — รอคำขอจากหน้าเว็บ');
        void catchUpMissedRequest('เพิ่งต่อ Realtime (เก็บตกคำขอที่หลุดไป)');
      } else {
        if (realtimeOk) realtimeDownSince = Date.now(); // นับจากตอนเริ่มหลุด ไม่นับใหม่ทุกครั้งที่สถานะเปลี่ยน
        realtimeOk = false;
        log(`⚠️ Realtime ${status}${err ? `: ${err.message}` : ''} — ระหว่างนี้ยังรับคำขอได้จากการเช็ค Supabase ทุก 30 วิ`);
      }
    });

  const requestPoll = setInterval(
    () => void catchUpMissedRequest('หน้าเว็บขอข้อมูลสด (เจอจากการเช็ค Supabase ทุก 30 วิ)'),
    REQUEST_POLL_MS,
  );

  // supabase-js ต่อใหม่เองเกือบทุกกรณี — ถ้าหลุดนานผิดปกติ ออกจากโปรแกรมให้ .bat เปิดใหม่ (ได้ connection สด)
  const watchdog = setInterval(() => {
    if (!realtimeOk && Date.now() - realtimeDownSince > REALTIME_DOWN_RESTART_MS) {
      log('🔁 Realtime ต่อไม่ติดเกิน 10 นาที — ปิดตัวเองให้ run-pending-docs-agent.bat เปิดใหม่ (เป็นซ้ำๆ = firewall ร้านบล็อก websocket?)');
      process.exit(2);
    }
  }, 30_000);

  const shutdown = async signal => {
    log(`⏹ ได้รับ ${signal} — ปิด Agent`);
    clearInterval(requestPoll);
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
