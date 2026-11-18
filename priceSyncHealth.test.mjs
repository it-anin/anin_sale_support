import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { transformWithEsbuild } from 'vite';

// โมดูลนี้ไม่ import อะไร จึงโหลดผ่าน data: URL ได้ (รูปแบบเดียวกับ priceCache.test.mjs)
const path = fileURLToPath(new URL('./priceSyncHealth.ts', import.meta.url));
const { code } = await transformWithEsbuild(readFileSync(path, 'utf8'), path, { loader: 'ts' });
const {
  PRICE_CHECK_STALE_MS, evaluatePriceSync, samePriceSyncProblem, describePriceSyncProblem,
} = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

const HOUR = 60 * 60 * 1000;
const NOW = Date.parse('2026-11-18T03:00:00Z');
const ago = ms => new Date(NOW - ms).toISOString();

test('no status row means nothing to warn about (setup not installed or still loading)', () => {
  assert.equal(evaluatePriceSync(null, NOW), null);
  assert.equal(evaluatePriceSync(undefined, NOW), null);
});

test('a recent successful check without an error is healthy', () => {
  assert.equal(evaluatePriceSync({ last_checked_at: ago(3 * HOUR), last_error: null }, NOW), null);
  assert.equal(evaluatePriceSync({ last_checked_at: ago(0) }, NOW), null);
});

test('a failed latest run warns, even when the previous check was recent', () => {
  const failedAt = ago(HOUR);
  const problem = evaluatePriceSync({
    last_checked_at: ago(2 * HOUR), last_error: 'อ่านข้อมูลราคาจาก MSSQL ไม่สำเร็จ ดู log ที่เครื่อง Agent', last_error_at: failedAt,
  }, NOW);
  assert.deepEqual(problem, { kind: 'error', since: failedAt });
});

test('an error takes precedence over staleness', () => {
  const problem = evaluatePriceSync({ last_checked_at: ago(100 * HOUR), last_error: 'x', last_error_at: ago(HOUR) }, NOW);
  assert.equal(problem.kind, 'error');
});

test('blank or whitespace-only last_error is not a failure (cleared by the next success)', () => {
  assert.equal(evaluatePriceSync({ last_checked_at: ago(HOUR), last_error: '' }, NOW), null);
  assert.equal(evaluatePriceSync({ last_checked_at: ago(HOUR), last_error: '   ' }, NOW), null);
});

test('an error without a valid timestamp still warns, with since = null', () => {
  assert.deepEqual(evaluatePriceSync({ last_error: 'x', last_error_at: null }, NOW), { kind: 'error', since: null });
  assert.deepEqual(evaluatePriceSync({ last_error: 'x', last_error_at: 'not a date' }, NOW), { kind: 'error', since: null });
});

test('"over one day" is 25 hours: 1 hour of grace so the 08:00 run in progress does not trigger a false alarm', () => {
  assert.equal(PRICE_CHECK_STALE_MS, 25 * HOUR);
  // วันถัดไป 08:00:03 ขณะรอบใหม่ยังไม่เสร็จ (เกิน 24 ชม. เล็กน้อย) ต้องไม่เตือน
  assert.equal(evaluatePriceSync({ last_checked_at: ago(24 * HOUR + 3_000) }, NOW), null);
  assert.equal(evaluatePriceSync({ last_checked_at: ago(25 * HOUR) }, NOW), null);        // เท่ากับกำหนด ยังไม่เกิน
  const stale = evaluatePriceSync({ last_checked_at: ago(25 * HOUR + 1) }, NOW);
  assert.deepEqual(stale, { kind: 'stale', since: ago(25 * HOUR + 1) });
});

test('a missed 08:00 round shows up the next morning (~09:00), a missed week stays flagged', () => {
  assert.equal(evaluatePriceSync({ last_checked_at: ago(26 * HOUR) }, NOW)?.kind, 'stale');
  assert.equal(evaluatePriceSync({ last_checked_at: ago(7 * 24 * HOUR) }, NOW)?.kind, 'stale');
});

test('never checked (null/missing/blank/invalid) is flagged as stale with since = null', () => {
  for (const value of [null, undefined, '', 'garbage']) {
    assert.deepEqual(evaluatePriceSync({ last_checked_at: value }, NOW), { kind: 'stale', since: null });
  }
  assert.deepEqual(evaluatePriceSync({}, NOW), { kind: 'stale', since: null });
});

test('a timestamp in the future (client clock behind) is never stale', () => {
  assert.equal(evaluatePriceSync({ last_checked_at: new Date(NOW + 5 * HOUR).toISOString() }, NOW), null);
});

test('defaults to the current time when now is omitted', () => {
  assert.equal(evaluatePriceSync({ last_checked_at: new Date().toISOString() }), null);
  assert.equal(evaluatePriceSync({ last_checked_at: new Date(Date.now() - 30 * HOUR).toISOString() })?.kind, 'stale');
});

test('samePriceSyncProblem lets the hook skip re-renders when nothing changed', () => {
  const a = { kind: 'stale', since: ago(30 * HOUR) };
  assert.equal(samePriceSyncProblem(null, null), true);
  assert.equal(samePriceSyncProblem(a, a), true);
  assert.equal(samePriceSyncProblem(a, { ...a }), true);
  assert.equal(samePriceSyncProblem(a, null), false);
  assert.equal(samePriceSyncProblem(null, a), false);
  assert.equal(samePriceSyncProblem(a, { ...a, kind: 'error' }), false);
  assert.equal(samePriceSyncProblem(a, { ...a, since: ago(31 * HOUR) }), false);
});

test('tooltip text: failed run shows the time in Asia/Bangkok and tells staff what to do', () => {
  const text = describePriceSyncProblem({ kind: 'error', since: '2026-11-18T01:00:01Z' }, NOW);
  assert.match(text, /ล้มเหลว/);
  assert.match(text, /08:00/);            // 01:00 UTC = 08:00 เวลาไทย
  assert.match(text, /แจ้งผู้ดูแลระบบ/);
  assert.doesNotMatch(describePriceSyncProblem({ kind: 'error', since: null }, NOW), /\(\)/);
});

test('tooltip text: stale shows whole days (or hours) and the last good check', () => {
  const twoDays = describePriceSyncProblem({ kind: 'stale', since: ago(2 * 24 * HOUR + 3 * HOUR) }, NOW);
  assert.match(twoDays, /ไม่ได้ตรวจราคามาแล้ว 2 วัน/);
  assert.match(describePriceSyncProblem({ kind: 'stale', since: ago(25 * HOUR + 1) }, NOW), /แล้ว 1 วัน/);
  assert.match(describePriceSyncProblem({ kind: 'stale', since: ago(3 * HOUR) }, NOW), /แล้ว 3 ชั่วโมง/);
  assert.match(describePriceSyncProblem({ kind: 'stale', since: null }, NOW), /ยังไม่เคยตรวจราคาสำเร็จ/);
});
