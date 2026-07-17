import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';

import { runCli } from './cli.js';

test('runCli creates a named project and prints next steps', async () => {
  const cwd = '/tmp/workspace';
  const createdProjects = [];
  const output = [];

  const exitCode = await runCli(['Customer Portal'], {
    cwd,
    stdout: { write: (chunk) => output.push(chunk) },
    createProjectImpl: async (project) => createdProjects.push(project),
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(createdProjects, [
    {
      targetPath: join(cwd, 'Customer Portal'),
      packageName: 'customer-portal',
      preset: 'cloudflare-d1',
    },
  ]);
  assert.match(output.join(''), /Created VergeKit app in Customer Portal/);
  assert.match(
    output.join(''),
    /https:\/\/vergekit\.com\/docs\/installation/,
  );
});

test('runCli uses the current directory when no target is provided', async () => {
  const cwd = '/tmp/my-app';
  const createdProjects = [];
  const output = [];

  await runCli([], {
    cwd,
    stdout: { write: (chunk) => output.push(chunk) },
    createProjectImpl: async (project) => createdProjects.push(project),
  });

  assert.deepEqual(createdProjects, [
    {
      targetPath: cwd,
      packageName: 'my-app',
      preset: 'cloudflare-d1',
    },
  ]);
  assert.doesNotMatch(output.join(''), /cd /);
});

test('runCli accepts --preset value and preserves the destination', async () => {
  const cwd = '/tmp/workspace';
  const createdProjects = [];

  await runCli(['my-app', '--preset', 'node-mysql'], {
    cwd,
    stdout: { write: () => {} },
    createProjectImpl: async (project) => createdProjects.push(project),
  });

  assert.deepEqual(createdProjects, [
    {
      targetPath: join(cwd, 'my-app'),
      packageName: 'my-app',
      preset: 'node-mysql',
    },
  ]);
});

test('runCli accepts --preset=value before the destination', async () => {
  const cwd = '/tmp/workspace';
  const createdProjects = [];

  await runCli(['--preset=node-mysql', 'my-app'], {
    cwd,
    stdout: { write: () => {} },
    createProjectImpl: async (project) => createdProjects.push(project),
  });

  assert.deepEqual(createdProjects, [
    {
      targetPath: join(cwd, 'my-app'),
      packageName: 'my-app',
      preset: 'node-mysql',
    },
  ]);
});

test('runCli rejects a missing preset value clearly', async () => {
  await assert.rejects(
    () => runCli(['my-app', '--preset']),
    /Missing value for --preset.*cloudflare-d1, node-mysql/,
  );

  await assert.rejects(
    () => runCli(['--preset=', 'my-app']),
    /Missing value for --preset.*cloudflare-d1, node-mysql/,
  );
});

test('runCli rejects unsupported presets clearly', async () => {
  await assert.rejects(
    () => runCli(['my-app', '--preset', 'postgres']),
    /Unsupported preset "postgres".*cloudflare-d1, node-mysql/,
  );
});

test('runCli prints help without creating a project', async () => {
  const createdProjects = [];
  const output = [];

  const exitCode = await runCli(['--help'], {
    stdout: { write: (chunk) => output.push(chunk) },
    createProjectImpl: async (project) => createdProjects.push(project),
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(createdProjects, []);
  assert.match(output.join(''), /Usage: npm create vergekit@latest/);
  assert.match(output.join(''), /--preset <preset>/);
  assert.match(output.join(''), /--preset=<preset>/);
  assert.match(output.join(''), /cloudflare-d1.*default/);
  assert.match(output.join(''), /node-mysql/);
});
