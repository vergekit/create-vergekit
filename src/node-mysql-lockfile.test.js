import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
  parseUpdateArguments,
  updateNodeMysqlLockfile,
} from '../scripts/update-node-mysql-lockfile.mjs';

async function createFixture() {
  const rootPath = await mkdtemp(join(tmpdir(), 'create-node-lock-test-'));
  const boilerplatePath = join(rootPath, 'boilerplate');
  const lockfilePath = join(rootPath, 'package-lock.json');
  await mkdir(boilerplatePath);

  const canonicalPackage = {
    name: 'Verge Kit',
    version: '0.1.3',
    scripts: {
      dev: 'astro dev',
      'db:migrate:local': 'wrangler d1 migrations apply vk --local',
      'db:migrate:remote': 'wrangler d1 migrations apply vk --remote',
    },
    dependencies: {
      '@astrojs/cloudflare': '^14.0.1',
      astro: '^7.0.4',
      'drizzle-orm': '^0.45.2',
    },
    devDependencies: {
      '@cloudflare/workers-types': '^4.0.0',
      wrangler: '^4.0.0',
    },
    allowScripts: {
      'esbuild@0.28.1': true,
      fsevents: false,
      msw: false,
      'sharp@0.34.5': true,
      'workerd@1.20260617.1': true,
    },
  };
  await writeFile(
    join(boilerplatePath, 'package.json'),
    `${JSON.stringify(canonicalPackage, null, 2)}\n`,
  );
  await writeFile(lockfilePath, '{"sentinel":true}\n');

  return { boilerplatePath, lockfilePath };
}

function createLockfile(packageJson) {
  return {
    name: packageJson.name,
    version: packageJson.version,
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': {
        name: packageJson.name,
        version: packageJson.version,
        dependencies: packageJson.dependencies,
        devDependencies: packageJson.devDependencies,
        engines: packageJson.engines,
      },
      'node_modules/@astrojs/node': {},
      'node_modules/dotenv': {},
      'node_modules/mysql2': {},
    },
  };
}

test('lockfile updater composes the Node manifest and atomically replaces the template lock', async () => {
  const fixture = await createFixture();
  let installedPackage;

  const result = await updateNodeMysqlLockfile({
    ...fixture,
    installPackageLock: async (workspacePath) => {
      installedPackage = JSON.parse(
        await readFile(join(workspacePath, 'package.json'), 'utf8'),
      );
      await writeFile(
        join(workspacePath, 'package-lock.json'),
        `${JSON.stringify(createLockfile(installedPackage), null, 2)}\n`,
      );
    },
    log: () => {},
  });

  assert.equal(installedPackage.dependencies.astro, '^7.0.4');
  assert.equal(installedPackage.dependencies['@astrojs/cloudflare'], undefined);
  assert.equal(installedPackage.dependencies['@astrojs/node'], '^11.0.2');
  assert.equal(installedPackage.dependencies.mysql2, '^3.23.0');
  assert.equal(installedPackage.devDependencies.wrangler, undefined);
  assert.equal(installedPackage.scripts['db:migrate:local'], undefined);
  assert.equal(installedPackage.scripts['db:migrate'], 'drizzle-kit migrate');
  assert.equal(installedPackage.allowScripts['esbuild@0.28.1'], true);
  assert.equal(installedPackage.allowScripts.fsevents, false);
  assert.equal(installedPackage.allowScripts.msw, false);
  assert.equal(installedPackage.allowScripts['sharp@0.34.5'], true);
  assert.equal(
    installedPackage.allowScripts['workerd@1.20260617.1'],
    undefined,
  );
  assert.deepEqual(
    JSON.parse(await readFile(fixture.lockfilePath, 'utf8')),
    result.packageLock,
  );
});

test('lockfile updater preserves the existing lock when npm fails', async () => {
  const fixture = await createFixture();
  const originalLock = await readFile(fixture.lockfilePath, 'utf8');

  await assert.rejects(
    updateNodeMysqlLockfile({
      ...fixture,
      installPackageLock: async () => {
        throw new Error('npm failed');
      },
      log: () => {},
    }),
    /npm failed/,
  );

  assert.equal(await readFile(fixture.lockfilePath, 'utf8'), originalLock);
});

test('lockfile updater parses its maintenance CLI arguments', () => {
  assert.deepEqual(parseUpdateArguments(['--boilerplate', '../custom']), {
    boilerplatePath: resolve('../custom'),
    help: false,
  });
  assert.equal(parseUpdateArguments(['--help']).help, true);
  assert.throws(
    () => parseUpdateArguments(['--boilerplate']),
    /Missing value for --boilerplate/,
  );
  assert.throws(() => parseUpdateArguments(['--wat']), /Unknown option/);
});
