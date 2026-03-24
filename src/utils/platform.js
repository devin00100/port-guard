export const platform = process.platform;
export const isWindows = platform === 'win32';
export const isMac = platform === 'darwin';
export const isLinux = platform === 'linux';

export const commands = {
  scan: isWindows ? ['netstat', '-ano'] : ['lsof', '-i', '-n', '-P'],
  kill: isWindows ? ['taskkill', '/PID', '{pid}', '/F'] : ['kill', '-9', '{pid}'],
  getProcess: isWindows ? ['wmic', 'process', 'where', `processid={pid}`, 'get', 'name,commandline', '/format:list'] : ['ps', '-p', '{pid}', '-o', 'comm=,args='],
};

export function getKillCommand(pid) {
  const cmd = isWindows 
    ? ['taskkill', '/PID', pid.toString(), '/F']
    : ['kill', '-9', pid.toString()];
  return cmd;
}

export function getProcessInfoCommand(pid) {
  if (isWindows) {
    return ['wmic', 'process', 'where', `ProcessId=${pid}`, 'get', 'Name,CommandLine', '/format:list'];
  }
  return ['ps', '-p', pid.toString(), '-o', 'comm=,args='];
}
