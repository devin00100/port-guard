import { exec } from 'child_process';
import { promisify } from 'util';
import { platform, isWindows } from '../utils/platform.js';
import { debug } from '../utils/logger.js';

const execAsync = promisify(exec);

export async function scanPort(port) {
  debug(`Scanning port ${port} on ${platform}...`);
  
  let cmd;
  if (isWindows) {
    cmd = `netstat -ano | findstr :${port}`;
  } else {
    cmd = `lsof -i :${port} -n -P 2>/dev/null`;
  }

  try {
    const { stdout } = await execAsync(cmd, { shell: true });
    return parseOutput(stdout, port);
  } catch {
    return [];
  }
}

function parseOutput(output, targetPort) {
  if (!output.trim()) return [];

  const results = [];

  if (isWindows) {
    const lines = output.split('\n').filter(l => l.trim());
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 5) {
        const localAddress = parts[1];
        const portMatch = localAddress.match(/:(\d+)$/);
        if (portMatch) {
          const port = parseInt(portMatch[1]);
          if (port === targetPort) {
            results.push({
              port,
              pid: parseInt(parts[4]),
              protocol: parts[0].toUpperCase(),
            });
          }
        }
      }
    }
  } else {
    const lines = output.split('\n').filter(l => l.trim());
    for (const line of lines) {
      const parts = line.split(/\s+/);
      if (parts.length >= 9) {
        const command = parts[0];
        const pid = parseInt(parts[1]);
        const name = parts[8] || '';
        const portMatch = name.match(/:(\d+)/);
        if (portMatch) {
          const port = parseInt(portMatch[1]);
          if (port === targetPort) {
            results.push({
              port,
              pid,
              process: command,
              protocol: parts[7]?.toUpperCase() || 'TCP',
            });
          }
        }
      }
    }
  }

  return results;
}

export async function getProcessInfo(pid) {
  debug(`Getting process info for PID ${pid}...`);
  
  let cmd;
  if (isWindows) {
    cmd = `wmic process where ProcessId=${pid} get Name,CommandLine /format:list`;
  } else {
    cmd = `ps -p ${pid} -o comm=,args= 2>/dev/null`;
  }

  try {
    const { stdout } = await execAsync(cmd, { shell: true });
    return parseProcessInfo(stdout, pid);
  } catch {
    return { pid, name: 'Unknown', command: '' };
  }
}

function parseProcessInfo(output, pid) {
  if (!output.trim()) return { pid, name: 'Unknown', command: '' };

  if (isWindows) {
    const lines = output.split('\n');
    let name = 'Unknown';
    let command = '';

    for (const line of lines) {
      if (line.startsWith('Name=')) name = line.replace('Name=', '').trim();
      if (line.startsWith('CommandLine=')) command = line.replace('CommandLine=', '').trim();
    }

    return { pid, name, command };
  } else {
    const parts = output.trim().split(/\s+/);
    const name = parts[0] || 'Unknown';
    const command = parts.slice(1).join(' ') || '';
    return { pid, name, command };
  }
}

export default { scanPort, getProcessInfo };
