#!/usr/bin/env node

import { Command } from 'commander';
import { scanPort, getProcessInfo } from '../core/scanner.js';
import { setPortState, clearPortState } from '../core/state.js';
import { killProcess } from '../core/killer.js';
import { runCommand } from '../core/runner.js';
import { Watcher } from '../core/watcher.js';
import { setSilent, setVerbose, header, info, success, warn, error, processInfo } from '../utils/logger.js';
import { isWindows } from '../utils/platform.js';
import * as readline from 'readline';
import chalk from 'chalk';

const program = new Command();

let watcher = null;
let isRunning = true;
let mode = 'monitor';

function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

function cleanup() {
  if (watcher) {
    watcher.stop();
    watcher = null;
  }
  isRunning = false;
}

function drawUI(port, processes, modeName, appPid = null) {
  const modeColors = {
    monitor: chalk.cyan,
    guard: chalk.red,
    smart: chalk.green,
  };
  const modeColor = modeColors[modeName] || chalk.cyan;
  const status = processes.length > 0 ? chalk.red('IN USE') : chalk.green('FREE');
  
  process.stdout.write('\x1b[2J\x1b[0f');
  console.log(chalk.cyan('╔═══════════════════════════════════════════╗'));
  console.log(chalk.cyan('║         Port Guardian - ') + modeColor(modeName.toUpperCase().padEnd(18)) + chalk.cyan(' ║'));
  console.log(chalk.cyan('╚═══════════════════════════════════════════╝'));
  console.log();
  console.log(chalk.bold('  Port: ') + chalk.cyan(port) + chalk.bold('  |  Status: ') + status);
  console.log(chalk.gray('─'.repeat(50)));
  
  if (processes.length > 0) {
    processes.forEach((proc, idx) => {
      const isOwn = appPid && proc.pid === appPid;
      const mark = isOwn ? chalk.green('★') : chalk.red('●');
      console.log(`  ${mark} ${chalk.red(proc.pid)} - ${chalk.white(proc.name)}`);
      if (proc.command) {
        console.log(chalk.gray('    ') + proc.command.substring(0, 45));
      }
    });
  } else {
    console.log(chalk.gray('  No processes'));
  }
  
  console.log(chalk.gray('─'.repeat(50)));
  
  if (modeName === 'guard') {
    console.log(chalk.red('  [Q] Quit'));
  } else if (modeName === 'smart') {
    console.log(chalk.green('  [S] Stop app  [Q] Quit'));
  } else {
    console.log(chalk.green('  [K] Kill  [I] Ignore  [Q] Quit'));
  }
  console.log();
}

program
  .name('port-guard')
  .description('Manage, monitor, and control processes running on ports')
  .version('0.1.0')
  .argument('<port>', 'Port number to monitor')
  .option('-w, --watch', 'Enable monitoring (monitor mode)', false)
  .option('-g, --guard', 'Enable auto-kill mode (guard mode)', false)
  .option('-r, --run <command>', 'Run command with port protection (smart mode)')
  .option('-s, --silent', 'Minimal output', false)
  .option('-v, --verbose', 'Detailed output', false)
  .option('-i, --interval <ms>', 'Check interval in milliseconds', '1000')
  .action(main);

async function main(port, options) {
  const portNum = parseInt(port);
  if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
    error('Invalid port number. Must be between 1 and 65535.');
    process.exit(1);
  }

  setSilent(options.silent);
  setVerbose(options.verbose);

  if (options.run) {
    await smartMode(portNum, options);
  } else if (options.guard) {
    await guardMode(portNum, options);
  } else {
    await monitorMode(portNum, options);
  }
}

async function refreshPort(port) {
  const results = await scanPort(port);
  const processes = [];
  for (const result of results) {
    const info = await getProcessInfo(result.pid);
    processes.push({ pid: result.pid, name: info.name, command: info.command });
  }
  return processes;
}

async function monitorMode(port, options) {
  mode = 'monitor';
  let processes = await refreshPort(port);
  let lastPid = processes.length > 0 ? processes[0].pid : null;

  watcher = new Watcher(port, {
    interval: parseInt(options.interval),
    onChange: async (change) => {
      if (change.type === 'opened' && change.pid !== lastPid) {
        processes = await refreshPort(port);
        lastPid = change.pid;
      } else if (change.type === 'closed') {
        processes = [];
        lastPid = null;
      }
    },
  });

  await watcher.start();

  process.on('SIGINT', () => {
    cleanup();
    console.log(chalk.green('\n  Stopped.\n'));
    process.exit(0);
  });

  drawUI(port, processes, 'monitor');

  while (isRunning) {
    process.stdout.write(chalk.yellow('  > '));
    const cmd = (await ask('')).trim().toLowerCase();

    if (cmd === 'q' || cmd === 'quit' || cmd === 'exit') {
      cleanup();
      console.log(chalk.green('\n  Goodbye!\n'));
      break;
    } else if ((cmd === 'k' || cmd === 'kill') && processes.length > 0) {
      const proc = processes[0];
      console.log(chalk.yellow(`  Killing ${proc.pid}...`));
      const result = await killProcess(proc.pid);
      if (result.success) {
        console.log(chalk.green(`  Killed ${proc.pid}`));
        clearPortState(port);
        processes = [];
        lastPid = null;
      } else {
        console.log(chalk.red(`  Failed: ${result.error}`));
      }
      drawUI(port, processes, 'monitor');
    } else if ((cmd === 'i' || cmd === 'ignore') && processes.length > 0) {
      console.log(chalk.yellow('  Ignored'));
      clearPortState(port);
      processes = [];
      lastPid = null;
      drawUI(port, processes, 'monitor');
    } else {
      processes = await refreshPort(port);
      lastPid = processes.length > 0 ? processes[0].pid : null;
      drawUI(port, processes, 'monitor');
    }
  }
}

async function guardMode(port, options) {
  mode = 'guard';
  let processes = await refreshPort(port);

  if (processes.length > 0) {
    console.log(chalk.yellow('  Killing existing processes...'));
    for (const proc of processes) {
      await killProcess(proc.pid);
    }
    processes = [];
  }

  watcher = new Watcher(port, {
    interval: parseInt(options.interval),
    onChange: async (change) => {
      if (change.type === 'opened') {
        console.log(chalk.red(`\n  ⚠ Auto-killed ${change.pid}`));
        await killProcess(change.pid);
        processes = await refreshPort(port);
        drawUI(port, processes, 'guard');
      } else {
        processes = [];
        drawUI(port, processes, 'guard');
      }
    },
  });

  await watcher.start();

  process.on('SIGINT', () => {
    cleanup();
    console.log(chalk.green('\n  Stopped.\n'));
    process.exit(0);
  });

  drawUI(port, processes, 'guard');

  while (isRunning) {
    process.stdout.write(chalk.yellow('  > '));
    const cmd = (await ask('')).trim().toLowerCase();

    if (cmd === 'q' || cmd === 'quit' || cmd === 'exit') {
      cleanup();
      console.log(chalk.green('\n  Goodbye!\n'));
      break;
    }
    processes = await refreshPort(port);
    drawUI(port, processes, 'guard');
  }
}

async function smartMode(port, options) {
  mode = 'smart';
  const command = options.run;
  
  let processes = await refreshPort(port);
  
  if (processes.length > 0) {
    console.log(chalk.yellow('  Killing existing processes...'));
    for (const proc of processes) {
      await killProcess(proc.pid);
    }
    processes = [];
  }

  console.log(chalk.cyan('  Starting: ') + chalk.white(command) + '\n');
  
  const child = runCommand(command);
  const appPid = child.pid;
  
  console.log(chalk.green(`  Started (PID ${appPid})\n`));

  let appStarted = false;

  watcher = new Watcher(port, {
    interval: parseInt(options.interval),
    appPid,
    onChange: async (change) => {
      if (change.type === 'opened') {
        if (change.pid === appPid) appStarted = true;
        processes = await refreshPort(port);
      } else {
        if (change.pid === appPid && appStarted) {
          console.log(chalk.red('\n  ⚠ App stopped!\n'));
          appStarted = false;
        }
        processes = [];
      }
      drawUI(port, processes, 'smart', appPid);
    },
  });

  await watcher.start();

  child.on('close', (code) => {
    cleanup();
    console.log(chalk.yellow(`\n  App exited (${code})\n`));
    process.exit(0);
  });

  process.on('SIGINT', () => {
    cleanup();
    if (!isWindows && appPid) try { process.kill(-appPid, 'SIGTERM'); } catch {}
    console.log(chalk.green('\n  Stopped.\n'));
    process.exit(0);
  });

  drawUI(port, [{ pid: appPid, name: 'YOUR APP', command }], 'smart', appPid);

  while (isRunning) {
    process.stdout.write(chalk.yellow('  > '));
    const cmd = (await ask('')).trim().toLowerCase();

    if (cmd === 'q' || cmd === 'quit' || cmd === 'exit') {
      cleanup();
      if (!isWindows && appPid) try { process.kill(-appPid, 'SIGTERM'); } catch {}
      console.log(chalk.green('\n  Goodbye!\n'));
      break;
    } else if (cmd === 's' || cmd === 'stop') {
      cleanup();
      if (!isWindows && appPid) try { process.kill(-appPid, 'SIGTERM'); } catch {}
      console.log(chalk.green('\n  Stopped\n'));
      break;
    }
    processes = await refreshPort(port);
    drawUI(port, processes, 'smart', appPid);
  }
}

program.parse();
