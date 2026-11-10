import test from 'node:test';
import assert from 'node:assert/strict';
import { planAgentCleanup, repairAgents } from './repair-promaxx-agents.mjs';

const p = (id, parentId, name, role = '') => ({ id, parentId, name, role, started: '2026-11-06T10:00:00.000Z' });
function fixture() {
  return [
    p(1, 0, 'explorer.exe'), p(900, 1, 'powershell.exe'), p(999, 900, 'node.exe'),
    p(20184, 1, 'cmd.exe'), p(20384, 20184, 'node.exe', 'pending-docs-agent'),
    p(27140, 1, 'cmd.exe'), p(17772, 27140, 'node.exe'),
    p(55780, 1, 'cmd.exe'), p(56888, 55780, 'node.exe', 'promaxx-agents'),
    p(54512, 56888, 'node.exe', 'pending-docs-agent'), p(33568, 56888, 'node.exe', 'stock-agent'),
    p(17664, 1, 'cmd.exe'), p(56904, 17664, 'node.exe', 'promaxx-agents'),
    p(52316, 56904, 'node.exe', 'pending-docs-agent'), p(55444, 56904, 'node.exe', 'stock-agent'),
    p(56204, 1, 'cmd.exe'), p(53252, 56204, 'node.exe', 'promaxx-agents'),
    p(55320, 53252, 'node.exe', 'pending-docs-agent'), p(49060, 53252, 'node.exe', 'stock-agent'),
    p(13136, 1, 'cmd.exe'), p(26952, 13136, 'node.exe', 'promaxx-agents'),
    p(12868, 26952, 'node.exe', 'pending-docs-agent'), p(34904, 26952, 'node.exe', 'stock-agent'),
  ];
}

test('วางแผนจากรายการจริง เลือกเฉพาะ wrapper ของ Agent และคง Other 17772/terminal ไว้', () => {
  const plan = planAgentCleanup(fixture(), 999);
  assert.deepEqual(plan.counts, { 'promaxx-agents': 4, 'pending-docs-agent': 5, 'stock-agent': 4 });
  assert.deepEqual(plan.wrappers.map(p => p.id).sort((a, b) => a - b), [13136, 17664, 20184, 55780, 56204]);
  assert(!plan.agents.some(p => [17772, 999].includes(p.id)));
});

test('ไม่ปิด wrapper ที่มีโปรแกรมอื่นหรือเป็น terminal ที่ใช้รันตัวซ่อม', () => {
  assert.throws(() => planAgentCleanup([...fixture(), p(888, 55780, 'node.exe')], 999), /another program/);
  const sameTerminal = fixture().map(p => p.id === 900 ? { ...p, parentId: 55780 } : p);
  assert.throws(() => planAgentCleanup(sameTerminal, 999), /repair terminal/);
});

test('เก็บ wrapper ที่เหลือเฉพาะ ping รอเปิดใหม่ และไม่ตาม PID ที่ถูกนำกลับมาใช้ใหม่', () => {
  const before = planAgentCleanup(fixture(), 999);
  const after = fixture().filter(p => !['node.exe'].includes(p.name) || [17772, 999].includes(p.id));
  after.push({ ...p(50000, 55780, 'ping.exe'), loopbackPing: true });
  assert(planAgentCleanup(after, 999, before.wrappers).wrappers.some(p => p.id === 55780));
  const reused = after.map(p => p.id === 55780 ? { ...p, started: 'new-process' } : p);
  assert(!planAgentCleanup(reused, 999, before.wrappers).wrappers.some(p => p.id === 55780));
});

test('ไม่ปิด CMD ที่รับ PID ของ parent เก่ามาใช้ใหม่ภายหลัง Agent เริ่มแล้ว', () => {
  const reused = fixture().map(p => p.id === 55780 ? { ...p, started: '2026-11-06T11:00:00.000Z' } : p);
  const plan = planAgentCleanup(reused, 999);
  assert(!plan.wrappers.some(p => p.id === 55780));
  assert(plan.agents.some(p => p.id === 56888));
});

function fakeAdapter({ failKill = false } = {}) {
  let processes = fixture();
  const events = [];
  const removeTree = id => {
    const ids = new Set([id]);
    let size;
    do { size = ids.size; for (const p of processes) if (ids.has(p.parentId)) ids.add(p.id); } while (size !== ids.size);
    processes = processes.filter(p => !ids.has(p.id));
  };
  return {
    events,
    readTask: async () => ({ admin: true, combinedAction: true, multipleInstances: 'IgnoreNew' }),
    readProcesses: async () => structuredClone(processes),
    stopTask: async () => { events.push('stop-task'); removeTree(13136); },
    killTree: async record => { if (failKill) throw new Error('access denied'); events.push(`kill-tree:${record.id}`); removeTree(record.id); },
    killProcess: async record => { events.push(`kill:${record.id}`); processes = processes.filter(p => p.id !== record.id); },
    startTask: async () => {
      events.push('start-task');
      processes.push(p(60000, 1, 'cmd.exe'), p(60001, 60000, 'node.exe', 'promaxx-agents'),
        p(60002, 60001, 'node.exe', 'pending-docs-agent'), p(60003, 60001, 'node.exe', 'stock-agent'));
    },
    wait: async () => {},
  };
}

test('preview อ่านอย่างเดียว; apply หยุดต้นทาง ล้างส่วนเกิน เปิด Task ครั้งเดียว และเก็บ Other ไว้', async () => {
  const adapter = fakeAdapter();
  await repairAgents(adapter, { selfId: 999, log: () => {} });
  assert.deepEqual(adapter.events, []);
  const after = await repairAgents(adapter, { apply: true, selfId: 999, log: () => {} });
  assert.deepEqual(after, { 'promaxx-agents': 1, 'pending-docs-agent': 1, 'stock-agent': 1 });
  assert.equal(adapter.events[0], 'stop-task');
  assert.equal(adapter.events.filter(e => e === 'start-task').length, 1);
  assert((await adapter.readProcesses()).some(p => p.id === 17772));
  assert((await adapter.readProcesses()).some(p => p.id === 999));
});

test('หาก cleanup ล้มเหลว เปิด Task เดิมกลับ; สิทธิ์/Task ผิดต้องไม่เปลี่ยนโปรเซส', async () => {
  const adapter = fakeAdapter({ failKill: true });
  await assert.rejects(repairAgents(adapter, { apply: true, selfId: 999, log: () => {} }), /access denied/);
  assert.equal(adapter.events.at(-1), 'start-task');
  for (const task of [
    { admin: false, combinedAction: true, multipleInstances: 'IgnoreNew' },
    { admin: true, combinedAction: false, multipleInstances: 'IgnoreNew' },
    { admin: true, combinedAction: true, multipleInstances: 'Parallel' },
  ]) {
    const unsafe = fakeAdapter(); unsafe.readTask = async () => task;
    await assert.rejects(repairAgents(unsafe, { apply: true, selfId: 999, log: () => {} }));
    assert.deepEqual(unsafe.events, []);
  }
});
