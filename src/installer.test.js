import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  CommandExecutionError,
  createLocalSecretsFile,
  generateBetterAuthSecret,
  getPresetSetup,
  initializeAdmin,
  installDependencies,
  migrateDatabase,
  readMysqlConnectionDefaults,
  runCommand,
  updateMysqlEnvironmentFile,
} from './installer.js';

test('secret generation uses 32 random bytes and produces a shell-safe value', () => {
  const requestedSizes = [];
  const secret = generateBetterAuthSecret((size) => {
    requestedSizes.push(size);
    return Buffer.alloc(size, 255);
  });

  assert.deepEqual(requestedSizes, [32]);
  assert.equal(secret.length, 43);
  assert.match(secret, /^[A-Za-z0-9_-]+$/);
});

test('D1 and Node secret files replace only the Better Auth secret', async (t) => {
  for (const fixture of [
    {
      preset: 'cloudflare-d1',
      template: '.dev.vars.example',
      output: '.dev.vars',
      source: 'BETTER_AUTH_SECRET=placeholder\nBETTER_AUTH_URL=http://localhost:4321\n',
    },
    {
      preset: 'node-mysql',
      template: '.env.example',
      output: '.env',
      source: 'MYSQL_HOST=127.0.0.1\nBETTER_AUTH_SECRET=\nEMAIL_PROVIDER=console\n',
    },
  ]) {
    await t.test(fixture.preset, async () => {
      const targetPath = await mkdtemp(join(tmpdir(), 'vk-secrets-'));
      await writeFile(join(targetPath, fixture.template), fixture.source);

      const result = await createLocalSecretsFile(targetPath, fixture.preset, {
        generateSecret: () => 'private-test-value',
      });
      const contents = await readFile(join(targetPath, fixture.output), 'utf8');
      const mode = (await stat(join(targetPath, fixture.output))).mode & 0o777;

      assert.deepEqual(result, { fileName: fixture.output, status: 'created' });
      assert.match(contents, /BETTER_AUTH_SECRET=private-test-value/);
      assert.doesNotMatch(contents, /placeholder/);
      assert.equal(mode, 0o600);
    });
  }
});

test('existing environment files are never overwritten', async () => {
  const targetPath = await mkdtemp(join(tmpdir(), 'vk-secrets-existing-'));
  await writeFile(join(targetPath, '.dev.vars.example'), 'BETTER_AUTH_SECRET=\n');
  await writeFile(join(targetPath, '.dev.vars'), 'KEEP=this-value\n');

  assert.deepEqual(
    await createLocalSecretsFile(targetPath, 'cloudflare-d1', {
      generateSecret: () => 'must-not-be-written',
    }),
    { fileName: '.dev.vars', status: 'existing' },
  );
  assert.equal(
    await readFile(join(targetPath, '.dev.vars'), 'utf8'),
    'KEEP=this-value\n',
  );
});

test('MySQL defaults come from the generated environment example', async () => {
  const targetPath = await mkdtemp(join(tmpdir(), 'vk-mysql-defaults-'));
  await writeFile(
    join(targetPath, '.env.example'),
    [
      'MYSQL_HOST=127.0.0.1',
      'MYSQL_PORT=3306',
      'MYSQL_USER=',
      'MYSQL_PASSWORD=',
      'MYSQL_DATABASE=',
      '',
    ].join('\n'),
  );

  assert.deepEqual(await readMysqlConnectionDefaults(targetPath), {
    host: '127.0.0.1',
    port: '3306',
    user: '',
    password: '',
    database: '',
  });
});

test('MySQL connection entry updates only its five environment values', async () => {
  const targetPath = await mkdtemp(join(tmpdir(), 'vk-mysql-environment-'));
  await writeFile(
    join(targetPath, '.env'),
    [
      'MYSQL_HOST=127.0.0.1',
      'MYSQL_PORT=3306',
      'MYSQL_USER=user',
      'MYSQL_PASSWORD=',
      'MYSQL_DATABASE=database',
      'BETTER_AUTH_SECRET=keep-this-secret',
      'EMAIL_PROVIDER=console',
      '',
    ].join('\n'),
    { mode: 0o600 },
  );

  await updateMysqlEnvironmentFile(targetPath, {
    host: 'db.internal',
    port: '3307',
    user: 'app-user',
    password: 'spaces and "quotes"',
    database: 'vergekit',
  });

  const contents = await readFile(join(targetPath, '.env'), 'utf8');
  assert.match(contents, /^MYSQL_HOST=db\.internal$/m);
  assert.match(contents, /^MYSQL_PORT=3307$/m);
  assert.match(contents, /^MYSQL_USER=app-user$/m);
  assert.match(contents, /^MYSQL_PASSWORD="spaces and \\"quotes\\""$/m);
  assert.match(contents, /^MYSQL_DATABASE=vergekit$/m);
  assert.match(contents, /^BETTER_AUTH_SECRET=keep-this-secret$/m);
  assert.match(contents, /^EMAIL_PROVIDER=console$/m);
});

test('preset setup selects the correct environment file and migration script', () => {
  assert.deepEqual(getPresetSetup('cloudflare-d1'), {
    secretsFile: '.dev.vars',
    secretsTemplate: '.dev.vars.example',
    migrationScript: 'db:migrate:local',
  });
  assert.deepEqual(getPresetSetup('node-mysql'), {
    secretsFile: '.env',
    secretsTemplate: '.env.example',
    migrationScript: 'db:migrate',
  });
});

test('setup command helpers select npm scripts without a shell', async () => {
  const calls = [];
  const runCommandImpl = async (command, args, options) => {
    calls.push({ command, args, options });
  };

  await installDependencies('/tmp/app', { runCommandImpl });
  await migrateDatabase('/tmp/app', 'cloudflare-d1', { runCommandImpl });
  await migrateDatabase('/tmp/app', 'node-mysql', { runCommandImpl });
  await initializeAdmin('/tmp/app', { runCommandImpl });

  assert.deepEqual(calls, [
    { command: 'npm', args: ['install'], options: { cwd: '/tmp/app' } },
    {
      command: 'npm',
      args: ['run', 'db:migrate:local'],
      options: { cwd: '/tmp/app' },
    },
    {
      command: 'npm',
      args: ['run', 'db:migrate'],
      options: { cwd: '/tmp/app' },
    },
    {
      command: 'npm',
      args: ['run', 'init:admin'],
      options: { cwd: '/tmp/app' },
    },
  ]);
});

test('subprocess output is inherited and nonzero exits remain actionable', async () => {
  const spawnCalls = [];
  const spawnImpl = (command, args, options) => {
    spawnCalls.push({ command, args, options });
    const child = new EventEmitter();
    queueMicrotask(() => child.emit('exit', 7, null));
    return child;
  };

  await assert.rejects(
    () =>
      runCommand('npm', ['install'], {
        cwd: '/tmp/app',
        spawnImpl,
      }),
    (error) =>
      error instanceof CommandExecutionError &&
      error.code === 7 &&
      /npm install failed with exit code 7/.test(error.message),
  );
  assert.deepEqual(spawnCalls, [
    {
      command: 'npm',
      args: ['install'],
      options: { cwd: '/tmp/app', stdio: 'inherit', shell: false },
    },
  ]);
});
