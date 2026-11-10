/** Task เดิมเปิด Pending + Stock พร้อมกัน; แต่ละตัวล้มแล้วเปิดใหม่ได้เอง. */
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DIRECTORY = fileURLToPath(new URL('.', import.meta.url));

export function startAgents({
  directory = DIRECTORY,
  agents = ['pending-docs-agent.mjs', 'stock-agent.mjs'],
  restartDelayMs = 10_000,
  log = console.log,
} = {}) {
  const states = agents.map(file => ({ file, child: null, restart: null }));
  let stopping = false;
  let stopPromise;

  const scheduleRestart = state => {
    if (stopping) return;
    log(`[Agents] ${state.file} stopped; restarting in ${restartDelayMs / 1000}s`);
    state.restart = setTimeout(() => {
      state.restart = null;
      launch(state);
    }, restartDelayMs);
  };

  const launch = state => {
    if (stopping) return;
    try {
      // ส่ง path เป็น argument โดยตรง รองรับโฟลเดอร์ที่มีช่องว่างและไม่เปิดหน้าต่างเพิ่ม.
      const child = spawn(process.execPath, [resolve(directory, state.file)], {
        cwd: directory, stdio: 'inherit', shell: false,
      });
      state.child = child;
      log(`[Agents] Starting ${state.file}`);
      child.once('error', error => log(`[Agents] ${state.file}: ${error.message}`));
      child.once('close', () => {
        state.child = null;
        scheduleRestart(state);
      });
    } catch (error) {
      log(`[Agents] ${state.file}: ${error.message}`);
      scheduleRestart(state);
    }
  };

  states.forEach(launch);

  return {
    stop() {
      if (stopPromise) return stopPromise;
      stopping = true;
      stopPromise = Promise.all(states.map(state => {
        clearTimeout(state.restart);
        const child = state.child;
        if (!child) return;
        return new Promise(done => {
          const forceStop = setTimeout(() => child.kill('SIGKILL'), 5_000);
          child.once('close', () => { clearTimeout(forceStop); done(); });
          child.kill('SIGTERM');
        });
      }));
      return stopPromise;
    },
  };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const agents = startAgents();
  const stop = () => { void agents.stop(); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
