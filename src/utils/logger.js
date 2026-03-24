import chalk from 'chalk';

const verbose = process.env.VERBOSE === 'true';
const silent = process.env.SILENT === 'true';

export function info(message, ...args) {
  if (silent) return;
  console.log(chalk.blue('ℹ'), message, ...args);
}

export function success(message, ...args) {
  if (silent) return;
  console.log(chalk.green('✔'), message, ...args);
}

export function warn(message, ...args) {
  if (silent) return;
  console.log(chalk.yellow('⚠'), message, ...args);
}

export function error(message, ...args) {
  console.error(chalk.red('✖'), message, ...args);
}

export function debug(message, ...args) {
  if (!verbose) return;
  console.log(chalk.gray('[DEBUG]'), message, ...args);
}

export function setVerbose(value) {
  process.env.VERBOSE = value ? 'true' : 'false';
}

export function setSilent(value) {
  process.env.SILENT = value ? 'true' : 'false';
}

export function header(message) {
  if (silent) return;
  console.log(chalk.bold.cyan(`\n${message}\n`));
}

export function processInfo(data) {
  if (silent) return;
  const { port, pid, process: proc, command } = data;
  console.log(chalk.gray('─'.repeat(40)));
  console.log(`  ${chalk.bold('Port:')} ${chalk.cyan(port)}`);
  console.log(`  ${chalk.bold('PID:')} ${pid}`);
  if (proc) console.log(`  ${chalk.bold('Process:')} ${proc}`);
  if (command) console.log(`  ${chalk.bold('Command:')} ${command}`);
}
