import { exec } from 'child_process';
import { promisify } from 'util';
import { isWindows } from '../utils/platform.js';
import { debug } from '../utils/logger.js';

const execAsync = promisify(exec);

function execWithTimeout(cmd, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Command timed out'));
    }, timeout);
    
    exec(cmd, { shell: true }, (error, stdout, stderr) => {
      clearTimeout(timer);
      if (error) reject(error);
      else resolve({ stdout, stderr });
    });
  });
}

export async function killProcess(pid) {
  if (!pid || pid <= 0) {
    return { success: false, error: 'Invalid PID' };
  }

  debug(`Killing process ${pid}...`);

  try {
    process.kill(pid, 'SIGTERM');
    return { success: true };
  } catch (err) {
    const errorMsg = err.message || '';
    if (errorMsg.includes('Access is denied') || errorMsg.includes('EPERM')) {
      return { success: false, error: 'Permission denied. Try running as administrator.' };
    }
    if (errorMsg.includes('not found') || errorMsg.includes('ESRCH')) {
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
