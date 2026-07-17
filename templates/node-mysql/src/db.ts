import { drizzle } from 'drizzle-orm/mysql2';
import { createPool } from 'mysql2/promise';
import { runtimeEnv } from '@/runtime';

export const authDatabaseProvider = 'mysql' as const;

function requireMysqlSetting(name: string, value: string | undefined) {
  const normalizedValue = value?.trim();

  if (!normalizedValue) {
    throw new Error(`${name} is required for the node-mysql preset.`);
  }

  return normalizedValue;
}

function resolveMysqlPort(value: string | undefined) {
  const port = Number(value?.trim() || '3306');

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('MYSQL_PORT must be an integer between 1 and 65535.');
  }

  return port;
}

export const pool = createPool({
  host: requireMysqlSetting('MYSQL_HOST', runtimeEnv.MYSQL_HOST),
  port: resolveMysqlPort(runtimeEnv.MYSQL_PORT),
  user: requireMysqlSetting('MYSQL_USER', runtimeEnv.MYSQL_USER),
  password: runtimeEnv.MYSQL_PASSWORD,
  database: requireMysqlSetting('MYSQL_DATABASE', runtimeEnv.MYSQL_DATABASE),
  timezone: 'Z',
});

export const db = drizzle(pool);

export type AppDatabase = typeof db;

export async function closeDatabasePool() {
  await pool.end();
}
