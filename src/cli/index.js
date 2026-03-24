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
let displayNeedsRefresh = false;
let pendingResolve = null;

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

function displayStatus(port, processes, modeName, appPid = null) {
  console.clear();
  const modeColors = {
    monitor: chalk.cyan,
    guard: chalk.red,
    smart: chalk.green,
  };
  const modeColor = modeColors[modeName] || chalk.cyan;
  
  console.log(chalk.cyan('╔═══════════════════════════════════════════╗'));
  console.log(chalk.cyan('║         Port Guardian - ') + modeColor(modeName.toUpperCase().padEnd(18)) + chalk.cyan(' ║'));
  console.log(chalk.cyan('╚═══════════════════════════════════════════╝'));
  console.log();
  console.log(chalk.bold('  Port: ') + chalk.cyan(port));
  console.log(chalk.bold('  Mode: ') + modeColor(modeName));
  console.log(chalk.bold('  Status: ') + (processes.length > 0 ? chalk.red('IN USE') : chalk.green('FREE')));
  console.log(chalk.gray('─'.repeat(50)));
  
  if (processes.length > 0) {
    console.log(chalk.bold('\n  Processes on port ') + chalk.cyan(port) + chalk.bold(':'));
    processes.forEach((proc, idx) => {
      const isOwnApp = appPid && proc.pid === appPid;
      const marker = isOwnApp ? chalk.green('★') : chalk.red('●');
      console.log(chalk.gray(`  ${idx + 1}. `) + marker + ' ' + chalk.red(proc.pid) + chalk.gray(' - ') + chalk.white(proc.name));
      if (proc.command) {
        console.log(chalk.gray('     Command: ') + chalk.gray(proc.command.substring(0, 50)));
      }
    });
  } else {
    console.log(chalk.green('\n  No processes on this port'));
  }
  
  console.log(chalk.gray('─'.repeat(50)));
  
  if (modeName === 'guard') {
    console.log(chalk.red('  [A]') + ' Auto-kill   ' + chalk.green('[Q]') + ' Quit\n');
  } else if (modeName === 'smart') {
    console.log(chalk.green('  [S]') + ' Stop app    ' + chalk.green('[Q]') + ' Quit\n');
  } else {
    console.log(chalk.green('  [K]') + ' Kill   ' + chalk.green('[I]') + ' Ignore   ' + chalk.green('[Q]') + ' Quit\n');
  }
}

function displayHeader(port, modeName, command = null, appPid = null) {
  console.clear();
  const modeColors = {
    monitor: chalk.cyan,
    guard: chalk.red,
    smart: chalk.green,
  };
  const modeColor = modeColors[modeName] || chalk.cyan;
  
  console.log(chalk.cyan('╔═══════════════════════════════════════════╗'));
  console.log(chalk.cyan('║         Port Guardian - ') + modeColor(modeName.toUpperCase().padEnd(18)) + chalk.cyan(' ║'));
  console.log(chalk.cyan('╚═══════════════════════════════════════════╝'));
  console.log();
  console.log(chalk.bold('  Port: ') + chalk.cyan(port));
  console.log(chalk.bold('  Mode: ') + modeColor(modeName));
  if (command) {
    console.log(chalk.bold('  Command: ') + chalk.white(command));
  }
  if (appPid) {
    console.log(chalk.bold('  App PID: ') + chalk.green(appPid));
  }
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
    processes.push({
      pid: result.pid,
      name: info.name,
      command: info.command
    });
  }
  
  return processes;
}

async function monitorMode(port, options) {
  mode = 'monitor';
  displayHeader(port, 'monitor');
  
  let portProcesses = await refreshPort(port);
  
  if (portProcesses.length === 0) {
    console.log(chalk.green('\n  Port is free\n'));
  } else {
    console.log(chalk.red(`\n  Port is in use by ${portProcesses.length} process(es)\n`));
  }

  await runMonitorLoop(port, portProcesses, options);
}

async function runMonitorLoop(port, portProcesses, options) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let inputResolve = null;
  let lastPid = portProcesses.length > 0 ? portProcesses[0].pid : null;

  rl.on('line', (input) => {
    if (inputResolve) {
      inputResolve(input.trim().toLowerCase());
      inputResolve = null;
    }
  });

  watcher = new Watcher(port, {
    interval: parseInt(options.interval),
    onChange: async (change) => {
      if (change.type === 'opened') {
        const newPid = change.pid;
        if (newPid !== lastPid) {
          portProcesses = await refreshPort(port);
          lastPid = newPid;
          displayNeedsRefresh = true;
          if (inputResolve) {
            inputResolve('__refresh__');
            inputResolve = null;
          }
        }
      } else {
        if (lastPid !== null) {
          portProcesses = [];
          lastPid = null;
          displayNeedsRefresh = true;
          if (inputResolve) {
            inputResolve('__refresh__');
            inputResolve = null;
          }
        }
      }
    },
  });

  await watcher.start();

  process.on('SIGINT', () => {
    cleanup();
    rl.close();
    console.log(chalk.green('\n\n  Stopped. Goodbye!\n'));
    process.exit(0);
  });

  displayStatus(port, portProcesses, 'monitor');

  while (isRunning) {
    if (portProcesses.length === 0) {
      process.stdout.write(chalk.yellow('> '));
    } else {
      process.stdout.write(chalk.yellow('  Action: '));
    }
    
    const inputPromise = new Promise((resolve) => {
      inputResolve = resolve;
    });
    
    const timeoutPromise = new Promise((resolve) => {
      setTimeout(() => resolve('__timeout__'), 1000);
    });
    
    const result = await Promise.race([inputPromise, timeoutPromise]);
    
    if (result === '__timeout__') {
      if (displayNeedsRefresh) {
        displayStatus(port, portProcesses, 'monitor');
        displayNeedsRefresh = false;
      }
      continue;
    }
    
    if (result === '__refresh__') {
      displayStatus(port, portProcesses, 'monitor');
      displayNeedsRefresh = false;
      continue;
    }
    
    const cmd = result;

    if (cmd === 'q' || cmd === 'quit' || cmd === 'exit') {
      cleanup();
      rl.close();
      console.log(chalk.green('\n\n  Stopped. Goodbye!\n'));
      break;
    } else if ((cmd === 'k' || cmd === 'kill') && portProcesses.length > 0) {
      const proc = portProcesses[0];
      console.log(chalk.yellow(`\n  Killing process ${proc.pid}...`));
      const result = await killProcess(proc.pid);
      if (result.success) {
        console.log(chalk.green(`  Process ${proc.pid} killed`));
        clearPortState(port);
        portProcesses = [];
        lastPid = null;
      } else {
        console.log(chalk.red(`  Failed: ${result.error}`));
      }
      displayStatus(port, portProcesses, 'monitor');
    } else if ((cmd === 'i' || cmd === 'ignore') && portProcesses.length > 0) {
      console.log(chalk.yellow(`\n  Process ignored`));
      clearPortState(port);
      portProcesses = [];
      lastPid = null;
      displayStatus(port, portProcesses, 'monitor');
    } else {
      displayStatus(port, portProcesses, 'monitor');
    }
  }
  
  rl.close();
}

async function guardMode(port, options) {
  mode = 'guard';
  displayHeader(port, 'guard');
  
  let portProcesses = await refreshPort(port);
  
  if (portProcesses.length > 0) {
    console.log(chalk.red(`\n  Killing ${portProcesses.length} process(es)...`));
    for (const proc of portProcesses) {
      const result = await killProcess(proc.pid);
      if (result.success) {
        console.log(chalk.green(`  Killed ${proc.pid}`));
      }
    }
    portProcesses = [];
  } else {
    console.log(chalk.green('\n  Port is free\n'));
  }
  
  await runGuardLoop(port, portProcesses, options);
}

async function runGuardLoop(port, portProcesses, options) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let inputResolve = null;
  let lastProcessCount = 0;

  rl.on('line', (input) => {
    if (inputResolve) {
      inputResolve(input.trim().toLowerCase());
      inputResolve = null;
    }
  });

  watcher = new Watcher(port, {
    interval: parseInt(options.interval),
    onChange: async (change) => {
      if (change.type === 'opened') {
        console.log(chalk.red(`\n  ⚠ Auto-killed: ${change.pid}`));
        await killProcess(change.pid);
        portProcesses = await refreshPort(port);
        lastProcessCount = portProcesses.length;
      } else {
        portProcesses = [];
        lastProcessCount = 0;
      }
      displayNeedsRefresh = true;
      if (inputResolve) {
        inputResolve('__refresh__');
        inputResolve = null;
      }
    },
  });

  await watcher.start();

  process.on('SIGINT', () => {
    cleanup();
    rl.close();
    console.log(chalk.green('\n\n  Stopped. Goodbye!\n'));
    process.exit(0);
  });

  while (isRunning) {
    if (displayNeedsRefresh) {
      displayStatus(port, portProcesses, 'guard');
      displayNeedsRefresh = false;
    }
    
    process.stdout.write(chalk.yellow('  Action: '));
    
    const inputPromise = new Promise((resolve) => {
      inputResolve = resolve;
    });
    
    const timeoutPromise = new Promise((resolve) => {
      setTimeout(() => resolve('__timeout__'), 500);
    });
    
    const result = await Promise.race([inputPromise, timeoutPromise]);
    
    if (result === '__timeout__' || result === '__refresh__') {
      continue;
    }
    
    const cmd = result;

    if (cmd === 'q' || cmd === 'quit' || cmd === 'exit') {
      cleanup();
      rl.close();
      console.log(chalk.green('\n\n  Stopped. Goodbye!\n'));
      break;
    }
  }
  
  rl.close();
}

async function smartMode(port, options) {
  mode = 'smart';
  const command = options.run;
  
  displayHeader(port, 'smart', command);
  
  let portProcesses = await refreshPort(port);
  
  if (portProcesses.length > 0) {
    console.log(chalk.yellow(`\n  Killing ${portProcesses.length} process(es)...`));
    for (const proc of portProcesses) {
      await killProcess(proc.pid);
    }
    portProcesses = [];
  } else {
    console.log(chalk.green('\n  Port is free'));
  }

  console.log(chalk.cyan('\n  Starting: ') + chalk.white(command) + chalk.cyan('...\n'));
  
  const child = runCommand(command);
  const appPid = child.pid;
  
  console.log(chalk.green(`  App started (PID ${appPid})\n`));
  
  await runSmartLoop(port, portProcesses, options, command, appPid, child);
}

async function runSmartLoop(port, portProcesses, options, command, appPid, child) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let inputResolve = null;
  let appStarted = false;
  let lastProcessCount = 0;

  rl.on('line', (input) => {
    if (inputResolve) {
      inputResolve(input.trim().toLowerCase());
      inputResolve = null;
    }
  });

  watcher = new Watcher(port, {
    interval: parseInt(options.interval),
    appPid,
    onChange: async (change) => {
      if (change.type === 'opened') {
        if (change.pid === appPid) {
          appStarted = true;
        }
        portProcesses = await refreshPort(port);
        lastProcessCount = portProcesses.length;
      } else {
        if (change.pid === appPid && appStarted) {
          console.log(chalk.red('\n  ⚠ App stopped!\n'));
          appStarted = false;
        }
        portProcesses = [];
        lastProcessCount = 0;
      }
      displayNeedsRefresh = true;
      if (inputResolve) {
        inputResolve('__refresh__');
        inputResolve = null;
      }
    },
  });

  await watcher.start();

  child.on('close', (code) => {
    cleanup();
    rl.close();
    console.log(chalk.yellow(`\n  App exited (code ${code})\n`));
    process.exit(0);
  });

  process.on('SIGINT', () => {
    cleanup();
    rl.close();
    if (!isWindows && appPid) {
      try { process.kill(-appPid, 'SIGTERM'); } catch {}
    }
    console.log(chalk.green('\n\n  Stopped. Goodbye!\n'));
    process.exit(0);
  });

  while (isRunning) {
    if (displayNeedsRefresh) {
      displayStatus(port, portProcesses, 'smart', appPid);
      displayNeedsRefresh = false;
    }
    
    process.stdout.write(chalk.yellow('  Action: '));
    
    const inputPromise = new Promise((resolve) => {
      inputResolve = resolve;
    });
    
    const timeoutPromise = new Promise((resolve) => {
      setTimeout(() => resolve('__timeout__'), 500);
    });
    
    const result = await Promise.race([inputPromise, timeoutPromise]);
    
    if (result === '__timeout__' || result === '__refresh__') {
      continue;
    }
    
    const cmd = result;

    if (cmd === 'q' || cmd === 'quit' || cmd === 'exit') {
      cleanup();
      rl.close();
      if (!isWindows && appPid) {
        try { process.kill(-appPid, 'SIGTERM'); } catch {}
      }
      console.log(chalk.green('\n\n  Stopped. Goodbye!\n'));
      break;
    } else if (cmd === 's' || cmd === 'stop') {
      cleanup();
      rl.close();
      if (!isWindows && appPid) {
        try { process.kill(-appPid, 'SIGTERM'); } catch {}
      }
      console.log(chalk.green('\n  App stopped\n'));
      break;
    }
  }
  
  rl.close();
}

program.parse();
