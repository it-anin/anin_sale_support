import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const setupSql = readFileSync(new URL('./stock-sync-setup.sql', import.meta.url), 'utf8');
const sample = { branch: 'คลังสินค้า', sku: '000001', name: 'สินค้าทดสอบ', qty: '-2.125', unit: 'ชิ้น', price: '12.5' };
const row = async (db, query, params) => (await db.query(query, params)).rows[0];
const asRole = (db, role) => db.exec(`set role ${role}`);
const replace = (db, items, hash) => row(db, 'select public.replace_stock_snapshot($1::jsonb, $2) as n', [JSON.stringify(items), hash]);
const pause = () => new Promise(done => setTimeout(done, 5));

async function createDb() {
  const db = new PGlite();
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls; create publication supabase_realtime;');
  return db;
}

test('อัปเกรดตารางเดิมได้โดยไม่แก้ข้อมูล/ID และ public ยังคงอ่านอย่างเดียว', async () => {
  const db = await createDb();
  try {
    await db.exec(`
      create table public.stock (
        id bigserial primary key, branch text not null, sku text not null, name text,
        qty text, unit text, price text, uploaded_at timestamptz not null default now()
      );
      create index stock_branch_sku_idx on stock(branch, sku);
      insert into stock(branch, sku, name, qty, unit, price)
        values ('คลังสินค้า', '000001', 'สินค้าทดสอบ', '-2.125', 'ชิ้น', '12.5');
      create table public.stock_sync (
        id smallint primary key check(id=1), refresh_requested_at timestamptz,
        last_success_at timestamptz, last_checked_at timestamptz, data_hash text,
        last_error text, last_error_at timestamptz, row_count integer not null default 0
      );
      insert into public.stock_sync(id) values (1);
    `);
    const before = await row(db, 'select * from stock');
    await db.exec(setupSql);
    await db.exec(setupSql);
    assert.deepEqual(await row(db, 'select * from stock'), before);
    assert.equal((await row(db, 'select sync_version from stock_sync')).sync_version, 2);
    const index = await row(db, "select indexdef from pg_indexes where indexname = 'stock_branch_sku_unique_idx'");
    assert.match(index.indexdef, /UNIQUE INDEX/);
    assert.equal((await db.query("select 1 from pg_indexes where indexname = 'stock_branch_sku_idx'")).rows.length, 0);
    for (const role of ['anon', 'authenticated']) {
      await asRole(db, role);
      assert.equal((await row(db, 'select count(*)::int as n from stock')).n, 1);
      await assert.rejects(db.query("update stock set qty = '99' where sku = '000001'"), /permission denied/);
      await assert.rejects(replace(db, [sample], 'bad'), /permission denied/);
      await assert.rejects(db.query("select public.mark_stock_unchanged('bad')"), /permission denied/);
      await assert.rejects(db.query("select public.report_stock_sync_error('bad')"), /permission denied/);
    }
    await asRole(db, 'service_role');
    assert.equal((await replace(db, [sample], 'first')).n, 1);
    assert.deepEqual(await row(db, 'select * from stock'), before);
    assert((await row(db, 'select last_success_at from stock_sync')).last_success_at);
    await asRole(db, 'postgres');
    assert.deepEqual((await db.query("select tablename from pg_publication_tables where pubname='supabase_realtime'")).rows, [{ tablename: 'stock_sync' }]);
  } finally { await db.close(); }
});

test('20,000 แถว เปลี่ยนสอง/เพิ่มหนึ่ง/ลบหนึ่ง → เขียนเพียงสี่แถว และ rollback ได้ทั้งชุด', async () => {
  const db = await createDb();
  try {
    await db.exec(setupSql);
    // เครื่องมือนับการเขียนใช้เฉพาะฐานข้อมูลจำลองนี้ ไม่ติดตั้ง trigger ในระบบจริง.
    await db.exec(`
      create table public.test_stock_writes(operation text);
      grant all on public.test_stock_writes to service_role;
      create function public.test_record_stock_write() returns trigger language plpgsql as $$
      begin insert into public.test_stock_writes values (TG_OP); return null; end $$;
      create trigger test_count_writes after insert or update or delete on public.stock
        for each row execute function public.test_record_stock_write();
    `);
    const items = Array.from({ length: 20_000 }, (_, index) => ({ ...sample, sku: String(index).padStart(6, '0') }));
    await asRole(db, 'service_role');
    assert.equal((await replace(db, items, 'initial')).n, 20_000);
    const untouchedBefore = await row(db, "select id, uploaded_at::text from stock where sku='000100'");
    const changedBefore = await row(db, "select id, uploaded_at::text from stock where sku='000000'");
    await db.exec('delete from test_stock_writes');

    const next = structuredClone(items);
    next[0].qty = '0';
    next[1].name = 'ชื่อสินค้าใหม่';
    next.pop();
    next.push({ ...sample, sku: '020000', qty: '9007199254740993.0001' });
    await pause();
    const started = performance.now();
    assert.equal((await replace(db, next, 'changed')).n, 20_000);
    const elapsed = performance.now() - started;
    assert.deepEqual((await db.query('select operation, count(*)::int as n from test_stock_writes group by operation order by operation')).rows,
      [{ operation: 'DELETE', n: 1 }, { operation: 'INSERT', n: 1 }, { operation: 'UPDATE', n: 2 }]);
    assert.deepEqual(await row(db, "select id, uploaded_at::text from stock where sku='000100'"), untouchedBefore);
    const changedAfter = await row(db, "select id, uploaded_at::text from stock where sku='000000'");
    assert.equal(changedAfter.id, changedBefore.id);
    assert.notEqual(changedAfter.uploaded_at, changedBefore.uploaded_at);
    assert.equal((await row(db, "select qty from stock where sku='020000'")).qty, '9007199254740993.0001');
    assert.equal((await row(db, 'select count(*)::int as n from stock')).n, 20_000);
    console.log(`Delta fixture: 20,000 rows compared, 4 writes, ${elapsed.toFixed(1)} ms`);

    await db.exec('delete from test_stock_writes');
    const beforeRepeat = await row(db, 'select * from stock_sync');
    await pause();
    assert.equal((await replace(db, next, 'changed')).n, 20_000);
    assert.equal((await row(db, 'select count(*)::int as n from test_stock_writes')).n, 0);
    const afterRepeat = await row(db, 'select * from stock_sync');
    assert.equal(String(afterRepeat.last_success_at), String(beforeRepeat.last_success_at));
    assert(afterRepeat.last_checked_at > beforeRepeat.last_checked_at);
    await replace(db, next, 'different-hash-same-data');
    assert.equal((await row(db, 'select count(*)::int as n from test_stock_writes')).n, 0);
    assert.equal(String((await row(db, 'select last_success_at from stock_sync')).last_success_at), String(beforeRepeat.last_success_at));

    // --once ส่ง payload เดิมก็ตรวจข้อมูลจริงได้ แม้มีใครแก้แถวโดยไม่อัปเดต hash.
    await db.exec("update stock set qty = '999' where sku = '000000'; delete from test_stock_writes;");
    await replace(db, next, 'different-hash-same-data');
    assert.equal((await row(db, "select qty from stock where sku='000000'")).qty, '0');
    assert.deepEqual((await db.query('select operation from test_stock_writes')).rows, [{ operation: 'UPDATE' }]);
    await db.exec('delete from test_stock_writes');

    const stateBeforeFailure = await row(db, 'select * from stock_sync');
    const signature = () => row(db, "select md5(jsonb_agg(to_jsonb(s) order by id)::text) as hash from stock s");
    const dataBeforeFailure = await signature();
    await asRole(db, 'postgres');
    await db.exec("alter table stock_sync add constraint test_fail_status check(data_hash <> 'rollback') not valid");
    await asRole(db, 'service_role');
    const failing = structuredClone(next);
    failing[0].qty = '123';
    failing.pop();
    failing.push({ ...sample, sku: '030000' });
    await assert.rejects(replace(db, failing, 'rollback'), /test_fail_status/);
    assert.deepEqual(await signature(), dataBeforeFailure);
    assert.deepEqual(await row(db, 'select * from stock_sync'), stateBeforeFailure);
    assert.equal((await row(db, 'select count(*)::int as n from test_stock_writes')).n, 0);

    for (const bad of [[], [sample, sample], [{ ...sample, qty: null }], [{ ...sample, qty: 'bad' }], [{ ...sample, branch: 'other' }]]) {
      await assert.rejects(replace(db, bad, 'invalid'));
      assert.deepEqual(await row(db, 'select * from stock_sync'), stateBeforeFailure);
    }
    await db.query("select public.report_stock_sync_error('ทดสอบข้อผิดพลาด')");
    assert.equal((await row(db, "select public.mark_stock_unchanged('different-hash-same-data') as unchanged")).unchanged, true);
    assert.equal((await row(db, 'select last_error from stock_sync')).last_error, null);
    await asRole(db, 'postgres');
    await db.exec(setupSql);
    assert.deepEqual(await signature(), dataBeforeFailure);
  } finally { await db.close(); }
});

test('ถ้าตารางเดิมมี SKU ซ้ำ การอัปเกรดต้องหยุดและเก็บข้อมูลเดิมไว้', async () => {
  const db = await createDb();
  try {
    await db.exec(`create table stock (
      id bigserial primary key, branch text not null, sku text not null,
      name text, qty text, unit text, price text, uploaded_at timestamptz default now()
    ); insert into stock(branch,sku) values ('SRC','001'),('SRC','001');`);
    await assert.rejects(db.exec(setupSql), /unique index/);
    await db.exec('rollback');
    assert.equal((await row(db, 'select count(*)::int as n from stock')).n, 2);
  } finally { await db.close(); }
});
