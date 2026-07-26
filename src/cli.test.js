import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';

import { parseCliArguments, runCli } from './cli.js';
import { PromptCancelledError } from './prompts.js';

function createPromptUi(overrides = {}) {
  return {
    intro() {},
    cancel() {},
    outro() {},
    note() {},
    step() {},
    warn() {},
    error() {},
    task: async (_message, operation) => operation(),
    askTarget: async () => '.',
    askPreset: async () => 'cloudflare-d1',
    askInstall: async () => true,
    askMigrate: async () => true,
    askMysqlConnection: async () => ({
      host: '127.0.0.1',
      port: '3306',
      database: '',
      user: '',
      password: '',
    }),
    askMysqlMigrate: async () => true,
    askAdmin: async () => true,
    ...overrides,
  };
}

function createSetupOperations(events = []) {
  return {
    createLocalSecretsFile: async (_targetPath, preset) => {
      events.push('secrets');
      return {
        fileName: preset === 'cloudflare-d1' ? '.dev.vars' : '.env',
        status: 'created',
      };
    },
    installDependencies: async () => events.push('install'),
    readMysqlConnectionDefaults: async () => {
      events.push('read-database');
      return {
        host: '127.0.0.1',
        port: '3306',
        database: '',
        user: '',
        password: '',
      };
    },
    updateMysqlEnvironmentFile: async () => events.push('database'),
    migrateDatabase: async () => events.push('migrate'),
    initializeAdmin: async () => events.push('admin'),
  };
}

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

test('runCli treats ./ as the current directory in completion output', async () => {
  const cwd = '/tmp/my-app';
  const output = [];

  await runCli(['./'], {
    cwd,
    stdout: { write: (chunk) => output.push(chunk) },
    createProjectImpl: async () => {},
  });

  assert.match(output.join(''), /Created VergeKit app in my-app/);
  assert.doesNotMatch(output.join(''), /Created VergeKit app in \.\//);
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
  assert.match(output.join(''), /--yes/);
  assert.match(output.join(''), /--no-install/);
  assert.match(output.join(''), /--migrate/);
  assert.match(output.join(''), /--admin/);
});

test('interactive mode prompts for missing project choices and completes D1 setup', async () => {
  const cwd = '/tmp/workspace';
  const events = [];
  const createdProjects = [];
  const summaries = [];
  const questions = [];
  const promptUi = createPromptUi({
    askTarget: async () => {
      questions.push('target');
      return 'My Portal';
    },
    askPreset: async () => {
      questions.push('preset');
      return 'cloudflare-d1';
    },
    askInstall: async () => {
      questions.push('install');
      return true;
    },
    askMigrate: async () => {
      questions.push('migrate');
      return true;
    },
    askAdmin: async () => {
      questions.push('admin');
      return true;
    },
    note: (message) => summaries.push(message),
  });

  const exitCode = await runCli([], {
    cwd,
    stdin: { isTTY: true },
    stdout: { isTTY: true, write() {} },
    promptUi,
    createProjectImpl: async (project) => createdProjects.push(project),
    setupOperations: createSetupOperations(events),
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(questions, [
    'target',
    'preset',
    'install',
    'migrate',
    'admin',
  ]);
  assert.deepEqual(events, ['secrets', 'install', 'migrate', 'admin']);
  assert.deepEqual(createdProjects, [
    {
      targetPath: join(cwd, 'My Portal'),
      packageName: 'my-portal',
      preset: 'cloudflare-d1',
    },
  ]);
  assert.match(summaries.join('\n'), /ready for local development/);
  assert.match(summaries.join('\n'), /cd 'My Portal'/);
  assert.match(summaries.join('\n'), /npm run dev/);
});

test('--yes is prompt-free, installs and migrates D1, but leaves admin interactive', async () => {
  const events = [];
  const output = [];
  let promptLoads = 0;

  const exitCode = await runCli(['app', '--yes'], {
    cwd: '/tmp/workspace',
    stdin: { isTTY: false },
    stdout: { isTTY: false, write: (chunk) => output.push(chunk) },
    loadPromptUiImpl: async () => {
      promptLoads += 1;
      return createPromptUi();
    },
    createProjectImpl: async () => {},
    setupOperations: createSetupOperations(events),
  });

  assert.equal(exitCode, 0);
  assert.equal(promptLoads, 0);
  assert.deepEqual(events, ['secrets', 'install', 'migrate']);
  assert.match(output.join(''), /npm run init:admin/);
  assert.match(output.join(''), /npm run dev/);
});

test('skipping dependency installation still creates secrets and prints resume commands', async () => {
  const events = [];
  const summaries = [];

  await runCli(['app', '--preset', 'cloudflare-d1'], {
    cwd: '/tmp/workspace',
    stdin: { isTTY: true },
    stdout: { isTTY: true, write() {} },
    promptUi: createPromptUi({
      askInstall: async () => false,
      note: (message) => summaries.push(message),
    }),
    createProjectImpl: async () => {},
    setupOperations: createSetupOperations(events),
  });

  assert.deepEqual(events, ['secrets']);
  assert.match(summaries.join('\n'), /npm install/);
  assert.match(summaries.join('\n'), /npm run db:migrate:local/);
});

test('Node/MySQL setup installs but waits for database configuration', async () => {
  const events = [];
  const output = [];

  const exitCode = await runCli(
    ['node-app', '--preset', 'node-mysql', '--install'],
    {
      cwd: '/tmp/workspace',
      stdin: { isTTY: false },
      stdout: { isTTY: false, write: (chunk) => output.push(chunk) },
      createProjectImpl: async () => {},
      setupOperations: createSetupOperations(events),
    },
  );

  assert.equal(exitCode, 0);
  assert.deepEqual(events, ['secrets', 'install']);
  assert.match(output.join(''), /MYSQL_HOST.*MYSQL_PORT.*MYSQL_USER/s);
  assert.match(output.join(''), /npm run db:migrate/);
  assert.match(output.join(''), /npm run init:admin/);
});

test('interactive Node/MySQL setup groups connection entry before migration and admin', async () => {
  const events = [];
  const questions = [];
  const summaries = [];
  const connection = {
    host: 'mysql.internal',
    port: '3307',
    database: 'vergekit',
    user: 'vergekit_user',
    password: 'secret',
  };
  const operations = createSetupOperations(events);
  operations.updateMysqlEnvironmentFile = async (_targetPath, value) => {
    events.push('database');
    assert.deepEqual(value, connection);
  };

  const exitCode = await runCli(
    ['node-app', '--preset', 'node-mysql'],
    {
      cwd: '/tmp/workspace',
      stdin: { isTTY: true },
      stdout: { isTTY: true, write() {} },
      promptUi: createPromptUi({
        askInstall: async () => {
          questions.push('install');
          return true;
        },
        askMysqlConnection: async (defaults) => {
          questions.push('database');
          assert.equal(defaults.host, '127.0.0.1');
          return connection;
        },
        askMysqlMigrate: async () => {
          questions.push('migrate');
          return true;
        },
        askAdmin: async () => {
          questions.push('admin');
          return true;
        },
        note: (message) => summaries.push(message),
      }),
      createProjectImpl: async () => events.push('generate'),
      setupOperations: operations,
    },
  );

  assert.equal(exitCode, 0);
  assert.deepEqual(questions, ['install', 'database', 'migrate', 'admin']);
  assert.deepEqual(events, [
    'generate',
    'secrets',
    'install',
    'read-database',
    'database',
    'migrate',
    'admin',
  ]);
  assert.match(summaries.join('\n'), /ready for local development/);
  assert.doesNotMatch(summaries.join('\n'), /npm run db:migrate/);
  assert.doesNotMatch(summaries.join('\n'), /npm run init:admin/);
  assert.match(summaries.join('\n'), /npm run dev/);
});

test('setup failure preserves the project, stops dependent steps, and prints a resume path', async () => {
  const events = [];
  const output = [];
  const operations = createSetupOperations(events);
  operations.installDependencies = async () => {
    events.push('install');
    throw new Error('registry unavailable');
  };

  const exitCode = await runCli(['app', '--yes'], {
    cwd: '/tmp/workspace',
    stdin: { isTTY: false },
    stdout: { isTTY: false, write: (chunk) => output.push(chunk) },
    createProjectImpl: async () => events.push('generate'),
    setupOperations: operations,
  });

  assert.equal(exitCode, 1);
  assert.deepEqual(events, ['generate', 'secrets', 'install']);
  assert.match(output.join(''), /install setup failed/);
  assert.match(output.join(''), /registry unavailable/);
  assert.match(output.join(''), /Resume with:[\s\S]*npm install/);
});

test('an existing environment file is reported without exposing its contents', async () => {
  const output = [];
  const operations = createSetupOperations();
  operations.createLocalSecretsFile = async () => ({
    fileName: '.dev.vars',
    status: 'existing',
  });

  await runCli(['app', '--no-install'], {
    cwd: '/tmp/workspace',
    stdin: { isTTY: false },
    stdout: { isTTY: false, write: (chunk) => output.push(chunk) },
    createProjectImpl: async () => {},
    setupOperations: operations,
  });

  assert.match(output.join(''), /.dev.vars already exists; it was not changed/);
  assert.doesNotMatch(output.join(''), /BETTER_AUTH_SECRET=/);
});

test('unsupported Node versions fail before project generation', async () => {
  let generated = false;

  await assert.rejects(
    () =>
      runCli(['app'], {
        nodeVersion: '20.19.0',
        stdout: { isTTY: false, write() {} },
        createProjectImpl: async () => {
          generated = true;
        },
      }),
    /Node\.js 22\.12\.0 or newer.*20\.19\.0/,
  );
  assert.equal(generated, false);
});

test('cancellation exits cleanly at every prompt and keeps generated projects', async (t) => {
  const cases = [
    { prompt: 'askTarget', argv: [], generated: false },
    { prompt: 'askPreset', argv: [], generated: false },
    {
      prompt: 'askInstall',
      argv: ['app', '--preset', 'cloudflare-d1'],
      generated: true,
    },
    {
      prompt: 'askMigrate',
      argv: ['app', '--preset', 'cloudflare-d1'],
      generated: true,
    },
    {
      prompt: 'askAdmin',
      argv: ['app', '--preset', 'cloudflare-d1'],
      generated: true,
    },
    {
      prompt: 'askMysqlConnection',
      argv: ['app', '--preset', 'node-mysql'],
      generated: true,
    },
    {
      prompt: 'askMysqlMigrate',
      argv: ['app', '--preset', 'node-mysql'],
      generated: true,
    },
  ];

  for (const fixture of cases) {
    await t.test(fixture.prompt, async () => {
      let generated = false;
      const cancellations = [];
      const ui = createPromptUi({
        [fixture.prompt]: async () => {
          throw new PromptCancelledError();
        },
        cancel: (message) => cancellations.push(message),
      });

      const exitCode = await runCli(fixture.argv, {
        cwd: '/tmp/workspace',
        stdin: { isTTY: true },
        stdout: { isTTY: true, write() {} },
        promptUi: ui,
        createProjectImpl: async () => {
          generated = true;
        },
        setupOperations: createSetupOperations(),
      });

      assert.equal(exitCode, 0);
      assert.equal(generated, fixture.generated);
      assert.match(
        cancellations.join('\n'),
        fixture.generated ? /generated project was kept/ : /cancelled/i,
      );
    });
  }
});

test('setup flags parse as tri-state controls and reject contradictions', () => {
  assert.deepEqual(
    parseCliArguments([
      'app',
      '--preset=node-mysql',
      '--install',
      '--no-migrate',
      '--no-admin',
    ]),
    {
      targetArg: 'app',
      targetWasProvided: true,
      preset: 'node-mysql',
      presetWasProvided: true,
      yes: false,
      install: true,
      migrate: false,
      admin: false,
      setupFlagWasProvided: true,
    },
  );
  assert.throws(
    () => parseCliArguments(['--install', '--no-install']),
    /Use only one of --install or --no-install/,
  );
});

test('positive setup flags imply their dependencies in non-interactive mode', async () => {
  const events = [];

  await runCli(['app', '--migrate', '--no-admin'], {
    cwd: '/tmp/workspace',
    stdin: { isTTY: false },
    stdout: { isTTY: false, write() {} },
    createProjectImpl: async () => {},
    setupOperations: createSetupOperations(events),
  });

  assert.deepEqual(events, ['secrets', 'install', 'migrate']);
});

test('completion commands quote shell-sensitive destination paths', async () => {
  const output = [];

  await runCli(['~', '--no-install'], {
    cwd: '/tmp/workspace',
    stdin: { isTTY: false },
    stdout: { isTTY: false, write: (chunk) => output.push(chunk) },
    createProjectImpl: async () => {},
    setupOperations: createSetupOperations(),
  });

  assert.match(output.join(''), /cd '~'/);
});

test('Node/MySQL rejects automatic database steps without an interactive terminal', async () => {
  let generated = false;

  await assert.rejects(
    () =>
      runCli(['app', '--preset', 'node-mysql', '--migrate'], {
        stdin: { isTTY: false },
        stdout: { isTTY: false, write() {} },
        createProjectImpl: async () => {
          generated = true;
        },
      }),
    /requires an interactive terminal.*configured securely/,
  );
  assert.equal(generated, false);
});
