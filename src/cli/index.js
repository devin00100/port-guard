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
let lastProcessCount = 0;

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
    console.log(chalk.red('  [A]') + ' Auto-kill   ' + chalk.green('[R]') + ' Refresh   ' + chalk.green('[Q]') + ' Quit\n');
  } else if (modeName === 'smart') {
    console.log(chalk.green('  [S]') + ' Stop app    ' + chalk.green('[R]') + ' Refresh   ' + chalk.green('[Q]') + ' Quit\n');
  } else {
    console.log(chalk.green('  [K]') + ' Kill process   ' + chalk.green('[I]') + ' Ignore   ' + chalk.green('[R]') + ' Refresh   ' + chalk.green('[Q]') + ' Quit\n');
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
  watcher = new Watcher(port, {
    interval: parseInt(options.interval),
    onChange: async (change) => {
      if (change.type === 'opened') {
        portProcesses = await refreshPort(port);
      } else {
        portProcesses = [];
      }
    },
  });

  await watcher.start();

  process.on('SIGINT', () => {
    cleanup();
    console.log(chalk.green('\n\n  Stopped monitoring. Goodbye!\n'));
    process.exit(0);
  });

  while (isRunning) {
    displayStatus(port, portProcesses, 'monitor');
    
    if (portProcesses.length === 0) {
      process.stdout.write(chalk.yellow('> '));
    } else {
      process.stdout.write(chalk.yellow('  Enter action: '));
    }
    
    const input = await ask('');
    const cmd = input.trim().toLowerCase();

    if (cmd === 'q' || cmd === 'quit' || cmd === 'exit') {
      cleanup();
      console.log(chalk.green('\n\n  Stopped monitoring. Goodbye!\n'));
      break;
    } else if (cmd === 'r' || cmd === 'refresh') {
      portProcesses = await refreshPort(port);
    } else if ((cmd === 'k' || cmd === 'kill') && portProcesses.length > 0) {
      const proc = portProcesses[0];
      console.log(chalk.yellow(`\n  Killing process ${proc.pid}...`));
      const result = await killProcess(proc.pid);
      if (result.success) {
        console.log(chalk.green(`  Process ${proc.pid} killed`));
        clearPortState(port);
        portProcesses = await refreshPort(port);
      } else {
        console.log(chalk.red(`  Failed to kill: ${result.error}`));
      }
      await new Promise(r => setTimeout(r, 1500));
    } else if ((cmd === 'i' || cmd === 'ignore') && portProcesses.length > 0) {
      console.log(chalk.yellow(`\n  Process ignored`));
      clearPortState(port);
      portProcesses = [];
      await new Promise(r => setTimeout(r, 1500));
    }
  }
}

async function guardMode(port, options) {
  mode = 'guard';
  displayHeader(port, 'guard');
  
  let portProcesses = await refreshPort(port);
  
  if (portProcesses.length > 0) {
    console.log(chalk.red(`\n  Killing ${portProcesses.length} existing process(es)...`));
    for (const proc of portProcesses) {
      const result = await killProcess(proc.pid);
      if (result.success) {
        console.log(chalk.green(`  Killed ${proc.pid}`));
      } else {
        console.log(chalk.red(`  Failed to kill ${proc.pid}`));
      }
    }
    portProcesses = [];
  } else {
    console.log(chalk.green('\n  Port is free\n'));
  }
  
  await runGuardLoop(port, portProcesses, options);
}

async function runGuardLoop(port, portProcesses, options) {
  let resolveInput = null;
  let lastProcessCount = 0;
  
  watcher = new Watcher(port, {
    interval: parseInt(options.interval),
    onChange: async (change) => {
      if (change.type === 'opened') {
        console.log(chalk.red(`\n  ⚠ Unauthorized process detected: ${change.pid}`));
        console.log(chalk.yellow(`  Auto-killing...`));
        const result = await killProcess(change.pid);
        if (result.success) {
          console.log(chalk.green(`  Process killed\n`));
        } else {
          console.log(chalk.red(`  Failed to kill: ${result.error}\n`));
        }
        portProcesses = await refreshPort(port);
        lastProcessCount = portProcesses.length;
      } else {
        portProcesses = [];
        lastProcessCount = 0;
      }
      displayNeedsRefresh = true;
    },
  });

  await watcher.start();

  process.on('SIGINT', () => {
    cleanup();
    console.log(chalk.green('\n\n  Stopped guarding. Goodbye!\n'));
    process.exit(0);
  });

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.on('line', (input) => {
    if (resolveInput) {
      resolveInput(input.trim().toLowerCase());
      resolveInput = null;
    }
  });

  while (isRunning) {
    displayStatus(port, portProcesses, 'guard');
    
    process.stdout.write(chalk.yellow('  Enter action: '));
    
    const inputPromise = new Promise((resolve) => {
      resolveInput = resolve;
    });
    
    const timeoutPromise = new Promise((resolve) => {
      setTimeout(() => resolve('timeout'), 200);
    });
    
    const winner = await Promise.race([inputPromise, timeoutPromise]);
    
    if (winner === 'timeout') {
      continue;
    }
    
    const cmd = winner;

    if (cmd === 'q' || cmd === 'quit' || cmd === 'exit') {
      cleanup();
      console.log(chalk.green('\n\n  Stopped guarding. Goodbye!\n'));
      break;
    } else if (cmd === 'r' || cmd === 'refresh') {
      portProcesses = await refreshPort(port);
      displayNeedsRefresh = true;
    } else if (cmd === 'a' || cmd === 'auto') {
      console.log(chalk.green('\n  Auto-kill is always enabled in guard mode\n'));
      await new Promise(r => setTimeout(r, 1000));
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
    console.log(chalk.yellow(`\n  Killing ${portProcesses.length} existing process(es)...`));
    for (const proc of portProcesses) {
      const result = await killProcess(proc.pid);
      if (result.success) {
        console.log(chalk.green(`  Killed ${proc.pid}`));
      }
    }
    portProcesses = [];
  } else {
    console.log(chalk.green('\n  Port is free'));
  }

  console.log(chalk.cyan('\n  Starting: ') + chalk.white(command) + chalk.cyan('...\n'));
  
  const child = runCommand(command);
  const appPid = child.pid;
  
  console.log(chalk.green(`  App started (PID ${appPid})\n`));
  
  console.log(chalk.gray('  Press any key to continue...\n'));
  await ask('');
  
  await runSmartLoop(port, portProcesses, options, command, appPid, child);
}

async function runSmartLoop(port, portProcesses, options, command, appPid, child) {
  let resolveInput = null;
  let appStarted = false;
  let lastProcessCount = 0;
  
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
        displayNeedsRefresh = true;
      } else {
        if (change.pid === appPid && appStarted) {
          console.log(chalk.red('\n  ⚠ Your app has stopped!\n'));
          appStarted = false;
        }
        portProcesses = [];
        lastProcessCount = 0;
        displayNeedsRefresh = true;
      }
    },
  });

  await watcher.start();

  child.on('close', (code) => {
    cleanup();
    if (code !== 0) {
      console.log(chalk.yellow(`\n  App exited with code ${code}\n`));
    } else {
      console.log(chalk.green('\n  App exited\n'));
    }
    process.exit(0);
  });

  process.on('SIGINT', () => {
    cleanup();
    if (!isWindows && appPid) {
      try { process.kill(-appPid, 'SIGTERM'); } catch {}
    }
    console.log(chalk.green('\n\n  Stopped. Goodbye!\n'));
    process.exit(0);
  });

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.on('line', (input) => {
    if (resolveInput) {
      resolveInput(input.trim().toLowerCase());
      resolveInput = null;
    }
  });

  while (isRunning) {
    displayStatus(port, portProcesses, 'smart', appPid);
    
    process.stdout.write(chalk.yellow('  Enter action: '));
    
    const inputPromise = new Promise((resolve) => {
      resolveInput = resolve;
    });
    
    const timeoutPromise = new Promise((resolve) => {
      setTimeout(() => resolve('timeout'), 200);
    });
    
    const winner = await Promise.race([inputPromise, timeoutPromise]);
    
    if (winner === 'timeout') {
      continue;
    }
    
    const cmd = winner;

    if (cmd === 'q' || cmd === 'quit' || cmd === 'exit') {
      cleanup();
      if (!isWindows && appPid) {
        try { process.kill(-appPid, 'SIGTERM'); } catch {}
      }
      console.log(chalk.green('\n\n  Stopped. Goodbye!\n'));
      break;
    } else if (cmd === 'r' || cmd === 'refresh') {
      portProcesses = await refreshPort(port);
      displayNeedsRefresh = true;
    } else if (cmd === 's' || cmd === 'stop') {
      console.log(chalk.yellow('\n  Stopping app...'));
      if (!isWindows && appPid) {
        try { process.kill(-appPid, 'SIGTERM'); } catch {}
      }
      cleanup();
      console.log(chalk.green('  App stopped\n'));
      break;
    }
  }
  
  rl.close();
}

program.parse();
