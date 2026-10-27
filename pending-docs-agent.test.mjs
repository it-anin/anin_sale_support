import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  DEST_BRANCH_FALLBACK,
  TRANSFER_SQL,
  WAREHOUSE_MAP,
  assertReadOnlySql,
  buildMssqlConfig,
  cleanText,
  createSyncRunner,
  groupTransferRows,
  loadConfig,
  normalizeDate,
  publicErrorMessage,
  pushSnapshot,
  readEnvValue,
  resolveDestination,
  resolveWarehouse,
  snapshotHash,
  sqlForSsms,
  timestampMs,
  unansweredRequestMs,
  warehouseKey,
} from './pending-docs-agent.mjs';

const setupSql = readFileSync(new URL('./pending-docs-setup.sql', import.meta.url), 'utf8');

// ชื่อสาขา/คลังตามตาราง BRANCH + WAREHOUSE จริงของ ProMaxx (ผู้ใช้ส่งมา 2569-10-27)
// ค่าเริ่มต้น = ใบจาก Main KKL (4:0) โอนเข้า Warehouse (0:0) ตามกฎ "KKL/SSS โอนเข้า Warehouse เท่านั้น"
function sqlRow(overrides = {}) {
  return {
    sys_tran_no: 101,
    doc_no: 'TB6810-0001      ',
    doc_date: '2026-10-20',
    from_branch_id: 4,
    from_branch_name: 'อนิน สาขาเก้ากิโล   ',
    from_warehouse_id: 0,
    from_warehouse_name: 'Main KKL',
    to_branch_id: 0,
    to_branch_name: 'อนิน สาขาแยกชากค้อ',
    to_warehouse_id: 0,
    to_warehouse_name: 'Warehouse',
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

test('WAREHOUSE_MAP ตรงกับตาราง WAREHOUSE ที่ผู้ใช้ส่งมา · สาขา 1-3 ไม่แสดง', () => {
  assert.deepEqual(WAREHOUSE_MAP, { '0:0': 'คลังสินค้า', '0:1': 'SRC', '4:0': 'KKL', '5:0': 'SSS' });
  assert.deepEqual(DEST_BRANCH_FALLBACK, { 0: 'คลังสินค้า', 4: 'KKL', 5: 'SSS' });
  // ต้องเป็นรหัสที่หน้าเว็บรู้จัก (STORE_BRANCH_CODES ใน auth.ts + แท็บคลังสินค้า) ไม่งั้นได้ 0 แถวเงียบๆ
  const webCodes = ['คลังสินค้า', 'SRC', 'KKL', 'SSS'];
  for (const code of [...Object.values(WAREHOUSE_MAP), ...Object.values(DEST_BRANCH_FALLBACK)]) {
    assert.ok(webCodes.includes(code), code);
  }
});

test('warehouseKey ต้องมีทั้งเลขสาขาและเลขคลัง · เลข 0 ใช้ได้ปกติ', () => {
  assert.equal(warehouseKey(0, 0), '0:0');
  assert.equal(warehouseKey('4', 0), '4:0'); // driver อาจให้เลขมาเป็นข้อความ
  assert.equal(warehouseKey(0, null), null);
  assert.equal(warehouseKey(null, 1), null);
});

test('resolveWarehouse แยก Warehouse กับ Front Store ของสาขา 0 · นอก map ได้ชื่อดิบ', () => {
  assert.deepEqual(resolveWarehouse(0, 0, { warehouse: 'Warehouse' }), { code: 'คลังสินค้า', known: true });
  assert.deepEqual(resolveWarehouse(0, 1, { warehouse: 'Front Store' }), { code: 'SRC', known: true });
  assert.deepEqual(resolveWarehouse(1, 0, { branch: ' ออนนุช ', warehouse: 'Main ONN' }), { code: 'ออนนุช', known: false });
  assert.deepEqual(resolveWarehouse(0, 9, { warehouse: 'คลังใหม่' }), { code: 'คลังใหม่', known: false });
  assert.deepEqual(resolveWarehouse(7, null), { code: 'สาขา #7', known: false });
  assert.deepEqual(resolveWarehouse(null, null), { code: '', known: false });
});

// 🚨 เลขคลังซ้ำข้ามสาขา — ถ้าเผลอจับคู่ด้วยเลขคลังอย่างเดียว ใบของออนนุช (1:0) จะกลายเป็นคลังสินค้า (0:0)
test('เลขคลังเดียวกันคนละสาขาเป็นคนละคลัง', () => {
  assert.equal(resolveWarehouse(0, 0).code, 'คลังสินค้า');
  assert.equal(resolveWarehouse(4, 0).code, 'KKL');
  assert.equal(resolveWarehouse(1, 0).known, false);
});

test('TRANSFER_SQL JOIN ตาราง WAREHOUSE ด้วยสาขา+คลังทั้งคู่ และเป็น LEFT JOIN', () => {
  const text = TRANSFER_SQL.replace(/\s+/g, ' ');
  // LEFT = ใบที่ไม่มีคลังยังอยู่ · คีย์ 2 คอลัมน์ = ไม่มีแถวคูณ → จำนวนแถวเท่ารายงาน R16.150 เดิม
  assert.match(text, /LEFT JOIN WAREHOUSE SRCWH ON SRCWH\.SYSBRANCHID = TRANS\.SYSBRANCHID AND SRCWH\.SYSWAREHOUSEID = TRANS\.SYSWAREHOUSEID /);
  assert.match(text, /LEFT JOIN WAREHOUSE DESTWH ON DESTWH\.SYSBRANCHID = TRANEXTRAINFO\.REFTRANFERSYSBRANCH AND DESTWH\.SYSWAREHOUSEID = TRANEXTRAINFO\.REFTRANFERSYSWAREHOUSE /);
});

test('resolveDestination ใช้คลังปลายทางจริงก่อน ไม่มีค่อยดูจากสาขา', () => {
  assert.equal(resolveDestination(sqlRow()), 'คลังสินค้า');
  assert.equal(resolveDestination(sqlRow({ to_warehouse_id: 1, to_warehouse_name: 'Front Store' })), 'SRC'); // ผิดกฎแต่แสดงตามจริง
  // ใบที่ไม่ระบุคลังปลายทาง: สาขา 0 = คลังสินค้า ตามกฎ KKL/SSS โอนเข้า Warehouse เท่านั้น
  assert.equal(resolveDestination(sqlRow({ to_warehouse_id: null, to_warehouse_name: null })), 'คลังสินค้า');
  assert.equal(resolveDestination(sqlRow({ to_branch_id: 4, to_warehouse_id: null, to_warehouse_name: null })), 'KKL');
  // สาขานอก map ได้ชื่อสาขาดิบ
  assert.equal(resolveDestination(sqlRow({ to_branch_id: 2, to_branch_name: 'ตลาดเวิลด์มาร์เก็ต ', to_warehouse_name: 'Main WRD' })), 'ตลาดเวิลด์มาร์เก็ต');
});

test('groupTransferRows รวมรายการสินค้าเป็นใบโอน 1 ใบต่อ SYSTRANNO', () => {
  const { docs, skipped } = groupTransferRows([
    sqlRow({ line_no: 2, item_code: '222', item_name: 'สินค้า B', qty: 5 }),
    sqlRow({ line_no: 1 }),
    sqlRow({ sys_tran_no: 202, doc_no: 'TB6810-0002', from_branch_id: 5, from_branch_name: 'อนิน สาขาสวนเสือศรีราชา', from_warehouse_name: 'Main SSS', line_no: 1, serial_no: 'LOT-7 ' }),
  ]);

  assert.equal(docs.length, 2);
  assert.deepEqual(skipped, []);

  const first = docs[0];
  assert.equal(first.doc_no, 'TB6810-0001');
  assert.equal(first.doc_date, '2026-10-20');
  assert.equal(first.from_branch, 'KKL');
  assert.equal(first.to_branch, 'คลังสินค้า');
  assert.equal(first.item_count, 2);
  assert.deepEqual(first.items, [
    { line_no: 1, code: '123456', name: 'พาราเซตามอล 500 มก.', qty: 2 },
    { line_no: 2, code: '222', name: 'สินค้า B', qty: 5 },
  ]);

  const second = docs[1];
  assert.equal(second.from_branch, 'SSS');
  assert.equal(second.items[0].serial, 'LOT-7');
});

test('groupTransferRows แยกใบของสาขา 0 ตามคลังต้นทาง: Warehouse = คลังสินค้า · Front Store = SRC', () => {
  const branch0 = { from_branch_id: 0, from_branch_name: 'อนิน สาขาแยกชากค้อ', to_branch_id: 4, to_branch_name: 'อนิน สาขาเก้ากิโล', to_warehouse_name: 'Main KKL' };
  const { docs } = groupTransferRows([
    sqlRow({ ...branch0, sys_tran_no: 1, from_warehouse_id: 0, from_warehouse_name: 'Warehouse' }),
    sqlRow({ ...branch0, sys_tran_no: 2, from_warehouse_id: 1, from_warehouse_name: 'Front Store' }),
  ]);
  assert.deepEqual(docs.map(d => [d.from_branch, d.to_branch]), [['คลังสินค้า', 'KKL'], ['SRC', 'KKL']]);
});

test('groupTransferRows ไม่แสดงใบที่คลังต้นทางอยู่นอก map และนับเป็นใบ ไม่ใช่แถว', () => {
  const onnut = { from_branch_id: 1, from_branch_name: 'ออนนุช', from_warehouse_name: 'Main ONN' };
  const { docs, skipped } = groupTransferRows([
    sqlRow({ ...onnut, sys_tran_no: 1, line_no: 1 }),
    sqlRow({ ...onnut, sys_tran_no: 1, line_no: 2 }),
    sqlRow({ ...onnut, sys_tran_no: 2 }),
    sqlRow({ sys_tran_no: 3, from_branch_id: 3, from_branch_name: 'กรุงเทพกรีฑา', from_warehouse_name: 'Main KTK' }),
    // สาขา 0 ที่ไม่มีเลขคลัง — เดาไม่ได้ว่า Warehouse หรือ Front Store จึงไม่แสดง (ดีกว่าโชว์ผิดคน)
    sqlRow({ sys_tran_no: 5, from_branch_id: 0, from_branch_name: 'อนิน สาขาแยกชากค้อ', from_warehouse_id: null, from_warehouse_name: null }),
    sqlRow({ sys_tran_no: 4 }),
  ]);
  assert.deepEqual(docs.map(d => d.sys_tran_no), [4]);
  assert.deepEqual(skipped, [
    { key: '1:0', name: 'ออนนุช', docs: 2 },
    { key: '3:0', name: 'กรุงเทพกรีฑา', docs: 1 },
    { key: '0:?', name: 'อนิน สาขาแยกชากค้อ', docs: 1 },
  ]);
});

test('groupTransferRows ปลายทางนอก map ยังแสดง ด้วยชื่อสาขาเดิมจาก ProMaxx', () => {
  const { docs } = groupTransferRows([sqlRow({ to_branch_id: 2, to_branch_name: 'ตลาดเวิลด์มาร์เก็ต ', to_warehouse_name: 'Main WRD' })]);
  assert.equal(docs.length, 1);
  assert.equal(docs[0].to_branch, 'ตลาดเวิลด์มาร์เก็ต');
});

test('groupTransferRows ใช้ map ที่ส่งเข้ามาแทนค่าเริ่มต้นได้', () => {
  const { docs, skipped } = groupTransferRows(
    [sqlRow({ from_branch_id: 9, from_branch_name: 'สาขาใหม่', from_warehouse_name: 'Main NEW' })],
    { '9:0': 'SRC' },
    {},
  );
  assert.equal(docs[0].from_branch, 'SRC');
  assert.equal(docs[0].to_branch, 'อนิน สาขาแยกชากค้อ'); // 0:0 ไม่อยู่ใน map ที่ส่งมา และไม่มี fallback → ชื่อสาขาดิบ
  assert.deepEqual(skipped, []);
});

test('groupTransferRows ข้ามแถวที่ไม่มี SYSTRANNO และจำนวนที่อ่านไม่ออกเป็น null', () => {
  const { docs } = groupTransferRows([
    sqlRow({ sys_tran_no: null }),
    sqlRow({ sys_tran_no: '  ' }),
    sqlRow({ sys_tran_no: '3000000000', qty: null }),
  ]);
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

test('snapshotHash ชุดเดิมได้ค่าเดิม แม้ SQL ส่งใบมาคนละลำดับ', () => {
  const { docs } = groupTransferRows([
    sqlRow({ sys_tran_no: 101 }),
    sqlRow({ sys_tran_no: 202, doc_no: 'TB6810-0002' }),
  ]);
  assert.match(snapshotHash(docs), /^[0-9a-f]{64}$/);
  assert.equal(snapshotHash(docs), snapshotHash([...docs].reverse()));
  assert.equal(snapshotHash(docs), snapshotHash(groupTransferRows([sqlRow({ sys_tran_no: 101 }), sqlRow({ sys_tran_no: 202, doc_no: 'TB6810-0002' })]).docs));
});

// ทุกอย่างที่หน้าเว็บแสดงต้องอยู่ในลายนิ้วมือ — หลุดไปช่องเดียว = ข้อมูลเปลี่ยนแต่ Agent คิดว่าเหมือนเดิม หน้าเว็บค้างของเก่า
test('snapshotHash เปลี่ยนทุกครั้งที่สิ่งที่หน้าเว็บแสดงเปลี่ยน', () => {
  const base = snapshotHash(groupTransferRows([sqlRow()]).docs);
  const changed = {
    'แก้จำนวน': [sqlRow({ qty: 3 })],
    'เพิ่มรายการ': [sqlRow(), sqlRow({ line_no: 2, item_code: '222' })],
    'แก้ชื่อสินค้า': [sqlRow({ item_name: 'พาราเซตามอล 650 มก.' })],
    'ใส่ serial': [sqlRow({ serial_no: 'LOT-9' })],
    'แก้วันที่': [sqlRow({ doc_date: '2026-10-21' })],
    'เปลี่ยนปลายทาง': [sqlRow({ to_warehouse_id: 1, to_warehouse_name: 'Front Store' })],
    'มีใบใหม่': [sqlRow(), sqlRow({ sys_tran_no: 202, doc_no: 'TB6810-0002' })],
    'สาขากด "ส่ง" ครบแล้ว ไม่มีใบค้าง': [],
  };
  for (const [what, rows] of Object.entries(changed)) {
    assert.notEqual(snapshotHash(groupTransferRows(rows).docs), base, what);
  }
});

function fakeSupabase(results = {}) {
  const calls = [];
  return {
    calls,
    async rpc(name, args) {
      calls.push([name, args]);
      return results[name] ?? { data: null, error: null };
    },
  };
}

test('pushSnapshot ข้อมูลเหมือนเดิม → บันทึกแค่เวลาที่ตรวจ ไม่ส่งชุดใบโอนซ้ำ', async () => {
  const { docs } = groupTransferRows([sqlRow()]);
  const client = fakeSupabase({ mark_pending_docs_unchanged: { data: true, error: null } });
  assert.deepEqual(await pushSnapshot(client, docs), { changed: false, hash: snapshotHash(docs) });
  assert.deepEqual(client.calls, [['mark_pending_docs_unchanged', { p_hash: snapshotHash(docs) }]]);
});

test('pushSnapshot ข้อมูลเปลี่ยน → แทนที่ทั้งชุดพร้อมลายนิ้วมือใหม่', async () => {
  const { docs } = groupTransferRows([sqlRow()]);
  const client = fakeSupabase({ mark_pending_docs_unchanged: { data: false, error: null } });
  assert.deepEqual(await pushSnapshot(client, docs), { changed: true, hash: snapshotHash(docs) });
  assert.deepEqual(client.calls.map(([name]) => name), ['mark_pending_docs_unchanged', 'replace_pending_transfers']);
  assert.deepEqual(client.calls[1][1], { p_rows: docs, p_hash: snapshotHash(docs) });
});

test('pushSnapshot force (--once) ส่งทั้งชุดเลยไม่ต้องเทียบ', async () => {
  const client = fakeSupabase();
  assert.equal((await pushSnapshot(client, [], { force: true })).changed, true);
  assert.deepEqual(client.calls.map(([name]) => name), ['replace_pending_transfers']);
});

test('pushSnapshot error จาก Supabase → หน้าเว็บได้ข้อความสั้น และไม่ส่งชุดใบโอนต่อ', async () => {
  const client = fakeSupabase({ mark_pending_docs_unchanged: { data: null, error: { message: 'Could not find the function public.mark_pending_docs_unchanged(p_hash)' } } });
  await assert.rejects(pushSnapshot(client, []), err => {
    assert.equal(err.name, 'SupabaseError');
    assert.equal(publicErrorMessage(err), 'ส่งข้อมูลขึ้น Supabase ไม่สำเร็จ');
    return true;
  });
  assert.equal(client.calls.length, 1);

  const replaceFails = fakeSupabase({ replace_pending_transfers: { data: null, error: { message: 'timeout' } } });
  await assert.rejects(pushSnapshot(replaceFails, []), { name: 'SupabaseError' });
});

// 🚨 RPC ที่ Agent ใช้เขียนต้องเรียกได้ด้วย service_role เท่านั้น — Supabase แจก execute ให้ anon อัตโนมัติ
// replace: ใครก็ลบ snapshot ได้ · mark_unchanged: data_hash อ่านได้สาธารณะ ใครก็ทำให้เว็บเชื่อว่าเครื่องในร้านยังตรวจอยู่
test('pending-docs-setup.sql ถอนสิทธิ์ anon จาก RPC ฝั่ง Agent ทุกตัว', () => {
  for (const fn of ['replace_pending_transfers(jsonb, text)', 'mark_pending_docs_unchanged(text)']) {
    assert.ok(setupSql.includes(`revoke all on function public.${fn} from public, anon, authenticated;`), fn);
    assert.ok(setupSql.includes(`grant execute on function public.${fn} to service_role;`), fn);
  }
  // ตัวรุ่นก่อน (รับแค่ p_rows) ต้องถูกลบ ไม่งั้นมี 2 ตัวชื่อซ้ำ PostgREST เลือกไม่ได้ว่าจะเรียกตัวไหน
  assert.ok(setupSql.includes('drop function if exists public.replace_pending_transfers(jsonb);'));
});

// คำขออัตโนมัติ = สลับกลับมาที่แท็บ · เกณฑ์ต่ำเกินไป สลับหน้าต่างไปมาก็กลายเป็นถาม MSSQL ถี่ๆ ซึ่งผู้ใช้ไม่เอา
test('คำขอตอนกลับมาที่แท็บผ่านเฉพาะตอนข้อมูลเก่ากว่าอย่างน้อย 1 นาที', () => {
  const m = setupSql.match(/when p_auto then[\s\S]*?interval '(\d+) (minutes?|seconds?)'/);
  assert.ok(m, 'ไม่พบเกณฑ์ interval ของคำขออัตโนมัติใน request_pending_docs_refresh');
  const ms = Number(m[1]) * (m[2].startsWith('minute') ? 60_000 : 1000);
  assert.ok(ms >= 60_000, `${m[1]} ${m[2]}`);
});

// Agent ไม่ถาม MSSQL ตามรอบแล้ว — ตอนเริ่มทำงานจะถามก็ต่อเมื่อมีคนเปิดหน้าค้างไว้ระหว่าง Agent ปิด/รีสตาร์ท
test('unansweredRequestMs บอกคำขอที่ยังไม่มีใครตอบ', () => {
  const t = iso => Date.parse(iso);
  assert.equal(unansweredRequestMs({ refresh_requested_at: null }), null, 'ยังไม่เคยมีใครขอ');
  assert.equal(unansweredRequestMs({
    refresh_requested_at: '2026-10-27T08:00:00Z', last_success_at: '2026-10-27T08:00:02Z', last_checked_at: null,
  }), null, 'ส่งชุดใหม่ไปแล้ว');
  assert.equal(unansweredRequestMs({
    refresh_requested_at: '2026-10-27T08:00:00Z', last_success_at: '2026-10-27T07:00:00Z', last_checked_at: '2026-10-27T08:00:03Z',
  }), null, 'ตรวจแล้วเหมือนเดิม');
  assert.equal(unansweredRequestMs({
    refresh_requested_at: '2026-10-27T08:00:00Z', last_success_at: '2026-10-27T07:00:00Z', last_checked_at: '2026-10-27T07:00:00Z',
  }), t('2026-10-27T08:00:00Z'), 'ขอแล้วยังไม่มีคำตอบ');
  assert.equal(unansweredRequestMs({
    refresh_requested_at: '2026-10-27T08:00:00Z', last_success_at: null, last_checked_at: null,
    last_error_at: '2026-10-27T08:00:05Z',
  }), t('2026-10-27T08:00:00Z'), 'จบด้วย error → รีสตาร์ทแล้วลองใหม่ได้');
  // ตารางรุ่นก่อนไม่มี last_checked_at
  assert.equal(unansweredRequestMs({ refresh_requested_at: '2026-10-27T08:00:00Z', last_success_at: '2026-10-27T08:00:01Z' }), null);
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
