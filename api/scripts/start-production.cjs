const fs = require('fs');
const path = require('path');
const net = require('net');
const { spawn, spawnSync } = require('child_process');
const { URL } = require('url');
const { PrismaClient, Prisma } = require('@prisma/client');
const { loadSecrets, getRequiredSecret } = require('./secrets-manager.cjs');
let prisma;
let databaseUrl;

function waitForDatabase() {
  const parsedUrl = new URL(databaseUrl);
  const host = parsedUrl.hostname;
  const port = Number(parsedUrl.port || 5432);
  const deadline = Date.now() + 60000;

  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect(port, host);

      socket.once('connect', () => {
        socket.end();
        resolve();
      });

      socket.once('error', () => {
        socket.destroy();

        if (Date.now() >= deadline) {
          reject(new Error(`Database not reachable at ${host}:${port}`));
          return;
        }

        setTimeout(attempt, 1000);
      });
    };

    attempt();
  });
}

function runStep(command, args, label) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env: process.env,
    shell: process.platform === 'win32',
  });

  if (result.status !== 0) {
    const exitCode = result.status === null ? 'unknown' : String(result.status);
    throw new Error(`${label} failed with exit code ${exitCode}`);
  }
}

function getCommittedMigrations() {
  const migrationsDir = path.join(__dirname, '..', 'prisma', 'migrations');
  if (!fs.existsSync(migrationsDir)) {
    return [];
  }

  return fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d+_.+/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

async function migrationHistoryExists() {
  try {
    const rows = await prisma.$queryRaw`
      SELECT to_regclass('public."_prisma_migrations"') AS "tableName"
    `;
    return Boolean(rows?.[0]?.tableName);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2021' || error.code === 'P2022')) {
      return false;
    }

    throw error;
  }
}

async function hasCoreSchemaTables() {
  try {
    const rows = await prisma.$queryRaw`
      SELECT
        to_regclass('public."User"') AS "userTable",
        to_regclass('public."Request"') AS "requestTable",
        to_regclass('public."RequestHistory"') AS "historyTable"
    `;
    const firstRow = rows?.[0] || {};
    return Boolean(firstRow.userTable || firstRow.requestTable || firstRow.historyTable);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2021' || error.code === 'P2022')) {
      return false;
    }

    throw error;
  }
}

function applyLegacyMigrationBaseline(migrations) {
  for (const migrationName of migrations) {
    runStep('npx', ['prisma', 'migrate', 'resolve', '--applied', migrationName], `Mark migration applied: ${migrationName}`);
  }
}

async function applySchema() {
  const committedMigrations = getCommittedMigrations();
  const hasMigrationHistory = await migrationHistoryExists();

  if (!hasMigrationHistory) {
    const hasCoreSchema = await hasCoreSchemaTables();

    if (hasCoreSchema) {
      console.log('Legacy schema detected without Prisma migration history. Syncing schema and baselining migrations...');
      runStep('npx', ['prisma', 'db', 'push', '--skip-generate'], 'Prisma schema sync');
      applyLegacyMigrationBaseline(committedMigrations);
      return;
    }
  }

  console.log('Applying Prisma migrations...');
  runStep('npx', ['prisma', 'migrate', 'deploy'], 'Prisma migrations');
}

async function shouldRestoreCoreData() {
  try {
    const [userCount, requestCount, historyCount] = await Promise.all([
      prisma.user.count(),
      prisma.request.count(),
      prisma.requestHistory.count(),
    ]);

    return userCount === 0 || requestCount === 0 || historyCount === 0;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2021' || error.code === 'P2022') {
        return true;
      }
    }

    throw error;
  }
}

function hasRestoreSource() {
  return true;
}

async function main() {
  try {
    await loadSecrets({ secrets: ['DATABASE_URL'] });
    databaseUrl = getRequiredSecret('DATABASE_URL');
    process.env.DATABASE_URL = databaseUrl;
    prisma = new PrismaClient();

    await waitForDatabase();
    await applySchema();

    const restoreNeeded = await shouldRestoreCoreData();
    if (restoreNeeded) {
      console.log('Core database data is missing or incomplete. Restoring from Firestore...');
      runStep('node', ['scripts/restoreFirestore.cjs'], 'Firestore data restore');
    } else {
      console.log('Core database data already present. Skipping restore.');
    }

    await prisma.$disconnect();

    const server = spawn('node', ['dist/index.js'], {
      stdio: 'inherit',
      env: process.env,
      shell: process.platform === 'win32',
    });

    const stopServer = (signal) => {
      if (!server.killed) {
        server.kill(signal);
      }
    };

    process.on('SIGINT', () => stopServer('SIGINT'));
    process.on('SIGTERM', () => stopServer('SIGTERM'));

    server.on('exit', (code, signal) => {
      if (signal) {
        process.exit(0);
        return;
      }

      process.exit(code === null ? 0 : code);
    });
  } catch (error) {
    console.error('Startup failed:', error);
    try {
      await prisma.$disconnect();
    } catch {
      // Ignore disconnect errors during shutdown.
    }
    process.exit(1);
  }
}

main();
