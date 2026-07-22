import assert from 'node:assert/strict';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { applyPreset } from './presets.js';

const overlayPath = fileURLToPath(
  new URL('../templates/node-mysql/', import.meta.url),
);
const schemaPath = join(overlayPath, 'src', 'config', 'schema.ts');
const migrationPath = join(
  overlayPath,
  'migrations',
  '0000_vk_init.sql',
);
const snapshotPath = join(
  overlayPath,
  'migrations',
  'meta',
  '0000_snapshot.json',
);

const betterAuthCoreFields = {
  user: [
    'id',
    'name',
    'email',
    'emailVerified',
    'image',
    'createdAt',
    'updatedAt',
  ],
  session: [
    'id',
    'expiresAt',
    'token',
    'createdAt',
    'updatedAt',
    'ipAddress',
    'userAgent',
    'userId',
  ],
  account: [
    'id',
    'accountId',
    'providerId',
    'userId',
    'accessToken',
    'refreshToken',
    'idToken',
    'accessTokenExpiresAt',
    'refreshTokenExpiresAt',
    'scope',
    'password',
    'createdAt',
    'updatedAt',
  ],
  verification: [
    'id',
    'identifier',
    'value',
    'expiresAt',
    'createdAt',
    'updatedAt',
  ],
};

const betterAuthAdminFields = {
  user: ['role', 'banned', 'banReason', 'banExpires'],
  session: ['impersonatedBy'],
};

const nullableFields = {
  user: ['image', 'role', 'banned', 'banReason', 'banExpires'],
  session: ['ipAddress', 'userAgent', 'impersonatedBy'],
  account: [
    'accessToken',
    'refreshToken',
    'idToken',
    'accessTokenExpiresAt',
    'refreshTokenExpiresAt',
    'scope',
    'password',
  ],
  verification: [],
};

const dateFields = {
  user: ['banExpires', 'createdAt', 'updatedAt'],
  session: ['expiresAt', 'createdAt', 'updatedAt'],
  account: [
    'accessTokenExpiresAt',
    'refreshTokenExpiresAt',
    'createdAt',
    'updatedAt',
  ],
  verification: ['expiresAt', 'createdAt', 'updatedAt'],
};

async function readSnapshot() {
  return JSON.parse(await readFile(snapshotPath, 'utf8'));
}

test('MySQL overlay matches the pinned Better Auth 1.6.x core and admin field contract', async () => {
  const snapshot = await readSnapshot();
  const packageLock = JSON.parse(
    await readFile(join(overlayPath, 'package-lock.json'), 'utf8'),
  );

  assert.equal(
    packageLock.packages['node_modules/@vergekit/core/node_modules/better-auth']
      .version,
    '1.6.19',
  );
  assert.equal(
    packageLock.packages['node_modules/@better-auth/drizzle-adapter'].version,
    '1.6.19',
  );
  assert.match(
    packageLock.packages['node_modules/better-auth'].version,
    /^1\.6\./,
  );
  assert.equal(snapshot.dialect, 'mysql');
  assert.deepEqual(Object.keys(snapshot.tables).sort(), [
    'account',
    'session',
    'user',
    'verification',
  ]);

  for (const [tableName, coreFields] of Object.entries(betterAuthCoreFields)) {
    const expectedFields = [
      ...coreFields,
      ...(betterAuthAdminFields[tableName] ?? []),
    ].sort();
    assert.deepEqual(
      Object.keys(snapshot.tables[tableName].columns).sort(),
      expectedFields,
      `${tableName} must expose the complete Better Auth field set`,
    );
  }
});

test('MySQL schema bounds keys and indexed or unique strings', async () => {
  const { tables } = await readSnapshot();

  for (const table of Object.values(tables)) {
    assert.equal(table.columns.id.type, 'varchar(36)');
    assert.deepEqual(
      Object.values(table.compositePrimaryKeys).flatMap(({ columns }) =>
        columns,
      ),
      ['id'],
    );
  }

  assert.equal(tables.session.columns.userId.type, 'varchar(36)');
  assert.equal(tables.account.columns.userId.type, 'varchar(36)');
  assert.equal(tables.session.columns.impersonatedBy.type, 'varchar(36)');
  assert.equal(tables.user.columns.email.type, 'varchar(255)');
  assert.equal(tables.session.columns.token.type, 'varchar(255)');
  assert.equal(tables.verification.columns.identifier.type, 'varchar(255)');

  assert.deepEqual(tables.user.uniqueConstraints.user_email_unique.columns, [
    'email',
  ]);
  assert.deepEqual(
    tables.session.uniqueConstraints.session_token_unique.columns,
    ['token'],
  );
  assert.deepEqual(tables.session.indexes.session_userId_idx.columns, [
    'userId',
  ]);
  assert.deepEqual(tables.account.indexes.account_userId_idx.columns, [
    'userId',
  ]);
  assert.deepEqual(
    tables.verification.indexes.verification_identifier_idx.columns,
    ['identifier'],
  );
});

test('MySQL schema preserves cascades, nullability, booleans, admin fields, and datetime(3)', async () => {
  const { tables } = await readSnapshot();

  for (const [tableName, nullable] of Object.entries(nullableFields)) {
    for (const [columnName, column] of Object.entries(
      tables[tableName].columns,
    )) {
      assert.equal(
        column.notNull,
        !nullable.includes(columnName),
        `${tableName}.${columnName} nullability must match Better Auth`,
      );
    }
  }

  for (const tableName of ['session', 'account']) {
    const foreignKey = Object.values(tables[tableName].foreignKeys)[0];
    assert.deepEqual(
      {
        tableFrom: foreignKey.tableFrom,
        tableTo: foreignKey.tableTo,
        columnsFrom: foreignKey.columnsFrom,
        columnsTo: foreignKey.columnsTo,
        onDelete: foreignKey.onDelete,
      },
      {
        tableFrom: tableName,
        tableTo: 'user',
        columnsFrom: ['userId'],
        columnsTo: ['id'],
        onDelete: 'cascade',
      },
    );
  }

  assert.equal(tables.user.columns.emailVerified.type, 'boolean');
  assert.equal(tables.user.columns.emailVerified.default, false);
  assert.equal(tables.user.columns.banned.type, 'boolean');
  assert.equal(tables.user.columns.banned.default, false);
  assert.equal(tables.user.columns.role.default, "'user'");
  assert.equal(tables.user.columns.banReason.type, 'text');

  for (const [tableName, columns] of Object.entries(dateFields)) {
    for (const columnName of columns) {
      assert.equal(
        tables[tableName].columns[columnName].type,
        'datetime(3)',
        `${tableName}.${columnName} must avoid MySQL timestamp range limits`,
      );
    }
  }
});

test('generated MySQL SQL contains the complete auth constraints and no timestamp columns', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  const tableNames = [...sql.matchAll(/CREATE TABLE `([^`]+)`/g)]
    .map((match) => match[1])
    .sort();

  assert.deepEqual(tableNames, ['account', 'session', 'user', 'verification']);
  assert.match(sql, /CONSTRAINT `user_email_unique` UNIQUE\(`email`\)/);
  assert.match(sql, /CONSTRAINT `session_token_unique` UNIQUE\(`token`\)/);
  assert.match(
    sql,
    /FOREIGN KEY \(`userId`\) REFERENCES `user`\(`id`\) ON DELETE cascade/,
  );
  assert.match(sql, /CREATE INDEX `account_userId_idx`/);
  assert.match(sql, /CREATE INDEX `session_userId_idx`/);
  assert.match(sql, /CREATE INDEX `verification_identifier_idx`/);
  assert.match(sql, /`emailVerified` boolean NOT NULL DEFAULT false/);
  assert.match(sql, /`banned` boolean DEFAULT false/);
  assert.match(sql, /datetime\(3\)/);
  assert.doesNotMatch(sql, /\btimestamp\b/i);
});

test('schema keeps Date objects at the driver boundary and generated relations for Better Auth joins', async () => {
  const source = await readFile(schemaPath, 'utf8');

  assert.equal((source.match(/mode: 'date'/g) ?? []).length, 13);
  assert.equal((source.match(/fsp: 3/g) ?? []).length, 13);
  assert.match(source, /export const userRelations = relations/);
  assert.match(source, /export const sessionRelations = relations/);
  assert.match(source, /export const accountRelations = relations/);
  assert.doesNotMatch(source, /sqlite-core|\btimestamp\(/);
});

test('node-mysql output replaces the D1 migration history with MySQL migrations', async () => {
  const stagingPath = await mkdtemp(join(tmpdir(), 'node-mysql-schema-'));
  await mkdir(join(stagingPath, 'migrations'), { recursive: true });
  await mkdir(join(stagingPath, 'src', 'pages'), { recursive: true });
  await writeFile(join(stagingPath, 'migrations', '0000.sql'), '-- d1\n');
  await writeFile(
    join(stagingPath, 'src', 'pages', 'index.astro'),
    '<h1>Canonical homepage</h1>\n',
  );
  await writeFile(
    join(stagingPath, 'package.json'),
    `${JSON.stringify({ name: 'vk', version: '0.1.2' }, null, 2)}\n`,
  );

  await applyPreset(stagingPath, 'node-mysql');

  assert.deepEqual((await readdir(join(stagingPath, 'migrations'))).sort(), [
    '0000_vk_init.sql',
    'meta',
  ]);
  assert.deepEqual(
    (await listFiles(join(stagingPath, 'migrations'))).sort(),
    ['0000_vk_init.sql', 'meta/0000_snapshot.json', 'meta/_journal.json'],
  );
});

async function listFiles(rootPath, relativePath = '') {
  const directoryPath = join(rootPath, relativePath);
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = join(relativePath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(rootPath, entryPath)));
    } else {
      files.push(entryPath);
    }
  }

  return files;
}
