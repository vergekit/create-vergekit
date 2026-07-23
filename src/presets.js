import { constants as fsConstants } from 'node:fs';
import {
  access,
  cp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_PRESET = 'cloudflare-d1';
export const SUPPORTED_PRESETS = Object.freeze([
  DEFAULT_PRESET,
  'node-mysql',
]);

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const DEFAULT_PRESET_DEFINITIONS = Object.freeze({
  'cloudflare-d1': Object.freeze({
    overlayDirectory: null,
    materializePaths: Object.freeze({}),
    removePaths: Object.freeze([]),
    packageJson: Object.freeze({}),
    requiredPaths: Object.freeze(['package.json']),
    forbiddenPaths: Object.freeze(['templates']),
  }),
  'node-mysql': Object.freeze({
    overlayDirectory: 'node-mysql',
    materializePaths: Object.freeze({
      '.gitignore.template': '.gitignore',
      'tests/auth/auth-schema.test.ts.template':
        'tests/auth/auth-schema.test.ts',
      'tests/auth/runtime-seam.test.ts.template':
        'tests/auth/runtime-seam.test.ts',
      'tests/auth/server-config.test.ts.template':
        'tests/auth/server-config.test.ts',
      'tests/cli/init-admin.test.ts.template':
        'tests/cli/init-admin.test.ts',
      'tests/config/database-config.test.ts.template':
        'tests/config/database-config.test.ts',
      'tests/db/mysql-client.test.ts.template':
        'tests/db/mysql-client.test.ts',
      'tests/docs/node-mysql-setup.test.ts.template':
        'tests/docs/node-mysql-setup.test.ts',
      'tests/email/send-email.test.ts.template':
        'tests/email/send-email.test.ts',
    }),
    removePaths: Object.freeze([
      '.dev.vars.example',
      'README.md',
      'astro.config.mjs',
      'cli/init-admin.ts',
      'docs',
      'drizzle.config.ts',
      'migrations',
      'package-lock.json',
      'src/config/schema.ts',
      'src/db.ts',
      'src/env.d.ts',
      'src/runtime.ts',
      'tests/auth/auth-schema.test.ts',
      'tests/auth/runtime-seam.test.ts',
      'tests/auth/server-config.test.ts',
      'tests/cli/init-admin.test.ts',
      'tests/config/database-config.test.ts',
      'tests/db',
      'tests/docs',
      'tests/email/send-email.test.ts',
      'tsconfig.json',
      'wrangler.jsonc',
    ]),
    packageJson: Object.freeze({
      remove: Object.freeze({
        scripts: Object.freeze(['db:migrate:local', 'db:migrate:remote']),
        dependencies: Object.freeze(['@astrojs/cloudflare']),
        devDependencies: Object.freeze([
          '@cloudflare/workers-types',
          'wrangler',
        ]),
        allowScripts: Object.freeze(['workerd@1.20260617.1']),
      }),
      merge: Object.freeze({
        scripts: Object.freeze({
          'db:migrate': 'drizzle-kit migrate',
          start: 'node ./dist/server/entry.mjs',
        }),
        dependencies: Object.freeze({
          '@astrojs/node': '^11.0.2',
          dotenv: '^17.4.2',
          mysql2: '^3.23.0',
        }),
        devDependencies: Object.freeze({
          '@types/node': '^24.13.3',
        }),
        engines: Object.freeze({
          node: '>=22.12.0',
        }),
        allowScripts: Object.freeze({
          'esbuild@0.18.20': true,
          'esbuild@0.25.12': true,
          'esbuild@0.28.1': true,
          fsevents: false,
          msw: false,
          'sharp@0.34.5': true,
        }),
      }),
    }),
    requiredPaths: Object.freeze([
      'package.json',
      'package-lock.json',
      'README.md',
      'astro.config.mjs',
      'drizzle.config.ts',
      '.env.example',
      '.gitignore',
      'docs/setup/node-mysql.md',
      'tsconfig.json',
      'src/runtime.ts',
      'src/db.ts',
      'src/env.d.ts',
      'src/config/schema.ts',
      'src/pages/index.astro',
      'cli/init-admin.ts',
      'tests/auth/auth-schema.test.ts',
      'tests/auth/runtime-seam.test.ts',
      'tests/auth/server-config.test.ts',
      'tests/cli/init-admin.test.ts',
      'tests/config/database-config.test.ts',
      'tests/db/mysql-client.test.ts',
      'tests/docs/node-mysql-setup.test.ts',
      'tests/email/send-email.test.ts',
      'migrations/0000_vk_init.sql',
      'migrations/meta/0000_snapshot.json',
      'migrations/meta/_journal.json',
    ]),
    forbiddenPaths: Object.freeze([
      'templates',
      '.dev.vars',
      '.dev.vars.example',
      '.gitignore.template',
      'docs/decisions',
      'docs/roadmap.md',
      'docs/setup/configuration.md',
      'docs/setup/d1.md',
      'docs/setup/deployment.md',
      'docs/setup/email.md',
      'docs/setup/hyperdrive-proof.md',
      'tests/auth/auth-schema.test.ts.template',
      'tests/auth/runtime-seam.test.ts.template',
      'tests/auth/server-config.test.ts.template',
      'tests/cli/init-admin.test.ts.template',
      'tests/config/database-config.test.ts.template',
      'tests/db/d1-client.test.ts',
      'tests/db/runtime.test.ts',
      'tests/db/mysql-client.test.ts.template',
      'tests/docs/hyperdrive-proof.test.ts',
      'tests/docs/operational-polish.test.ts',
      'tests/docs/node-mysql-setup.test.ts.template',
      'tests/email/send-email.test.ts.template',
      'wrangler.jsonc',
      'drizzle',
    ]),
    exclusiveDirectoryChildren: Object.freeze({
      migrations: Object.freeze(['0000_vk_init.sql', 'meta']),
    }),
    requiredContent: Object.freeze({
      'README.md': Object.freeze([
        'Node.js + MySQL',
        'npm run db:migrate',
        'npm run init:admin',
        'npm run dev',
        'npm run build',
        'npm run start',
        'console',
        'Resend',
        'Mailgun',
      ]),
      'astro.config.mjs': Object.freeze([
        "from '@astrojs/node'",
        "from 'astro-favicons'",
        "output: 'server'",
        "mode: 'standalone'",
        'html: false',
      ]),
      'docs/setup/node-mysql.md': Object.freeze([
        'MYSQL_HOST',
        'MYSQL_PORT',
        'MYSQL_USER',
        'MYSQL_PASSWORD',
        'MYSQL_DATABASE',
        'BETTER_AUTH_SECRET',
        'migrations/meta',
        'npm run db:migrate',
        'npm run init:admin',
        'npm run dev',
        'npm run build',
        'npm run start',
        'reverse proxy',
        'process manager',
        'Resend',
        'Mailgun',
      ]),
      'drizzle.config.ts': Object.freeze([
        "dialect: 'mysql'",
        "out: './migrations'",
        'MYSQL_HOST',
        'MYSQL_DATABASE',
      ]),
      '.env.example': Object.freeze([
        'MYSQL_HOST',
        'MYSQL_PORT',
        'MYSQL_USER',
        'MYSQL_PASSWORD',
        'MYSQL_DATABASE',
      ]),
      'src/db.ts': Object.freeze([
        "from 'drizzle-orm/mysql2'",
        "authDatabaseProvider = 'mysql'",
        'MYSQL_HOST',
        'MYSQL_DATABASE',
      ]),
      'src/runtime.ts': Object.freeze([
        "import 'dotenv/config'",
        'process.env',
      ]),
      'src/env.d.ts': Object.freeze([
        'reference types="node"',
        'loadAuthSession',
      ]),
    }),
    forbiddenContent: Object.freeze([
      'cloudflare:workers',
      '@astrojs/cloudflare',
      '@cloudflare/workers-types',
      'drizzle-orm/d1',
      'D1Database',
      'wrangler.jsonc',
      '.dev.vars',
      'drizzle/',
      'Cloudflare Email',
      'EMAIL binding',
      'Cloudflare Workers',
      'Cloudflare D1',
      'DATABASE_URL',
    ]),
    forbiddenContentExclusions: Object.freeze([
      'src/pages/index.astro',
    ]),
    forbiddenPackageLockPackages: Object.freeze([
      'node_modules/@astrojs/cloudflare',
      'node_modules/@cloudflare/workers-types',
      'node_modules/wrangler',
    ]),
  }),
});

export function validatePreset(preset) {
  if (!SUPPORTED_PRESETS.includes(preset)) {
    throw new Error(
      `Unsupported preset "${preset}". Supported presets: ${SUPPORTED_PRESETS.join(', ')}.`,
    );
  }

  return preset;
}

export function composePresetPackageJson(
  packageJson,
  preset = DEFAULT_PRESET,
  { presetDefinitions = DEFAULT_PRESET_DEFINITIONS } = {},
) {
  validatePreset(preset);
  const definition = getPresetDefinition(preset, presetDefinitions);
  return applyPackageJsonMutation(packageJson, definition.packageJson);
}

export async function applyPreset(
  stagingPath,
  preset = DEFAULT_PRESET,
  {
    templatesPath = join(packageRoot, 'templates'),
    presetDefinitions = DEFAULT_PRESET_DEFINITIONS,
  } = {},
) {
  validatePreset(preset);
  const definition = getPresetDefinition(preset, presetDefinitions);
  let overlayPath;

  if (definition.overlayDirectory) {
    overlayPath = join(templatesPath, definition.overlayDirectory);
    if (!(await pathExists(overlayPath))) {
      throw new Error(`Preset overlay is missing for ${preset}: ${overlayPath}`);
    }
  }

  for (const relativePath of definition.removePaths ?? []) {
    await rm(resolveStagedPath(stagingPath, relativePath), {
      recursive: true,
      force: true,
    });
  }

  if (overlayPath) {
    await cp(overlayPath, stagingPath, {
      recursive: true,
      force: true,
      errorOnExist: false,
    });
  }

  for (const [sourcePath, destinationPath] of Object.entries(
    definition.materializePaths ?? {},
  )) {
    const source = resolveStagedPath(stagingPath, sourcePath);
    const destination = resolveStagedPath(stagingPath, destinationPath);
    await cp(source, destination, { force: true });
    await rm(source, { force: true });
  }

  await mutatePackageJson(stagingPath, definition.packageJson);
  await validateStagedProject(stagingPath, preset, {
    presetDefinitions,
  });
}

export async function validateStagedProject(
  stagingPath,
  preset = DEFAULT_PRESET,
  {
    expectedPackageName,
    presetDefinitions = DEFAULT_PRESET_DEFINITIONS,
  } = {},
) {
  validatePreset(preset);
  const definition = getPresetDefinition(preset, presetDefinitions);
  const packageJson = await readJson(
    join(stagingPath, 'package.json'),
    'staged package.json',
  );

  if (typeof packageJson.name !== 'string' || packageJson.name.length === 0) {
    throw new Error('Staged package.json must contain a non-empty name.');
  }

  if (expectedPackageName && packageJson.name !== expectedPackageName) {
    throw new Error(
      `Staged package name is "${packageJson.name}"; expected "${expectedPackageName}".`,
    );
  }

  for (const relativePath of definition.requiredPaths ?? []) {
    if (!(await pathExists(resolveStagedPath(stagingPath, relativePath)))) {
      throw new Error(
        `Preset ${preset} is missing required path: ${relativePath}`,
      );
    }
  }

  for (const relativePath of definition.forbiddenPaths ?? []) {
    if (await pathExists(resolveStagedPath(stagingPath, relativePath))) {
      throw new Error(
        `Preset ${preset} contains forbidden path: ${relativePath}`,
      );
    }
  }

  assertPackageJsonMutation(packageJson, definition.packageJson);

  for (const [relativePath, expectedChildren] of Object.entries(
    definition.exclusiveDirectoryChildren ?? {},
  )) {
    const entries = await readdir(resolveStagedPath(stagingPath, relativePath));
    const actualChildren = entries.sort();
    if (!arraysEqual(actualChildren, [...expectedChildren].sort())) {
      throw new Error(
        `Preset ${preset} has unexpected entries in ${relativePath}: ${actualChildren.join(', ') || '(empty)'}.`,
      );
    }
  }

  for (const [relativePath, requiredValues] of Object.entries(
    definition.requiredContent ?? {},
  )) {
    const content = await readFile(
      resolveStagedPath(stagingPath, relativePath),
      'utf8',
    );
    for (const requiredValue of requiredValues) {
      if (!content.includes(requiredValue)) {
        throw new Error(
          `Preset ${preset} expected ${relativePath} to contain: ${requiredValue}`,
        );
      }
    }
  }

  await assertTreeExcludesContent(
    stagingPath,
    preset,
    definition.forbiddenContent ?? [],
    definition.forbiddenContentExclusions ?? [],
  );

  const packageLockPath = join(stagingPath, 'package-lock.json');
  if (await pathExists(packageLockPath)) {
    const packageLock = await readJson(
      packageLockPath,
      'staged package-lock.json',
    );

    if (expectedPackageName) {
      if (packageLock.name !== expectedPackageName) {
        throw new Error(
          `Staged lockfile name is "${packageLock.name}"; expected "${expectedPackageName}".`,
        );
      }

      if (
        packageLock.packages?.[''] &&
        packageLock.packages[''].name !== expectedPackageName
      ) {
        throw new Error(
          `Staged lockfile root package name is "${packageLock.packages[''].name}"; expected "${expectedPackageName}".`,
        );
      }
    }

    for (const packagePath of definition.forbiddenPackageLockPackages ?? []) {
      if (Object.hasOwn(packageLock.packages ?? {}, packagePath)) {
        throw new Error(
          `Preset ${preset} lockfile contains forbidden package: ${packagePath}`,
        );
      }
    }
  }
}

function getPresetDefinition(preset, presetDefinitions) {
  const definition = presetDefinitions[preset];
  if (!definition) {
    throw new Error(`Preset definition is missing for ${preset}.`);
  }

  return definition;
}

async function mutatePackageJson(stagingPath, mutation = {}) {
  if (
    Object.keys(mutation.remove ?? {}).length === 0 &&
    Object.keys(mutation.merge ?? {}).length === 0
  ) {
    return;
  }

  const packageJsonPath = join(stagingPath, 'package.json');
  const packageJson = await readJson(packageJsonPath, 'staged package.json');

  await writeFile(
    packageJsonPath,
    `${JSON.stringify(applyPackageJsonMutation(packageJson, mutation), null, 2)}\n`,
  );
}

function applyPackageJsonMutation(packageJson, mutation = {}) {
  const result = structuredClone(packageJson);

  for (const [section, keys] of Object.entries(mutation.remove ?? {})) {
    if (!result[section] || typeof result[section] !== 'object') {
      continue;
    }

    for (const key of keys) {
      delete result[section][key];
    }
  }

  for (const [section, values] of Object.entries(mutation.merge ?? {})) {
    result[section] = {
      ...result[section],
      ...values,
    };
  }

  return result;
}

function assertPackageJsonMutation(packageJson, mutation = {}) {
  for (const [section, keys] of Object.entries(mutation.remove ?? {})) {
    for (const key of keys) {
      if (Object.hasOwn(packageJson[section] ?? {}, key)) {
        throw new Error(
          `Preset package.json still contains ${section}.${key}.`,
        );
      }
    }
  }

  for (const [section, values] of Object.entries(mutation.merge ?? {})) {
    for (const [key, value] of Object.entries(values)) {
      if (packageJson[section]?.[key] !== value) {
        throw new Error(
          `Preset package.json has an unexpected value for ${section}.${key}.`,
        );
      }
    }
  }
}

function resolveStagedPath(stagingPath, relativePath) {
  const normalizedPath = normalize(relativePath);
  if (
    !relativePath ||
    isAbsolute(relativePath) ||
    normalizedPath === '..' ||
    normalizedPath.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
  ) {
    throw new Error(`Preset path must stay within staging: ${relativePath}`);
  }

  return join(stagingPath, normalizedPath);
}

async function assertTreeExcludesContent(
  stagingPath,
  preset,
  values,
  excludedPaths,
) {
  if (values.length === 0) {
    return;
  }

  const exclusions = new Set(excludedPaths);
  for (const relativePath of await listFiles(stagingPath)) {
    if (
      relativePath === 'package-lock.json' ||
      exclusions.has(relativePath)
    ) {
      continue;
    }

    const content = await readFile(resolveStagedPath(stagingPath, relativePath));
    if (content.includes(0)) {
      continue;
    }

    const text = content.toString('utf8');
    for (const value of values) {
      if (text.includes(value)) {
        throw new Error(
          `Preset ${preset} contains forbidden content in ${relativePath}: ${value}`,
        );
      }
    }
  }
}

async function listFiles(rootPath, relativeDirectory = '') {
  const directoryPath = relativeDirectory
    ? resolveStagedPath(rootPath, relativeDirectory)
    : rootPath;
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const relativePath = relativeDirectory
      ? `${relativeDirectory}/${entry.name}`
      : entry.name;
    if (entry.isDirectory()) {
      files.push(...(await listFiles(rootPath, relativePath)));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }

  return files;
}

function arraysEqual(left, right) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

async function pathExists(path) {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function readJson(path, label) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read ${label}: ${reason}`, { cause: error });
  }
}
