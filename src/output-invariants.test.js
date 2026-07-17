import assert from 'node:assert/strict';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import test from 'node:test';

import { createProject } from './create-project.js';
import { applyPreset, validateStagedProject } from './presets.js';

const canonicalPackage = {
  name: 'Verge Kit',
  version: '0.1.2',
  type: 'module',
  scripts: {
    dev: 'astro dev',
    build: 'astro build',
    preview: 'astro preview',
    check: 'astro check',
    lint: 'oxlint .',
    test: 'vitest run',
    'db:generate': 'drizzle-kit generate',
    'db:studio': 'drizzle-kit studio',
    'db:migrate:local': 'wrangler d1 migrations apply vk --local',
    'db:migrate:remote': 'wrangler d1 migrations apply vk --remote',
    'init:admin': 'tsx cli/init-admin.ts',
    verify: 'npm run check && npm run lint && npm run test && npm run build',
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
};

const canonicalLock = {
  name: 'Verge Kit',
  version: '0.1.2',
  lockfileVersion: 3,
  packages: {
    '': {
      name: 'Verge Kit',
      version: '0.1.2',
      dependencies: {
        '@astrojs/cloudflare': '^14.0.1',
      },
      devDependencies: {
        '@cloudflare/workers-types': '^4.20260619.1',
        wrangler: '^4.103.0',
      },
    },
    'node_modules/@astrojs/cloudflare': {
      version: '14.0.1',
    },
    'node_modules/@cloudflare/workers-types': {
      version: '4.20260619.1',
    },
    'node_modules/wrangler': {
      version: '4.103.0',
    },
  },
};

const canonicalFiles = {
  '.dev.vars.example': 'BETTER_AUTH_SECRET=\n',
  '.gitignore': '.dev.vars\n.wrangler\n',
  'README.md': '# Canonical Cloudflare Workers app\n',
  'astro.config.mjs': "import cloudflare from '@astrojs/cloudflare';\n",
  'cli/init-admin.ts': '// wrangler d1 initializer\n',
  'docs/decisions/0001-d1-first-adapter-ready.md': '# D1 decision\n',
  'docs/decisions/0002-workers-email-provider-strategy.md':
    '# Cloudflare Email decision\n',
  'docs/roadmap.md': '# Cloudflare D1 roadmap\n',
  'docs/setup/auth-routes.md': 'Use drizzle/d1 for auth migrations.\n',
  'docs/setup/configuration.md': 'Configure wrangler.jsonc and .dev.vars.\n',
  'docs/setup/d1.md': '# D1 setup\n',
  'docs/setup/deployment.md': '# Cloudflare Workers deployment\n',
  'docs/setup/email.md': 'Use the EMAIL binding.\n',
  'docs/setup/hyperdrive-proof.md': '# Hyperdrive proof\n',
  'drizzle.config.ts': "export default { out: './drizzle/d1' };\n",
  'drizzle/d1/0000_vk_init.sql': '-- canonical d1 migration\n',
  'src/config/schema.ts': '// sqlite schema\n',
  'src/db.ts': "import { drizzle } from 'drizzle-orm/d1';\n",
  'src/env.d.ts': 'declare const DB: D1Database;\n',
  'src/pages/api/health.ts': '// common health route\n',
  'src/pages/index.astro': '<h1>Cloudflare Workers</h1>\n',
  'src/runtime.ts': "import { env } from 'cloudflare:workers';\n",
  'tests/auth/auth-schema.test.ts': '// D1Database schema test\n',
  'tests/auth/runtime-seam.test.ts': "// cloudflare:workers seam test\n",
  'tests/auth/server-config.test.ts': '// D1Database server test\n',
  'tests/cli/init-admin.test.ts': '// wrangler d1 admin test\n',
  'tests/config/app-config.test.ts': '// common app config test\n',
  'tests/config/database-config.test.ts': '// drizzle/d1 config test\n',
  'tests/db/d1-client.test.ts': '// D1Database client test\n',
  'tests/db/runtime.test.ts': "// cloudflare:workers runtime test\n",
  'tests/docs/hyperdrive-proof.test.ts': '// Hyperdrive docs test\n',
  'tests/docs/operational-polish.test.ts': '// wrangler.jsonc docs test\n',
  'tests/email/send-email.test.ts': '// Cloudflare Email test\n',
  'tests/http/health.test.ts': '// common health test\n',
  'tsconfig.json': '{"exclude":[".wrangler"]}\n',
  'wrangler.jsonc': '{}\n',
};

test('cloudflare-d1 preserves the complete fixture byte-for-byte except package names', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'vk-output-cloudflare-'));
  const canonicalPath = join(workspace, 'canonical');
  const targetPath = join(workspace, 'generated-cloudflare');
  await writeCanonicalFixture(canonicalPath);

  await createProject({
    targetPath,
    packageName: 'generated-cloudflare',
    downloadAndExtractTemplate: (stagingPath) =>
      writeCanonicalFixture(stagingPath),
  });

  const [canonicalTree, generatedTree] = await Promise.all([
    snapshotTree(canonicalPath),
    snapshotTree(targetPath),
  ]);
  assert.deepEqual(Object.keys(generatedTree), Object.keys(canonicalTree));

  for (const [path, content] of Object.entries(canonicalTree)) {
    if (path !== 'package.json' && path !== 'package-lock.json') {
      assert.equal(generatedTree[path], content, `${path} must be byte-identical`);
    }
  }

  const expectedPackage = {
    ...canonicalPackage,
    name: 'generated-cloudflare',
  };
  const expectedLock = structuredClone(canonicalLock);
  expectedLock.name = 'generated-cloudflare';
  expectedLock.packages[''].name = 'generated-cloudflare';
  assert.equal(
    generatedTree['package.json'],
    `${JSON.stringify(expectedPackage, null, 2)}\n`,
  );
  assert.equal(
    generatedTree['package-lock.json'],
    `${JSON.stringify(expectedLock, null, 2)}\n`,
  );
});

test('node-mysql composes a clean full fixture with only Node/MySQL operations', async () => {
  const stagingPath = await mkdtemp(join(tmpdir(), 'vk-output-node-'));
  await writeCanonicalFixture(stagingPath);

  await applyPreset(stagingPath, 'node-mysql');
  await validateStagedProject(stagingPath, 'node-mysql');

  const tree = await snapshotTree(stagingPath);
  const absentPaths = [
    '.dev.vars.example',
    'wrangler.jsonc',
    'drizzle/d1/0000_vk_init.sql',
    'docs/decisions/0001-d1-first-adapter-ready.md',
    'docs/setup/d1.md',
    'tests/db/d1-client.test.ts',
    'tests/db/runtime.test.ts',
    'tests/docs/hyperdrive-proof.test.ts',
    'tests/docs/operational-polish.test.ts',
  ];
  for (const path of absentPaths) {
    assert.equal(tree[path], undefined, `${path} must be removed`);
  }

  assert.equal(tree['src/pages/api/health.ts'], '// common health route\n');
  assert.equal(
    tree['src/pages/index.astro'],
    canonicalFiles['src/pages/index.astro'],
  );
  assert.equal(
    tree['tests/config/app-config.test.ts'],
    '// common app config test\n',
  );
  assert.equal(tree['tests/http/health.test.ts'], '// common health test\n');
  assert.deepEqual(await readdir(join(stagingPath, 'drizzle')), ['mysql']);

  const documentation = `${tree['README.md']}\n${tree['docs/setup/node-mysql.md']}`;
  for (const value of ['console', 'Resend', 'Mailgun']) {
    assert.match(documentation, new RegExp(value));
  }
  for (const value of [
    'MYSQL_HOST',
    'MYSQL_PORT',
    'MYSQL_USER',
    'MYSQL_PASSWORD',
    'MYSQL_DATABASE',
  ]) {
    assert.match(documentation, new RegExp(value));
  }
  assert.doesNotMatch(documentation, /DATABASE_URL/);
  assert.equal(
    tree['.env.example'],
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
  for (const command of [
    'npm run db:migrate',
    'npm run init:admin',
    'npm run dev',
    'npm run build',
    'npm run start',
  ]) {
    assert.match(documentation, new RegExp(command.replaceAll(' ', '\\s')));
  }

  const packageJson = JSON.parse(tree['package.json']);
  const packageLock = JSON.parse(tree['package-lock.json']);
  assert.equal(packageJson.dependencies['@astrojs/node'], '^11.0.2');
  assert.equal(packageJson.dependencies.mysql2, '^3.23.0');
  assert.equal(packageJson.scripts['db:migrate'], 'drizzle-kit migrate');
  assert.equal(packageJson.scripts['db:migrate:local'], undefined);
  assert.equal(packageJson.scripts['db:migrate:remote'], undefined);
  assert.deepEqual(packageJson.allowScripts, {
    'esbuild@0.18.20': true,
    'esbuild@0.25.12': true,
    'esbuild@0.28.1': true,
    fsevents: false,
    msw: false,
    'sharp@0.34.5': true,
  });
  for (const path of [
    'node_modules/@astrojs/cloudflare',
    'node_modules/@cloudflare/workers-types',
    'node_modules/wrangler',
  ]) {
    assert.equal(packageLock.packages[path], undefined);
  }

  assert.equal(
    Object.keys(tree).some((path) =>
      path === 'templates' ||
      path.startsWith('templates/') ||
      path.endsWith('.template')
    ),
    false,
  );
  assert.equal(
    Object.entries(tree).some(
      ([path, content]) =>
        path !== 'src/pages/index.astro' && content.includes('DATABASE_URL'),
    ),
    false,
  );
});

test('node staged validation rejects target content leaks and extra migration trees', async () => {
  const stagingPath = await mkdtemp(join(tmpdir(), 'vk-output-invalid-'));
  await writeCanonicalFixture(stagingPath);
  await applyPreset(stagingPath, 'node-mysql');

  const leakPath = join(stagingPath, 'src', 'target-leak.ts');
  await writeFile(leakPath, "import { env } from 'cloudflare:workers';\n");
  await assert.rejects(
    validateStagedProject(stagingPath, 'node-mysql'),
    /forbidden content in src\/target-leak\.ts: cloudflare:workers/,
  );
  await rm(leakPath);

  await mkdir(join(stagingPath, 'drizzle', 'postgres'), { recursive: true });
  await writeFile(
    join(stagingPath, 'drizzle', 'postgres', '0000.sql'),
    '-- unexpected migration\n',
  );
  await assert.rejects(
    validateStagedProject(stagingPath, 'node-mysql'),
    /unexpected entries in drizzle: mysql, postgres/,
  );
});

async function writeCanonicalFixture(rootPath) {
  await mkdir(rootPath, { recursive: true });
  await writeFixtureFile(
    rootPath,
    'package.json',
    `${JSON.stringify(canonicalPackage, null, 2)}\n`,
  );
  await writeFixtureFile(
    rootPath,
    'package-lock.json',
    `${JSON.stringify(canonicalLock, null, 2)}\n`,
  );

  for (const [path, content] of Object.entries(canonicalFiles)) {
    await writeFixtureFile(rootPath, path, content);
  }
}

async function writeFixtureFile(rootPath, relativePath, content) {
  const path = join(rootPath, relativePath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

async function snapshotTree(rootPath, relativeDirectory = '') {
  const directory = relativeDirectory
    ? join(rootPath, relativeDirectory)
    : rootPath;
  const entries = await readdir(directory, { withFileTypes: true });
  const snapshot = {};

  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const relativePath = relativeDirectory
      ? join(relativeDirectory, entry.name)
      : entry.name;
    if (entry.isDirectory()) {
      Object.assign(snapshot, await snapshotTree(rootPath, relativePath));
    } else if (entry.isFile()) {
      const normalizedPath = relativePath.split(sep).join('/');
      snapshot[normalizedPath] = await readFile(
        join(rootPath, relativePath),
        'utf8',
      );
    }
  }

  return snapshot;
}
