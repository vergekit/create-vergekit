#!/usr/bin/env node

import { execFile } from 'node:child_process';
import {
  access,
  copyFile,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { composePresetPackageJson } from '../src/presets.js';

const execFileAsync = promisify(execFile);
const createRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultBoilerplatePath = resolve(createRoot, '../boilerplate');
const defaultLockfilePath = resolve(
  createRoot,
  'templates/node-mysql/package-lock.json',
);

export function parseUpdateArguments(argv) {
  let boilerplatePath = defaultBoilerplatePath;
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === '--help' || argument === '-h') {
      help = true;
      continue;
    }

    if (argument === '--boilerplate') {
      const value = argv[index + 1];
      if (!value || value.startsWith('-')) {
        throw new Error('Missing value for --boilerplate.');
      }
      boilerplatePath = resolve(value);
      index += 1;
      continue;
    }

    if (argument.startsWith('--boilerplate=')) {
      const value = argument.slice('--boilerplate='.length);
      if (!value) {
        throw new Error('Missing value for --boilerplate.');
      }
      boilerplatePath = resolve(value);
      continue;
    }

    throw new Error(`Unknown option: ${argument}`);
  }

  return { boilerplatePath, help };
}

export async function updateNodeMysqlLockfile({
  boilerplatePath = defaultBoilerplatePath,
  lockfilePath = defaultLockfilePath,
  installPackageLock = installPackageLockWithNpm,
  log = console.log,
} = {}) {
  const canonicalPackage = await readJson(
    join(boilerplatePath, 'package.json'),
    'canonical boilerplate package.json',
  );
  const nodePackage = composePresetPackageJson(
    canonicalPackage,
    'node-mysql',
  );
  const workspacePath = await mkdtemp(
    join(tmpdir(), 'create-vergekit-node-lock-'),
  );
  const generatedLockfilePath = join(workspacePath, 'package-lock.json');
  const replacementPath = `${lockfilePath}.${process.pid}.${Date.now()}.tmp`;

  try {
    await writeFile(
      join(workspacePath, 'package.json'),
      `${JSON.stringify(nodePackage, null, 2)}\n`,
    );

    if (await pathExists(lockfilePath)) {
      await copyFile(lockfilePath, generatedLockfilePath);
    }

    await installPackageLock(workspacePath);

    const generatedLock = await readJson(
      generatedLockfilePath,
      'generated Node/MySQL package-lock.json',
    );
    validateNodeMysqlLockfile(nodePackage, generatedLock);

    await writeFile(
      replacementPath,
      `${JSON.stringify(generatedLock, null, 2)}\n`,
    );
    await rename(replacementPath, lockfilePath);
    log(`Updated Node/MySQL lockfile: ${lockfilePath}`);

    return { lockfilePath, packageJson: nodePackage, packageLock: generatedLock };
  } finally {
    await rm(replacementPath, { force: true });
    await rm(workspacePath, { recursive: true, force: true });
  }
}

export function validateNodeMysqlLockfile(packageJson, packageLock) {
  if (packageLock.lockfileVersion !== 3) {
    throw new Error('Node/MySQL lockfile must use lockfileVersion 3.');
  }

  const lockRoot = packageLock.packages?.[''];
  if (!lockRoot) {
    throw new Error('Node/MySQL lockfile is missing its root package metadata.');
  }

  for (const field of ['name', 'version']) {
    if (
      packageLock[field] !== packageJson[field] ||
      lockRoot[field] !== packageJson[field]
    ) {
      throw new Error(
        `Node/MySQL lockfile ${field} does not match the composed package.json.`,
      );
    }
  }

  for (const section of ['dependencies', 'devDependencies', 'engines']) {
    assertMatchingSection(section, packageJson[section], lockRoot[section]);
  }

  for (const packageName of ['@astrojs/node', 'dotenv', 'mysql2']) {
    if (!Object.hasOwn(packageLock.packages, `node_modules/${packageName}`)) {
      throw new Error(
        `Node/MySQL lockfile is missing required package: ${packageName}`,
      );
    }
  }

  for (const packageName of [
    '@astrojs/cloudflare',
    '@cloudflare/workers-types',
    'wrangler',
  ]) {
    if (Object.hasOwn(packageLock.packages, `node_modules/${packageName}`)) {
      throw new Error(
        `Node/MySQL lockfile contains forbidden package: ${packageName}`,
      );
    }
  }
}

function assertMatchingSection(section, expected = {}, actual = {}) {
  const expectedEntries = Object.entries(expected).sort();
  const actualEntries = Object.entries(actual).sort();

  if (JSON.stringify(expectedEntries) !== JSON.stringify(actualEntries)) {
    throw new Error(
      `Node/MySQL lockfile root ${section} does not match the composed package.json.`,
    );
  }
}

async function installPackageLockWithNpm(workspacePath) {
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  await execFileAsync(
    npmCommand,
    [
      'install',
      '--package-lock-only',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
    ],
    {
      cwd: workspacePath,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    },
  );

}

async function readJson(path, label) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read ${label}: ${reason}`, { cause: error });
  }
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function helpText() {
  return `Regenerate the Node/MySQL preset lockfile from the canonical boilerplate.

Usage:
  npm run update:node-mysql-lock
  npm run update:node-mysql-lock -- --boilerplate ../boilerplate
`;
}

function isDirectExecution() {
  return Boolean(
    process.argv[1] &&
      pathToFileURL(resolve(process.argv[1])).href === import.meta.url,
  );
}

if (isDirectExecution()) {
  try {
    const options = parseUpdateArguments(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(helpText());
    } else {
      await updateNodeMysqlLockfile(options);
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Unable to update Node/MySQL lockfile: ${reason}\n`);
    process.exitCode = 1;
  }
}
