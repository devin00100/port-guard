const { readFileSync, writeFileSync, mkdirSync } = require('fs');
const { resolve } = require('path');

const rootDir = resolve(__dirname, '..');

function read(path) {
  return readFileSync(resolve(rootDir, path), 'utf8');
}

function write(path, content) {
  const fullPath = resolve(rootDir, path);
  const dir = require('path').dirname(fullPath);
  mkdirSync(dir, { recursive: true });
  writeFileSync(fullPath, content);
}

console.log('Building port-guard...\n');

write('dist/cli/index.js', read('src/cli/index.js').replace('#!/usr/bin/env node', ''));

[
  ['src/core/state.js', 'dist/core/state.js'],
  ['src/core/scanner.js', 'dist/core/scanner.js'],
  ['src/core/killer.js', 'dist/core/killer.js'],
  ['src/core/runner.js', 'dist/core/runner.js'],
  ['src/core/watcher.js', 'dist/core/watcher.js'],
  ['src/utils/platform.js', 'dist/utils/platform.js'],
  ['src/utils/logger.js', 'dist/utils/logger.js'],
].forEach(([src, dest]) => {
  write(dest, read(src));
});

const indexJs = `
import state from './core/state.js';
import scanner from './core/scanner.js';
import killer from './core/killer.js';
import runner from './core/runner.js';
import { Watcher, createWatcher } from './core/watcher.js';
import * as logger from './utils/logger.js';
import * as platform from './utils/platform.js';

export { state, scanner, killer, runner, Watcher, createWatcher, logger, platform };
export default { state, scanner, killer, runner, Watcher, createWatcher, logger, platform };
`;

write('dist/index.js', indexJs);

console.log('\nBuild complete!');
console.log('Run: node dist/cli/index.js <port>');
