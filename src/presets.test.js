import assert from 'node:assert/strict';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

import {
  applyPreset,
  composePresetPackageJson,
  DEFAULT_PRESET,
  SUPPORTED_PRESETS,
  validatePreset,
  validateStagedProject,
} from './presets.js';

test('preset constants keep Cloudflare as the default and list both presets', () => {
  assert.equal(DEFAULT_PRESET, 'cloudflare-d1');
  assert.deepEqual(SUPPORTED_PRESETS, ['cloudflare-d1', 'node-mysql']);
});

test('validatePreset rejects unsupported values clearly', () => {
  assert.throws(
    () => validatePreset('postgres'),
    /Unsupported preset "postgres".*cloudflare-d1, node-mysql/,
  );
});

test('composePresetPackageJson derives Node dependencies without mutating the canonical manifest', () => {
  const canonicalPackage = {
    name: 'vk',
    scripts: {
      dev: 'astro dev',
      'db:migrate:local': 'wrangler d1 migrations apply vk --local',
    },
    dependencies: {
      '@astrojs/cloudflare': '^14.0.1',
      astro: '^7.0.3',
    },
    devDependencies: {
      '@cloudflare/workers-types': '^4.0.0',
      wrangler: '^4.0.0',
    },
  };

  const nodePackage = composePresetPackageJson(
    canonicalPackage,
    'node-mysql',
  );

  assert.equal(canonicalPackage.dependencies['@astrojs/cloudflare'], '^14.0.1');
  assert.equal(nodePackage.dependencies['@astrojs/cloudflare'], undefined);
  assert.equal(nodePackage.dependencies['@astrojs/node'], '^11.0.2');
  assert.equal(nodePackage.dependencies.astro, '^7.0.3');
  assert.equal(nodePackage.dependencies.mysql2, '^3.23.0');
  assert.equal(nodePackage.devDependencies.wrangler, undefined);
  assert.equal(nodePackage.scripts['db:migrate:local'], undefined);
  assert.equal(nodePackage.scripts['db:migrate'], 'drizzle-kit migrate');
});

test('cloudflare-d1 is a validated no-op', async () => {
  const stagingPath = await mkdtemp(join(tmpdir(), 'create-vergekit-staging-'));
  const packageJson = '{"name":"vk","private":true}\n';
  const readme = '# Cloudflare app\n';
  await writeFile(join(stagingPath, 'package.json'), packageJson);
  await writeFile(join(stagingPath, 'README.md'), readme);

  await applyPreset(stagingPath, 'cloudflare-d1');

  assert.equal(
    await readFile(join(stagingPath, 'package.json'), 'utf8'),
    packageJson,
  );
  assert.equal(await readFile(join(stagingPath, 'README.md'), 'utf8'), readme);
});

test('node preset composition copies an overlay, removes paths, and mutates package.json structurally', async () => {
  const stagingPath = await mkdtemp(join(tmpdir(), 'create-vergekit-staging-'));
  const templatesPath = await mkdtemp(
    join(tmpdir(), 'create-vergekit-templates-'),
  );
  const overlayPath = join(templatesPath, 'node-mysql');

  await mkdir(join(stagingPath, 'drizzle', 'd1'), { recursive: true });
  await mkdir(join(overlayPath, 'src'), { recursive: true });
  await writeFile(
    join(stagingPath, 'package.json'),
    `${JSON.stringify(
      {
        name: 'vk',
        scripts: { dev: 'astro dev', deploy: 'wrangler deploy' },
        dependencies: {
          '@astrojs/cloudflare': '1.0.0',
          astro: '7.0.3',
        },
        devDependencies: { wrangler: '4.0.0' },
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(join(stagingPath, 'wrangler.jsonc'), '{}\n');
  await writeFile(join(stagingPath, 'drizzle', 'd1', '0000.sql'), '-- d1\n');
  await writeFile(join(stagingPath, 'README.md'), '# Cloudflare\n');
  await writeFile(join(overlayPath, 'README.md'), '# Node\n');
  await writeFile(
    join(overlayPath, 'src', 'runtime.ts'),
    'export const runtimeEnv = process.env;\n',
  );

  const presetDefinitions = {
    'node-mysql': {
      overlayDirectory: 'node-mysql',
      removePaths: ['wrangler.jsonc', 'drizzle/d1'],
      packageJson: {
        remove: {
          scripts: ['deploy'],
          dependencies: ['@astrojs/cloudflare'],
          devDependencies: ['wrangler'],
        },
        merge: {
          scripts: {
            start: 'node ./dist/server/entry.mjs',
          },
          dependencies: {
            '@astrojs/node': '1.0.0',
            mysql2: '3.0.0',
          },
        },
      },
      requiredPaths: ['package.json', 'README.md', 'src/runtime.ts'],
      forbiddenPaths: ['templates', 'wrangler.jsonc', 'drizzle/d1'],
    },
  };

  await applyPreset(stagingPath, 'node-mysql', {
    templatesPath,
    presetDefinitions,
  });

  const packageJson = JSON.parse(
    await readFile(join(stagingPath, 'package.json'), 'utf8'),
  );
  assert.equal(
    await readFile(join(stagingPath, 'README.md'), 'utf8'),
    '# Node\n',
  );
  assert.equal(
    await readFile(join(stagingPath, 'src', 'runtime.ts'), 'utf8'),
    'export const runtimeEnv = process.env;\n',
  );
  assert.equal(packageJson.dependencies.astro, '7.0.3');
  assert.equal(packageJson.dependencies['@astrojs/cloudflare'], undefined);
  assert.equal(packageJson.dependencies['@astrojs/node'], '1.0.0');
  assert.equal(packageJson.dependencies.mysql2, '3.0.0');
  assert.equal(packageJson.scripts.dev, 'astro dev');
  assert.equal(packageJson.scripts.deploy, undefined);
  assert.equal(packageJson.scripts.start, 'node ./dist/server/entry.mjs');
  assert.equal(packageJson.devDependencies.wrangler, undefined);
  await assert.rejects(() => readFile(join(stagingPath, 'wrangler.jsonc')));
  await assert.rejects(() =>
    readFile(join(stagingPath, 'drizzle', 'd1', '0000.sql')),
  );
  await assert.rejects(() => readFile(join(stagingPath, 'templates')));
});

test('staged validation rejects preset metadata in generated output', async () => {
  const stagingPath = await mkdtemp(join(tmpdir(), 'create-vergekit-staging-'));
  await mkdir(join(stagingPath, 'templates'));
  await writeFile(
    join(stagingPath, 'package.json'),
    `${JSON.stringify({ name: 'vk' }, null, 2)}\n`,
  );

  await assert.rejects(
    () => validateStagedProject(stagingPath, 'cloudflare-d1'),
    /contains forbidden path: templates/,
  );
});

test('the shipped Node overlay selects standalone Node, MySQL, and Node-only dependencies', async () => {
  const stagingPath = await mkdtemp(join(tmpdir(), 'create-vergekit-staging-'));
  const canonicalIndex = '<h1>Cloudflare Workers</h1>\n';
  await mkdir(join(stagingPath, 'src', 'pages'), { recursive: true });
  await writeFile(
    join(stagingPath, 'package.json'),
    `${JSON.stringify(
      {
        name: 'vk',
        version: '0.1.2',
        scripts: {
          dev: 'astro dev',
          build: 'astro build',
          'db:generate': 'drizzle-kit generate',
          'db:migrate:local': 'wrangler d1 migrations apply vk --local',
          'db:migrate:remote': 'wrangler d1 migrations apply vk --remote',
        },
        dependencies: {
          '@astrojs/cloudflare': '^14.0.1',
          astro: '^7.0.3',
          'drizzle-orm': '^0.45.2',
        },
        devDependencies: {
          '@cloudflare/workers-types': '^4.20260619.1',
          'drizzle-kit': '^0.31.10',
          wrangler: '^4.103.0',
        },
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    join(stagingPath, 'src', 'pages', 'index.astro'),
    canonicalIndex,
  );

  await applyPreset(stagingPath, 'node-mysql');

  const packageJson = JSON.parse(
    await readFile(join(stagingPath, 'package.json'), 'utf8'),
  );
  const packageLock = JSON.parse(
    await readFile(join(stagingPath, 'package-lock.json'), 'utf8'),
  );
  const astroConfig = await readFile(
    join(stagingPath, 'astro.config.mjs'),
    'utf8',
  );
  const runtimeSource = await readFile(
    join(stagingPath, 'src', 'runtime.ts'),
    'utf8',
  );
  const databaseSource = await readFile(
    join(stagingPath, 'src', 'db.ts'),
    'utf8',
  );
  const environmentTypes = await readFile(
    join(stagingPath, 'src', 'env.d.ts'),
    'utf8',
  );
  const drizzleConfig = await readFile(
    join(stagingPath, 'drizzle.config.ts'),
    'utf8',
  );
  const envExample = await readFile(
    join(stagingPath, '.env.example'),
    'utf8',
  );
  const gitignore = await readFile(join(stagingPath, '.gitignore'), 'utf8');
  const initAdminSource = await readFile(
    join(stagingPath, 'cli', 'init-admin.ts'),
    'utf8',
  );
  const authRuntimeTest = await readFile(
    join(stagingPath, 'tests', 'auth', 'runtime-seam.test.ts'),
    'utf8',
  );
  const initAdminTest = await readFile(
    join(stagingPath, 'tests', 'cli', 'init-admin.test.ts'),
    'utf8',
  );
  const homepage = await readFile(
    join(stagingPath, 'src', 'pages', 'index.astro'),
    'utf8',
  );

  assert.match(astroConfig, /from '@astrojs\/node'/);
  assert.equal(homepage, canonicalIndex);
  assert.match(astroConfig, /mode: 'standalone'/);
  assert.doesNotMatch(astroConfig, /cloudflare|sessionDrivers/);
  assert.equal(
    runtimeSource,
    "import 'dotenv/config';\n\nexport const runtimeEnv = process.env;\n",
  );
  assert.match(databaseSource, /from 'drizzle-orm\/mysql2'/);
  assert.match(databaseSource, /from 'mysql2\/promise'/);
  assert.match(databaseSource, /authDatabaseProvider = 'mysql'/);
  assert.match(databaseSource, /timezone: 'Z'/);
  assert.match(databaseSource, /MYSQL_HOST/);
  assert.match(databaseSource, /MYSQL_PORT/);
  assert.match(databaseSource, /MYSQL_USER/);
  assert.match(databaseSource, /MYSQL_PASSWORD/);
  assert.match(databaseSource, /MYSQL_DATABASE/);
  assert.doesNotMatch(databaseSource, /DATABASE_URL/);
  assert.match(databaseSource, /closeDatabasePool/);
  assert.doesNotMatch(databaseSource, /config\/schema|cloudflare:workers/);
  assert.match(environmentTypes, /reference types="node"/);
  assert.match(environmentTypes, /interface ProcessEnv/);
  assert.match(environmentTypes, /MYSQL_HOST/);
  assert.match(environmentTypes, /MYSQL_PORT/);
  assert.match(environmentTypes, /MYSQL_USER/);
  assert.match(environmentTypes, /MYSQL_PASSWORD/);
  assert.match(environmentTypes, /MYSQL_DATABASE/);
  assert.doesNotMatch(environmentTypes, /Cloudflare|workers-types|D1Database/);
  assert.match(drizzleConfig, /import 'dotenv\/config'/);
  assert.match(drizzleConfig, /dialect: 'mysql'/);
  assert.match(drizzleConfig, /out: '\.\/drizzle\/mysql'/);
  assert.match(drizzleConfig, /MYSQL_HOST/);
  assert.match(drizzleConfig, /MYSQL_PORT/);
  assert.match(drizzleConfig, /MYSQL_USER/);
  assert.match(drizzleConfig, /MYSQL_PASSWORD/);
  assert.match(drizzleConfig, /MYSQL_DATABASE/);
  assert.doesNotMatch(drizzleConfig, /DATABASE_URL/);
  assert.doesNotMatch(drizzleConfig, /d1-http|CLOUDFLARE/);
  assert.equal(
    envExample,
    'MYSQL_HOST=127.0.0.1\n' +
      'MYSQL_PORT=3306\n' +
      'MYSQL_USER=user\n' +
      'MYSQL_PASSWORD=\n' +
      'MYSQL_DATABASE=database\n\n' +
      'BETTER_AUTH_SECRET=\n' +
      'BETTER_AUTH_URL=http://localhost:4321\n\n' +
      'EMAIL_PROVIDER=console\n\n' +
      '# EMAIL_PROVIDER="resend"\n' +
      '# EMAIL_FROM="VK <a@b.c>"\n' +
      '# RESEND_API_KEY=',
  );
  assert.match(gitignore, /^\.env$/m);
  assert.match(gitignore, /^!\.env\.example$/m);
  assert.match(initAdminSource, /adminApi\.createUser/);
  assert.match(initAdminSource, /\.update\(schema\.user\)/);
  assert.match(initAdminSource, /close: closeDatabasePool/);
  assert.doesNotMatch(initAdminSource, /node:child_process|INSERT\s+INTO/);
  assert.match(authRuntimeTest, /authDatabaseProvider: 'mysql'/);
  assert.doesNotMatch(authRuntimeTest, /cloudflare:workers/);
  assert.match(initAdminTest, /reports duplicate users clearly/);
  await assert.rejects(() =>
    readFile(
      join(
        stagingPath,
        'tests',
        'auth',
        'runtime-seam.test.ts.template',
      ),
    ),
  );
  await assert.rejects(() =>
    readFile(
      join(stagingPath, 'tests', 'cli', 'init-admin.test.ts.template'),
    ),
  );

  assert.equal(packageJson.scripts['db:migrate:local'], undefined);
  assert.equal(packageJson.scripts['db:migrate:remote'], undefined);
  assert.equal(packageJson.scripts['db:migrate'], 'drizzle-kit migrate');
  assert.equal(packageJson.scripts.start, 'node ./dist/server/entry.mjs');
  assert.equal(packageJson.dependencies['@astrojs/cloudflare'], undefined);
  assert.equal(packageJson.dependencies['@astrojs/node'], '^11.0.2');
  assert.equal(packageJson.dependencies.dotenv, '^17.4.2');
  assert.equal(packageJson.dependencies.mysql2, '^3.23.0');
  assert.equal(packageJson.devDependencies['@cloudflare/workers-types'], undefined);
  assert.equal(packageJson.devDependencies.wrangler, undefined);
  assert.equal(packageJson.devDependencies['@types/node'], '^24.13.3');
  assert.equal(packageJson.engines.node, '>=22.12.0');

  assert.equal(packageLock.packages[''].dependencies['@astrojs/node'], '^11.0.2');
  assert.equal(packageLock.packages[''].dependencies.dotenv, '^17.4.2');
  assert.equal(packageLock.packages[''].dependencies.mysql2, '^3.23.0');
  assert.equal(packageLock.packages[''].dependencies['@astrojs/cloudflare'], undefined);
  assert.equal(packageLock.packages[''].devDependencies.wrangler, undefined);
  assert.equal(packageLock.packages[''].engines.node, '>=22.12.0');
});

test('the Node runtime loads dotenv in isolation without importing database code', async () => {
  const fixturePath = await mkdtemp(join(tmpdir(), 'node-runtime-overlay-'));
  const dotenvPath = join(fixturePath, 'node_modules', 'dotenv');
  await mkdir(dotenvPath, { recursive: true });
  await writeFile(
    join(dotenvPath, 'package.json'),
    `${JSON.stringify(
      {
        name: 'dotenv',
        type: 'module',
        exports: { './config': './config.js' },
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    join(dotenvPath, 'config.js'),
    "process.env.NODE_MYSQL_RUNTIME_TEST = 'loaded-by-dotenv';\n",
  );

  const runtimeSource = await readFile(
    new URL('../templates/node-mysql/src/runtime.ts', import.meta.url),
    'utf8',
  );
  const isolatedRuntimePath = join(fixturePath, 'runtime.mjs');
  await writeFile(isolatedRuntimePath, runtimeSource);

  try {
    const { runtimeEnv } = await import(pathToFileURL(isolatedRuntimePath));

    assert.equal(runtimeEnv, process.env);
    assert.equal(runtimeEnv.NODE_MYSQL_RUNTIME_TEST, 'loaded-by-dotenv');
    await assert.rejects(() => access(join(fixturePath, 'db.mjs')), {
      code: 'ENOENT',
    });
  } finally {
    delete process.env.NODE_MYSQL_RUNTIME_TEST;
  }
});
