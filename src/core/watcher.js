import { scanPort, getProcessInfo } from './scanner.js';
import { setPortState, getPortState } from './state.js';
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
  }

  async start() {
    this.running = true;
    debug(`Starting watcher for port ${this.port}`);
    
    // Wait a moment for the app to start before first check
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
      const currentPid = results.length > 0 ? results[0].pid : null;
      const previousPid = getPortState(this.port);

      if (currentPid !== previousPid) {
        setPortState(this.port, currentPid);

        if (currentPid) {
          const processInfo = await getProcessInfo(currentPid);
          const isOwnProcess = this.appPid && currentPid === this.appPid;

          this.onChange({
            type: currentPid ? 'opened' : 'closed',
            port: this.port,
            pid: currentPid,
            process: processInfo.name,
            command: processInfo.command,
            isOwnProcess,
          });
        } else {
          this.onChange({
            type: 'closed',
            port: this.port,
            pid: null,
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
