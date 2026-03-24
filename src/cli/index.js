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
let portProcesses = [];
let isRunning = true;

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

function displayStatus(port, processes) {
  console.clear();
  console.log(chalk.cyan('╔═══════════════════════════════════════════╗'));
  console.log(chalk.cyan('║         Port Guardian - Watch Mode          ║'));
  console.log(chalk.cyan('╚═══════════════════════════════════════════╝'));
  console.log();
  console.log(chalk.bold('  Port: ') + chalk.cyan(port));
  console.log(chalk.bold('  Status: ') + (processes.length > 0 ? chalk.red('IN USE') : chalk.green('FREE')));
  console.log(chalk.gray('─'.repeat(50)));
  
  if (processes.length > 0) {
    console.log(chalk.bold('\n  Processes on port ') + chalk.cyan(port) + chalk.bold(':'));
    processes.forEach((proc, idx) => {
      console.log(chalk.gray(`  ${idx + 1}. `) + chalk.red(proc.pid) + chalk.gray(' - ') + chalk.white(proc.name));
      if (proc.command) {
        console.log(chalk.gray('     Command: ') + chalk.gray(proc.command));
      }
    });
  } else {
    console.log(chalk.green('\n  No processes on this port'));
  }
  
  console.log(chalk.gray('─'.repeat(50)));
  console.log(chalk.green('  [k]') + ' Kill process   ' + chalk.green('[i]') + ' Ignore   ' + chalk.green('[r]') + ' Refresh   ' + chalk.green('[q]') + ' Quit\n');
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
  header(`Monitoring port ${port}`);

  portProcesses = await refreshPort(port);
  
  if (portProcesses.length === 0) {
    success(`Port ${port} is free`);
    if (!options.watch) return;
  } else {
    warn(`Port ${port} is in use by ${portProcesses.length} process(es)`);
  }

  if (options.watch) {
    let displayNeedsRefresh = true;

    watcher = new Watcher(port, {
      interval: parseInt(options.interval),
      onChange: async (change) => {
        if (change.type === 'opened') {
          portProcesses = await refreshPort(port);
          displayNeedsRefresh = true;
        } else {
          portProcesses = [];
          displayNeedsRefresh = true;
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
      displayStatus(port, portProcesses);
      
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
        displayNeedsRefresh = true;
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
        const proc = portProcesses[0];
        console.log(chalk.yellow(`\n  Process ${proc.pid} ignored`));
        console.log(chalk.gray('  Will notify again if a different process starts\n'));
        clearPortState(port);
        portProcesses = [];
        await new Promise(r => setTimeout(r, 1500));
      } else if (cmd === 'h' || cmd === 'help' || cmd === '') {
        // Just refresh the display
      } else {
        console.log(chalk.red(`\n  Unknown command: "${cmd}"`));
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }
}

async function guardMode(port, options) {
  header(`Guarding port ${port} (auto-kill enabled)`);

  const results = await scanPort(port);
  if (results.length > 0) {
    for (const result of results) {
      warn(`Found process ${result.pid} on port ${port}`);
      const { success: killed } = await killProcess(result.pid);
      if (killed) {
        success(`Killed process ${result.pid}`);
      } else {
        error(`Failed to kill process ${result.pid}`);
      }
    }
  } else {
    info(`Port ${port} is free`);
  }

  info(`\nGuarding port ${port}...`);
  info('[Press Ctrl+C to quit]\n');

  watcher = new Watcher(port, {
    interval: parseInt(options.interval),
    onChange: async (change) => {
      if (change.type === 'opened') {
        warn(`Unauthorized process detected on port ${port}`);
        info(`  PID: ${change.pid}`);
        const { success: killed, error: err } = await killProcess(change.pid);
        if (killed) {
          success(`Process killed`);
        } else {
          error(err || 'Failed to kill process');
        }
      }
    },
  });

  await watcher.start();

  process.on('SIGINT', () => {
    cleanup();
    success('Stopped guarding.');
    process.exit(0);
  });
}

async function smartMode(port, options) {
  const command = options.run;
  header(`Smart Mode: Running and protecting port ${port}`);

  info('Checking port...\n');

  const results = await scanPort(port);
  if (results.length > 0) {
    for (const result of results) {
      warn(`Found existing process on port ${port} (PID ${result.pid})`);
      const { success: killed } = await killProcess(result.pid);
      if (killed) {
        success('Killed existing process');
      } else {
        error('Failed to kill existing process');
        process.exit(1);
      }
    }
  } else {
    info(`Port ${port} is free`);
  }

  info(`\nStarting: ${command}...\n`);

  const child = runCommand(command);
  const appPid = child.pid;

  success(`App started (PID ${appPid})`);
  info(`\nWatching port ${port}...`);
  info('[Press Ctrl+C to quit]\n');

  watcher = new Watcher(port, {
    interval: parseInt(options.interval),
    appPid,
    onChange: (change) => {
      if (change.type === 'opened') {
        if (change.pid === appPid) {
          success('Your app is running');
        } else if (!change.isOwnProcess) {
          warn(`Another process detected on port ${port} (PID ${change.pid}) - ignored`);
        }
      } else {
        info(`Port ${change.port} is now free`);
      }
    },
  });

  await watcher.start();

  child.on('close', (code) => {
    cleanup();
    if (code !== 0) {
      warn(`App exited with code ${code}`);
    } else {
      success('App exited');
    }
    process.exit(0);
  });

  process.on('SIGINT', () => {
    cleanup();
    if (!isWindows) {
      process.kill(-appPid, 'SIGTERM');
    }
    success('Stopped.');
    process.exit(0);
  });
}

program.parse();
