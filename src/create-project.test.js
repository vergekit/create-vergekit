import assert from 'node:assert/strict';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createProject } from './create-project.js';
import { applyPreset } from './presets.js';

test('createProject copies the template and renames the generated package', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'create-vergekit-'));
  const targetPath = join(workspace, 'My App');

  await createProject({
    targetPath,
    packageName: 'my-app',
    downloadAndExtractTemplate: async (stagingPath) => {
      await writeFile(
        join(stagingPath, 'package.json'),
        `${JSON.stringify({ name: 'vk', private: true }, null, 2)}\n`,
      );
      await writeFile(join(stagingPath, 'README.md'), '# Verge Kit\n');
    },
  });

  const packageJson = JSON.parse(
    await readFile(join(targetPath, 'package.json'), 'utf8'),
  );
  const readme = await readFile(join(targetPath, 'README.md'), 'utf8');

  assert.equal(packageJson.name, 'my-app');
  assert.equal(packageJson.private, true);
  assert.equal(readme, '# Verge Kit\n');
});

test('createProject updates package and lockfile root names in staging', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'create-vergekit-'));
  const targetPath = join(workspace, 'renamed-app');

  await createProject({
    targetPath,
    packageName: 'renamed-app',
    downloadAndExtractTemplate: async (stagingPath) => {
      await writeFile(
        join(stagingPath, 'package.json'),
        `${JSON.stringify({ name: 'vk', version: '0.1.2' }, null, 2)}\n`,
      );
      await writeFile(
        join(stagingPath, 'package-lock.json'),
        `${JSON.stringify(
          {
            name: 'vk',
            version: '0.1.2',
            lockfileVersion: 3,
            packages: {
              '': {
                name: 'vk',
                version: '0.1.2',
              },
            },
          },
          null,
          2,
        )}\n`,
      );
    },
  });

  const packageJson = JSON.parse(
    await readFile(join(targetPath, 'package.json'), 'utf8'),
  );
  const packageLock = JSON.parse(
    await readFile(join(targetPath, 'package-lock.json'), 'utf8'),
  );

  assert.equal(packageJson.name, 'renamed-app');
  assert.equal(packageLock.name, 'renamed-app');
  assert.equal(packageLock.packages[''].name, 'renamed-app');
  assert.equal(packageLock.version, '0.1.2');
});

test('createProject applies the selected preset before package naming and destination copy', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'create-vergekit-'));
  const targetPath = join(workspace, 'node-app');
  const events = [];

  await createProject({
    targetPath,
    packageName: 'node-app',
    preset: 'node-mysql',
    downloadAndExtractTemplate: async (stagingPath) => {
      events.push('extract');
      await mkdir(join(stagingPath, 'src', 'pages'), { recursive: true });
      await writeFile(
        join(stagingPath, 'package.json'),
        `${JSON.stringify({ name: 'vk' }, null, 2)}\n`,
      );
      await writeFile(
        join(stagingPath, 'src', 'pages', 'index.astro'),
        '<h1>Canonical homepage</h1>\n',
      );
    },
    applyPresetImpl: async (stagingPath, preset) => {
      events.push(`preset:${preset}`);
      const stagedPackage = JSON.parse(
        await readFile(join(stagingPath, 'package.json'), 'utf8'),
      );
      assert.equal(stagedPackage.name, 'vk');
      await assert.rejects(() => access(targetPath), { code: 'ENOENT' });
      await applyPreset(stagingPath, preset);
    },
  });

  assert.deepEqual(events, ['extract', 'preset:node-mysql']);
  const packageJson = JSON.parse(
    await readFile(join(targetPath, 'package.json'), 'utf8'),
  );
  assert.equal(packageJson.name, 'node-app');
  assert.equal(
    await readFile(join(targetPath, 'src', 'pages', 'index.astro'), 'utf8'),
    '<h1>Canonical homepage</h1>\n',
  );
});

test('a failing preset leaves a previously absent target absent', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'create-vergekit-'));
  const targetPath = join(workspace, 'node-app');

  await assert.rejects(
    () =>
      createProject({
        targetPath,
        packageName: 'node-app',
        preset: 'node-mysql',
        downloadAndExtractTemplate: async (stagingPath) => {
          await writeFile(
            join(stagingPath, 'package.json'),
            `${JSON.stringify({ name: 'vk' }, null, 2)}\n`,
          );
        },
        applyPresetImpl: async () => {
          throw new Error('Preset composition failed.');
        },
      }),
    /Preset composition failed/,
  );

  await assert.rejects(() => access(targetPath), { code: 'ENOENT' });
});

test('a failing preset leaves a permitted metadata-only target unchanged', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'create-vergekit-'));
  const targetPath = join(workspace, 'node-app');
  await mkdir(join(targetPath, '.git'), { recursive: true });
  await writeFile(join(targetPath, '.git', 'config'), 'existing config\n');
  await writeFile(join(targetPath, '.DS_Store'), 'existing metadata\n');

  await assert.rejects(
    () =>
      createProject({
        targetPath,
        packageName: 'node-app',
        preset: 'node-mysql',
        downloadAndExtractTemplate: async (stagingPath) => {
          await writeFile(
            join(stagingPath, 'package.json'),
            `${JSON.stringify({ name: 'vk' }, null, 2)}\n`,
          );
        },
        applyPresetImpl: async () => {
          throw new Error('Preset composition failed.');
        },
      }),
    /Preset composition failed/,
  );

  assert.deepEqual((await readdir(targetPath)).sort(), ['.DS_Store', '.git']);
  assert.equal(
    await readFile(join(targetPath, '.git', 'config'), 'utf8'),
    'existing config\n',
  );
  assert.equal(
    await readFile(join(targetPath, '.DS_Store'), 'utf8'),
    'existing metadata\n',
  );
});
