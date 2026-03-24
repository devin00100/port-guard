#!/usr/bin/env node

import { Command } from 'commander';
import { scanPort, getProcessInfo } from '../core/scanner.js';
import { setPortState, clearPortState } from '../core/state.js';
import { killProcess } from '../core/killer.js';
import { runCommand } from '../core/runner.js';
import { Watcher } from '../core/watcher.js';
import { setSilent, setVerbose } from '../utils/logger.js';
import { isWindows } from '../utils/platform.js';
import * as readline from 'readline';
import chalk from 'chalk';

const program = new Command();
let watcher = null;
let isRunning = true;

function cleanup() {
  if (watcher) { watcher.stop(); watcher = null; }
  isRunning = false;
}

function draw(port, processes, mode, appPid = null) {
  const colors = { monitor: 'cyan', guard: 'red', smart: 'green' };
  const c = colors[mode] || 'cyan';
  console.clear();
  console.log(chalk[c](`
  ╔═══════════════════════════════════════════╗
  ║         Port Guardian - ${mode.toUpperCase().padEnd(18)}║
  ╚═══════════════════════════════════════════╝`);
  console.log(chalk.bold(`  Port: `) + chalk.cyan(port));
  console.log(chalk.bold(`  Status: `) + (processes.length > 0 ? chalk.red('IN USE') : chalk.green('FREE')));
  console.log(chalk.gray('  ─'.repeat(25)));
  if (processes.length === 0) {
    console.log(chalk.gray('  No processes'));
  } else {
    processes.forEach(proc => {
      const isApp = appPid && proc.pid === appPid;
      const icon = isApp ? '★' : '●';
      const ic = isApp ? 'green' : 'red';
      console.log(`  ${chalk[icon](icon)} ${chalk.red(proc.pid)} - ${proc.name}`);
      if (proc.command) console.log(chalk.gray(`      ${proc.command}`));
    });
  }
  console.log(chalk.gray('  ─'.repeat(25)));
  if (mode === 'guard') console.log(chalk.green('  [Q] Quit\n'));
  else if (mode === 'smart') console.log(chalk.green('  [S] Stop  [Q] Quit\n'));
  else console.log(chalk.green('  [K] Kill  [I] Ignore  [Q] Quit\n'));
}

function prompt(mode) { return mode === 'monitor' ? '  Action > ' : '  > '; }

program.name('port-guard').description('Port Guardian CLI').version('0.1.0')
  .argument('<port>', 'Port number')
  .option('-w, --watch', 'Monitor mode')
  .option('-g, --guard', 'Guard mode')
  .option('-r, --run <cmd>', 'Run command')
  .option('-i, --interval <ms>', 'Check interval', '1000')
  .action(main);

async function main(port, opts) {
  const p = parseInt(port);
  if (isNaN(p) || p < 1 || p > 65535) { console.log(chalk.red('Invalid port')); process.exit(1); }
  setSilent(opts.silent); setVerbose(opts.verbose);
  if (opts.run) await smartMode(p, opts);
  else if (opts.guard) await guardMode(p, opts);
  else await monitorMode(p, opts);
}

async function refresh(port) {
  const r = await scanPort(port);
  const procs = [];
  for (const x of r) {
    const i = await getProcessInfo(x.pid);
    procs.push({ pid: x.pid, name: i.name, command: i.command });
  }
  return procs;
}

async function monitorMode(port, opts) {
  let procs = await refresh(port);
  let lastPid = procs[0]?.pid || null;
  let mode = 'monitor';

  watcher = new Watcher(port, { interval: parseInt(opts.interval), onChange: async (ch) => {
    if (ch.type === 'opened' && ch.pid !== lastPid) { procs = await refresh(port); lastPid = ch.pid; }
    else if (ch.type === 'closed') { procs = []; lastPid = null; }
  }});
  await watcher.start();

  process.on('SIGINT', () => { cleanup(); console.log(chalk.green('\n  Stopped\n')); process.exit(0); });

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  while (isRunning) {
    draw(port, procs, mode);
    procs = await refresh(port);
    lastPid = procs[0]?.pid || null;
    rl.write(prompt(mode));
    const input = await new Promise(r => { rl.once('line', r); setTimeout(() => r(''), 800); });
    const cmd = (input || '').trim().toLowerCase();
    if (cmd === 'q' || cmd === 'quit') { cleanup(); console.log(chalk.green('\n  Bye!\n')); break; }
    else if ((cmd === 'k' || cmd === 'kill') && procs.length) { console.log(chalk.yellow(`\n  Killing ${procs[0].pid}...`)); const r = await killProcess(procs[0].pid); if (r.success) { console.log(chalk.green(`  Killed`)); clearPortState(port); procs = []; lastPid = null; } }
    else if ((cmd === 'i' || cmd === 'ignore') && procs.length) { console.log(chalk.yellow('  Ignored')); clearPortState(port); procs = []; lastPid = null; }
  }
  rl.close();
}

async function guardMode(port, opts) {
  let procs = await refresh(port);
  let mode = 'guard';
  if (procs.length) { console.log(chalk.yellow('  Killing existing...')); for (const p of procs) await killProcess(p.pid); procs = []; }

  watcher = new Watcher(port, { interval: parseInt(opts.interval), onChange: async (ch) => {
    if (ch.type === 'opened') { console.log(chalk.red(`\n  ⚠ Killed ${ch.pid}`)); await killProcess(ch.pid); procs = await refresh(port); draw(port, procs, mode); }
    else { procs = []; draw(port, procs, mode); }
  }});
  await watcher.start();
  process.on('SIGINT', () => { cleanup(); console.log(chalk.green('\n  Stopped\n')); process.exit(0); });
  draw(port, procs, mode);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  while (isRunning) { rl.write('  > '); const cmd = (await new Promise(r => rl.once('line', r))).trim().toLowerCase(); if (cmd === 'q' || cmd === 'quit') { cleanup(); break; } procs = await refresh(port); draw(port, procs, mode); }
  rl.close();
}

async function smartMode(port, opts) {
  const cmd = opts.run;
  let procs = [], mode = 'smart', appPid = null;
  if ((await refresh(port)).length) { console.log(chalk.yellow('  Killing existing...')); for (const p of await refresh(port)) await killProcess(p.pid); }
  console.log(chalk.cyan(`\n  Starting: ${cmd}\n`));
  const child = runCommand(cmd);
  appPid = child.pid;
  console.log(chalk.green(`  Started (PID ${appPid})\n`));

  watcher = new Watcher(port, { interval: parseInt(opts.interval), appPid, onChange: async (ch) => {
    if (ch.type === 'opened') { if (ch.pid === appPid) console.log(chalk.green('\n  App running')); procs = await refresh(port); }
    else { console.log(chalk.red('\n  App stopped')); procs = []; }
    draw(port, procs, mode, appPid);
  }});
  await watcher.start();
  child.on('close', (code) => { cleanup(); console.log(chalk.yellow(`\n  Exited (${code})\n`)); process.exit(0); });
  process.on('SIGINT', () => { cleanup(); if (!isWindows && appPid) try { process.kill(-appPid, 'SIGTERM'); } catch {} console.log(chalk.green('\n  Stopped\n')); process.exit(0); });
  draw(port, [{ pid: appPid, name: 'YOUR APP', command: cmd }], mode, appPid);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  while (isRunning) { rl.write('  > '); const i = (await new Promise(r => rl.once('line', r))).trim().toLowerCase(); if (i === 'q' || i === 'quit') { cleanup(); if (!isWindows && appPid) try { process.kill(-appPid, 'SIGTERM'); } catch {} break; } if (i === 's' || i === 'stop') { cleanup(); if (!isWindows && appPid) try { process.kill(-appPid, 'SIGTERM'); } catch {} break; } procs = await refresh(port); draw(port, procs, mode, appPid); }
  rl.close();
}

program.parse();
