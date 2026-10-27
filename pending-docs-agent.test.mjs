import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  TRANSFER_SQL,
  assertReadOnlySql,
  buildMssqlConfig,
  cleanText,
  createSyncRunner,
  groupTransferRows,
  loadConfig,
  normalizeDate,
  publicErrorMessage,
  readEnvValue,
  resolveBranch,
  sqlForSsms,
  timestampMs,
} from './pending-docs-agent.mjs';

const ID_MAP = { 0: 'คลังสินค้า', 1: 'SRC' };
const NAME_MAP = { 'main kkl': 'KKL' };
const branchOf = (id, name) => resolveBranch(id, name, ID_MAP, NAME_MAP);

function sqlRow(overrides = {}) {
  return {
    sys_tran_no: 101,
    doc_no: 'TB6810-0001      ',
    doc_date: '2026-10-20',
    from_branch_id: 1,
    from_branch_name: 'Front Store   ',
    to_branch_id: 0,
    to_branch_name: 'Warehouse',
    line_no: 1,
    item_code: '123456   ',
    item_name: 'พาราเซตามอล  500 มก.   ',
    serial_no: '          ',
    qty: 2,
    ...overrides,
  };
}

function envOf(values) {
  return name => values[name] ?? null;
}

test('assertReadOnlySql ยอมให้ SQL ใบโอนค้างส่งตัวจริงผ่าน', () => {
  assert.equal(assertReadOnlySql(TRANSFER_SQL), TRANSFER_SQL);
});

test('assertReadOnlySql ปฏิเสธทุกคำสั่งที่เขียน/สร้าง/รันอะไรใน MSSQL', () => {
  const rejected = [
    "UPDATE TRANS SET FCANCEL = 1 WHERE SYSTRANNO = 1",
    'delete from TRANS where SYSTRANNO = 1',
    'SELECT * INTO TRANS_BACKUP FROM TRANS',
    'SELECT 1; DROP TABLE TRANS',
    'EXEC sp_who',
    'WITH x AS (SELECT 1 AS a) SELECT a FROM x',
    'SELECT 1 /* ปิดคอมเมนต์ */ ; TRUNCATE TABLE ITEMS',
    'SELECT 1 WHERE 1 = 1 MERGE TRANS USING ITEMS ON 1 = 1',
    'CREATE VIEW v AS SELECT 1 AS a',
  ];
  for (const text of rejected) {
    assert.throws(() => assertReadOnlySql(text), /🚨/, text);
  }
});

test('assertReadOnlySql ไม่สนคำต้องห้ามที่อยู่ในคอมเมนต์', () => {
  const text = 'SELECT 1 AS a -- ห้าม UPDATE เด็ดขาด\n/* DELETE ก็ห้าม */';
  assert.equal(assertReadOnlySql(text), text);
});

test('cleanText ตัดช่องว่างที่ ProMaxx เติมท้ายช่อง char และยุบช่องว่างซ้อน', () => {
  assert.equal(cleanText('  พารา   500  '), 'พารา 500');
  assert.equal(cleanText(null), '');
  assert.equal(cleanText(12345), '12345');
});

test('normalizeDate รับเฉพาะ YYYY-MM-DD และแปลง Date เป็นวันที่ตามเวลาเครื่อง', () => {
  assert.equal(normalizeDate('2026-10-20'), '2026-10-20');
  assert.equal(normalizeDate(' 2026-10-20 '), '2026-10-20');
  assert.equal(normalizeDate(new Date(2026, 9, 20, 23, 59)), '2026-10-20');
  assert.equal(normalizeDate('20/10/2569'), null);
  assert.equal(normalizeDate(''), null);
  assert.equal(normalizeDate(new Date('invalid')), null);
});

test('resolveBranch ใช้ SYSBRANCHID ก่อน แล้วค่อยใช้ชื่อสาขา', () => {
  assert.deepEqual(branchOf(1, 'ชื่ออะไรก็ได้'), { code: 'SRC', known: true });
  assert.deepEqual(branchOf(0, null), { code: 'คลังสินค้า', known: true });
  assert.deepEqual(branchOf(9, '  Main KKL  '), { code: 'KKL', known: true });
});

test('resolveBranch สาขาที่ไม่รู้จักเก็บชื่อดิบไว้ ไม่ทิ้งใบ', () => {
  assert.deepEqual(branchOf(7, ' สาขาใหม่ '), { code: 'สาขาใหม่', known: false });
  assert.deepEqual(branchOf(7, ''), { code: 'สาขา #7', known: false });
  assert.deepEqual(branchOf(null, null), { code: '', known: false });
});

test('resolveBranch ค่าเริ่มต้นจับคู่ชื่อสาขาชุดเดียวกับไฟล์สต๊อค', () => {
  assert.equal(resolveBranch(99, 'Front Store').code, 'SRC');
  assert.equal(resolveBranch(99, 'WAREHOUSE').code, 'คลังสินค้า');
  assert.equal(resolveBranch(99, 'Main SSS').code, 'SSS');
});

test('groupTransferRows รวมรายการสินค้าเป็นใบโอน 1 ใบต่อ SYSTRANNO', () => {
  const { docs, unknownBranches } = groupTransferRows([
    sqlRow({ line_no: 2, item_code: '222', item_name: 'สินค้า B', qty: 5 }),
    sqlRow({ line_no: 1 }),
    sqlRow({ sys_tran_no: 202, doc_no: 'TB6810-0002', from_branch_id: 9, from_branch_name: 'Main KKL', line_no: 1, serial_no: 'LOT-7 ' }),
  ], branchOf);

  assert.equal(docs.length, 2);
  assert.deepEqual(unknownBranches, []);

  const first = docs[0];
  assert.equal(first.doc_no, 'TB6810-0001');
  assert.equal(first.doc_date, '2026-10-20');
  assert.equal(first.from_branch, 'SRC');
  assert.equal(first.to_branch, 'คลังสินค้า');
  assert.equal(first.item_count, 2);
  assert.deepEqual(first.items, [
    { line_no: 1, code: '123456', name: 'พาราเซตามอล 500 มก.', qty: 2 },
    { line_no: 2, code: '222', name: 'สินค้า B', qty: 5 },
  ]);

  const second = docs[1];
  assert.equal(second.from_branch, 'KKL');
  assert.equal(second.items[0].serial, 'LOT-7');
});

test('groupTransferRows รายงานสาขาที่ map ไม่ได้ครั้งเดียวต่อสาขา', () => {
  const { docs, unknownBranches } = groupTransferRows([
    sqlRow({ sys_tran_no: 1, to_branch_id: 5, to_branch_name: 'สาขาใหม่' }),
    sqlRow({ sys_tran_no: 2, to_branch_id: 5, to_branch_name: 'สาขาใหม่ ' }),
  ], branchOf);
  assert.equal(docs.length, 2);
  assert.equal(docs[0].to_branch, 'สาขาใหม่');
  assert.deepEqual(unknownBranches, [{ id: 5, name: 'สาขาใหม่' }]);
});

test('groupTransferRows ข้ามแถวที่ไม่มี SYSTRANNO และจำนวนที่อ่านไม่ออกเป็น null', () => {
  const { docs } = groupTransferRows([
    sqlRow({ sys_tran_no: null }),
    sqlRow({ sys_tran_no: '  ' }),
    sqlRow({ sys_tran_no: '3000000000', qty: null }),
  ], branchOf);
  assert.equal(docs.length, 1);
  assert.equal(docs[0].sys_tran_no, '3000000000'); // bigint จาก driver มาเป็นข้อความ — ส่งต่อแบบเดิม
  assert.equal(docs[0].items[0].qty, null);
});

test('timestampMs อ่านเวลาได้ทั้งแบบ PostgREST และแบบมีช่องว่าง', () => {
  const expected = Date.UTC(2026, 9, 27, 7, 32, 5, 123);
  assert.equal(timestampMs('2026-10-27T07:32:05.123456+00:00'), expected);
  assert.equal(timestampMs('2026-10-27 07:32:05.123456+00'), expected);
  assert.equal(timestampMs('2026-10-27T07:32:05.123Z'), expected);
  assert.equal(timestampMs(null), null);
  assert.equal(timestampMs('ไม่ใช่เวลา'), null);
});

test('createSyncRunner ยุบคำขอที่เข้ามาระหว่างซิงค์เหลืออีก 1 รอบ', async () => {
  const calls = [];
  let release;
  const gate = new Promise(r => { release = r; });
  const runner = createSyncRunner(async reason => {
    calls.push(reason);
    if (calls.length === 1) await gate;
  });

  const first = runner.request('เปิดหน้า');
  runner.request('เครื่อง 2');
  runner.request('เครื่อง 3');
  release();
  await first;

  assert.equal(calls.length, 2);
  assert.equal(calls[0], 'เปิดหน้า');

  await runner.request('หลังจากนั้น');
  assert.equal(calls.length, 3);
});

test('createSyncRunner รอบที่ error ไม่ทำให้รอบถัดไปค้าง', async () => {
  let n = 0;
  const runner = createSyncRunner(async () => {
    n += 1;
    if (n === 1) throw new Error('MSSQL หลุด');
  });
  await assert.rejects(runner.request('รอบแรก'));
  await runner.request('รอบสอง');
  assert.equal(n, 2);
});

test('publicErrorMessage ไม่ส่งข้อความดิบของ driver (มีชื่อเครื่อง/IP ใน LAN) ขึ้น Supabase', () => {
  const cases = [
    [{ name: 'ConnectionError', code: 'ELOGIN', message: "Login failed for user 'sa'." }, /ปฏิเสธการล็อกอิน/],
    [{ name: 'ConnectionError', code: 'EINSTLOOKUP', message: 'Failed to get response from SQL Server Browser on POS-SERVER' }, /instance/],
    [{ name: 'ConnectionError', code: 'ETIMEOUT', message: 'Failed to connect to 192.168.1.10:1433 in 15000ms' }, /ต่อ MSSQL ไม่ทัน/],
    [{ name: 'RequestError', code: 'ETIMEOUT', message: 'Timeout: Request failed to complete in 20000ms' }, /นานเกิน 20 วิ/],
    [{ name: 'RequestError', code: 'EREQUEST', number: 229, message: "The SELECT permission was denied on the object 'TRANS'" }, /ไม่มีสิทธิ์/],
    [{ name: 'SupabaseError', message: 'relation does not exist' }, /Supabase/],
    [new Error('อะไรก็ไม่รู้ ที่ 192.168.1.10'), /ดู log/],
  ];
  for (const [err, pattern] of cases) {
    const message = publicErrorMessage(err);
    assert.match(message, pattern);
    assert.doesNotMatch(message, /192\.168|POS-SERVER|'sa'/);
  }
});

test('readEnvValue อ่านค่า + ถอดเครื่องหมายคำพูดครอบ โดยไม่ตัด # ที่อยู่ในรหัสผ่าน', () => {
  const text = [
    'VITE_SUPABASE_URL=https://example.supabase.co',
    'MSSQL_SERVER = POS-SERVER ',
    'MSSQL_PASSWORD="p@ss#word=1"',
    "MSSQL_USER='web_readonly'",
    'MSSQL_INSTANCE=',
  ].join('\n');
  assert.equal(readEnvValue(text, 'MSSQL_SERVER'), 'POS-SERVER');
  assert.equal(readEnvValue(text, 'MSSQL_PASSWORD'), 'p@ss#word=1');
  assert.equal(readEnvValue(text, 'MSSQL_USER'), 'web_readonly');
  assert.equal(readEnvValue(text, 'MSSQL_INSTANCE'), null);
  assert.equal(readEnvValue(text, 'MSSQL_DATABASE'), null);
});

test('loadConfig บอกชื่อค่าที่ขาด และ dry-run ไม่ต้องมี service key', () => {
  const mssqlOnly = {
    MSSQL_SERVER: 'POS-SERVER',
    MSSQL_DATABASE: 'PROMAXX',
    MSSQL_USER: 'web_readonly',
    MSSQL_PASSWORD: 'secret',
  };
  assert.throws(() => loadConfig(envOf(mssqlOnly)), /SUPABASE_SERVICE_KEY/);
  assert.throws(() => loadConfig(envOf({}), { requireSupabase: false }), /MSSQL_SERVER, MSSQL_DATABASE, MSSQL_USER, MSSQL_PASSWORD/);

  const config = loadConfig(envOf(mssqlOnly), { requireSupabase: false });
  assert.equal(config.days, 90);
  assert.equal(loadConfig(envOf({ ...mssqlOnly, PENDING_TRANSFER_DAYS: '30' }), { requireSupabase: false }).days, 30);
  assert.equal(loadConfig(envOf({ ...mssqlOnly, PENDING_TRANSFER_DAYS: '0' }), { requireSupabase: false }).days, 90);
  assert.equal(loadConfig(envOf({ ...mssqlOnly, PENDING_TRANSFER_DAYS: 'abc' }), { requireSupabase: false }).days, 90);
});

test('buildMssqlConfig รองรับ named instance ของ Express, พอร์ตตายตัว และปิด encrypt', () => {
  const base = { MSSQL_SERVER: 'POS-SERVER', MSSQL_DATABASE: 'PROMAXX', MSSQL_USER: 'u', MSSQL_PASSWORD: 'p' };

  const named = buildMssqlConfig(envOf({ ...base, MSSQL_INSTANCE: 'SQLEXPRESS', MSSQL_PORT: '1433' }));
  assert.equal(named.options.instanceName, 'SQLEXPRESS');
  assert.equal(named.port, undefined); // มี instance แล้วไม่ใช้พอร์ต
  assert.equal(named.options.encrypt, true);
  assert.equal(named.options.trustServerCertificate, true);
  assert.equal(named.pool.max, 2);

  const fixedPort = buildMssqlConfig(envOf({ ...base, MSSQL_PORT: '1433', MSSQL_ENCRYPT: 'FALSE', MSSQL_TDS_VERSION: '7_3_B' }));
  assert.equal(fixedPort.port, 1433);
  assert.equal(fixedPort.options.instanceName, undefined);
  assert.equal(fixedPort.options.encrypt, false);
  assert.equal(fixedPort.options.tdsVersion, '7_3_B');
});

test('sqlForSsms ให้ SQL ตัวเดียวกับที่ Agent ใช้ พร้อมประกาศ @days สำหรับวางใน SSMS', () => {
  const text = sqlForSsms(30);
  assert.match(text, /^SET STATISTICS TIME ON;\nDECLARE @days int = 30;\nSELECT /);
  assert.ok(text.includes(TRANSFER_SQL.trim()));
});

// คู่มือขั้น 1.4 มี SQL ให้ก๊อปไปวาง SSMS ได้ก่อนติดตั้งอะไร (ผู้ใช้ทำขั้นนั้นก่อนมีโค้ดในเครื่อง)
// แก้ TRANSFER_SQL แล้วลืมแก้คู่มือ = ผู้ใช้ไปทดสอบ SQL คนละตัวกับที่ Agent ใช้จริง
test('SQL ในคู่มือขั้น 1.4 ตรงกับ sqlForSsms(90) ทุกตัวอักษร', () => {
  const guide = readFileSync(new URL('./วิธีติดตั้ง-agent-เอกสารค้าง.md', import.meta.url), 'utf8');
  const marker = guide.indexOf('<!-- sql-for-ssms');
  assert.notEqual(marker, -1, 'ไม่พบ marker <!-- sql-for-ssms --> ในคู่มือ');
  const block = guide.slice(marker).match(/```sql\r?\n([\s\S]*?)\r?\n```/);
  assert.ok(block, 'ไม่พบบล็อก ```sql หลัง marker');
  assert.equal(block[1].trim(), sqlForSsms(90).trim());
});
