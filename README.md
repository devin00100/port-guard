# 🚀 Port Guardian

<div align="center">

![Port Guardian](https://img.shields.io/badge/Port%20Guardian-6366f1?style=for-the-badge&logo=terminal&logoColor=white)
[![npm version](https://img.shields.io/npm/v/@devin00100/port-guard.svg?style=for-the-badge)](https://www.npmjs.com/package/@devin00100/port-guard)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/Node.js-18+-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org/)

**CLI tool to Manage, Monitor & Control Processes Running on Ports**

*No configuration needed. Just specify the port and protect your services.*

**Author: Deepak Ashok Karai**

</div>

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🔍 **Port Scanning** | Find all processes running on a specific port |
| 👀 **Real-time Monitoring** | Watch port status changes in real-time |
| 🛡️ **Auto-Guard** | Automatically kill processes that try to use the port |
| 🎮 **Smart Mode** | Run your app and protect it - restarts automatically |
| 💀 **Process Control** | Kill individual processes from CLI |
| 📊 **Process Info** | View detailed process information (PID, name, command) |
| 🎨 **Beautiful UI** | Color-coded TUI with modern interface |
| ⚡ **Fast Detection** | Efficient port scanning with configurable intervals |
| 📦 **NPM Module** | Use as a library in your Node.js projects |

---

## 📦 Install

```bash
# Install globally (recommended)
npm install -g @devin00100/port-guard

# Or use with npx (no install needed)
npx @devin00100/port-guard <port>

# CLI command (works as 'port-guard')
port-guard <port>
```

### Requirements
- Node.js >= 18.0.0
- npm or yarn

---

## 🚀 Quick Start

### Monitor Mode (Default)
```bash
# Monitor a port
port-guard 3000

# With custom check interval
port-guard 3000 -i 500
```

### Guard Mode
```bash
# Auto-kill any new process on the port
port-guard 3000 -g

# Guard with custom interval
port-guard 3000 -g -i 2000
```

### Smart Mode
```bash
# Run your app and protect it
port-guard 3000 -r "npm run dev"

# Run in specific directory
port-guard 3000 -r "npm run dev" -d "/path/to/project"

# Smart mode with custom interval
port-guard 3000 -r "npm run dev" -i 1000
```

---

## 🎮 Interactive Commands

### Monitor Mode
```
  Action > k     Kill the process
  Action > q     Quit
```

### Guard Mode
```
  > q     Quit
```

### Smart Mode
```
  > r     Restart the app
  > q     Quit
```

---

## 📋 All Options

| Option | Short | Description | Default |
|--------|-------|-------------|---------|
| `--help` | `-h` | Show help message | - |
| `--version` | `-V` | Show version number | - |
| `--watch` | `-w` | Monitor mode (watch port) | - |
| `--guard` | `-g` | Guard mode (auto-kill) | - |
| `--run` | `-r` | Run command (smart mode) | - |
| `--directory` | `-d` | Working directory for --run | current dir |
| `--interval` | `-i` | Check interval in ms | 1000 |
| `--silent` | `-s` | Minimal output | - |
| `--verbose` | `-v` | Detailed output | - |

---

## 🎯 Usage Examples

### Basic Monitoring
```bash
# Monitor port 3000
port-guard 3000

# Monitor with verbose output
port-guard 3000 -v
```

### Guard Your Port
```bash
# Guard port 3000 (kill any new process)
port-guard 3000 -g

# Guard and check every 500ms
port-guard 3000 -g -i 500
```

### Run & Protect
```bash
# Run development server and protect port
port-guard 3000 -r "npm run dev"

# Run with custom directory
port-guard 3000 -r "npm start" -d "/var/www/myapp"

# Run any command
port-guard 8080 -r "python manage.py runserver"
```

### Process Management
```bash
# Kill process on port
# (in monitor mode, type 'k')
```

---

## 📦 Use as NPM Module

Port Guardian can be used as a library in your Node.js projects.

### Installation
```bash
npm install @devin00100/port-guard
```

### Examples

#### Scan a Port
```javascript
import { scanPort } from '@devin00100/port-guard';

const processes = await scanPort(3000);
console.log(processes);
// [{ port: 3000, pid: 12345, protocol: 'TCP' }]
```

#### Get Process Info
```javascript
import { getProcessInfo } from '@devin00100/port-guard';

const info = await getProcessInfo(12345);
console.log(info);
// { pid: 12345, name: 'node.exe', command: 'node server.js' }
```

#### Kill a Process
```javascript
import { killProcess } from '@devin00100/port-guard';

const result = await killProcess(12345);
console.log(result);
// { success: true }
```

#### Watch a Port
```javascript
import { Watcher } from '@devin00100/port-guard';

const watcher = new Watcher(3000, {
  interval: 1000,
  onChange: (change) => {
    console.log('Port change:', change.type, change.pid);
  }
});

await watcher.start();
// Port change: opened 12345
// Port change: closed null

watcher.stop();
```

#### Run a Command
```javascript
import { runCommand } from '@devin00100/port-guard';

const child = runCommand('npm run dev', {
  cwd: '/path/to/project',
  env: { NODE_ENV: 'development' }
});

child.on('close', (code) => {
  console.log('Process exited with code:', code);
});
```

---

## 🎨 Example Output

### Monitor Mode
```
  ╔═══════════════════════════════════════════╗
  ║         Port Guardian - MONITOR           ║
  ╚═══════════════════════════════════════════╝

  Port: 3000
  Status: IN USE
  ──────────────────────────────────────────────────
  ● 12345 - node.exe
      node server.js
  ──────────────────────────────────────────────────
  [K] Kill  [Q] Quit

  Action > 
```

### Guard Mode
```
  ╔═══════════════════════════════════════════╗
  ║         Port Guardian - GUARD             ║
  ╚═══════════════════════════════════════════╝

  Port: 3000
  Status: FREE
  ──────────────────────────────────────────────────
  No processes
  ──────────────────────────────────────────────────
  [Q] Quit

  > 
```

### Smart Mode
```
  ╔═══════════════════════════════════════════╗
  ║         Port Guardian - SMART             ║
  ╚═══════════════════════════════════════════╝

  Port: 3000
  Status: IN USE
  ──────────────────────────────────────────────────
  ★ 12345 - YOUR APP
      npm run dev
  ──────────────────────────────────────────────────
  [R] Restart  [Q] Quit

  > 
```

---

## 🛠️ Development

```bash
# Clone the repository
git clone https://github.com/devin00100/port-guard.git
cd port-guard

# Install dependencies
npm install

# Build the project
npm run build

# Link for local testing
npm link

# Run locally
port-guard 3000
```

---

## 🤝 Contributing

Contributions are welcome! Feel free to submit issues and pull requests.

---

## 📄 License

MIT License - feel free to use it in your projects!

---

## 🙏 Acknowledgments

Built with ❤️ by **Deepak Ashok Karai**

Using Node.js and these amazing packages:
- [chalk](https://www.npmjs.com/package/chalk) - Terminal string styling
- [commander](https://www.npmjs.com/package/commander) - CLI interface

---

<div align="center">

**Made with ❤️ for developers who love clean ports**

*If you find this useful, star the repo! ⭐*

</div>
