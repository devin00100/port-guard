#!/usr/bin/env node

import { Command } from 'commander';
import { scanPort, getProcessInfo } from '../core/scanner.js';
import { setPortState, getPortState, clearPortState } from '../core/state.js';
import { killProcess } from '../core/killer.js';
import { runCommand } from '../core/runner.js';
import { Watcher } from '../core/watcher.js';
import { setSilent, setVerbose, header, info, success, warn, error, processInfo } from '../utils/logger.js';
import { isWindows } from '../utils/platform.js';
import * as readline from 'readline';

const program = new Command();

let watcher = null;
let currentProcess = null;
let rl = null;

function cleanup() {
  if (watcher) {
    watcher.stop();
    watcher = null;
  }
  if (rl) {
    rl.close();
    rl = null;
  }
}

function createInterface() {
  if (rl) return rl;
  rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return rl;
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

function waitForInput(prompt) {
  return new Promise((resolve) => {
    const interface_ = createInterface();
    interface_.question(prompt, (answer) => {
      resolve(answer);
    });
  });
}

async function handleCommand(port, cmd) {
  if (cmd === 'q' || cmd === 'quit' || cmd === 'exit') {
    cleanup();
    success('Stopped monitoring.');
    process.exit(0);
  } else if (cmd === 'k' || cmd === 'kill') {
    if (currentProcess) {
      info(`Killing process ${currentProcess.pid}...`);
      const result = await killProcess(currentProcess.pid);
      if (result.success) {
        success(`Process ${currentProcess.pid} killed`);
        clearPortState(port);
      } else {
        error(result.error || 'Failed to kill process');
      }
      currentProcess = null;
    } else {
      info('No process to kill');
    }
  } else if (cmd === 'i' || cmd === 'ignore') {
    if (currentProcess) {
      info('Process ignored - will notify again if it changes');
      clearPortState(port);
      currentProcess = null;
    } else {
      info('No process to ignore');
    }
  } else if (cmd === 'h' || cmd === 'help' || cmd === '') {
    info('Commands: kill (k), ignore (i), quit (q)');
  } else {
    info(`Unknown command: "${cmd}". Use: kill (k), ignore (i), quit (q)`);
  }
}

async function monitorMode(port, options) {
  header(`Monitoring port ${port}`);

  let lastNotifiedPid = null;

  const results = await scanPort(port);
  if (results.length === 0) {
    success(`Port ${port} is free`);
    if (!options.watch) return;
  } else {
    for (const result of results) {
      const processInfo_ = await getProcessInfo(result.pid);
      warn(`Port ${port} is in use`);
      processInfo({ port, pid: result.pid, process: processInfo_.name, command: processInfo_.command });
      lastNotifiedPid = result.pid;
      currentProcess = {
        pid: result.pid,
        process: processInfo_.name,
        command: processInfo_.command
      };
    }
  }

  if (options.watch) {
    info(`\nWatching port ${port} for changes...`);
    info('[Available commands: kill (k), ignore (i), quit (q)]\n');

    watcher = new Watcher(port, {
      interval: parseInt(options.interval),
      onChange: (change) => {
        if (change.type === 'opened') {
          if (change.pid !== lastNotifiedPid) {
            warn(`Port ${change.port} opened`);
            processInfo(change);
            lastNotifiedPid = change.pid;
            currentProcess = {
              pid: change.pid,
              process: change.process,
              command: change.command
            };
          }
        } else {
          info(`Port ${change.port} is now free`);
          lastNotifiedPid = null;
          currentProcess = null;
        }
      },
    });

    await watcher.start();

    process.on('SIGINT', () => {
      cleanup();
      success('Stopped monitoring.');
      process.exit(0);
    });

    let waitingForInput = false;
    let resolveInput = null;
    let lastProcessedPid = null;

    createInterface().on('line', (input) => {
      if (waitingForInput && resolveInput) {
        resolveInput(input.trim().toLowerCase());
        waitingForInput = false;
        resolveInput = null;
      }
    });

    while (true) {
      await new Promise(r => setTimeout(r, 100));

      if (currentProcess && currentProcess.pid !== lastProcessedPid) {
        const inputPromise = new Promise((resolve) => {
          resolveInput = resolve;
        });

        const prompt = `\n[Action] Process ${currentProcess.pid} on port ${port}. Enter command (kill/ignore/quit): `;
        process.stdout.write(prompt);
        waitingForInput = true;
        
        const input = await inputPromise;
        lastProcessedPid = currentProcess ? currentProcess.pid : null;
        await handleCommand(port, input);
      } else if (!currentProcess) {
        const inputPromise = new Promise((resolve) => {
          resolveInput = resolve;
        });

        process.stdout.write('[port-guard] > ');
        waitingForInput = true;
        
        const input = await inputPromise;
        await handleCommand(port, input);
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
