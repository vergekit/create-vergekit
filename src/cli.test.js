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
    },
  ]);
  assert.match(output.join(''), /cd Customer Portal/);
  assert.match(output.join(''), /npm install/);
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
    },
  ]);
  assert.doesNotMatch(output.join(''), /cd /);
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
});
