#!/usr/bin/env node

import { execSync, spawn } from 'child_process';
import http from 'http';
import net from 'net';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const webDir = path.resolve(__dirname, '..');
const apiDir = path.resolve(webDir, '../api');
const pythonPath = path.resolve(apiDir, '.venv/bin/python');

function isPortInUse(port) {
  return new Promise((resolve) => {
    const tester = net
      .createServer()
      .once('error', (err) => {
        resolve(err.code === 'EADDRINUSE');
      })
      .once('listening', () => {
        tester.close(() => resolve(false));
      })
      .listen(port, '127.0.0.1');
  });
}

function checkBackendRunning(timeoutMs = 5000) {
  return new Promise((resolve) => {
    let resolved = false;
    const done = (val) => {
      if (!resolved) {
        resolved = true;
        resolve(val);
      }
    };

    try {
      const req = http.get(
        'http://127.0.0.1:8000/api/v1/health',
        {
          agent: false,
          headers: { Connection: 'close' },
          timeout: timeoutMs,
        },
        (res) => {
          res.resume();
          done(res.statusCode === 200);
        }
      );

      req.on('error', () => {
        done(false);
      });

      req.on('timeout', () => {
        req.destroy();
        done(false);
      });
    } catch {
      done(false);
    }
  });
}

function isOurProcessAlive(proc) {
  if (!proc || !proc.pid) return false;
  try {
    process.kill(proc.pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function stopOurBackendProcess() {
  if (!backendProc || !backendProc.pid) return;
  const pid = backendProc.pid;
  if (!isOurProcessAlive(backendProc)) {
    backendProc = null;
    return;
  }

  console.log('\x1b[33m%s\x1b[0m', `🛑 Gracefully stopping owned backend process (PID: ${pid})...`);
  try {
    if (process.platform !== 'win32') {
      process.kill(-pid, 'SIGTERM');
    } else {
      backendProc.kill('SIGTERM');
    }
  } catch {}

  // Wait up to 3s for graceful exit
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 200));
    if (!isOurProcessAlive(backendProc)) {
      backendProc = null;
      return;
    }
  }

  // Force kill if still hung
  try {
    console.warn('\x1b[31m%s\x1b[0m', `⚠️ Backend process ${pid} did not terminate gracefully; sending SIGKILL...`);
    if (process.platform !== 'win32') {
      process.kill(-pid, 'SIGKILL');
    } else {
      backendProc.kill('SIGKILL');
    }
  } catch {}
  backendProc = null;
}

function getProcessInfoOnPort(port) {
  try {
    if (process.platform === 'win32') {
      const netstat = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8' });
      const lines = netstat.trim().split('\n');
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && !isNaN(pid)) {
          return { pid: parseInt(pid, 10), cmd: '' };
        }
      }
    } else {
      const pids = execSync(`lsof -ti :${port}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n');
      for (const rawPid of pids) {
        const pid = parseInt(rawPid.trim(), 10);
        if (pid && !isNaN(pid)) {
          const cmd = execSync(`ps -p ${pid} -o args=`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
          return { pid, cmd };
        }
      }
    }
  } catch {
    return null;
  }
  return null;
}

async function ensureBackendPortAvailable() {
  const inUse = await isPortInUse(8000);
  if (!inUse) return true;

  const isHealthy = await checkBackendRunning(3000);
  if (isHealthy) return true; // Healthy instance already running

  // If port 8000 is occupied by an unresponsive process, check if it's OUR child process
  if (backendProc && isOurProcessAlive(backendProc)) {
    console.log('\x1b[33m%s\x1b[0m', '⚠️  Port 8000 is occupied by an unresponsive owned backend process. Stopping...');
    await stopOurBackendProcess();
  } else {
    // Check if the occupying process is an orphaned JobFinder / uvicorn instance
    const procInfo = getProcessInfoOnPort(8000);
    const isOrphanedJobFinder = procInfo && (
      procInfo.cmd.includes('app.main:app') ||
      procInfo.cmd.includes('jobFinder/apps/api') ||
      procInfo.cmd.includes('uvicorn')
    );

    if (isOrphanedJobFinder) {
      console.log(
        '\x1b[33m%s\x1b[0m',
        `⚠️  Port 8000 is occupied by an unresponsive orphaned JobFinder backend process (PID: ${procInfo.pid}). Terminating...`
      );
      try {
        if (process.platform !== 'win32') {
          process.kill(-procInfo.pid, 'SIGKILL');
        } else {
          process.kill(procInfo.pid, 'SIGKILL');
        }
      } catch {
        try {
          process.kill(procInfo.pid, 'SIGKILL');
        } catch {}
      }
    } else {
      // Port 8000 is occupied by an external/unrelated process. Do NOT blindly kill with fuser!
      console.warn(
        '\x1b[33m%s\x1b[0m',
        `⚠️  Port 8000 is occupied by an external process (${procInfo?.cmd?.slice(0, 60) || 'unknown'}). Preserving process without termination.`
      );
    }
  }

  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 200));
    if (!(await isPortInUse(8000))) {
      console.log('\x1b[32m%s\x1b[0m', '✓ Port 8000 successfully freed.');
      return true;
    }
  }
  return !(await isPortInUse(8000));
}

let backendProc = null;
let isShuttingDown = false;
let isStartingBackend = false;

async function startBackend() {
  if (isShuttingDown || isStartingBackend) return;
  isStartingBackend = true;

  try {
    const isPortReady = await ensureBackendPortAvailable();
    if (!isPortReady) {
      console.warn(
        '\x1b[33m%s\x1b[0m',
        '⚠️  FastAPI backend server cannot be started because port 8000 is occupied. Will retry on next health check cycle.'
      );
      return;
    }

    let isRunning = await checkBackendRunning();
    if (!isRunning) {
      console.log('\x1b[36m%s\x1b[0m', '⚡ Starting FastAPI backend server on http://127.0.0.1:8000...');
      const spawnTime = Date.now();
      backendProc = spawn(pythonPath, ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8000', '--reload'], {
        cwd: apiDir,
        stdio: ['ignore', 'inherit', 'inherit'],
        detached: process.platform !== 'win32',
      });

      backendProc.on('error', (err) => {
        console.error('\x1b[31m%s\x1b[0m', 'Failed to start backend process:', err.message);
      });

      backendProc.on('exit', (code, signal) => {
        backendProc = null;
        if (!isShuttingDown) {
          const runDuration = Date.now() - spawnTime;
          const retryDelay = runDuration < 3000 ? 5000 : 2000;
          console.warn('\x1b[33m%s\x1b[0m', `⚠️  FastAPI backend process exited (code: ${code}, signal: ${signal}). Auto-restarting in ${retryDelay / 1000}s...`);
          setTimeout(() => {
            if (!isShuttingDown) startBackend();
          }, retryDelay);
        }
      });

      // Wait for backend to initialize (allow up to 60s for full framework imports & cold start)
      const maxAttempts = 120;
      let attempts = 0;
      while (attempts < maxAttempts) {
        if (!backendProc || !isOurProcessAlive(backendProc)) {
          // Process exited early; terminate wait loop immediately
          break;
        }
        await new Promise((r) => setTimeout(r, 500));
        isRunning = await checkBackendRunning();
        if (isRunning) {
          console.log('\x1b[32m%s\x1b[0m', '✓ FastAPI backend is ready and connected!');
          break;
        }
        attempts++;
      }

      if (!isRunning && (!backendProc || !isOurProcessAlive(backendProc))) {
        // Process crash already reported by on('exit')
      } else if (!isRunning) {
        console.error('\x1b[31m%s\x1b[0m', '❌ Backend failed to start on http://127.0.0.1:8000 within 60s.');
      }
    } else {
      console.log('\x1b[32m%s\x1b[0m', '✓ Backend is already running on http://127.0.0.1:8000');
    }
  } finally {
    isStartingBackend = false;
  }
}

async function main() {
  await startBackend();

  console.log('\x1b[35m%s\x1b[0m', '⚡ Starting Vite frontend on http://localhost:5173...\n');
  const viteBin = path.resolve(webDir, 'node_modules/.bin/vite');
  const viteProc = spawn(viteBin, process.argv.slice(2), {
    cwd: webDir,
    stdio: 'inherit',
    env: process.env,
  });

  // Watchdog: poll health every 5 seconds with consecutive failure threshold
  let consecutiveFailures = 0;
  let isCheckingHealth = false;
  let recoveryAttempts = 0;
  let lastRecoveryTime = 0;
  const FAILURE_THRESHOLD = 3;
  const MAX_RECOVERIES = 3;
  const COOLDOWN_MS = 30000;

  const watchdogInterval = setInterval(async () => {
    if (isShuttingDown || isStartingBackend || isCheckingHealth) return;

    // Cooldown check if recovery failed repeatedly
    if (recoveryAttempts >= MAX_RECOVERIES) {
      if (Date.now() - lastRecoveryTime < COOLDOWN_MS) {
        return; // In cooldown period
      }
      recoveryAttempts = 0;
    }

    isCheckingHealth = true;
    try {
      const healthy = await checkBackendRunning(5000);
      if (healthy) {
        if (consecutiveFailures > 0) {
          console.log('\x1b[32m%s\x1b[0m', '✓ Backend health restored; resetting failure counter.');
        }
        consecutiveFailures = 0;
        recoveryAttempts = 0;
      } else if (!isShuttingDown) {
        consecutiveFailures++;
        console.warn(
          '\x1b[33m%s\x1b[0m',
          `⚠️  Backend health check failed (${consecutiveFailures}/${FAILURE_THRESHOLD}).`
        );
        if (consecutiveFailures >= FAILURE_THRESHOLD) {
          console.warn(
            '\x1b[31m%s\x1b[0m',
            `❌ Backend unresponsive for ${consecutiveFailures} consecutive checks. Initiating controlled revival...`
          );
          recoveryAttempts++;
          lastRecoveryTime = Date.now();
          consecutiveFailures = 0;
          await startBackend();
        }
      }
    } finally {
      isCheckingHealth = false;
    }
  }, 15000);

  const cleanup = () => {
    isShuttingDown = true;
    clearInterval(watchdogInterval);
    if (backendProc && backendProc.pid) {
      try {
        if (process.platform !== 'win32') {
          process.kill(-backendProc.pid, 'SIGTERM');
        } else {
          backendProc.kill('SIGTERM');
        }
      } catch {}
    }
    process.exit();
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  process.on('exit', cleanup);

  viteProc.on('close', (code) => {
    cleanup();
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
