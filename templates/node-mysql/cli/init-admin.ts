#!/usr/bin/env node
import process from 'node:process';
import { createInterface } from 'node:readline/promises';
import { pathToFileURL } from 'node:url';

export interface AdminInput {
  name: string;
  email: string;
  password: string;
}

export interface AdminUserUpdate {
  emailVerified: true;
  role: 'admin';
  updatedAt: Date;
}

export interface AdminInitializerDependencies {
  createUser(input: AdminInput): Promise<{ id: string }>;
  updateUser(userId: string, values: AdminUserUpdate): Promise<void>;
  close(): Promise<void>;
  now?: () => Date;
}

export type MaskedPasswordCharacterResult =
  | { status: 'input'; value: string; output: string }
  | { status: 'submit'; value: string; output: string }
  | { status: 'cancel'; value: string; output: string };

interface BetterAuthAdminApi {
  createUser(input: {
    body: AdminInput;
  }): Promise<{ user: { id: string } }>;
}

const DEFAULT_AUTH_URL = 'http://localhost:4321';
const DEFAULT_ADMIN_NAME = 'Admin User';
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function errorMessage(error: unknown) {
  if (error && typeof error === 'object') {
    const body = 'body' in error ? error.body : undefined;

    if (
      body &&
      typeof body === 'object' &&
      'message' in body &&
      typeof body.message === 'string' &&
      body.message.trim()
    ) {
      return body.message;
    }
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return String(error);
}

function errorCode(error: unknown) {
  if (!error || typeof error !== 'object') {
    return '';
  }

  const body = 'body' in error ? error.body : undefined;

  if (
    body &&
    typeof body === 'object' &&
    'code' in body &&
    typeof body.code === 'string'
  ) {
    return body.code;
  }

  return 'code' in error && typeof error.code === 'string' ? error.code : '';
}

export function validateAdminInput(input: AdminInput): AdminInput {
  const name = input.name.trim() || DEFAULT_ADMIN_NAME;
  const email = input.email.trim().toLowerCase();

  if (!isValidEmail(email)) {
    throw new Error('Enter a valid admin email address.');
  }

  if (input.password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `Admin password must be at least ${MIN_PASSWORD_LENGTH} characters long.`,
    );
  }

  if (input.password.length > MAX_PASSWORD_LENGTH) {
    throw new Error(
      `Admin password must be no more than ${MAX_PASSWORD_LENGTH} characters long.`,
    );
  }

  return { name, email, password: input.password };
}

export function describeCreateUserFailure(error: unknown, email: string) {
  const message = errorMessage(error);
  const signature = `${errorCode(error)} ${message}`.toLowerCase();

  if (
    signature.includes('user_already_exists') ||
    signature.includes('already exists') ||
    signature.includes('duplicate')
  ) {
    return `An account already exists for ${email}.`;
  }

  return `Better Auth could not create ${email}: ${message}`;
}

export async function initializeAdminUser(
  input: AdminInput,
  dependencies: AdminInitializerDependencies,
) {
  try {
    const admin = validateAdminInput(input);
    let user: { id: string };

    try {
      user = await dependencies.createUser(admin);

      if (!user.id) {
        throw new Error('Better Auth did not return the created user id.');
      }
    } catch (error) {
      throw new Error(describeCreateUserFailure(error, admin.email), {
        cause: error,
      });
    }

    const update: AdminUserUpdate = {
      emailVerified: true,
      role: 'admin',
      updatedAt: dependencies.now?.() ?? new Date(),
    };

    try {
      await dependencies.updateUser(user.id, update);
    } catch (error) {
      throw new Error(
        `Better Auth created ${admin.email}, but the verified admin update failed: ${errorMessage(error)}`,
        { cause: error },
      );
    }

    return { id: user.id, email: admin.email };
  } finally {
    await dependencies.close();
  }
}

export function applyMaskedPasswordCharacter(
  value: string,
  character: string,
): MaskedPasswordCharacterResult {
  if (character === '\u0003') {
    return { status: 'cancel', value, output: '' };
  }

  if (character === '\r' || character === '\n') {
    return { status: 'submit', value, output: '' };
  }

  if (character === '\u007f' || character === '\b') {
    if (!value) {
      return { status: 'input', value, output: '' };
    }

    return { status: 'input', value: value.slice(0, -1), output: '\b \b' };
  }

  return { status: 'input', value: `${value}${character}`, output: '*' };
}

async function questionHidden(query: string) {
  const input = process.stdin;

  if (!input.isTTY || typeof input.setRawMode !== 'function') {
    const fallback = createInterface({ input, output: process.stdout });

    try {
      return await fallback.question(query);
    } finally {
      fallback.close();
    }
  }

  return new Promise<string>((resolve, reject) => {
    let value = '';
    const wasRaw = input.isRaw;

    const cleanup = () => {
      input.off('data', onData);
      input.setRawMode(Boolean(wasRaw));
      input.pause();
      process.stdout.write('\n');
    };

    const onData = (data: Buffer) => {
      for (const character of data.toString('utf8')) {
        const next = applyMaskedPasswordCharacter(value, character);

        if (next.output) {
          process.stdout.write(next.output);
        }

        value = next.value;

        if (next.status === 'cancel') {
          cleanup();
          reject(new Error('Cancelled.'));
          return;
        }

        if (next.status === 'submit') {
          cleanup();
          resolve(value);
          return;
        }
      }
    };

    process.stdout.write(query);
    input.setRawMode(true);
    input.resume();
    input.on('data', onData);
  });
}

async function promptForAdminUser(): Promise<AdminInput> {
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  let readlineClosed = false;
  const closeReadline = () => {
    if (!readlineClosed) {
      readline.close();
      readlineClosed = true;
    }
  };

  try {
    const rawName = await readline.question(
      `Enter admin name (press Enter for "${DEFAULT_ADMIN_NAME}"): `,
    );
    const name = rawName.trim() || DEFAULT_ADMIN_NAME;
    let email = '';

    while (!email) {
      const candidate = (await readline.question('Enter admin email: '))
        .trim()
        .toLowerCase();

      if (isValidEmail(candidate)) {
        email = candidate;
      } else {
        console.error('Invalid email format. Please try again.');
      }
    }

    closeReadline();
    let password = '';

    while (!password) {
      const candidate = await questionHidden(
        `Enter admin password (${MIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH} characters): `,
      );

      if (
        candidate.length >= MIN_PASSWORD_LENGTH &&
        candidate.length <= MAX_PASSWORD_LENGTH
      ) {
        password = candidate;
      } else {
        console.error(
          `Password must be ${MIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH} characters long.`,
        );
      }
    }

    return { name, email, password };
  } finally {
    closeReadline();
  }
}

export async function loadNodeAdminDependencies(): Promise<AdminInitializerDependencies> {
  const [
    { createAuthFromEnv },
    { eq },
    { authConfig },
    schema,
    { runtimeEnv },
  ] = await Promise.all([
    import('@vergekit/core/auth'),
    import('drizzle-orm'),
    import('../src/config/auth'),
    import('../src/config/schema'),
    import('../src/runtime'),
  ]);
  const { authDatabaseProvider, closeDatabasePool, db } = await import(
    '../src/db'
  );

  return {
    async createUser(input) {
      const baseURL = runtimeEnv.BETTER_AUTH_URL?.trim() || DEFAULT_AUTH_URL;
      const request = new Request(
        new URL('/api/auth/admin/create-user', baseURL),
      );
      const auth = createAuthFromEnv({
        runtimeEnv,
        request,
        database: db,
        schema,
        authConfig,
        drizzle: {
          provider: authDatabaseProvider,
        },
      });
      const adminApi = auth.api as unknown as BetterAuthAdminApi;
      const result = await adminApi.createUser({ body: input });

      return { id: result.user.id };
    },
    async updateUser(userId, values) {
      await db
        .update(schema.user)
        .set(values)
        .where(eq(schema.user.id, userId));
    },
    close: closeDatabasePool,
  };
}

function showHelp() {
  console.log(`Create a verified Better Auth user with the admin role in MySQL.

Usage:
  npm run init:admin

The script reads MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD,
MYSQL_DATABASE, BETTER_AUTH_SECRET, and BETTER_AUTH_URL from .env or the
process environment.`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    showHelp();
    return;
  }

  if (args.length > 0) {
    throw new Error(`Unknown argument: ${args[0]}`);
  }

  const admin = await promptForAdminUser();
  const dependencies = await loadNodeAdminDependencies();

  console.log('\nCreating verified user with the admin role in MySQL...');
  const result = await initializeAdminUser(admin, dependencies);

  console.log(`\nAdmin role user created: ${result.email}`);
}

function isMain(moduleUrl: string, argvPath: string | undefined) {
  return Boolean(argvPath && moduleUrl === pathToFileURL(argvPath).href);
}

if (isMain(import.meta.url, process.argv[1])) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\nFailed to create admin user: ${message}`);
    process.exitCode = 1;
  });
}
