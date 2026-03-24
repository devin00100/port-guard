import portGuard from '../dist/index.js';

const { scanPort, getProcessInfo, killProcess, killProcessTree, runCommand, Watcher, platform, isWindows } = portGuard;

console.log('=== PORT-GUARD MODULE TEST ===\n');
console.log(`Platform: ${platform}`);
console.log(`Is Windows: ${isWindows}\n`);

console.log('--- Test 1: scanPort (port 13000) ---');
const results = await scanPort(13000);
console.log('Results:', results);
console.log();

console.log('--- Test 2: getProcessInfo (PID 0) ---');
const info = await getProcessInfo(0);
console.log('Info:', info);
console.log();

console.log('--- Test 3: killProcess (invalid PID) ---');
const killResult = await killProcess(-1);
console.log('Kill result:', killResult);
console.log();

console.log('--- Test 4: killProcessTree (non-existent PID) ---');
const killTreeResult = await killProcessTree(999999);
console.log('Kill tree result:', killTreeResult);
console.log();

console.log('--- Test 5: runCommand (start server on port 13001) ---');
const serverCode = `
const http = require('http');
const server = http.createServer((req, res) => {
  res.end('OK');
});
server.listen(13001, () => console.log('Server running on 13001'));
`;

const child = runCommand(`node -e "${serverCode}"`);
console.log('Server started with PID:', child.pid);

await new Promise(r => setTimeout(r, 1500));

console.log('\n--- Test 6: scanPort (port 13001) after server start ---');
const serverResults = await scanPort(13001);
console.log('Results:', serverResults);

if (serverResults.length > 0) {
  console.log('\n--- Test 7: getProcessInfo for server PID ---');
  const serverInfo = await getProcessInfo(serverResults[0].pid);
  console.log('Info:', serverInfo);
  
  console.log('\n--- Test 8: killProcess ---');
  const killed = await killProcess(serverResults[0].pid);
  console.log('Killed:', killed);
}

console.log('\n--- Test 9: Watcher class ---');
const watcher = new Watcher(13000, { 
  interval: 2000,
  onChange: (change) => {
    console.log('Port change detected:', change.type, change.pid || 'none');
  }
});
console.log('Watcher created. Starting in 2 seconds...');

await new Promise(r => setTimeout(r, 2000));

console.log('Starting watcher...');
await watcher.start();
console.log('Watcher started. Checking for 2 seconds...');

await new Promise(r => setTimeout(r, 2000));

console.log('Stopping watcher...');
watcher.stop();
console.log('Watcher stopped.');

console.log('\n=== ALL TESTS COMPLETED ===');
process.exit(0);
