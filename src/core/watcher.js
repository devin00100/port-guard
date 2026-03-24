import { scanPort, getProcessInfo } from './scanner.js';
import { setPortState, getPortState, clearPortState } from './state.js';
import { debug } from '../utils/logger.js';

export class Watcher {
  constructor(port, options = {}) {
    this.port = port;
    this.interval = options.interval || 1000;
    this.onChange = options.onChange || (() => {});
    this.appPid = options.appPid || null;
    this.running = false;
    this.paused = false;
    this.timer = null;
    this.lastKnownPid = null;
    this.lastKnownStatus = null;
  }

  async start() {
    this.running = true;
    debug(`Starting watcher for port ${this.port}`);
    
    await new Promise(r => setTimeout(r, 1000));
    await this.check();
    this.timer = setInterval(() => this.check(), this.interval);
  }

  stop() {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    debug(`Stopped watcher for port ${this.port}`);
  }

  pause() {
    this.paused = true;
  }

  resume() {
    this.paused = false;
  }

  async check() {
    if (!this.running || this.paused) return;

    try {
      const results = await scanPort(this.port);
      const currentPids = results.map(r => r.pid);
      const hasPortOpened = currentPids.length > 0;
      const currentPid = hasPortOpened ? currentPids[0] : null;
      
      const previousStatus = this.lastKnownStatus;
      const previousPid = this.lastKnownPid;

      const statusChanged = hasPortOpened !== previousStatus;
      const pidChanged = currentPid !== previousPid;

      if (statusChanged || (hasPortOpened && pidChanged)) {
        this.lastKnownStatus = hasPortOpened;
        this.lastKnownPid = currentPid;
        
        if (hasPortOpened) {
          const processInfo = await getProcessInfo(currentPid);
          const isOwnProcess = this.appPid && currentPid === this.appPid;

          this.onChange({
            type: 'opened',
            port: this.port,
            pid: currentPid,
            pids: currentPids,
            process: processInfo.name,
            command: processInfo.command,
            isOwnProcess,
          });
        } else {
          this.onChange({
            type: 'closed',
            port: this.port,
            pid: null,
            pids: [],
          });
        }
      }
    } catch (err) {
      debug(`Watcher error: ${err.message}`);
    }
  }

  setAppPid(pid) {
    this.appPid = pid;
  }
}

export function createWatcher(port, options) {
  return new Watcher(port, options);
}

export default { Watcher, createWatcher };
