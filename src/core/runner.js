import { spawn } from 'child_process';
import { debug } from '../utils/logger.js';

export function runCommand(command, options = {}) {
  debug(`Running command: ${command}`);

  const child = spawn(command, {
    shell: true,
    stdio: options.inherit ? 'inherit' : 'pipe',
    detached: options.detached || false,
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
  });

  if (!options.inherit) {
    if (child.stdout) {
      child.stdout.on('data', (data) => {
        process.stdout.write(data);
      });
    }
    if (child.stderr) {
      child.stderr.on('data', (data) => {
        process.stderr.write(data);
      });
    }
  }

  return child;
}

export function runCommandSync(command, options = {}) {
  const child = spawn(command, {
    shell: true,
    stdio: 'inherit',
    detached: options.detached || false,
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
  });

  if (options.detached) {
    child.unref();
  }

  return child;
}

export default { runCommand, runCommandSync };
