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
  const title = 'Port Guardian - ' + mode.toUpperCase().padEnd(18);
  
  console.clear();
  
  console.log(chalk[c]('\n  ╔═══════════════════════════════════════════╗'));
  console.log(chalk[c]('  ║         ' + title + '║'));
  console.log(chalk[c]('  ╚═══════════════════════════════════════════╝'));
  console.log(chalk.bold('  Port: ') + chalk.cyan(port));
  console.log(chalk.bold('  Status: ') + (processes.length > 0 ? chalk.red('IN USE') : chalk.green('FREE')));
  console.log(chalk.gray('  ─'.repeat(25)));
  if (processes.length === 0) {
    console.log(chalk.gray('  No processes'));
  } else {
    processes.forEach(proc => {
      const isApp = appPid && proc.pid === appPid;
      const icon = isApp ? '★' : '●';
      const ic = isApp ? 'green' : 'red';
      console.log('  ' + chalk[ic](icon) + ' ' + chalk.red(proc.pid) + ' - ' + proc.name);
      if (proc.command) console.log(chalk.gray('      ' + proc.command));
    });
  }
  console.log(chalk.gray('  ─'.repeat(25)));
  if (mode === 'guard') console.log(chalk.green('  [Q] Quit\n'));
  else if (mode === 'smart') console.log(chalk.green('  [S] Stop  [Q] Quit\n'));
  else console.log(chalk.green('  [K] Kill  [Q] Quit\n'));
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
  let mode = 'monitor';

  watcher = new Watcher(port, { interval: parseInt(opts.interval), onChange: async (ch) => {
    if (ch.type === 'opened') {
      procs = await refresh(port);
      console.clear();
      draw(port, procs, mode);
    }
    else if (ch.type === 'closed') { procs = []; console.clear(); draw(port, procs, mode); }
  }});
  await watcher.start();

  process.on('SIGINT', () => { cleanup(); console.log(chalk.green('\n  Stopped\n')); process.exit(0); });

  draw(port, procs, mode);
  
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  
  rl.setPrompt(prompt(mode));
  rl.prompt();
  
  rl.on('line', async (input) => {
    const cmd = (input || '').trim().toLowerCase();

    if (cmd === 'q' || cmd === 'quit') {
      cleanup();
      console.log(chalk.green('\n  Bye!\n'));
      rl.close();
      process.exit(0);
    } else if ((cmd === 'k' || cmd === 'kill') && procs.length) {
      console.log(chalk.yellow('\n  Killing ' + procs[0].pid + '...'));
      const r = await killProcess(procs[0].pid);
      if (r.success) {
        console.log(chalk.green('  Killed\n'));
        clearPortState(port);
        procs = [];
        draw(port, procs, mode);
      } else {
        console.log(chalk.red('  Failed: ' + (r.error || 'Unknown error') + '\n'));
      }
    }
    rl.prompt();
  });
  
  rl.on('close', () => {
    cleanup();
    process.exit(0);
  });
}

async function guardMode(port, opts) {
  let procs = await refresh(port);
  let mode = 'guard';
  if (procs.length) { console.log(chalk.yellow('  Killing existing...')); for (const p of procs) await killProcess(p.pid); procs = []; }

  watcher = new Watcher(port, { interval: parseInt(opts.interval), onChange: async (ch) => {
    if (ch.type === 'opened') { 
      console.log(chalk.red('\n  ⚠ Killed ' + ch.pid)); 
      await killProcess(ch.pid); 
      procs = await refresh(port); 
      console.clear();
      draw(port, procs, mode);
    }
    else { procs = []; console.clear(); draw(port, procs, mode); }
  }});
  await watcher.start();
  process.on('SIGINT', () => { cleanup(); console.log(chalk.green('\n  Stopped\n')); process.exit(0); });

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  draw(port, procs, mode);
    
  rl.setPrompt('  > ');
  rl.prompt();
  
  rl.on('line', (input) => {
    const cmd = (input || '').trim().toLowerCase();
    if (cmd === 'q' || cmd === 'quit') { 
      cleanup(); 
      rl.close();
      process.exit(0); 
    }
    rl.prompt();
  });
  
  rl.on('close', () => {
    cleanup();
    process.exit(0);
  });
}

async function smartMode(port, opts) {
  const cmd = opts.run;
  let procs = [], mode = 'smart', appPid = null;
  if ((await refresh(port)).length) { console.log(chalk.yellow('  Killing existing...')); for (const p of await refresh(port)) await killProcess(p.pid); }
  console.log(chalk.cyan('\n  Starting: ' + cmd + '\n'));
  const child = runCommand(cmd);
  appPid = child.pid;
  console.log(chalk.green('  Started (PID ' + appPid + ')\n'));

  watcher = new Watcher(port, { interval: parseInt(opts.interval), appPid, onChange: async (ch) => {
    if (ch.type === 'opened') { 
      if (ch.pid === appPid) console.log(chalk.green('\n  App running')); 
      procs = await refresh(port); 
      console.clear();
      draw(port, procs, mode, appPid);
    }
    else { console.log(chalk.red('\n  App stopped')); procs = []; console.clear(); draw(port, procs, mode, appPid); }
  }});
  await watcher.start();
  child.on('close', (code) => { cleanup(); console.log(chalk.yellow('\n  Exited (' + code + ')\n')); process.exit(0); });
  process.on('SIGINT', () => { cleanup(); if (!isWindows && appPid) try { process.kill(-appPid, 'SIGTERM'); } catch {} console.log(chalk.green('\n  Stopped\n')); process.exit(0); });
  
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  
  procs = [{ pid: appPid, name: 'YOUR APP', command: cmd }];
  
  draw(port, procs, mode, appPid);
  
  rl.setPrompt('  > ');
  rl.prompt();
  
  rl.on('line', (input) => {
    const i = (input || '').trim().toLowerCase();
    if (i === 'q' || i === 'quit') { 
      cleanup(); 
      if (!isWindows && appPid) try { process.kill(-appPid, 'SIGTERM'); } catch {} 
      rl.close();
      process.exit(0);
    } 
    if (i === 's' || i === 'stop') { 
      cleanup(); 
      if (!isWindows && appPid) try { process.kill(-appPid, 'SIGTERM'); } catch {} 
      rl.close();
      process.exit(0);
    }
    rl.prompt();
  });
  
  rl.on('close', () => {
    cleanup();
    process.exit(0);
  });
}

program.parse();
