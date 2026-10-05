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

function checkBackendRunning() {
  return new Promise((resolve) => {
    const req = http.get('http://127.0.0.1:8000/api/v1/health', (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => {
      resolve(false);
    });
    req.setTimeout(2000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function ensureBackendPortAvailable() {
  const inUse = await isPortInUse(8000);
  if (!inUse) return;

  const isHealthy = await checkBackendRunning();
  if (isHealthy) return; // Healthy instance already running

  console.log('\x1b[33m%s\x1b[0m', '⚠️  Port 8000 is occupied by an unresponsive process. Releasing...');
  try {
    execSync('fuser -k 8000/tcp 2>/dev/null || true');
  } catch {}

  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 200));
    if (!(await isPortInUse(8000))) {
      console.log('\x1b[32m%s\x1b[0m', '✓ Port 8000 successfully freed.');
      return;
    }
  }
}

async function main() {
  let backendProc = null;

  await ensureBackendPortAvailable();

  let isRunning = await checkBackendRunning();
  if (!isRunning) {
    console.log('\x1b[36m%s\x1b[0m', '⚡ Starting FastAPI backend server on http://127.0.0.1:8000...');
    backendProc = spawn(pythonPath, ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8000', '--reload'], {
      cwd: apiDir,
      stdio: ['ignore', 'inherit', 'inherit'],
      detached: process.platform !== 'win32',
    });

    backendProc.on('error', (err) => {
      console.error('\x1b[31m%s\x1b[0m', 'Failed to start backend process:', err.message);
    });

    // Wait for backend to initialize (allow up to 60s for full framework imports & cold start)
    const maxAttempts = 120;
    let attempts = 0;
    while (attempts < maxAttempts) {
      await new Promise((r) => setTimeout(r, 500));
      isRunning = await checkBackendRunning();
      if (isRunning) {
        console.log('\x1b[32m%s\x1b[0m', '✓ FastAPI backend is ready and connected!');
        break;
      }
      attempts++;
    }

    if (!isRunning) {
      console.error('\x1b[31m%s\x1b[0m', '❌ Backend failed to start on http://127.0.0.1:8000 within 60s. Aborting frontend startup.');
      if (backendProc && backendProc.pid) {
        try {
          if (process.platform !== 'win32') process.kill(-backendProc.pid, 'SIGKILL');
          else backendProc.kill('SIGKILL');
        } catch {}
      }
      process.exit(1);
    }
  } else {
    console.log('\x1b[32m%s\x1b[0m', '✓ Backend is already running on http://127.0.0.1:8000');
  }

  console.log('\x1b[35m%s\x1b[0m', '⚡ Starting Vite frontend on http://localhost:5173...\n');
  const viteBin = path.resolve(webDir, 'node_modules/.bin/vite');
  const viteProc = spawn(viteBin, process.argv.slice(2), {
    cwd: webDir,
    stdio: 'inherit',
    env: process.env,
  });

  const cleanup = () => {
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
