import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import {
  STOCK_SQL, normalizeStockRows, stockSnapshotHash, pushStockSnapshot,
  acquireStockAgentLock, stockAgentLockPath, stockPublicErrorMessage,
} from './stock-agent.mjs';
import { assertReadOnlySql } from './pending-docs-agent.mjs';

const raw = (overrides = {}) => ({
  branch_id: 0, warehouse_id: 0, sku: '001234  ', name: 'สินค้า  ทดสอบ\r\n',
  qty: '12.5000', unit: 'กล่อง  ', price: '100.2500', ...overrides,
});

test('แยก 4 คลังด้วยเลขสาขาและคลังคู่กัน เก็บ SKU ที่ขึ้นต้นด้วยศูนย์', () => {
  const items = normalizeStockRows([
    raw(), raw({ warehouse_id: 1 }), raw({ branch_id: 4 }), raw({ branch_id: 5 }),
  ]);
  assert.deepEqual(items.map(r => r.branch), ['คลังสินค้า', 'SRC', 'KKL', 'SSS']);
  assert.equal(items[0].sku, '001234');
  assert.equal(items[0].name, 'สินค้า ทดสอบ');
  assert.equal(items[0].unit, 'กล่อง');
});

test('รักษายอดศูนย์/ติดลบ/เศษและ decimal ที่เกินความละเอียดของ JS', () => {
  assert.equal(normalizeStockRows([raw({ qty: '0.0000' })])[0].qty, '0');
  assert.equal(normalizeStockRows([raw({ qty: '-2.1250' })])[0].qty, '-2.125');
  const [item] = normalizeStockRows([raw({ qty: '9007199254740993.0001', price: null })]);
  assert.equal(item.qty, '9007199254740993.0001');
  assert.equal(item.price, '');
});

test('ไม่แทนที่ชุดเดิมด้วยข้อมูลว่าง/เสีย/คลังที่ไม่รู้จัก/SKU ซ้ำ', () => {
  for (const rows of [[], [raw({ sku: '' })], [raw({ branch_id: 1 })], [raw({ warehouse_id: null })],
    [raw({ qty: null })], [raw({ qty: 'NaN' })], [raw({ price: 'ราคา' })], [raw(), raw()]]) {
    assert.throws(() => normalizeStockRows(rows));
  }
});

test('hash ไม่ขึ้นกับลำดับ SQL และเปลี่ยนเมื่อช่องที่แสดงผลเปลี่ยน', () => {
  const items = normalizeStockRows([raw(), raw({ branch_id: 4 })]);
  const hash = stockSnapshotHash(items);
  assert.equal(stockSnapshotHash([...items].reverse()), hash);
  for (const field of ['branch', 'sku', 'name', 'qty', 'unit', 'price']) {
    const modified = structuredClone(items);
    modified[0][field] += '1';
    assert.notEqual(stockSnapshotHash(modified), hash, field);
  }
  assert.equal(stockSnapshotHash(normalizeStockRows([raw({ qty: '12.5' }), raw({ branch_id: 4 })])), hash);
});

function fakeClient(results) {
  const calls = [];
  return { calls, rpc: async (...args) => { calls.push(args); return results.shift(); } };
}

test('ชุดเดิมบันทึกแค่เวลาที่ตรวจ ไม่เขียน stock ใหม่', async () => {
  const client = fakeClient([{ data: true, error: null }]);
  assert.equal((await pushStockSnapshot(client, normalizeStockRows([raw()]))).changed, false);
  assert.deepEqual(client.calls.map(call => call[0]), ['mark_stock_unchanged']);
});

test('ชุดใหม่ส่งทั้งชุดด้วย RPC เดียว และ --once ข้ามการเทียบ hash', async () => {
  const items = normalizeStockRows([raw()]);
  const client = fakeClient([{ data: false, error: null }, { data: 1, error: null }]);
  assert.equal((await pushStockSnapshot(client, items)).changed, true);
  assert.deepEqual(client.calls.map(call => call[0]), ['mark_stock_unchanged', 'replace_stock_snapshot']);
  assert.deepEqual(client.calls[1][1].p_rows, items);
  const force = fakeClient([{ data: 1, error: null }]);
  await pushStockSnapshot(force, items, { force: true });
  assert.deepEqual(force.calls.map(call => call[0]), ['replace_stock_snapshot']);
});

test('Supabase ล้มเหลวหรือจำนวนไม่ตรงต้องไม่รายงานว่าสำเร็จ', async () => {
  const items = normalizeStockRows([raw()]);
  const client = fakeClient([{ error: { message: 'offline' } }]);
  await assert.rejects(pushStockSnapshot(client, items), /offline/);
  assert.equal(client.calls.length, 1);
  await assert.rejects(pushStockSnapshot(fakeClient([{ data: 0 }]), items, { force: true }), /จำนวน/);
  await assert.rejects(pushStockSnapshot(fakeClient([]), []), /ว่าง/);
});

test('เก็บรหัสและชื่อ RPC ใน error แต่ข้อความสาธารณะไม่เผยรายละเอียดภายใน', async () => {
  const items = normalizeStockRows([raw()]);
  const client = fakeClient([{ data: false }, { error: { code: '57014', message: 'canceling statement due to statement timeout: private-host' } }]);
  await assert.rejects(pushStockSnapshot(client, items), error => {
    assert.equal(error.code, '57014');
    assert.equal(error.operation, 'replace_stock_snapshot');
    assert.match(error.message, /replace_stock_snapshot/);
    assert.match(stockPublicErrorMessage(error), /เกินเวลาที่กำหนด/);
    assert.doesNotMatch(stockPublicErrorMessage(error), /private-host/);
    return true;
  });
  for (const code of ['55P03', '40001', '40P01']) {
    assert.match(stockPublicErrorMessage({ name: 'SupabaseError', code }), /ซ้อนกัน/);
  }
  assert.equal(stockPublicErrorMessage({ name: 'SupabaseError', message: 'private-host' }), 'ส่งข้อมูลขึ้น Supabase ไม่สำเร็จ');
});

test('Windows ใช้ named pipe และ Linux ใช้ abstract socket ภายในเครื่อง', () => {
  assert.equal(stockAgentLockPath('test', 'win32'), String.raw`\\.\pipe\test`);
  assert.equal(stockAgentLockPath('test', 'linux'), '\0test');
});

test('เปิด Stock ซ้ำไม่ได้ และปล่อย lock แล้วเปิดใหม่ได้', async () => {
  const path = stockAgentLockPath(`stock-test-${randomUUID()}`);
  const first = await acquireStockAgentLock(path);
  assert(first);
  try { assert.equal(await acquireStockAgentLock(path), null); }
  finally { await Promise.all([first.release(), first.release()]); }
  const next = await acquireStockAgentLock(path);
  assert(next);
  await next.release();
});

test('guard คงอยู่ตลอดอายุ process และไม่ค้างเมื่อ process ถูกปิดกะทันหัน', { timeout: 10_000 }, async () => {
  const path = stockAgentLockPath(`stock-crash-${randomUUID()}`);
  const moduleUrl = new URL('./stock-agent.mjs', import.meta.url).href;
  const script = `
    import { acquireStockAgentLock } from ${JSON.stringify(moduleUrl)};
    setInterval(() => {}, 1000);
    await (async () => { if (!await acquireStockAgentLock(${JSON.stringify(path)})) throw new Error('busy'); })();
    global.gc();
    process.send('locked');
  `;
  const child = spawn(process.execPath, ['--expose-gc', '--input-type=module', '-e', script], {
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  try {
    const [message] = await Promise.race([
      once(child, 'message'),
      once(child, 'exit').then(() => { throw new Error(`guard child exited: ${stderr}`); }),
    ]);
    assert.equal(message, 'locked');
    assert.equal(await acquireStockAgentLock(path), null);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const closed = once(child, 'close');
      child.kill('SIGKILL');
      await closed;
    }
  }
  const replacement = await acquireStockAgentLock(path);
  assert(replacement);
  await replacement.release();
});

test('คำสั่งจริงผ่านด่าน SELECT อย่างเดียว', () => {
  assert.equal(assertReadOnlySql(STOCK_SQL), STOCK_SQL);
});

// ทดสอบ query จริงกับ movement จำลอง โดยใช้ SQLite (Node 22.13+) แทนเซิร์ฟเวอร์ ProMaxx.
// ลงทะเบียน CONVERT/varchar เพื่อรองรับ syntax แปลง decimal ของ SQL Server โดยไม่แก้ตัว query.
const { DatabaseSync } = await import('node:sqlite').catch(() => ({}));
test('query คิดยอดตาม R01.102: base qty, voucher sign, flags, คลังคู่, ราคาและหน่วยฐาน', { skip: !DatabaseSync }, () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.function('varchar', value => value);
    db.function('CONVERT', (_type, value) => value === null ? null : String(value));
    db.exec(`
      CREATE TABLE ITEMS (SYSITEMID int, ITEMID text, ITEMNAME text, FEFFECTSTOCK int,
        FSHOWONREPORT int, FUSED int, FONEPRICEALLBRANCH int);
      CREATE TABLE WAREHOUSE (SYSBRANCHID int, SYSWAREHOUSEID int);
      CREATE TABLE TRANS (SYSTRANNO int, SYSBRANCHID int, SYSWAREHOUSEID int, SYSVOUCHERID int,
        FTaxInvoiceReplacement int DEFAULT 0, FVoidTaxInvoice int DEFAULT 0, FCANCEL int DEFAULT 0, FAPPROVE int DEFAULT 1);
      CREATE TABLE TRANDETAILITEM (SYSTRANNO int, SYSITEMID int, BASEQUANTITY real, FPROCESS int DEFAULT 1);
      CREATE TABLE VOUCHER (SYSVOUCHERID int, FSTOCKMAIN int, VOUCHERTYPE text);
      CREATE TABLE ITEMUNIT (SYSITEMID int, SYSUNITID int, MULTIPLE int);
      CREATE TABLE UNITNAME (SYSUNITID int, UNITNAME text);
      CREATE TABLE ITEMPRICELEVEL (SYSITEMID int, SYSUNITID int, LEVELNO int, PRICE real);
      CREATE TABLE ITEMPRICELEVELONBRANCH (SYSBRANCHID int, SYSITEMID int, SYSUNITID int, LEVELNO int, PRICE real);
      CREATE TABLE COMPANY (WORKSYSBRANCHID int);
      INSERT INTO COMPANY VALUES (0);
      INSERT INTO WAREHOUSE VALUES (0,0),(0,1),(1,0),(4,0),(5,0);
      INSERT INTO VOUCHER VALUES (1,1,'RECEIVE'),(2,-1,'SALE'),(3,0,'ORDER'),(4,1,'TW');
      INSERT INTO UNITNAME VALUES (1,'ชิ้น'),(2,'แพ็ค');
      INSERT INTO ITEMS VALUES (1,'001','สินค้าราคากลาง',1,1,1,1),(2,'002','ราคาแยกสาขา',1,1,1,0),
        (3,'DEPOSIT','มัดจำ',1,1,1,1),(4,'DEPOSIT-NV','มัดจำ NV',1,1,1,1),
        (5,'005','ไม่กระทบ stock',0,1,1,1),(6,'006','ไม่แสดงรายงาน',1,0,1,1),
        (7,'007','เลิกใช้',1,1,0,1),(8,'008','ไม่มี movement',1,1,1,1),(9,'009','qty NULL',1,1,1,1);
      INSERT INTO ITEMUNIT VALUES (1,1,1),(1,2,12),(2,1,1);
      INSERT INTO ITEMPRICELEVEL VALUES (1,1,0,10.25),(1,2,0,120),(1,1,1,99),(2,1,0,88);
      INSERT INTO ITEMPRICELEVELONBRANCH VALUES (0,2,1,0,20.5),(4,2,1,0,44);
    `);
    let tranNo = 0;
    const move = (item, qty, { branch = 0, warehouse = 0, voucher = 1, replacement = 0, voided = 0,
      cancel = 0, approve = 1, process = 1 } = {}) => {
      db.prepare('INSERT INTO TRANS VALUES (?,?,?,?,?,?,?,?)').run(++tranNo, branch, warehouse, voucher, replacement, voided, cancel, approve);
      db.prepare('INSERT INTO TRANDETAILITEM VALUES (?,?,?,?)').run(tranNo, item, qty, process);
    };
    move(1, 12); move(1, 2.5, { voucher: 2 }); move(1, 1, { voucher: 4 }); // TW ต้องรวม = 10.5
    for (const options of [{ voucher: 3 }, { replacement: 1 }, { voided: 1 }, { cancel: 1 }, { approve: 0 }, { process: 0 }]) move(1, 999, options);
    move(1, 0, { warehouse: 1 });
    move(1, 2, { branch: 4, voucher: 2 });
    move(1, 3, { branch: 5 });
    move(1, 999, { branch: 1 }); // คลัง 0 ของอีกสาขาไม่ปะปน
    move(2, 1, { branch: 4 });
    for (const id of [3, 4, 5, 6, 7]) move(id, 999);
    move(9, null);
    const items = normalizeStockRows(db.prepare(STOCK_SQL).all());
    assert.equal(items.length, 5);
    assert.equal(items.find(r => r.branch === 'คลังสินค้า').qty, '10.5');
    assert.equal(items.find(r => r.branch === 'SRC').qty, '0');
    assert.equal(items.find(r => r.branch === 'KKL' && r.sku === '001').qty, '-2');
    assert.equal(items.find(r => r.branch === 'SSS').qty, '3');
    assert.equal(items.find(r => r.sku === '001').price, '10.25');
    assert.equal(items.find(r => r.sku === '001').unit, 'ชิ้น');
    assert.equal(items.find(r => r.sku === '002').price, '20.5'); // WORKSYSBRANCHID 0 แม้เป็นคลัง 4
  } finally { db.close(); }
});
