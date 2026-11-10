/** Windows: reset only the Pending/Stock agents belonging to the existing combined task. */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const AGENT_ROLES = new Set(['promaxx-agents', 'pending-docs-agent', 'stock-agent']);
const isAgent = p => p.name?.toLowerCase() === 'node.exe' && AGENT_ROLES.has(p.role);
const countAgents = processes => Object.fromEntries([...AGENT_ROLES].map(role => [role, processes.filter(p => isAgent(p) && p.role === role).length]));
const isCurrentParent = (parent, child) => Number.isFinite(Date.parse(parent.started))
  && Number.isFinite(Date.parse(child.started)) && Date.parse(parent.started) <= Date.parse(child.started);

function descendants(processes, root) {
  const found = new Set([root]);
  let previous;
  do {
    previous = found.size;
    for (const p of processes) if (found.has(p.parentId)) found.add(p.id);
  } while (found.size !== previous);
  return processes.filter(p => found.has(p.id) && p.id !== root);
}

export function planAgentCleanup(processes, selfId, previousWrappers = []) {
  const byId = new Map(processes.map(p => [p.id, p]));
  const protectedIds = new Set([selfId]);
  let parent = byId.get(selfId)?.parentId;
  while (parent && !protectedIds.has(parent)) {
    protectedIds.add(parent);
    parent = byId.get(parent)?.parentId;
  }
  if (processes.some(p => p.ambiguousAgent)) throw new Error('An agent command uses extra Node options. Review that process manually before cleanup.');
  const agents = processes.filter(isAgent);
  const wrappers = new Map();
  for (const p of agents) {
    const owner = byId.get(p.parentId);
    // ParentProcessId can refer to a different process after Windows reuses that PID.
    if (owner?.name.toLowerCase() === 'cmd.exe' && isCurrentParent(owner, p)) wrappers.set(owner.id, owner);
  }
  for (const old of previousWrappers) {
    const current = byId.get(old.id);
    if (current?.started === old.started && current.name.toLowerCase() === 'cmd.exe') wrappers.set(current.id, current);
  }
  for (const wrapper of wrappers.values()) {
    const tree = descendants(processes, wrapper.id);
    if (protectedIds.has(wrapper.id) || tree.some(p => protectedIds.has(p.id))) {
      throw new Error(`Agent wrapper PID ${wrapper.id} owns this repair terminal. Open a separate Administrator PowerShell window.`);
    }
    const unsafe = tree.find(p => !isAgent(p)
      && !wrappers.has(p.id)
      && p.name.toLowerCase() !== 'conhost.exe'
      && !(p.name.toLowerCase() === 'ping.exe' && p.loopbackPing));
    if (unsafe) throw new Error(`Wrapper PID ${wrapper.id} also contains another program (PID ${unsafe.id}). Close that agent window manually.`);
  }
  return { agents, wrappers: [...wrappers.values()], counts: countAgents(processes) };
}

function validateTask(task) {
  if (!task.admin) throw new Error('Open PowerShell with Run as administrator, then run this command again.');
  if (!task.combinedAction) throw new Error('This task must run run-pending-docs-agent.bat or promaxx-agents.mjs. No processes were changed.');
  if (!['IgnoreNew', '2'].includes(String(task.multipleInstances))) throw new Error('Set the existing task to Do not start a new instance before running this repair.');
}

export async function repairAgents(adapter, { apply = false, selfId = process.pid, log = console.log } = {}) {
  validateTask(await adapter.readTask());
  const before = planAgentCleanup(await adapter.readProcesses(), selfId);
  log(`Found: ${JSON.stringify(before.counts)}`);
  log(`Agent command wrappers: ${before.wrappers.map(p => p.id).join(', ') || 'none'}`);
  if (!apply) { log('Preview only. Add --apply to stop the old agents and start the existing task once.'); return before; }

  let taskStopped = false;
  let taskRestarted = false;
  try {
    await adapter.stopTask();
    taskStopped = true;
    await adapter.wait(800);
    const stopped = planAgentCleanup(await adapter.readProcesses(), selfId, before.wrappers);
    // Stop .bat hosts first so their restart loops cannot recreate the Node processes.
    for (const wrapper of stopped.wrappers) {
      const fresh = planAgentCleanup(await adapter.readProcesses(), selfId, [wrapper]);
      const target = fresh.wrappers.find(p => p.id === wrapper.id && p.started === wrapper.started);
      if (target) { await adapter.killTree(target); log(`Closed agent wrapper PID ${target.id}`); }
    }
    const agents = planAgentCleanup(await adapter.readProcesses(), selfId).agents
      .sort((a, b) => Number(b.role === 'promaxx-agents') - Number(a.role === 'promaxx-agents'));
    for (const old of agents) {
      const current = (await adapter.readProcesses()).find(p => p.id === old.id && p.started === old.started && isAgent(p));
      if (current) { await adapter.killProcess(current); log(`Stopped ${current.role} PID ${current.id}`); }
    }
    if ((await adapter.readProcesses()).some(isAgent)) throw new Error('An agent restarted during cleanup. Close the manual .bat window and retry.');
    await adapter.startTask();
    taskRestarted = true;
    log('Existing combined task started. Waiting for both agents...');
    await adapter.wait(12_000);
    const running = await adapter.readProcesses();
    const after = countAgents(running);
    log(`Now: ${JSON.stringify(after)}`);
    for (const p of running.filter(isAgent)) log(`${p.role}: PID ${p.id}`);
    if (Object.values(after).some(n => n !== 1)) throw new Error('The expected result is one launcher, one Pending, and one Stock. Send this output for review.');
    log('OK: one launcher + one Pending + one Stock.');
    return after;
  } finally {
    if (taskStopped && !taskRestarted) {
      log('Cleanup did not complete. Restoring the existing task so Pending can run.');
      await adapter.startTask();
    }
  }
}

function windowsAdapter(taskName, taskPath) {
  const env = { ...process.env, ANIN_REPAIR_TASK_NAME: taskName, ANIN_REPAIR_TASK_PATH: taskPath };
  const ps = script => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    "$ErrorActionPreference = 'Stop'; [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); " + script],
    { env, encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024, timeout: 30_000 }).trim();
  const readProcesses = () => JSON.parse(ps(`
    $rows = @(Get-CimInstance Win32_Process | ForEach-Object {
      $p = $_; $role = ''; $ambiguous = $false
      if ($p.Name -eq 'node.exe') {
        if ($p.CommandLine -match '^\\s*(?:"[^"]*"|\\S+)\\s+(?:"(?<main>[^"]+)"|(?<main>\\S+))') {
          $main = [IO.Path]::GetFileName($Matches.main)
          if ($main -match '^(promaxx-agents|pending-docs-agent|stock-agent)\\.mjs$') { $role = $Matches[1] }
        }
        if (!$role -and $p.CommandLine -match '(?:^|[\\\\/\\s"])(?:promaxx-agents|pending-docs-agent|stock-agent)\\.mjs(?:\\s|"|$)') { $ambiguous = $true }
      }
      [pscustomobject]@{
        id = [int]$p.ProcessId; parentId = [int]$p.ParentProcessId; name = $p.Name
        role = $role; ambiguousAgent = $ambiguous
        started = $(if ($p.CreationDate) { $p.CreationDate.ToUniversalTime().ToString('o') } else { '' })
        loopbackPing = ($p.Name -eq 'ping.exe' -and $p.CommandLine -match '(?:^|\\s)127\\.0\\.0\\.1(?:\\s|$)')
      }
    }); ConvertTo-Json -InputObject $rows -Depth 3 -Compress
  `));
  const kill = (record, tree) => {
    if (!record.started) throw new Error(`Cannot verify the identity of PID ${record.id}. No process was stopped.`);
    const live = readProcesses().find(p => p.id === record.id);
    if (!live || live.started !== record.started || live.name.toLowerCase() !== record.name.toLowerCase()) return;
    try { execFileSync('taskkill.exe', ['/PID', String(record.id), ...(tree ? ['/T'] : []), '/F'], { encoding: 'utf8', windowsHide: true, timeout: 15_000 }); }
    catch (error) { if (readProcesses().some(p => p.id === record.id && p.started === record.started)) throw error; }
  };
  return {
    readProcesses,
    readTask: () => JSON.parse(ps(`
      $t = Get-ScheduledTask -TaskName $env:ANIN_REPAIR_TASK_NAME -TaskPath $env:ANIN_REPAIR_TASK_PATH
      $a = ($t.Actions | ForEach-Object { $_.Execute + ' ' + $_.Arguments }) -join ' '
      [pscustomobject]@{
        admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
        combinedAction = ($a -match 'run-pending-docs-agent\\.bat|promaxx-agents\\.mjs')
        multipleInstances = $t.Settings.MultipleInstances.ToString()
      } | ConvertTo-Json -Compress
    `)),
    stopTask: () => ps('Stop-ScheduledTask -TaskName $env:ANIN_REPAIR_TASK_NAME -TaskPath $env:ANIN_REPAIR_TASK_PATH'),
    startTask: () => ps('Start-ScheduledTask -TaskName $env:ANIN_REPAIR_TASK_NAME -TaskPath $env:ANIN_REPAIR_TASK_PATH'),
    killTree: record => kill(record, true),
    killProcess: record => kill(record, false),
    wait: ms => new Promise(done => setTimeout(done, ms)),
  };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.platform !== 'win32') { console.error('Run this repair on the Windows computer that runs the agents.'); process.exitCode = 1; }
  else {
    const args = process.argv.slice(2);
    const taskIndex = args.indexOf('--task');
    const taskName = taskIndex >= 0 ? args[taskIndex + 1] : 'ANIN Pending Docs Agent';
    if (!taskName) throw new Error('Missing task name after --task');
    repairAgents(windowsAdapter(taskName, '\\'), { apply: args.includes('--apply') })
      .catch(error => { console.error(`ERROR: ${error.message}`); process.exitCode = 1; });
  }
}
