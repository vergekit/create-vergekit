import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  parseVerificationArguments,
  runGeneratedProjectVerification,
} from '../scripts/verify-generated-projects.mjs';

const verificationScriptPath = fileURLToPath(
  new URL('../scripts/verify-generated-projects.mjs', import.meta.url),
);

test('generated verification CLI requires and parses an explicit local source path', () => {
  assert.deepEqual(
    parseVerificationArguments(['--boilerplate', '../boilerplate']),
    { boilerplatePath: '../boilerplate', help: false },
  );
  assert.deepEqual(
    parseVerificationArguments(['--template=../boilerplate']),
    { boilerplatePath: '../boilerplate', help: false },
  );
  assert.deepEqual(parseVerificationArguments(['--help']), {
    boilerplatePath: undefined,
    help: true,
  });
  assert.throws(
    () => parseVerificationArguments([]),
    /explicit --boilerplate.*--template/,
  );
  assert.throws(
    () =>
      parseVerificationArguments([
        '--boilerplate',
        '../boilerplate',
        '--template=../other',
      ]),
    /exactly one boilerplate\/template path/,
  );
});

test('generated verification runs both clean installs and full verifies, asserts output, and cleans up', async () => {
  const fixture = await createHarnessFixture();
  const commands = [];
  const validations = [];
  const logs = [];
  let workspacePath;
  const mysqlEnvironmentNames = [
    'MYSQL_HOST',
    'MYSQL_PORT',
    'MYSQL_USER',
    'MYSQL_PASSWORD',
    'MYSQL_DATABASE',
  ];
  const previousMysqlEnvironment = Object.fromEntries(
    mysqlEnvironmentNames.map((name) => [name, process.env[name]]),
  );
  for (const name of mysqlEnvironmentNames) {
    process.env[name] = 'must-not-reach-child';
  }

  try {
    const results = await runGeneratedProjectVerification({
      boilerplatePath: fixture.boilerplatePath,
      createProjectImpl: createGeneratedProjectStub(),
      validateProjectImpl: async (targetPath, preset, options) => {
        validations.push({ targetPath, preset, options });
      },
      copyTemplateImpl: async () => {
        throw new Error('stub createProject must not copy a real template');
      },
      runCommandImpl: async (command, args, options) => {
        for (const name of mysqlEnvironmentNames) {
          assert.equal(Object.hasOwn(options.env, name), false);
        }
        commands.push({ command, args, cwd: options.cwd });
        if (args[0] === 'ci') {
          await mkdir(join(options.cwd, 'node_modules'));
        } else {
          await writeFixtureFile(options.cwd, 'dist/index.html', 'built\n');
          if (options.cwd.endsWith('node-mysql')) {
            await writeFixtureFile(
              options.cwd,
              'dist/server/entry.mjs',
              'export {};\n',
            );
          }
        }
      },
      mkdtempImpl: async (prefix) => {
        workspacePath = await mkdtemp(prefix);
        return workspacePath;
      },
      log: (message) => logs.push(message),
    });

    assert.deepEqual(results, [
      {
        preset: 'cloudflare-d1',
        packageName: 'vergekit-s08-cloudflare-d1',
      },
      {
        preset: 'node-mysql',
        packageName: 'vergekit-s08-node-mysql',
      },
    ]);
    assert.deepEqual(
      validations.map(({ preset, options }) => ({ preset, options })),
      [
        {
          preset: 'cloudflare-d1',
          options: { expectedPackageName: 'vergekit-s08-cloudflare-d1' },
        },
        {
          preset: 'node-mysql',
          options: { expectedPackageName: 'vergekit-s08-node-mysql' },
        },
      ],
    );
    assert.deepEqual(
      commands.map(({ command, args, cwd }) => [
        command,
        args[0],
        args[1],
        cwd.endsWith('node-mysql') ? 'node-mysql' : 'cloudflare-d1',
      ]),
      [
        ['npm', 'ci', '--cache', 'cloudflare-d1'],
        ['npm', 'run', 'verify', 'cloudflare-d1'],
        ['npm', 'ci', '--cache', 'node-mysql'],
        ['npm', 'run', 'verify', 'node-mysql'],
      ],
    );
    assert.match(logs.at(-1), /Both generated presets passed.*removed/);
    await assert.rejects(() => access(workspacePath), { code: 'ENOENT' });
  } finally {
    for (const name of mysqlEnvironmentNames) {
      restoreEnvironmentValue(name, previousMysqlEnvironment[name]);
    }
    await rm(fixture.rootPath, { recursive: true, force: true });
  }
});

test('generated verification reports a failed required step and still cleans up', async () => {
  const fixture = await createHarnessFixture();
  const commands = [];
  let workspacePath;

  try {
    await assert.rejects(
      () =>
        runGeneratedProjectVerification({
          boilerplatePath: fixture.boilerplatePath,
          createProjectImpl: createGeneratedProjectStub(),
          validateProjectImpl: async () => {},
          copyTemplateImpl: async () => {},
          runCommandImpl: async (command, args, options) => {
            commands.push([command, ...args, options.cwd]);
            if (args[0] === 'ci') {
              await mkdir(join(options.cwd, 'node_modules'));
              return;
            }
            if (options.cwd.endsWith('node-mysql')) {
              throw new Error('simulated verify failure');
            }
            await writeFixtureFile(options.cwd, 'dist/index.html', 'built\n');
          },
          mkdtempImpl: async (prefix) => {
            workspacePath = await mkdtemp(prefix);
            return workspacePath;
          },
          log: () => {},
        }),
      /\[node-mysql\] required step failed \(npm run verify\): simulated verify failure/,
    );

    assert.equal(commands.length, 4);
    await assert.rejects(() => access(workspacePath), { code: 'ENOENT' });
  } finally {
    await rm(fixture.rootPath, { recursive: true, force: true });
  }
});

test('generated verification rejects a skipped check/lint/test/build contract before installation', async () => {
  const fixture = await createHarnessFixture();
  const commands = [];
  let workspacePath;

  try {
    await assert.rejects(
      () =>
        runGeneratedProjectVerification({
          boilerplatePath: fixture.boilerplatePath,
          createProjectImpl: createGeneratedProjectStub({
            omittedScript: 'lint',
          }),
          validateProjectImpl: async () => {},
          copyTemplateImpl: async () => {},
          runCommandImpl: async (...args) => commands.push(args),
          mkdtempImpl: async (prefix) => {
            workspacePath = await mkdtemp(prefix);
            return workspacePath;
          },
          log: () => {},
        }),
      /missing required script: lint/,
    );

    assert.deepEqual(commands, []);
    await assert.rejects(() => access(workspacePath), { code: 'ENOENT' });
  } finally {
    await rm(fixture.rootPath, { recursive: true, force: true });
  }
});

test('generated verification CLI exits nonzero instead of skipping a missing source argument', () => {
  const result = spawnSync(process.execPath, [verificationScriptPath], {
    encoding: 'utf8',
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Generated-project verification failed/);
  assert.match(result.stderr, /explicit --boilerplate.*--template/);
});

test('the local generated verification harness is excluded from the published package', async () => {
  const packageJson = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  );

  assert.equal(packageJson.files.includes('scripts'), false);
  assert.equal(
    packageJson.files.some((path) => path.startsWith('scripts/')),
    false,
  );
});

async function createHarnessFixture() {
  const rootPath = await mkdtemp(join(tmpdir(), 'vk-s08-harness-test-'));
  const boilerplatePath = join(rootPath, 'boilerplate');
  await mkdir(boilerplatePath);
  await writeFixtureFile(
    boilerplatePath,
    'package.json',
    '{"name":"Verge Kit"}\n',
  );
  await writeFixtureFile(
    boilerplatePath,
    'package-lock.json',
    '{"name":"Verge Kit","lockfileVersion":3,"packages":{"":{"name":"Verge Kit"}}}\n',
  );
  return { rootPath, boilerplatePath };
}

function createGeneratedProjectStub({ omittedScript } = {}) {
  return async ({ targetPath, packageName, preset }) => {
    const scripts = {
      check: 'astro check',
      lint: 'oxlint .',
      test: 'vitest run',
      build: 'astro build',
      verify: 'npm run check && npm run lint && npm run test && npm run build',
    };
    delete scripts[omittedScript];

    const isNode = preset === 'node-mysql';
    const packageJson = {
      name: packageName,
      scripts,
      dependencies: isNode
        ? { '@astrojs/node': '1.0.0', mysql2: '3.0.0' }
        : { '@astrojs/cloudflare': '1.0.0' },
    };
    if (isNode) {
      packageJson.scripts.start = 'node ./dist/server/entry.mjs';
    }
    const packageLock = {
      name: packageName,
      lockfileVersion: 3,
      packages: { '': { name: packageName } },
    };

    await mkdir(targetPath, { recursive: true });
    await writeFixtureFile(
      targetPath,
      'package.json',
      `${JSON.stringify(packageJson, null, 2)}\n`,
    );
    await writeFixtureFile(
      targetPath,
      'package-lock.json',
      `${JSON.stringify(packageLock, null, 2)}\n`,
    );

    if (isNode) {
      await writeFixtureFile(
        targetPath,
        '.env.example',
        'MYSQL_HOST=\nMYSQL_PORT=\nMYSQL_USER=\nMYSQL_PASSWORD=\nMYSQL_DATABASE=\n',
      );
      await writeFixtureFile(
        targetPath,
        'drizzle/mysql/0000.sql',
        '-- mysql\n',
      );
      await writeFixtureFile(
        targetPath,
        'docs/setup/node-mysql.md',
        '# Node\n',
      );
    } else {
      await writeFixtureFile(targetPath, 'wrangler.jsonc', '{}\n');
      await writeFixtureFile(targetPath, 'drizzle/d1/0000.sql', '-- d1\n');
    }
  };
}

async function writeFixtureFile(rootPath, relativePath, content) {
  const path = join(rootPath, relativePath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

function restoreEnvironmentValue(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
