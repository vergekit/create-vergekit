#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';
import { pathToFileURL } from 'node:url';

import { createProject } from '../src/create-project.js';
import {
  SUPPORTED_PRESETS,
  validateStagedProject,
} from '../src/presets.js';

const execFileAsync = promisify(execFile);
const TEMPORARY_DIRECTORY_PREFIX = 'vergekit-generated-verification-';
const REQUIRED_VERIFICATION_SCRIPTS = Object.freeze([
  'check',
  'lint',
  'test',
  'build',
]);

export function parseVerificationArguments(argv) {
  let boilerplatePath;
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === '--help' || argument === '-h') {
      help = true;
      continue;
    }

    const option = ['--boilerplate', '--template'].find(
      (name) => argument === name || argument.startsWith(`${name}=`),
    );
    if (!option) {
      throw new Error(`Unknown option: ${argument}`);
    }
    if (boilerplatePath) {
      throw new Error('Provide exactly one boilerplate/template path.');
    }

    if (argument === option) {
      const value = argv[index + 1];
      if (!value || value.startsWith('-')) {
        throw new Error(`Missing value for ${option}.`);
      }
      boilerplatePath = value;
      index += 1;
    } else {
      boilerplatePath = argument.slice(`${option}=`.length);
      if (!boilerplatePath) {
        throw new Error(`Missing value for ${option}.`);
      }
    }
  }

  if (!help && !boilerplatePath) {
    throw new Error(
      'An explicit --boilerplate <path> or --template <path> is required.',
    );
  }

  return { boilerplatePath, help };
}

export async function runVerificationCli(
  argv,
  {
    stdout = process.stdout,
    runVerification = runGeneratedProjectVerification,
  } = {},
) {
  const options = parseVerificationArguments(argv);
  if (options.help) {
    stdout.write(verificationHelpText());
    return [];
  }

  return runVerification({
    boilerplatePath: options.boilerplatePath,
    log: (message) => stdout.write(`${message}\n`),
  });
}

export async function runGeneratedProjectVerification({
  boilerplatePath,
  createProjectImpl = createProject,
  validateProjectImpl = validateStagedProject,
  copyTemplateImpl = copyLocalBoilerplate,
  runCommandImpl = runCommand,
  mkdtempImpl = mkdtemp,
  rmImpl = rm,
  log = (message) => process.stdout.write(`${message}\n`),
} = {}) {
  if (!boilerplatePath) {
    throw new Error('A boilerplate/template path is required.');
  }

  const sourcePath = resolve(boilerplatePath);
  await assertBoilerplateSource(sourcePath);

  const workspacePath = await mkdtempImpl(
    join(tmpdir(), TEMPORARY_DIRECTORY_PREFIX),
  );
  assertSafeTemporaryWorkspace(workspacePath);

  const npmCachePath = join(workspacePath, 'npm-cache');
  const wranglerLogPath = join(workspacePath, 'wrangler-logs');
  const results = [];
  let failure;

  try {
    await mkdir(npmCachePath, { recursive: true });

    for (const preset of SUPPORTED_PRESETS) {
      const packageName = `vergekit-s08-${preset}`;
      const targetPath = join(workspacePath, preset);

      log(`[${preset}] generate from local boilerplate`);
      await runRequiredStep(preset, 'generation', () =>
        createProjectImpl({
          targetPath,
          packageName,
          preset,
          downloadAndExtractTemplate: (stagingPath) =>
            copyTemplateImpl(sourcePath, stagingPath),
        }),
      );

      log(`[${preset}] validate generated tree`);
      await runRequiredStep(preset, 'generated-tree validation', () =>
        validateProjectImpl(targetPath, preset, {
          expectedPackageName: packageName,
        }),
      );
      const sourceSnapshot = await runRequiredStep(
        preset,
        'verification contract validation',
        () => assertGeneratedTreeInvariants(targetPath, preset, packageName),
      );

      const commandEnvironment = makeVerificationEnvironment({
        wranglerLogPath,
      });
      log(`[${preset}] npm ci`);
      await runRequiredStep(preset, 'npm ci', () =>
        runCommandImpl(
          'npm',
          ['ci', '--cache', npmCachePath, '--no-audit', '--no-fund'],
          {
            cwd: targetPath,
            env: commandEnvironment,
          },
        ),
      );
      await runRequiredStep(preset, 'clean install assertion', () =>
        assertDirectory(join(targetPath, 'node_modules')),
      );

      log(`[${preset}] npm run verify`);
      await runRequiredStep(preset, 'npm run verify', () =>
        runCommandImpl('npm', ['run', 'verify'], {
          cwd: targetPath,
          env: commandEnvironment,
        }),
      );

      await runRequiredStep(preset, 'build output assertion', () =>
        assertDirectory(join(targetPath, 'dist')),
      );
      if (preset === 'node-mysql') {
        await runRequiredStep(
          preset,
          'standalone Node entrypoint assertion',
          () => assertFile(join(targetPath, 'dist', 'server', 'entry.mjs')),
        );
      }

      await runRequiredStep(preset, 'final tree invariant assertion', () =>
        assertGeneratedTreeInvariants(
          targetPath,
          preset,
          packageName,
          sourceSnapshot,
          { expectCleanInstallState: false },
        ),
      );
      results.push({ preset, packageName });
      log(`[${preset}] passed`);
    }
  } catch (error) {
    failure = error;
  }

  try {
    await removeTemporaryWorkspace(workspacePath, rmImpl);
  } catch (cleanupError) {
    if (failure) {
      throw new AggregateError(
        [failure, cleanupError],
        'Generated-project verification failed and temporary cleanup also failed.',
      );
    }
    throw cleanupError;
  }

  if (failure) {
    throw failure;
  }

  log('Both generated presets passed clean verification; temporary files removed.');
  return results;
}

export async function copyLocalBoilerplate(sourcePath, destinationPath) {
  const repositoryRoot = (
    await execFileAsync('git', ['-C', sourcePath, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
    })
  ).stdout.trim();
  if (resolve(repositoryRoot) !== resolve(sourcePath)) {
    throw new Error(
      'The boilerplate/template path must be the root of its Git working tree.',
    );
  }

  const { stdout } = await execFileAsync(
    'git',
    [
      '-C',
      sourcePath,
      'ls-files',
      '--cached',
      '--others',
      '--exclude-standard',
      '-z',
    ],
    { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
  );
  const relativePaths = stdout.split('\0').filter(Boolean);
  if (relativePaths.length === 0) {
    throw new Error('The boilerplate/template working tree contains no files.');
  }

  for (const relativePath of relativePaths) {
    const sourceFile = resolveContainedPath(sourcePath, relativePath);
    const destinationFile = resolveContainedPath(
      destinationPath,
      relativePath,
    );
    await mkdir(dirname(destinationFile), { recursive: true });
    await cp(sourceFile, destinationFile, {
      force: true,
      preserveTimestamps: true,
    });
  }
}

async function assertBoilerplateSource(sourcePath) {
  let sourceStat;
  try {
    sourceStat = await stat(sourcePath);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read boilerplate/template path: ${reason}`, {
      cause: error,
    });
  }
  if (!sourceStat.isDirectory()) {
    throw new Error('The boilerplate/template path must be a directory.');
  }

  await Promise.all([
    assertFile(join(sourcePath, 'package.json')),
    assertFile(join(sourcePath, 'package-lock.json')),
  ]);
}

async function assertGeneratedTreeInvariants(
  targetPath,
  preset,
  packageName,
  expectedSnapshot,
  { expectCleanInstallState = true } = {},
) {
  const packageJsonPath = join(targetPath, 'package.json');
  const packageLockPath = join(targetPath, 'package-lock.json');
  const [packageJsonText, packageLockText] = await Promise.all([
    readFile(packageJsonPath, 'utf8'),
    readFile(packageLockPath, 'utf8'),
  ]);
  const packageJson = JSON.parse(packageJsonText);
  const packageLock = JSON.parse(packageLockText);

  if (
    packageJson.name !== packageName ||
    packageLock.name !== packageName ||
    packageLock.packages?.['']?.name !== packageName
  ) {
    throw new Error('Generated package and lockfile root names must match.');
  }

  for (const script of REQUIRED_VERIFICATION_SCRIPTS) {
    if (typeof packageJson.scripts?.[script] !== 'string') {
      throw new Error(`Generated package is missing required script: ${script}`);
    }
    if (!packageJson.scripts.verify?.includes(`npm run ${script}`)) {
      throw new Error(
        `Generated verify script skips required step: npm run ${script}`,
      );
    }
  }

  await Promise.all([
    assertPathAbsent(join(targetPath, '.env')),
    assertPathAbsent(join(targetPath, '.dev.vars')),
    assertPathAbsent(join(targetPath, 'templates')),
  ]);

  if (preset === 'cloudflare-d1') {
    await Promise.all([
      assertFile(join(targetPath, 'wrangler.jsonc')),
      assertDirectory(join(targetPath, 'drizzle', 'd1')),
      assertPathAbsent(join(targetPath, 'drizzle', 'mysql')),
      assertPathAbsent(join(targetPath, 'docs', 'setup', 'node-mysql.md')),
    ]);
    if (
      !packageJson.dependencies?.['@astrojs/cloudflare'] ||
      packageJson.dependencies?.['@astrojs/node'] ||
      packageJson.dependencies?.mysql2
    ) {
      throw new Error('Cloudflare output contains an invalid runtime dependency set.');
    }
  } else if (preset === 'node-mysql') {
    await Promise.all([
      assertFile(join(targetPath, '.env.example')),
      assertDirectory(join(targetPath, 'drizzle', 'mysql')),
      assertFile(join(targetPath, 'docs', 'setup', 'node-mysql.md')),
      assertPathAbsent(join(targetPath, 'wrangler.jsonc')),
      assertPathAbsent(join(targetPath, 'drizzle', 'd1')),
      assertPathAbsent(join(targetPath, '.dev.vars.example')),
    ]);
    if (
      packageJson.scripts?.start !== 'node ./dist/server/entry.mjs' ||
      !packageJson.dependencies?.['@astrojs/node'] ||
      !packageJson.dependencies?.mysql2 ||
      packageJson.dependencies?.['@astrojs/cloudflare']
    ) {
      throw new Error('Node output contains an invalid runtime contract.');
    }
  } else {
    throw new Error(`Unexpected verification preset: ${preset}`);
  }

  if (expectCleanInstallState) {
    await assertPathAbsent(join(targetPath, 'node_modules'));
  }

  if (expectedSnapshot) {
    if (
      packageJsonText !== expectedSnapshot.packageJsonText ||
      packageLockText !== expectedSnapshot.packageLockText
    ) {
      throw new Error('Verification changed package or lockfile source metadata.');
    }
  }

  return { packageJsonText, packageLockText };
}

function makeVerificationEnvironment({ wranglerLogPath }) {
  const environment = { ...process.env };
  for (const variableName of [
    'MYSQL_HOST',
    'MYSQL_PORT',
    'MYSQL_USER',
    'MYSQL_PASSWORD',
    'MYSQL_DATABASE',
  ]) {
    delete environment[variableName];
  }

  return {
    ...environment,
    ASTRO_TELEMETRY_DISABLED: '1',
    CI: '1',
    NO_UPDATE_NOTIFIER: '1',
    WRANGLER_LOG_PATH: wranglerLogPath,
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    npm_config_update_notifier: 'false',
  };
}

async function runRequiredStep(preset, label, operation) {
  try {
    return await operation();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`[${preset}] required step failed (${label}): ${reason}`, {
      cause: error,
    });
  }
}

async function runCommand(command, args, { cwd, env }) {
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd,
      env,
      shell: false,
      stdio: 'inherit',
    });
    child.once('error', rejectPromise);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      const result = signal
        ? `terminated by signal ${signal}`
        : `exited with code ${code}`;
      rejectPromise(new Error(`${command} ${args.join(' ')} ${result}.`));
    });
  });
}

async function removeTemporaryWorkspace(workspacePath, rmImpl) {
  assertSafeTemporaryWorkspace(workspacePath);
  await rmImpl(workspacePath, { recursive: true, force: true });
}

function assertSafeTemporaryWorkspace(workspacePath) {
  const resolvedPath = resolve(workspacePath);
  const relativeToTemporaryRoot = relative(resolve(tmpdir()), resolvedPath);
  if (
    !relativeToTemporaryRoot ||
    relativeToTemporaryRoot === '..' ||
    relativeToTemporaryRoot.startsWith(`..${sep}`) ||
    isAbsolute(relativeToTemporaryRoot) ||
    !basename(resolvedPath).startsWith(TEMPORARY_DIRECTORY_PREFIX)
  ) {
    throw new Error('Refusing to clean an unsafe temporary workspace path.');
  }
}

function resolveContainedPath(rootPath, relativePath) {
  const resolvedRoot = resolve(rootPath);
  const resolvedPath = resolve(resolvedRoot, relativePath);
  const relativePathFromRoot = relative(resolvedRoot, resolvedPath);
  if (
    !relativePathFromRoot ||
    relativePathFromRoot === '..' ||
    relativePathFromRoot.startsWith(`..${sep}`) ||
    isAbsolute(relativePathFromRoot)
  ) {
    throw new Error(`Template path must stay inside its root: ${relativePath}`);
  }
  return resolvedPath;
}

async function assertFile(path) {
  let pathStat;
  try {
    pathStat = await stat(path);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Required file is missing: ${reason}`, { cause: error });
  }
  if (!pathStat.isFile()) {
    throw new Error('Required path is not a file.');
  }
}

async function assertDirectory(path) {
  let pathStat;
  try {
    pathStat = await stat(path);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Required directory is missing: ${reason}`, {
      cause: error,
    });
  }
  if (!pathStat.isDirectory()) {
    throw new Error('Required path is not a directory.');
  }
}

async function assertPathAbsent(path) {
  try {
    await access(path);
  } catch {
    return;
  }
  throw new Error('Generated tree contains a forbidden path.');
}

function verificationHelpText() {
  return `Verify both generated Verge Kit presets from a local source tree.

Usage:
  node ./scripts/verify-generated-projects.mjs --boilerplate <path>
  node ./scripts/verify-generated-projects.mjs --template=<path>

The source path must be the root of the local boilerplate Git working tree.
The script runs npm ci and npm run verify for both presets, then removes all
generated projects and caches. It does not run database migrations or smokes.
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
    await runVerificationCli(process.argv.slice(2));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Generated-project verification failed: ${reason}\n`);
    process.exitCode = 1;
  }
}
