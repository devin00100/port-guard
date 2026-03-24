#!/usr/bin/env node

import { Command } from 'commander';
import { scanPort, getProcessInfo } from '../core/scanner.js';
import { killProcess } from '../core/killer.js';
import { runCommand } from '../core/runner.js';
import { Watcher } from '../core/watcher.js';
import { setSilent, setVerbose, header, info, success, warn, error, processInfo } from '../utils/logger.js';
import { isWindows } from '../utils/platform.js';
import * as readline from 'readline';

const program = new Command();

let currentProcess = null;
let watcher = null;

function setupKeyboardHandler(port) {
  if (isWindows) {
    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
  }

  process.stdin.resume();
  readline.emitKeypressEvents(process.stdin);

  process.stdin.on('keypress', async (str, key) => {
    if (key.ctrl && key.name === 'c') {
      cleanup();
      process.exit(0);
    }

    if (!currentProcess) return;

    switch (str.toLowerCase()) {
      case 'k':
        info(`Killing process ${currentProcess.pid}...`);
        const { success: killed } = await killProcess(currentProcess.pid);
        if (killed) {
          success(`Process ${currentProcess.pid} killed`);
          currentProcess = null;
        } else {
          error('Failed to kill process');
        }
        break;
      case 'i':
        info('Process ignored');
        currentProcess = null;
        break;
      case 'q':
        cleanup();
        success('Stopped monitoring.');
        process.exit(0);
    }
  });
}

function cleanup() {
  if (watcher) {
    watcher.stop();
  }
  if (process.stdin.isTTY && !isWindows) {
    process.stdin.setRawMode(false);
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

async function monitorMode(port, options) {
  header(`Monitoring port ${port}`);

  const results = await scanPort(port);
  if (results.length === 0) {
    success(`Port ${port} is free`);
    return;
  }

  for (const result of results) {
    const processInfo_ = await getProcessInfo(result.pid);
    warn(`Port ${port} is in use`);
    processInfo({ port, pid: result.pid, process: processInfo_.name, command: processInfo_.command });
  }

  if (options.watch) {
    info(`\nWatching port ${port} for changes...`);
    info('[Press "k" to kill, "i" to ignore, "q" to quit, Ctrl+C to exit]\n');

    setupKeyboardHandler(port);

    watcher = new Watcher(port, {
      interval: parseInt(options.interval),
      onChange: handleMonitorChange,
    });

    await watcher.start();

    process.on('SIGINT', () => {
      cleanup();
      success('Stopped monitoring.');
      process.exit(0);
    });
  }
}

function handleMonitorChange(change) {
  if (change.type === 'opened') {
    warn(`Port ${change.port} opened`);
    currentProcess = {
      pid: change.pid,
      process: change.process,
      command: change.command
    };
    processInfo(change);
    info('[Press "k" to kill, "i" to ignore, "q" to quit]\n');
  } else {
    info(`Port ${change.port} is now free`);
    currentProcess = null;
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

  const watcher = new Watcher(port, {
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
    watcher.stop();
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

  const watcher = new Watcher(port, {
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
        info(`Port ${port} is now free`);
      }
    },
  });

  await watcher.start();

  child.on('close', (code) => {
    watcher.stop();
    if (code !== 0) {
      warn(`App exited with code ${code}`);
    } else {
      success('App exited');
    }
    process.exit(0);
  });

  process.on('SIGINT', () => {
    watcher.stop();
    if (!isWindows) {
      process.kill(-appPid, 'SIGTERM');
    }
    success('Stopped.');
    process.exit(0);
  });
}

program.parse();
