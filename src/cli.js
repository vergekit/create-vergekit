import { basename, relative } from 'node:path';

import { createProject } from './create-project.js';
import {
  createLocalSecretsFile,
  initializeAdmin,
  installDependencies,
  migrateDatabase,
  readMysqlConnectionDefaults,
  updateMysqlEnvironmentFile,
} from './installer.js';
import {
  DEFAULT_PRESET,
  SUPPORTED_PRESETS,
  validatePreset,
} from './presets.js';
import { resolveTargetDirectory } from './project.js';
import { loadPromptUi, PromptCancelledError } from './prompts.js';
import { assertSupportedNodeVersion } from './runtime.js';

const DEFAULT_SETUP_OPERATIONS = Object.freeze({
  createLocalSecretsFile,
  installDependencies,
  migrateDatabase,
  readMysqlConnectionDefaults,
  updateMysqlEnvironmentFile,
  initializeAdmin,
});

export async function runCli(
  argv,
  {
    cwd = process.cwd(),
    stdin = process.stdin,
    stdout = process.stdout,
    createProjectImpl = createProject,
    setupOperations = DEFAULT_SETUP_OPERATIONS,
    loadPromptUiImpl = loadPromptUi,
    promptUi,
    nodeVersion = process.versions.node,
    assertSupportedNodeVersionImpl = assertSupportedNodeVersion,
  } = {},
) {
  if (argv.includes('--help') || argv.includes('-h')) {
    stdout.write(helpText());
    return 0;
  }

  const options = parseCliArguments(argv);
  assertSupportedNodeVersionImpl(nodeVersion);

  const hasTty = Boolean(stdin.isTTY && stdout.isTTY);
  const interactive = hasTty && !options.yes;
  const ui = interactive ? (promptUi ?? (await loadPromptUiImpl())) : undefined;
  let project;

  try {
    ui?.intro();

    const targetArg = options.targetWasProvided
      ? options.targetArg
      : interactive
        ? await ui.askTarget()
        : options.targetArg;
    const preset = options.presetWasProvided
      ? options.preset
      : interactive
        ? await ui.askPreset()
        : options.preset;

    validateSetupOptions(options, { preset, interactive });

    const target = resolveTargetDirectory(targetArg, cwd);
    project = { targetArg, target, preset };
    await runTask(ui, `Creating project in ${projectLabel(targetArg, target.path)}`, () =>
      createProjectImpl({
        targetPath: target.path,
        packageName: target.packageName,
        preset,
      }),
    );

    const setupRequested =
      interactive || options.yes || options.setupFlagWasProvided;
    if (!setupRequested) {
      stdout.write(generationOnlyText(targetArg, target.path));
      return 0;
    }

    const result = await runSetup({
      targetPath: target.path,
      preset,
      options,
      interactive,
      ui,
      stdout,
      setupOperations,
    });
    const summary = setupSummary({
      cwd,
      targetArg,
      targetPath: target.path,
      preset,
      result,
    });

    presentSummary(ui, stdout, summary, result.failure);
    return result.failure ? 1 : 0;
  } catch (error) {
    if (!(error instanceof PromptCancelledError)) {
      throw error;
    }

    if (project) {
      const summary = cancelledSetupSummary({
        cwd,
        targetArg: project.targetArg,
        targetPath: project.target.path,
        preset: project.preset,
        result: error.setupResult,
      });
      ui?.note(summary, 'Project created');
      ui?.cancel('Setup cancelled. Your generated project was kept.');
    } else {
      ui?.cancel('Installation cancelled.');
    }

    return 0;
  }
}

export function parseCliArguments(argv) {
  const positionalArgs = [];
  let preset = DEFAULT_PRESET;
  let presetWasProvided = false;
  let yes = false;
  let install;
  let migrate;
  let admin;
  let setupFlagWasProvided = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--preset') {
      if (presetWasProvided) {
        throw new Error('The --preset option may only be provided once.');
      }

      const value = argv[index + 1];
      if (!value || value.startsWith('-')) {
        throw new Error(
          `Missing value for --preset. Supported presets: ${SUPPORTED_PRESETS.join(', ')}.`,
        );
      }

      preset = validatePreset(value);
      presetWasProvided = true;
      index += 1;
      continue;
    }

    if (arg.startsWith('--preset=')) {
      if (presetWasProvided) {
        throw new Error('The --preset option may only be provided once.');
      }

      const value = arg.slice('--preset='.length);
      if (!value) {
        throw new Error(
          `Missing value for --preset. Supported presets: ${SUPPORTED_PRESETS.join(', ')}.`,
        );
      }

      preset = validatePreset(value);
      presetWasProvided = true;
      continue;
    }

    if (arg === '--yes' || arg === '-y') {
      if (yes) {
        throw new Error('The --yes option may only be provided once.');
      }
      yes = true;
      setupFlagWasProvided = true;
      continue;
    }

    const setupFlag = parseBooleanSetupFlag(arg);
    if (setupFlag) {
      setupFlagWasProvided = true;
      if (setupFlag.name === 'install') {
        install = setBooleanOption('install', install, setupFlag.value);
      } else if (setupFlag.name === 'migrate') {
        migrate = setBooleanOption('migrate', migrate, setupFlag.value);
      } else {
        admin = setBooleanOption('admin', admin, setupFlag.value);
      }
      continue;
    }

    if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    }

    positionalArgs.push(arg);
  }

  if (positionalArgs.length > 1) {
    throw new Error('Expected at most one target directory.');
  }

  return {
    preset,
    presetWasProvided,
    targetArg: positionalArgs[0] ?? '.',
    targetWasProvided: positionalArgs.length === 1,
    yes,
    install,
    migrate,
    admin,
    setupFlagWasProvided,
  };
}

export async function runSetup({
  targetPath,
  preset,
  options,
  interactive,
  ui,
  stdout,
  setupOperations = DEFAULT_SETUP_OPERATIONS,
}) {
  const result = {
    secrets: 'pending',
    secretsFile: preset === 'cloudflare-d1' ? '.dev.vars' : '.env',
    install: 'skipped',
    database: preset === 'node-mysql' ? 'skipped' : 'not-applicable',
    migrate: 'skipped',
    admin: 'skipped',
    failure: undefined,
  };

  const install =
    options.install ??
    (options.migrate || options.admin
      ? true
      : options.yes
        ? true
        : interactive
          ? await askWithSetupProgress(() => ui.askInstall(), result)
          : false);

  try {
    const secrets = await runTask(ui, `Creating ${result.secretsFile}`, () =>
      setupOperations.createLocalSecretsFile(targetPath, preset),
    );
    result.secrets = secrets.status;
    result.secretsFile = secrets.fileName;
    if (secrets.status === 'existing') {
      reportWarning(
        ui,
        stdout,
        preset === 'node-mysql'
          ? '.env already exists; its existing secrets were preserved.'
          : `${secrets.fileName} already exists; it was not changed.`,
      );
    }
  } catch (error) {
    return failSetup(result, 'secrets', error);
  }

  if (!install) {
    return result;
  }

  reportStep(ui, stdout, 'Installing dependencies');
  try {
    await setupOperations.installDependencies(targetPath);
    result.install = 'completed';
  } catch (error) {
    return failSetup(result, 'install', error);
  }

  if (preset === 'node-mysql') {
    if (!interactive) {
      reportWarning(
        ui,
        stdout,
        'Add your MySQL 8 connection values to .env before running migrations.',
      );
      return result;
    }

    try {
      const defaults = await setupOperations.readMysqlConnectionDefaults(
        targetPath,
      );
      const connection = await askWithSetupProgress(
        () => ui.askMysqlConnection(defaults),
        result,
      );
      await runTask(ui, 'Saving MySQL connection settings', () =>
        setupOperations.updateMysqlEnvironmentFile(targetPath, connection),
      );
      result.database = 'configured';
    } catch (error) {
      if (error instanceof PromptCancelledError) {
        throw error;
      }
      return failSetup(result, 'database', error);
    }

    const migrate =
      options.migrate ??
      (options.admin
        ? true
        : await askWithSetupProgress(() => ui.askMysqlMigrate(), result));
    if (!migrate) {
      return result;
    }

    reportStep(ui, stdout, 'Running MySQL migrations');
    try {
      await setupOperations.migrateDatabase(targetPath, preset);
      result.migrate = 'completed';
    } catch (error) {
      return failSetup(result, 'migrate', error);
    }

    const admin =
      options.admin ??
      (await askWithSetupProgress(() => ui.askAdmin(), result));
    if (!admin) {
      return result;
    }

    reportStep(ui, stdout, 'Starting administrator setup');
    try {
      await setupOperations.initializeAdmin(targetPath);
      result.admin = 'completed';
    } catch (error) {
      return failSetup(result, 'admin', error);
    }

    return result;
  }

  const migrate =
    options.migrate ??
    (options.admin
      ? true
      : options.yes
        ? true
        : interactive
          ? await askWithSetupProgress(() => ui.askMigrate(), result)
          : false);
  if (!migrate) {
    return result;
  }

  reportStep(ui, stdout, 'Initializing local D1');
  try {
    await setupOperations.migrateDatabase(targetPath, preset);
    result.migrate = 'completed';
  } catch (error) {
    return failSetup(result, 'migrate', error);
  }

  const admin =
    options.admin ??
    (options.yes
      ? false
      : interactive
        ? await askWithSetupProgress(() => ui.askAdmin(), result)
        : false);
  if (!admin) {
    return result;
  }

  reportStep(ui, stdout, 'Starting administrator setup');
  try {
    await setupOperations.initializeAdmin(targetPath);
    result.admin = 'completed';
  } catch (error) {
    return failSetup(result, 'admin', error);
  }

  return result;
}

function parseBooleanSetupFlag(arg) {
  for (const name of ['install', 'migrate', 'admin']) {
    if (arg === `--${name}`) {
      return { name, value: true };
    }
    if (arg === `--no-${name}`) {
      return { name, value: false };
    }
  }

  return undefined;
}

function setBooleanOption(name, currentValue, nextValue) {
  if (currentValue !== undefined) {
    throw new Error(
      `Use only one of --${name} or --no-${name}.`,
    );
  }

  return nextValue;
}

function validateSetupOptions(options, { preset, interactive }) {
  if (options.install === false && (options.migrate || options.admin)) {
    throw new Error('--migrate and --admin require dependency installation.');
  }

  if (options.migrate === false && options.admin) {
    throw new Error('--admin requires database migration.');
  }

  if (
    preset === 'node-mysql' &&
    (options.migrate || options.admin) &&
    !interactive
  ) {
    throw new Error(
      'Automated Node.js + MySQL migration and administrator setup requires an interactive terminal so the database connection can be configured securely.',
    );
  }

  if (options.admin && !interactive) {
    throw new Error(
      '--admin requires an interactive terminal because the administrator command prompts for credentials.',
    );
  }
}

async function runTask(ui, message, operation) {
  return ui ? ui.task(message, operation) : operation();
}

function reportStep(ui, stdout, message) {
  if (ui) {
    ui.step(message);
  } else {
    stdout.write(`${message}...\n`);
  }
}

function reportWarning(ui, stdout, message) {
  if (ui) {
    ui.warn(message);
  } else {
    stdout.write(`${message}\n`);
  }
}

function failSetup(result, step, error) {
  result[step] = 'failed';
  result.failure = { step, error };
  return result;
}

async function askWithSetupProgress(question, result) {
  try {
    return await question();
  } catch (error) {
    if (error instanceof PromptCancelledError) {
      error.setupResult = { ...result };
    }
    throw error;
  }
}

function helpText() {
  return `create-vergekit

Usage: npm create vergekit@latest [directory] [options]

Presets:
  cloudflare-d1  Cloudflare Workers + D1 (default)
  node-mysql     Standalone Node.js + MySQL

Options:
  --preset <preset>        Select a preset
  --preset=<preset>        Select a preset
  -y, --yes                Accept setup defaults (install and D1 migrate)
  --install                Install dependencies
  --no-install             Skip dependency installation
  --migrate                Apply database migrations
  --no-migrate             Skip database migration
  --admin                  Launch interactive administrator setup
  --no-admin               Skip administrator setup
  -h, --help               Show this help

Examples:
  npm create vergekit@latest
  npm create vergekit@latest my-app
  npm create vergekit@latest my-app -- --preset node-mysql
  npm create vergekit@latest my-app -- --yes
  npm create vergekit@latest my-app -- --install --migrate --no-admin

Non-interactive terminals never prompt. Without setup flags they only generate
the project, preserving the pre-0.1.4 behavior. Interactive Node.js + MySQL setup
collects the database connection securely before migration and administrator
creation.
`;
}

function generationOnlyText(targetArg, targetPath) {
  return `
Created VergeKit app in ${projectLabel(targetArg, targetPath)}.

For guided setup, run the initializer in a terminal or use --yes.
Installation guide: https://vergekit.com/docs/installation/
`;
}

function setupSummary({ cwd, targetArg, targetPath, preset, result }) {
  const commands = [];
  const cd = cdCommand(cwd, targetPath);
  if (cd) {
    commands.push(cd);
  }

  if (result.failure) {
    if (result.failure.step === 'secrets') {
      commands.push(
        preset === 'cloudflare-d1'
          ? 'cp .dev.vars.example .dev.vars'
          : 'cp .env.example .env',
      );
    }
    if (result.install !== 'completed') {
      commands.push('npm install');
    }
    if (preset === 'cloudflare-d1' && result.migrate !== 'completed') {
      commands.push('npm run db:migrate:local');
    }
    if (preset === 'node-mysql' && result.migrate !== 'completed') {
      commands.push('npm run db:migrate');
    }
    if (result.admin !== 'completed') {
      commands.push('npm run init:admin');
    }
    commands.push('npm run dev');

    return [
      `Created VergeKit app in ${projectLabel(targetArg, targetPath)}, but ${result.failure.step} setup failed.`,
      errorMessage(result.failure.error),
      '',
      'Resume with:',
      indentCommands(commands),
    ].join('\n');
  }

  if (result.install !== 'completed') {
    commands.push('npm install');
  }

  if (preset === 'node-mysql') {
    if (result.migrate !== 'completed') {
      commands.push('npm run db:migrate');
    }
    if (result.admin !== 'completed') {
      commands.push('npm run init:admin');
    }
    commands.push('npm run dev');
    const configured = result.database === 'configured';
    const ready =
      result.install === 'completed' && result.migrate === 'completed';
    return [
      `Created VergeKit app in ${projectLabel(targetArg, targetPath)}${ready ? ' — ready for local development.' : '.'}`,
      configured
        ? 'Your MySQL connection settings were saved to .env.'
        : 'Set MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, and MYSQL_DATABASE in .env, then run:',
      indentCommands(commands),
      '',
      'EMAIL_PROVIDER=console is ready for local development. Configure Resend or Mailgun before production email delivery.',
    ].join('\n');
  }

  if (result.migrate !== 'completed') {
    commands.push('npm run db:migrate:local');
  }
  if (result.admin !== 'completed') {
    commands.push('npm run init:admin');
  }
  commands.push('npm run dev');

  const ready =
    result.install === 'completed' && result.migrate === 'completed';
  return [
    `Created VergeKit app in ${projectLabel(targetArg, targetPath)}${ready ? ' — ready for local development.' : '.'}`,
    '',
    ready && result.admin !== 'completed'
      ? 'Start development now, or create an administrator first:'
      : 'Next steps:',
    indentCommands(commands),
    '',
    'The console email provider is ready locally. Configure a production email provider before deployment.',
  ].join('\n');
}

function cancelledSetupSummary({
  cwd,
  targetArg,
  targetPath,
  preset,
  result,
}) {
  const commands = [];
  const cd = cdCommand(cwd, targetPath);
  if (cd) {
    commands.push(cd);
  }
  if (!result || !['created', 'existing'].includes(result.secrets)) {
    commands.push(
      preset === 'cloudflare-d1'
        ? 'cp .dev.vars.example .dev.vars'
        : 'cp .env.example .env',
    );
  }
  if (result?.install !== 'completed') {
    commands.push('npm install');
  }
  if (result?.migrate !== 'completed') {
    commands.push(
      preset === 'cloudflare-d1'
        ? 'npm run db:migrate:local'
        : 'npm run db:migrate',
    );
  }
  if (result?.admin !== 'completed') {
    commands.push('npm run init:admin');
  }
  commands.push('npm run dev');

  return [
    `Created VergeKit app in ${projectLabel(targetArg, targetPath)}.`,
    'Setup was cancelled; continue when ready:',
    indentCommands(commands),
  ].join('\n');
}

function presentSummary(ui, stdout, summary, failure) {
  if (ui) {
    ui.note(summary, failure ? 'Setup needs attention' : 'Next steps');
    if (failure) {
      ui.cancel('Project generated. Complete the remaining setup manually.');
    } else {
      ui.outro("✅ Your new Verge Kit app is ready.");
    }
    return;
  }

  stdout.write(`\n${summary}\n`);
}

function projectLabel(targetArg, targetPath) {
  return targetArg === '.' || targetArg === './'
    ? basename(targetPath)
    : targetArg;
}

function cdCommand(cwd, targetPath) {
  const path = relative(cwd, targetPath);
  return path ? `cd ${shellQuote(path)}` : '';
}

function shellQuote(value) {
  const path = value.startsWith('-') ? `./${value}` : value;
  return /^[a-zA-Z0-9_./-]+$/.test(path)
    ? path
    : `'${path.replaceAll("'", `'"'"'`)}'`;
}

function indentCommands(commands) {
  return commands.map((command) => `  ${command}`).join('\n');
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
