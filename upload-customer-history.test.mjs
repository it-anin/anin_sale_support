import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSyncStatusPayload,
  calculateCutoff,
  classifyChanges,
  makeDedupeKey,
  normalizePhone,
  parseThaiDateTime,
  prepareItems,
} from './upload-customer-history.mjs';

function csvRow({
  date = '14/1/2026 18:09:21',
  sku = 'SKU-1',
  productName = 'สินค้า',
  phone = '812345678',
  firstName = 'สมชาย',
  lastName = 'ใจดี',
} = {}) {
  const row = Array(38).fill('');
  row[1] = date;
  row[23] = sku;
  row[24] = productName;
  row[35] = phone;
  row[36] = firstName;
  row[37] = lastName;
  return row;
}

test('parseThaiDateTime validates real calendar dates and time ranges', () => {
  assert.equal(parseThaiDateTime('14/1/2026 8:09:02'), '2026-01-14T08:09:02');
  assert.equal(parseThaiDateTime('29/2/2024'), '2024-02-29T00:00:00');
  assert.equal(parseThaiDateTime('29/2/2026'), null);
  assert.equal(parseThaiDateTime('14/13/2026 08:00:00'), null);
  assert.equal(parseThaiDateTime('14/1/2026 24:00:00'), null);
});

test('phone normalization removes formatting and restores a leading zero', () => {
  assert.equal(normalizePhone('81-234-5678'), '0812345678');
  assert.equal(normalizePhone(' 038-123-456 '), '038123456');
});

test('dedupe key uses phone first and falls back to customer name', () => {
  const byPhoneA = makeDedupeKey({
    phone: '081-234-5678',
    first_name: 'สมชาย',
    last_name: 'ใจดี',
    sku: ' ABC ',
    product_name: 'ชื่อเดิม',
  });
  const byPhoneB = makeDedupeKey({
    phone: '812345678',
    first_name: 'ชื่อเปลี่ยน',
    last_name: 'นามสกุลเปลี่ยน',
    sku: 'abc',
    product_name: 'ชื่อใหม่',
  });
  assert.equal(byPhoneA, byPhoneB);

  const byName = makeDedupeKey({
    phone: '',
    first_name: ' สมชาย  ',
    last_name: ' ใจดี ',
    sku: '',
    product_name: ' ยา  เอ ',
  });
  assert.equal(byName, 'f15:สมชายl12:ใจดีd13:ยา เอ');
});

test('prepareItems keeps only the latest purchase for each customer and product', () => {
  const rows = [
    Array(38).fill('header'),
    csvRow({ date: '1/1/2026 09:00:00' }),
    csvRow({ date: '3/1/2026 09:00:00', productName: 'ชื่อใหม่' }),
    csvRow({ date: '2/1/2026 09:00:00' }),
    csvRow({ date: '31/2/2026 09:00:00', sku: 'BAD' }),
  ];

  const { items, stats } = prepareItems(rows);
  assert.equal(items.length, 1);
  assert.equal(items[0].purchase_date, '2026-01-03T09:00:00');
  assert.equal(items[0].product_name, 'ชื่อใหม่');
  assert.equal(stats.validRows, 3);
  assert.equal(stats.duplicateRows, 2);
  assert.equal(stats.skippedRows, 1);
  assert.equal(stats.skipReasons.invalidDate, 1);
});

test('classifyChanges inserts new keys, updates newer rows, and skips unchanged rows', () => {
  const base = {
    phone: '0812345678',
    first_name: 'สมชาย',
    last_name: 'ใจดี',
    sku: 'A',
    product_name: 'สินค้า A',
  };
  const unchanged = { ...base, dedupe_key: 'same', purchase_date: '2026-01-01T10:00:00' };
  const newer = { ...base, sku: 'B', dedupe_key: 'newer', purchase_date: '2026-01-03T10:00:00' };
  const inserted = { ...base, sku: 'C', dedupe_key: 'missing', purchase_date: '2026-01-03T10:00:00' };

  const result = classifyChanges(
    [unchanged, newer, inserted],
    [
      { ...unchanged },
      { ...newer, purchase_date: '2026-01-02T10:00:00.000' },
    ],
  );

  assert.equal(result.inserted, 1);
  assert.equal(result.updated, 1);
  assert.equal(result.unchanged, 1);
  assert.deepEqual(result.changed.map(row => row.dedupe_key), ['newer', 'missing']);
});

test('classifyChanges applies same-date corrections but never replaces a newer purchase', () => {
  const base = {
    dedupe_key: 'same-customer-product',
    purchase_date: '2026-01-03T10:00:00',
    phone: '0812345678',
    first_name: 'สมชาย',
    last_name: 'ใจดี',
    sku: 'A',
    product_name: 'ชื่อที่แก้แล้ว',
  };

  const corrected = classifyChanges(
    [base],
    [{ ...base, purchase_date: '2026-01-03T10:00:00.000', product_name: 'ชื่อเดิม' }],
  );
  assert.equal(corrected.updated, 1);

  const older = classifyChanges(
    [{ ...base, purchase_date: '2026-01-02T10:00:00' }],
    [base],
  );
  assert.equal(older.updated, 0);
  assert.equal(older.unchanged, 1);
});

test('daily cutoff starts seven days before the latest database date', () => {
  assert.equal(calculateCutoff('2026-07-27T18:30:00', 7), '2026-07-20T00:00:00');
  assert.equal(calculateCutoff(null), null);
});

test('sync status records every successful check without changing last_changed_at unnecessarily', () => {
  const base = {
    stats: { csvRows: 100, skippedRows: 2 },
    fullScan: false,
    latestPurchaseDate: '2026-07-27T20:58:32',
    checkedAt: '2026-07-27T16:44:57.000Z',
  };
  const unchanged = buildSyncStatusPayload({
    ...base,
    result: { candidateRows: 10, inserted: 0, updated: 0, unchanged: 10 },
  });
  assert.equal(unchanged.last_checked_at, base.checkedAt);
  assert.equal(Object.hasOwn(unchanged, 'last_changed_at'), false);

  const changed = buildSyncStatusPayload({
    ...base,
    result: { candidateRows: 10, inserted: 2, updated: 1, unchanged: 7 },
  });
  assert.equal(changed.last_changed_at, base.checkedAt);
});
