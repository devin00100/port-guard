import express from 'express';
import portGuard from '../dist/index.js';

const app = express();
const { scanPort, getProcessInfo, killProcess, killProcessTree, runCommand, Watcher, state, platform, isWindows, isMac, isLinux } = portGuard;

const TEST_PORT = 13002;

app.get('/', (req, res) => {
  res.json({ 
    message: 'Test server is running',
    platform: platform,
    isWindows: isWindows
  });
});

app.get('/test-module', async (req, res) => {
  const results = {
    platform: platform,
    isWindows: isWindows,
    isMac: isMac,
    isLinux: isLinux,
    tests: {}
  };

  // Test 1: scanPort on our own port
  results.tests.scanPort = await scanPort(TEST_PORT);

  // Test 2: getProcessInfo for current process
  results.tests.getProcessInfo = await getProcessInfo(process.pid);

  // Test 3: state functions
  state.setPortState(9000, 12345);
  results.tests.setPortState = state.getPortState(9000) === 12345;
  state.clearPortState(9000);
  results.tests.clearPortState = state.getPortState(9000) === undefined;

  // Test 4: killProcess with invalid PID (should fail gracefully)
  results.tests.killProcessInvalid = await killProcess(-1);

  // Test 5: Watcher
  results.tests.watcherCreated = true;

  res.json(results);
});

app.listen(TEST_PORT, () => {
  console.log(`Test server running on port ${TEST_PORT}`);
  console.log(`Platform: ${platform}, isWindows: ${isWindows}`);
  
  // Run CLI tests
  runModuleTests();
});

async function runModuleTests() {
  console.log('\n=== RUNNING PORT-GUARD MODULE TESTS ===\n');

  // Test scanPort
  console.log('1. Testing scanPort...');
  const scanResults = await scanPort(TEST_PORT);
  console.log('   scanPort result:', scanResults.length > 0 ? '✓ Found process' : '✗ No process found');
  console.log('   Data:', scanResults);

  // Test getProcessInfo
  console.log('\n2. Testing getProcessInfo...');
  const procInfo = await getProcessInfo(process.pid);
  console.log('   getProcessInfo result:', procInfo.name ? '✓ Success' : '✗ Failed');
  console.log('   Data:', procInfo);

  // Test state functions
  console.log('\n3. Testing state functions...');
  state.setPortState(9000, 12345);
  const saved = state.getPortState(9000);
  console.log('   setPortState/getPortState:', saved === 12345 ? '✓ Success' : '✗ Failed');
  
  state.clearPortState(9000);
  const cleared = state.getPortState(9000);
  console.log('   clearPortState:', cleared === undefined ? '✓ Success' : '✗ Failed');

  // Test killProcess with invalid PID
  console.log('\n4. Testing killProcess (invalid PID)...');
  const killResult = await killProcess(-1);
  console.log('   killProcess result:', !killResult.success ? '✓ Correctly failed' : '✗ Unexpected');
  console.log('   Error:', killResult.error);

  // Test Watcher
  console.log('\n5. Testing Watcher class...');
  const watcher = new Watcher(TEST_PORT, {
    interval: 1000,
    onChange: (change) => {
      console.log('   Watcher callback:', change.type, change.pid || 'none');
    }
  });
  console.log('   Watcher created:', watcher ? '✓ Success' : '✗ Failed');
  
  await watcher.start();
  console.log('   Watcher started: ✓');
  
  await new Promise(r => setTimeout(r, 1500));
  
  watcher.stop();
  console.log('   Watcher stopped: ✓');

  // Test runCommand
  console.log('\n6. Testing runCommand...');
  const child = runCommand('node -v');
  console.log('   runCommand spawned PID:', child.pid);
  
  await new Promise(r => setTimeout(r, 500));
  console.log('   runCommand: ✓ Success');

  console.log('\n=== ALL MODULE TESTS COMPLETED ===\n');
}
