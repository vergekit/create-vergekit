import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { validatePreset } from './presets.js';

const SETUP_BY_PRESET = Object.freeze({
  'cloudflare-d1': Object.freeze({
    secretsFile: '.dev.vars',
    secretsTemplate: '.dev.vars.example',
    migrationScript: 'db:migrate:local',
  }),
  'node-mysql': Object.freeze({
    secretsFile: '.env',
    secretsTemplate: '.env.example',
    migrationScript: 'db:migrate',
  }),
});

const MYSQL_CONNECTION_FIELDS = Object.freeze({
  host: 'MYSQL_HOST',
  port: 'MYSQL_PORT',
  user: 'MYSQL_USER',
  password: 'MYSQL_PASSWORD',
  database: 'MYSQL_DATABASE',
});

export class CommandExecutionError extends Error {
  constructor(command, args, { code, signal } = {}) {
    const detail = signal ? `signal ${signal}` : `exit code ${code ?? 'unknown'}`;
    super(`${[command, ...args].join(' ')} failed with ${detail}.`);
    this.name = 'CommandExecutionError';
    this.command = command;
    this.args = args;
    this.code = code;
    this.signal = signal;
  }
}

export function generateBetterAuthSecret(randomBytesImpl = randomBytes) {
  return randomBytesImpl(32).toString('base64url');
}

export function getPresetSetup(preset) {
  return SETUP_BY_PRESET[validatePreset(preset)];
}

export async function createLocalSecretsFile(
  targetPath,
  preset,
  {
    readFileImpl = readFile,
    writeFileImpl = writeFile,
    generateSecret = generateBetterAuthSecret,
  } = {},
) {
  const setup = getPresetSetup(preset);
  const templatePath = join(targetPath, setup.secretsTemplate);
  const destinationPath = join(targetPath, setup.secretsFile);
  const template = await readFileImpl(templatePath, 'utf8');
  const secret = generateSecret();
  const secretLine = `BETTER_AUTH_SECRET=${secret}`;
  const contents = /^BETTER_AUTH_SECRET=.*$/m.test(template)
    ? template.replace(/^BETTER_AUTH_SECRET=.*$/m, secretLine)
    : `${template.replace(/\s*$/, '\n')}\n${secretLine}\n`;

  try {
    await writeFileImpl(destinationPath, contents, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
  } catch (error) {
    if (error?.code === 'EEXIST') {
      return { fileName: setup.secretsFile, status: 'existing' };
    }

    throw error;
  }

  return { fileName: setup.secretsFile, status: 'created' };
}

export async function readMysqlConnectionDefaults(
  targetPath,
  { readFileImpl = readFile } = {},
) {
  const template = await readFileImpl(join(targetPath, '.env.example'), 'utf8');
  return Object.fromEntries(
    Object.entries(MYSQL_CONNECTION_FIELDS).map(([field, environmentName]) => [
      field,
      readEnvironmentValue(template, environmentName),
    ]),
  );
}

export async function updateMysqlEnvironmentFile(
  targetPath,
  connection,
  { readFileImpl = readFile, writeFileImpl = writeFile } = {},
) {
  const environmentPath = join(targetPath, '.env');
  let contents = await readFileImpl(environmentPath, 'utf8');

  for (const [field, environmentName] of Object.entries(
    MYSQL_CONNECTION_FIELDS,
  )) {
    const line = `${environmentName}=${serializeEnvironmentValue(connection[field])}`;
    const pattern = new RegExp(`^${environmentName}=.*$`, 'm');
    contents = pattern.test(contents)
      ? contents.replace(pattern, line)
      : `${contents.replace(/\s*$/, '\n')}${line}\n`;
  }

  await writeFileImpl(environmentPath, contents, {
    encoding: 'utf8',
    mode: 0o600,
  });
}

function readEnvironmentValue(contents, name) {
  const match = contents.match(new RegExp(`^${name}=(.*)$`, 'm'));
  return match ? parseEnvironmentValue(match[1]) : '';
}

function parseEnvironmentValue(value) {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function serializeEnvironmentValue(value) {
  const normalized = String(value ?? '');
  if (/^[A-Za-z0-9._:/@+-]*$/.test(normalized)) {
    return normalized;
  }
  return `"${normalized
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('\n', '\\n')}"`;
}

export function runCommand(
  command,
  args,
  {
    cwd,
    spawnImpl = spawn,
    stdio = 'inherit',
    platform = process.platform,
  } = {},
) {
  const executable =
    command === 'npm' && platform === 'win32' ? 'npm.cmd' : command;

  return new Promise((resolve, reject) => {
    const child = spawnImpl(executable, args, {
      cwd,
      stdio,
      shell: false,
    });

    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new CommandExecutionError(command, args, { code, signal }));
    });
  });
}

export function installDependencies(targetPath, options = {}) {
  return (options.runCommandImpl ?? runCommand)('npm', ['install'], {
    cwd: targetPath,
  });
}

export function migrateDatabase(targetPath, preset, options = {}) {
  const { migrationScript } = getPresetSetup(preset);
  return (options.runCommandImpl ?? runCommand)(
    'npm',
    ['run', migrationScript],
    { cwd: targetPath },
  );
}

export function initializeAdmin(targetPath, options = {}) {
  return (options.runCommandImpl ?? runCommand)(
    'npm',
    ['run', 'init:admin'],
    { cwd: targetPath },
  );
}
