import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startAgents } from './promaxx-agents.mjs';

const delay = ms => new Promise(done => setTimeout(done, ms));
const readStarts = directory => {
  try { return readFileSync(join(directory, 'starts.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse); }
  catch { return []; }
};
async function waitFor(check) {
  const deadline = Date.now() + 5_000;
  while (!check()) {
    assert(Date.now() < deadline, 'child process did not reach expected state');
    await delay(20);
  }
}
function writeAgent(directory, filename, crashFirst = false) {
  writeFileSync(join(directory, filename), `
    import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
    appendFileSync(new URL('./starts.jsonl', import.meta.url), JSON.stringify({file: ${JSON.stringify(filename)}, pid: process.pid})+'\\n');
    const marker = new URL('./crashed', import.meta.url);
    if (${crashFirst} && !existsSync(marker)) { writeFileSync(marker, '1'); process.exit(2); }
    setInterval(() => {}, 1000);
  `);
}

test('Task เดียวเปิดทั้งคู่ และ Stock ล้มแล้วเปิดใหม่โดยไม่รีสตาร์ท Pending', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'promaxx agents '));
  const pending = 'pending test.mjs';
  const stock = 'stock test.mjs';
  writeAgent(directory, pending);
  writeAgent(directory, stock, true);
  const runner = startAgents({ directory, agents: [pending, stock], restartDelayMs: 25, log: () => {} });
  let starts;
  try {
    await waitFor(() => readStarts(directory).filter(row => row.file === stock).length === 2);
    starts = readStarts(directory);
    assert.equal(starts.filter(row => row.file === pending).length, 1);
    assert.equal(starts.filter(row => row.file === stock).length, 2);
  } finally {
    await Promise.all([runner.stop(), runner.stop()]);
    // ลูกทุกตัวปิดตามตัวควบคุม ไม่มี Agent ที่ทำงานต่อหลังปิด Task แบบปกติ.
    for (const row of readStarts(directory)) assert.throws(() => process.kill(row.pid, 0), { code: 'ESRCH' });
    rmSync(directory, { recursive: true, force: true });
  }
});

test('ปิด Task ระหว่างรอเปิดใหม่ ยกเลิกการเปิด Agent ซ้ำ', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'promaxx stop '));
  writeAgent(directory, 'crash.mjs', true);
  let restartScheduled = false;
  const runner = startAgents({
    directory, agents: ['crash.mjs'], restartDelayMs: 100,
    log: line => { if (line.includes('restarting')) restartScheduled = true; },
  });
  try {
    await waitFor(() => restartScheduled);
    await runner.stop();
    await delay(200);
    assert.equal(readStarts(directory).length, 1);
  } finally {
    await runner.stop();
    rmSync(directory, { recursive: true, force: true });
  }
});
