import { PGlite } from '@electric-sql/pglite';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { priceHash } from './price-agent.mjs';

test('Price SQL: atomic deltas, notifications, durable requests, daily claims and RLS', { timeout: 60_000 }, async () => {
  const root = fileURLToPath(new URL('.', import.meta.url));
  const db = new PGlite();
  try {
    const setup = readFileSync(root + 'price-agent-setup.sql', 'utf8');
    const logSetup = readFileSync(root + 'price-change-setup.sql', 'utf8');
    await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    create table public.products (id bigserial primary key, barcode text, sku text, name text, unit text, price numeric, category text, base_multiple numeric, updated_at timestamptz);
    create table public.products_import (id bigserial primary key, barcode text, sku text, name text, unit text, price numeric, category text, base_multiple numeric);
    `);
    for (const name of ['price_change_log', 'price_change_seen']) {
      await db.exec(logSetup.match(new RegExp(`create table if not exists public\\.${name} \\([\\s\\S]*?\\n\\);`))[0]);
    }
    await db.exec(logSetup.match(/create or replace function public\.log_price_changes\(\)[\s\S]*?\$\$;/)[0]);
    await db.exec("insert into price_change_seen(profile_id) values ('SRC');");
    await db.exec(setup);
    // setup SQL executes against PostgreSQL and creates the RLS/RPC objects

    const scalar = async sql => Object.values((await db.query(sql)).rows[0])[0];
    const status = async () => (await db.query('select * from price_sync')).rows[0];
    const products = async () => (await db.query('select * from products order by barcode')).rows;
    const sync = async rows => (await db.query('select public.sync_price_products($1::jsonb, $2)', [JSON.stringify(rows), priceHash(rows)])).rows;
    const role = async (name, fn) => {
      await db.exec(`set role ${name}`);
      try { return await fn(); } finally { await db.exec('reset role'); }
    };
    const base = Array.from({ length: 10 }, (_, i) => ({
      barcode: `00000${i}`, sku: `10000${i}`, name: `Medicine ${i}`, unit: 'pack', price: 9, category: 'medicine', base_multiple: 1,
    }));
    await role('service_role', () => sync(base));
    const before = await products();
    assert.equal(before.length, 10);
    assert.equal(await scalar('select count(*) from price_change_log'), 0);
    assert.equal((await status()).data_version, 1);
    const initial = await status();
    assert.equal(await scalar(`select public.mark_price_unchanged('${priceHash(base)}')`), true);
    assert.equal((await status()).last_success_at.getTime(), initial.last_success_at.getTime());
    assert.deepEqual(await products(), before);
    // initial service_role import; unchanged hash preserves all product IDs/timestamps and data version

    const next = base.filter((_, i) => i !== 2).map((p, i) => i === 0 ? { ...p, price: 12 } : i === 1 ? { ...p, name: 'Renamed' } : p);
    next.push({ ...base[2], barcode: 'new-code', base_multiple: 10 });
    await role('service_role', () => sync(next));
    const after = await products();
    assert.equal(after.length, 10);
    assert.equal(after.find(p => p.barcode === base[0].barcode).id, before[0].id);
    assert.equal(after.find(p => p.barcode === base[0].barcode).price, '12');
    assert.deepEqual(after.find(p => p.barcode === base[5].barcode), before[5]);
    assert.ok(!after.some(p => p.barcode === base[2].barcode));
    assert.equal((await status()).data_version, 2);
    assert.equal(await scalar('select count(*) from price_change_log'), 1);
    assert.equal(await scalar('select new_price from price_change_log'), '12');
    // mixed insert/update/delete changes only affected rows, preserves untouched rows, logs exactly one changed price

    const applied = await status();
    await role('service_role', () => sync(next));
    assert.deepEqual(await products(), after);
    assert.equal((await status()).data_version, 2);
    assert.equal((await status()).last_success_at.getTime(), applied.last_success_at.getTime());
    // an identical full snapshot also performs zero product mutations

    for (const bad of [[], next.slice(0, 2), next.map((p, i) => i === 1 ? next[0] : p)]) {
      await assert.rejects(sync(bad));
      assert.deepEqual(await products(), after);
      assert.equal((await status()).data_version, 2);
      assert.equal(await scalar('select count(*) from products_import'), 0);
    }
    // empty, >20% shrink and duplicate snapshots roll back without deleting live data

    await db.exec(`create function fail_price_update() returns trigger language plpgsql as $$ begin
      if NEW.price = 999 then raise exception 'injected write failure'; end if; return NEW; end $$;
      create trigger fail_price_update before update on products for each row execute function fail_price_update();`);
    await assert.rejects(sync(next.map((p, i) => i === 0 ? { ...p, price: 999 } : p)), /injected write failure/);
    assert.deepEqual(await products(), after);
    assert.equal(await scalar('select count(*) from price_change_log'), 1);
    assert.equal((await status()).data_version, 2);
    assert.equal(await scalar('select count(*) from products_import'), 0);
    await db.exec('drop trigger fail_price_update on products; drop function fail_price_update();');
    // injected failure rolls back product changes, price notifications, staging and sync status together

    assert.equal(await scalar("select has_function_privilege('anon', 'public.sync_price_products(jsonb,text)', 'EXECUTE')"), false);
    assert.equal(await scalar("select has_function_privilege('authenticated', 'public.mark_price_unchanged(text)', 'EXECUTE')"), false);
    assert.equal(await scalar("select has_function_privilege('service_role', 'public.sync_price_products(jsonb,text)', 'EXECUTE')"), true);
    await role('anon', async () => {
      assert.equal((await status()).data_version, 2);
      await assert.rejects(db.exec("update public.price_sync set data_hash = 'forged' where id = 1"), /permission denied/);
      await assert.rejects(sync(next), /permission denied/);
    });
    // browser roles can read status but cannot write it or invoke Agent RPCs

    await db.exec(readFileSync(root + 'supabase/migrations/202609250001_web_products_upload.sql', 'utf8'));
    const manual = next.map((p, i) => i === 0 ? { ...p, price: 15 } : p);
    await role('anon', () => db.query('select public.upload_products_from_web($1::jsonb, false)', [JSON.stringify(manual)]));
    assert.equal((await status()).data_version, 3);
    assert.equal((await status()).data_hash, null);
    assert.equal(await scalar(`select public.mark_price_unchanged('${priceHash(next)}')`), false);
    assert.equal(await scalar('select count(*) from price_change_log'), 2);
    // existing anon web-upload RPC still works and invalidates the Agent hash

    await db.query('insert into public.products_import(barcode,sku) values ($1,$2)', ['active-upload', 'active']);
    await assert.rejects(sync(next), /upload is in progress/);
    assert.equal(await scalar('select count(*) from products_import'), 1);
    await db.exec('delete from products_import where id is not null;');
    // active CSV staging is preserved and blocks conflicting Agent writes

    await db.exec(setup);
    assert.equal((await status()).data_version, 3);
    assert.equal((await products()).length, 10);
    // rerunning setup preserves live data and status

    const queue = async () => role('anon', () => scalar('select public.request_price_refresh()'));
    const allowNext = () => db.exec("update price_sync set refresh_requested_at = clock_timestamp() - interval '11 seconds' where id = 1");
    const request1 = await queue();
    assert.equal(Number(request1), 1);
    assert.equal(Number(await queue()), 1);
    assert.equal(Number((await status()).completed_request_id), 0);
    assert.equal((await status()).data_version, 3);
    // Admin RPC queues one request; concurrent/repeated clicks reuse it without changing products

    await role('service_role', () => db.query('select public.sync_price_products($1::jsonb, $2, $3)', [JSON.stringify(manual), priceHash(manual), request1]));
    assert.equal(Number((await status()).completed_request_id), 1);
    assert.equal((await status()).data_version, 3); // Same live data, just a new Agent hash.
    assert.equal((await status()).last_request_error, null);
    assert.equal(await queue(), null); // Throttle a new request after completion.
    // completing a request with identical live data acknowledges success atomically without a data-version change; rapid new clicks are throttled

    await allowNext();
    const request2 = await queue();
    await role('service_role', () => db.query('select public.complete_price_refresh($1,$2)', [request2, 'test MSSQL unavailable']));
    assert.equal(Number((await status()).completed_request_id), 2);
    assert.equal((await status()).last_request_error, 'test MSSQL unavailable');
    assert.equal((await status()).data_version, 3);
    // MSSQL failure is durably acknowledged, preventing repeated SELECTs after restart

    await allowNext();
    const request3 = await queue();
    const beforeUnchanged = await products();
    assert.equal(await role('service_role', () => scalar(`select public.mark_price_unchanged('${priceHash(manual)}', ${request3})`)), true);
    assert.equal(Number((await status()).completed_request_id), 3);
    assert.equal((await status()).last_request_error, null);
    assert.deepEqual(await products(), beforeUnchanged);
    // an unchanged SQL report also completes the manual request and clears the previous error without touching products

    await allowNext();
    const request4 = await queue();
    const invalid = manual.map((p,i) => i === 1 ? manual[0] : p);
    await assert.rejects(role('service_role', () => db.query('select public.sync_price_products($1::jsonb,$2,$3)', [JSON.stringify(invalid), priceHash(invalid), request4])));
    assert.equal(Number((await status()).completed_request_id), 3);
    assert.deepEqual(await products(), beforeUnchanged);
    await role('service_role', () => db.query('select public.complete_price_refresh($1,$2)', [request4, 'test invalid report']));
    // a failed product transaction cannot falsely complete an Admin request successfully

    const today = await scalar("select (clock_timestamp() at time zone 'Asia/Bangkok')::date::text");
    assert.equal(await role('service_role', () => scalar(`select public.claim_price_scheduled_run('${today}')`)), true);
    assert.equal(await role('service_role', () => scalar(`select public.claim_price_scheduled_run('${today}')`)), false);
    assert.equal(await role('service_role', () => scalar("select public.claim_price_scheduled_run(((clock_timestamp() at time zone 'Asia/Bangkok')::date - 1))")), false);
    await db.exec(setup);
    assert.equal(await role('service_role', () => scalar(`select public.claim_price_scheduled_run('${today}')`)), false);
    // daily run claims persist across restart/setup and reject duplicates or stale dates

    for (const signature of ['public.sync_price_products(jsonb,text,bigint)', 'public.mark_price_unchanged(text,bigint)', 'public.complete_price_refresh(bigint,text)', 'public.claim_price_scheduled_run(date)']) {
      assert.equal(await scalar(`select has_function_privilege('anon', '${signature}', 'EXECUTE')`), false);
      assert.equal(await scalar(`select has_function_privilege('authenticated', '${signature}', 'EXECUTE')`), false);
      assert.equal(await scalar(`select has_function_privilege('service_role', '${signature}', 'EXECUTE')`), true);
    }
    await role('anon', () => assert.rejects(db.exec('update public.price_sync set completed_request_id = 999 where id = 1'), /permission denied/));
    // public clients can only request a refresh; completion, daily claims and data writes require service_role
  } finally { await db.close(); }
});
