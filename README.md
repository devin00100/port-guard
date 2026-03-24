# Port Guardian

> Manage, monitor, and control processes running on ports — before, during, and after execution.

**Author:** Deepak Ashok Karai

## Install

```bash
npm install -g port-guard
```

Or use without installing:

```bash
npx port-guard <port>
```

## Usage

```bash
port-guard <port> [options]
```

### Options

| Option | Description |
|--------|-------------|
| `--watch, -w` | Enable monitoring (monitor mode) |
| `--guard, -g` | Enable auto-kill mode (guard mode) |
| `--run, -r <cmd>` | Run command with port protection (smart mode) |
| `--silent, -s` | Minimal output |
| `--verbose, -v` | Detailed output |
| `--interval, -i <ms>` | Check interval (default: 1000ms) |

## Modes

### Monitor Mode (Default)

Observe port activity without killing processes.

```bash
port-guard 3000 --watch
```

### Guard Mode

Continuously monitor and automatically kill processes on the port.

```bash
port-guard 3000 --guard
```

### Smart Mode

Kill existing processes, run your command, and protect your app.

```bash
port-guard 3000 --run "npm run dev"
```

## Use as NPM Module

```javascript
import portGuard from 'port-guard';

// Scan for process on port
const processes = await portGuard.scanner.scanPort(3000);

// Kill a process
await portGuard.killer.killProcess(1234);

// Watch a port
const watcher = portGuard.createWatcher(3000, {
  onChange: (change) => console.log(change)
});
await watcher.start();
```

## License

MIT
