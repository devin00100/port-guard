import { exec } from 'child_process';
import { promisify } from 'util';
import { isWindows } from '../utils/platform.js';
import { debug } from '../utils/logger.js';

const execAsync = promisify(exec);

export async function killProcess(pid) {
  if (!pid || pid <= 0) {
    return { success: false, error: 'Invalid PID' };
  }

  debug(`Killing process ${pid}...`);

  let cmd;
  if (isWindows) {
    cmd = `taskkill /PID ${pid} /F`;
  } else {
    cmd = `kill -9 ${pid}`;
  }

  try {
    const { stdout, stderr } = await execAsync(cmd, { shell: true });
    debug(`Kill output: ${stdout || stderr}`);
    return { success: true, output: stdout || stderr };
  } catch (err) {
    const errorMsg = err.message || '';
    if (errorMsg.includes('Access is denied') || errorMsg.includes('Operation not permitted')) {
      return { success: false, error: 'Permission denied. Try running as administrator.' };
    }
    if (errorMsg.includes('not found') || errorMsg.includes('No such')) {
      return { success: false, error: 'Process not found (may have already exited)' };
    }
    return { success: false, error: errorMsg };
  }
}

export async function killProcessTree(pid) {
  if (isWindows) {
    try {
      await execAsync(`taskkill /PID ${pid} /T /F`, { shell: true });
      return { success: true };
    } catch {
      return killProcess(pid);
    }
  }
  return killProcess(pid);
}

export default { killProcess, killProcessTree };
