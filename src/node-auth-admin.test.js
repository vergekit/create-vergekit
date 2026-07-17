import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const initializerUrl = new URL(
  '../templates/node-mysql/cli/init-admin.ts',
  import.meta.url,
);
const {
  describeCreateUserFailure,
  initializeAdminUser,
  validateAdminInput,
} = await import(initializerUrl);

const validInput = {
  name: '  Ada Admin  ',
  email: '  ADA@EXAMPLE.COM  ',
  password: 'correct horse battery staple',
};

function createDependencies(overrides = {}) {
  const calls = {
    createUser: [],
    updateUser: [],
    close: 0,
  };
  const dependencies = {
    async createUser(input) {
      calls.createUser.push(input);
      return { id: 'user-1' };
    },
    async updateUser(userId, values) {
      calls.updateUser.push({ userId, values });
    },
    async close() {
      calls.close += 1;
    },
    now: () => new Date('2026-07-15T18:00:00.000Z'),
    ...overrides,
  };

  return { calls, dependencies };
}

test('Node admin input validation normalizes values and rejects invalid input', () => {
  assert.deepEqual(validateAdminInput(validInput), {
    name: 'Ada Admin',
    email: 'ada@example.com',
    password: validInput.password,
  });
  assert.throws(
    () => validateAdminInput({ ...validInput, email: 'invalid' }),
    /valid admin email/,
  );
  assert.throws(
    () => validateAdminInput({ ...validInput, password: 'short' }),
    /at least 8 characters/,
  );
  assert.throws(
    () => validateAdminInput({ ...validInput, password: 'x'.repeat(129) }),
    /no more than 128 characters/,
  );
});

test('Node admin initialization creates credentials before verified/admin update and cleanup', async () => {
  const { calls, dependencies } = createDependencies();

  assert.deepEqual(await initializeAdminUser(validInput, dependencies), {
    id: 'user-1',
    email: 'ada@example.com',
  });
  assert.deepEqual(calls.createUser, [
    {
      name: 'Ada Admin',
      email: 'ada@example.com',
      password: validInput.password,
    },
  ]);
  assert.deepEqual(calls.updateUser, [
    {
      userId: 'user-1',
      values: {
        emailVerified: true,
        role: 'admin',
        updatedAt: new Date('2026-07-15T18:00:00.000Z'),
      },
    },
  ]);
  assert.equal(calls.close, 1);
});

test('Node admin initialization reports duplicates and closes after creation failure', async () => {
  let closeCalls = 0;
  const duplicateError = {
    body: {
      code: 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL',
      message: 'User already exists. Use another email.',
    },
  };
  const { dependencies } = createDependencies({
    async createUser() {
      throw duplicateError;
    },
    async close() {
      closeCalls += 1;
    },
  });

  assert.equal(
    describeCreateUserFailure(duplicateError, 'ada@example.com'),
    'An account already exists for ada@example.com.',
  );
  await assert.rejects(
    initializeAdminUser(validInput, dependencies),
    /An account already exists for ada@example\.com\./,
  );
  assert.equal(closeCalls, 1);
});

test('Node admin initialization reports Better Auth failures and closes the pool', async () => {
  let closeCalls = 0;
  const { dependencies } = createDependencies({
    async createUser() {
      throw new Error('database unavailable');
    },
    async close() {
      closeCalls += 1;
    },
  });

  await assert.rejects(
    initializeAdminUser(validInput, dependencies),
    /Better Auth could not create ada@example\.com: database unavailable/,
  );
  assert.equal(closeCalls, 1);
});

test('Node admin initialization reports update failures and closes the pool', async () => {
  let closeCalls = 0;
  const { dependencies } = createDependencies({
    async updateUser() {
      throw new Error('update rejected');
    },
    async close() {
      closeCalls += 1;
    },
  });

  await assert.rejects(
    initializeAdminUser(validInput, dependencies),
    /Better Auth created ada@example\.com, but the verified admin update failed: update rejected/,
  );
  assert.equal(closeCalls, 1);
});

test('Node auth/admin overlay stays MySQL-specific and avoids raw SQL or Workers mocks', async () => {
  const [initializerSource, authTestSource] = await Promise.all([
    readFile(initializerUrl, 'utf8'),
    readFile(
      new URL(
        '../templates/node-mysql/tests/auth/runtime-seam.test.ts.template',
        import.meta.url,
      ),
      'utf8',
    ),
  ]);

  assert.match(initializerSource, /adminApi\.createUser\(\{ body: input \}\)/);
  assert.match(initializerSource, /\.update\(schema\.user\)/);
  assert.match(initializerSource, /emailVerified: true/);
  assert.match(initializerSource, /role: 'admin'/);
  assert.match(initializerSource, /provider: authDatabaseProvider/);
  assert.match(initializerSource, /close: closeDatabasePool/);
  assert.doesNotMatch(initializerSource, /INSERT\s+INTO|UPDATE\s+[`"']/i);
  assert.doesNotMatch(initializerSource, /node:child_process|\bmysql\s+-/);

  assert.match(authTestSource, /authDatabaseProvider: 'mysql'/);
  assert.match(authTestSource, /from '@\/middleware'/);
  assert.match(authTestSource, /from '@\/pages\/api\/auth\/\[\.\.\.all\]'/);
  assert.doesNotMatch(authTestSource, /cloudflare:workers/);
});
