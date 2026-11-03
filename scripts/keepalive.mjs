#!/usr/bin/env node
/**
 * Keeps the app and API ports warm.
 *
 * Cloud previews go stale when nothing is listening, so this polls both
 * services on an interval, restarts whichever one stopped answering, and
 * reinstalls dependencies when a sandbox restore has wiped them. It is meant to
 * be started detached and left alone:
 *
 *   setsid nohup node scripts/keepalive.mjs > /tmp/logs/keepalive.log 2>&1 &
 *
 * Options (env): APP_PORT (3000), API_PORT (5000), INTERVAL_MS (20000),
 * KEEPALIVE_LOG_DIR (/tmp/logs). Pass --once to run a single check pass.
 */
import { spawn, execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, openSync } from 'node:fs';
import { get } from 'node:http';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP_PORT = Number(process.env.APP_PORT || 3000);
const API_PORT = Number(process.env.API_PORT || 5000);
const INTERVAL_MS = Number(process.env.INTERVAL_MS || 20000);
const LOG_DIR = process.env.KEEPALIVE_LOG_DIR || '/tmp/logs';
const ONCE = process.argv.includes('--once');

mkdirSync(LOG_DIR, { recursive: true });

// pnpm lives in a per-user tools directory on this image; make sure child
// processes can find it even when started from a bare shell.
const env = {
  ...process.env,
  PATH: [
    path.join(homedir(), 'tools', 'node_modules', '.bin'),
    process.env.PATH || '',
  ]
    .filter(Boolean)
    .join(':'),
};

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  process.stdout.write(line);
  try {
    appendFileSync(path.join(LOG_DIR, 'keepalive.log'), line);
  } catch {
    /* logging must never break the watchdog */
  }
}

function probe(port, pathname = '/') {
  return new Promise((resolve) => {
    const req = get({ host: '127.0.0.1', port, path: pathname, timeout: 6000 }, (res) => {
      res.resume();
      resolve(res.statusCode && res.statusCode < 500 ? res.statusCode : null);
    });
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.on('error', () => resolve(null));
  });
}

function launch(name, command, args, extraEnv) {
  const out = openSync(path.join(LOG_DIR, `${name}.log`), 'a');
  const child = spawn(command, args, {
    cwd: ROOT,
    env: { ...env, ...extraEnv },
    detached: true,
    stdio: ['ignore', out, out],
  });
  child.unref();
  log(`started ${name} pid ${child.pid} -> ${LOG_DIR}/${name}.log`);
  return child.pid;
}

function ensureDependencies() {
  if (existsSync(path.join(ROOT, 'node_modules'))) return true;
  log('node_modules missing (sandbox restore?) — installing from the lockfile');
  try {
    execFileSync('pnpm', ['install', '--frozen-lockfile'], {
      cwd: ROOT,
      env,
      stdio: 'pipe',
      timeout: 240_000,
    });
    log('dependencies installed');
    return true;
  } catch (error) {
    log(`dependency install failed: ${error?.message || error}`);
    return false;
  }
}

function ensureApi() {
  launch('api', 'node', ['--enable-source-maps', 'artifacts/api-server/dist/index.mjs'], {
    PORT: String(API_PORT),
    NODE_ENV: process.env.NODE_ENV || 'development',
  });
}

function ensureApp() {
  launch(
    'app',
    'pnpm',
    ['--filter', '@workspace/browser-control', 'run', 'dev'],
    {
      PORT: String(APP_PORT),
      BASE_PATH: '/',
      API_PROXY_TARGET: `http://127.0.0.1:${API_PORT}`,
      CI: '1',
    },
  );
}

const state = { api: false, app: false };
const lastLaunch = { api: 0, app: 0 };
const GRACE_MS = 45_000;

function recentlyLaunched(name) {
  return Date.now() - lastLaunch[name] < GRACE_MS;
}

async function pass() {
  if (!ensureDependencies()) return;

  const api = await probe(API_PORT, '/api/healthz');
  const app = await probe(APP_PORT, '/');

  if (!api && state.api) log(`api on :${API_PORT} stopped answering — restarting`);
  else if (!api) log(`api on :${API_PORT} is down — starting it`);
  if (!app && state.app) log(`app on :${APP_PORT} stopped answering — restarting`);
  else if (!app) log(`app on :${APP_PORT} is down — starting it`);

  // A restart takes a while to bind; only relaunch when the port is truly dead
  // and nothing else has just been started for it.
  if (!api && !recentlyLaunched('api')) {
    lastLaunch.api = Date.now();
    ensureApi();
  }
  if (!app && !recentlyLaunched('app')) {
    lastLaunch.app = Date.now();
    ensureApp();
  }

  state.api = Boolean(api);
  state.app = Boolean(app);
  log(`app :${APP_PORT} ${app ? `ok (${app})` : 'restarting'} · api :${API_PORT} ${api ? `ok (${api})` : 'restarting'}`);
}

await pass();
if (!ONCE) {
  log(`watching every ${INTERVAL_MS / 1000}s`);
  setInterval(pass, INTERVAL_MS);
}
