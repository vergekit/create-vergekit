import assert from 'node:assert/strict';
import test from 'node:test';

import { createPromptUi, PromptCancelledError } from './prompts.js';

const CANCEL = Symbol('cancel');

function createClack(overrides = {}) {
  const clack = {
    intro() {},
    cancel() {},
    outro() {},
    note() {},
    log: { step() {}, warn() {}, error() {} },
    spinner: () => ({ start() {}, stop() {}, error() {} }),
    text: async () => '.',
    password: async () => '',
    select: async () => 'cloudflare-d1',
    confirm: async () => true,
    isCancel: (value) => value === CANCEL,
    ...overrides,
  };

  clack.group ??= async (prompts, options) => {
    const results = {};
    for (const [name, prompt] of Object.entries(prompts)) {
      const value = await prompt({ results });
      if (clack.isCancel(value)) {
        options?.onCancel?.({ results });
      }
      results[name] = value;
    }
    return results;
  };

  return clack;
}

test('every interactive question converts Clack cancellation cleanly', async (t) => {
  for (const method of [
    ['askTarget', 'text'],
    ['askPreset', 'select'],
    ['askInstall', 'confirm'],
    ['askMigrate', 'confirm'],
    ['askMysqlMigrate', 'confirm'],
    ['askAdmin', 'confirm'],
  ]) {
    await t.test(method[0], async () => {
      const ui = createPromptUi(
        createClack({ [method[1]]: async () => CANCEL }),
      );
      await assert.rejects(() => ui[method[0]](), PromptCancelledError);
    });
  }
});

test('MySQL connection questions are grouped, defaulted, validated, and mask the password', async () => {
  const textOptions = [];
  let passwordOptions;
  const answers = ['db.internal', '3307', 'vergekit', 'app_user'];
  const ui = createPromptUi(
    createClack({
      text: async (options) => {
        textOptions.push(options);
        return answers.shift();
      },
      password: async (options) => {
        passwordOptions = options;
        return 'secret value';
      },
    }),
  );

  const defaults = {
    host: '127.0.0.1',
    port: '3306',
    database: '',
    user: '',
    password: '',
  };
  assert.deepEqual(await ui.askMysqlConnection(defaults), {
    host: 'db.internal',
    port: '3307',
    database: 'vergekit',
    user: 'app_user',
    password: 'secret value',
  });
  assert.deepEqual(
    textOptions.map(({ defaultValue }) => defaultValue),
    ['127.0.0.1', '3306', '', ''],
  );
  assert.equal(textOptions[0].validate('  '), 'MySQL host is required.');
  assert.equal(textOptions[0].validate(undefined), undefined);
  assert.equal(textOptions[1].validate('70000'), 'Enter a port between 1 and 65535.');
  assert.equal(textOptions[1].validate('3306'), undefined);
  assert.equal(textOptions[1].validate(undefined), undefined);
  assert.equal(textOptions[2].validate(undefined), 'Database name is required.');
  assert.equal(textOptions[3].validate(undefined), 'Database user is required.');
  assert.equal(passwordOptions.mask, '•');
});

test('Enter accepts host and port defaults but database and user require input', async () => {
  const defaults = {
    host: '127.0.0.1',
    port: '3306',
    database: '',
    user: '',
    password: '',
  };
  let field = 0;
  const ui = createPromptUi(
    createClack({
      text: async (options) => {
        field += 1;
        if (field <= 2) {
          assert.equal(options.validate(undefined), undefined);
          return options.defaultValue;
        }
        assert.match(options.validate(undefined), /required/);
        return field === 3 ? 'vergekit' : 'vergekit_user';
      },
      password: async () => '',
    }),
  );

  assert.deepEqual(await ui.askMysqlConnection(defaults), {
    ...defaults,
    database: 'vergekit',
    user: 'vergekit_user',
  });
});

test('cancelling any MySQL connection field cancels the grouped setup', async () => {
  const ui = createPromptUi(createClack({ text: async () => CANCEL }));
  await assert.rejects(
    () =>
      ui.askMysqlConnection({
        host: '127.0.0.1',
        port: '3306',
        database: '',
        user: '',
        password: '',
      }),
    PromptCancelledError,
  );
});

test('prompt tasks stop or report errors without hiding the operation result', async () => {
  const events = [];
  const ui = createPromptUi(
    createClack({
      spinner: () => ({
        start: (message) => events.push(`start:${message}`),
        stop: (message) => events.push(`stop:${message}`),
        error: (message) => events.push(`error:${message}`),
      }),
    }),
  );

  assert.equal(await ui.task('Working', async () => 42), 42);
  await assert.rejects(
    () => ui.task('Breaking', async () => Promise.reject(new Error('boom'))),
    /boom/,
  );
  assert.deepEqual(events, [
    'start:Working',
    'stop:Working',
    'start:Breaking',
    'error:Breaking failed',
  ]);
});

test('preset selection hides Clack keyboard instruction helpers', async () => {
  let selectOptions;
  const ui = createPromptUi(
    createClack({
      select: async (options) => {
        selectOptions = options;
        return 'cloudflare-d1';
      },
    }),
  );

  assert.equal(await ui.askPreset(), 'cloudflare-d1');
  assert.equal(selectOptions.showInstructions, false);
});

test('destination prompt presents the current directory as a path', async () => {
  let textOptions;
  const ui = createPromptUi(
    createClack({
      text: async (options) => {
        textOptions = options;
        return './';
      },
    }),
  );

  assert.equal(await ui.askTarget(), './');
  assert.equal(textOptions.defaultValue, './');
  assert.equal(textOptions.placeholder, './');
  assert.equal(textOptions.validate(undefined), undefined);
});
