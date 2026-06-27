import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  assertTargetDirectoryIsUsable,
  getBlockingDirectoryEntries,
  normalizePackageName,
  resolveTargetDirectory,
} from './project.js';

test('normalizePackageName converts folder names into npm-safe app names', () => {
  assert.equal(normalizePackageName('My VergeKit App'), 'my-vergekit-app');
  assert.equal(normalizePackageName('@Example/Starter'), 'example-starter');
  assert.equal(normalizePackageName('...'), 'vergekit-app');
});

test('resolveTargetDirectory uses the cwd for dot targets', () => {
  const cwd = join(tmpdir(), 'My VergeKit App');
  const target = resolveTargetDirectory('.', cwd);

  assert.equal(target.path, cwd);
  assert.equal(target.packageName, 'my-vergekit-app');
});

test('resolveTargetDirectory resolves named projects under the cwd', () => {
  const cwd = join(tmpdir(), 'workspace');
  const target = resolveTargetDirectory('Customer Portal', cwd);

  assert.equal(target.path, join(cwd, 'Customer Portal'));
  assert.equal(target.packageName, 'customer-portal');
});

test('getBlockingDirectoryEntries ignores safe empty-directory metadata', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'create-vergekit-'));
  await writeFile(join(dir, '.DS_Store'), '');
  await writeFile(join(dir, 'Thumbs.db'), '');
  await mkdir(join(dir, '.git'));

  assert.deepEqual(await getBlockingDirectoryEntries(dir), []);
});

test('assertTargetDirectoryIsUsable rejects non-empty directories', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'create-vergekit-'));
  await writeFile(join(dir, 'existing.txt'), 'keep me');

  await assert.rejects(
    () => assertTargetDirectoryIsUsable(dir),
    /Target directory is not empty: existing\.txt/,
  );
});
