import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

const apiPort = Number(process.env.API_PORT || process.env.VITE_API_PORT || 3002);
const apiDir = fileURLToPath(new URL('../api', import.meta.url));

const run = (command, args, options = {}) =>
  spawnSync(command, args, {
    stdio: 'inherit',
    shell: false,
    ...options,
  });

const sleep = (ms) => delay(ms);

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const spawnNpm = (args, options = {}) => {
  if (process.platform === 'win32') {
    return spawn('cmd.exe', ['/d', '/s', '/c', 'npm', ...args], {
      shell: false,
      ...options,
    });
  }

  return spawn(npmCommand, args, {
    shell: false,
    ...options,
  });
};

const parseDatabaseTarget = () => {
  const fallback = { host: '127.0.0.1', port: 5433 };

  try {
    const envPath = new URL('../api/.env', import.meta.url);
    const raw = readFileSync(envPath, 'utf8');
    const dbLine = raw
      .split(/\r?\n/)
      .find((line) => line.trim().startsWith('DATABASE_URL='));

    if (!dbLine) {
      return fallback;
    }

    const value = dbLine
      .slice('DATABASE_URL='.length)
      .trim()
      .replace(/^['"]|['"]$/g, '');

    const url = new URL(value);
    const host = url.hostname || fallback.host;
    const port = Number(url.port || 5432);

    return {
      host,
      port: Number.isFinite(port) ? port : fallback.port,
    };
  } catch {
    return fallback;
  }
};

const checkPortOpen = (host, port, timeoutMs = 2000) =>
  new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (result) => {
      if (settled) {
        return;
      }

      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });

const tryStartPostgresServiceWindows = () => {
  const script = [
    "$services = Get-Service | Where-Object { $_.Name -match 'postgres' -or $_.DisplayName -match 'postgres' }",
    "if (-not $services) { exit 1 }",
    "$stopped = $services | Where-Object { $_.Status -ne 'Running' }",
    "foreach ($svc in $stopped) { try { Start-Service -Name $svc.Name -ErrorAction Stop } catch {} }",
    "exit 0",
  ].join('; ');

  const result = run('powershell', ['-NoLogo', '-NoProfile', '-Command', script]);
  return result.status === 0;
};

const ensureDatabaseReadyWithAutoStart = async (host, port) => {
  if (await checkPortOpen(host, port)) {
    return true;
  }

  if (process.platform === 'win32') {
    const attempted = tryStartPostgresServiceWindows();
    if (attempted) {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        if (await checkPortOpen(host, port)) {
          return true;
        }
        await sleep(1000);
      }
    }
  }

  return false;
};

const ensureDatabaseReady = async () => {
  const { host, port } = parseDatabaseTarget();
  const open = await ensureDatabaseReadyWithAutoStart(host, port);

  if (!open) {
    throw new Error(
      `PostgreSQL is not reachable at ${host}:${port}. Start PostgreSQL (or update DATABASE_URL in api/.env), then run npm run dev again.`
    );
  }
};

const checkApiHealth = async () => {
  try {
    const response = await fetch(`http://localhost:${apiPort}/health`);
    return response.ok;
  } catch {
    return false;
  }
};

const startBackend = () => {
  const child = spawnNpm(['run', 'dev'], {
    cwd: apiDir,
    stdio: 'inherit',
  });

  const stop = () => {
    if (!child.killed) {
      child.kill();
    }
  };

  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  return child;
};

const waitForApiHealth = async () => {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await checkApiHealth()) {
      return true;
    }

    await delay(2000);
  }

  return false;
};

const startFrontend = () => {
  const child = spawnNpm(['exec', 'vite', '--', '--host', '0.0.0.0'], {
    stdio: 'inherit',
  });

  const stop = () => {
    if (!child.killed) {
      child.kill();
    }
  };

  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  child.on('exit', (code) => {
    process.exitCode = code ?? 0;
  });
};

try {
  await ensureDatabaseReady();

  const portBusy = await checkPortOpen('127.0.0.1', apiPort);
  const apiHealthy = await checkApiHealth();

  let backend = null;

  if (apiHealthy) {
    console.log(`Using existing API server on http://localhost:${apiPort}`);
  } else if (portBusy) {
    throw new Error(
      `Port ${apiPort} is already in use by a non-healthy process. Stop the process using that port, then rerun npm run dev.`
    );
  } else {
    backend = startBackend();
  }

  const ready = await waitForApiHealth();
  if (!ready) {
    if (backend && backend.exitCode !== null && backend.exitCode !== 0) {
      throw new Error(
        `The backend API exited before becoming healthy. Check api/.env and ensure PostgreSQL is running on the DATABASE_URL host/port, then rerun npm run dev.`
      );
    }

    throw new Error('The backend API did not become healthy in time.');
  }

  startFrontend();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}