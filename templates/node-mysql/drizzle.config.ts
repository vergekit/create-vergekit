import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

function requireMysqlSetting(name: string, value: string | undefined) {
  const normalizedValue = value?.trim();

  if (!normalizedValue) {
    throw new Error(`${name} is required to run Drizzle Kit.`);
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

const password = process.env.MYSQL_PASSWORD;

export default defineConfig({
  dialect: 'mysql',
  schema: './src/config/schema.ts',
  out: './migrations',
  dbCredentials: {
    host: requireMysqlSetting('MYSQL_HOST', process.env.MYSQL_HOST),
    port: resolveMysqlPort(process.env.MYSQL_PORT),
    user: requireMysqlSetting('MYSQL_USER', process.env.MYSQL_USER),
    ...(password ? { password } : {}),
    database: requireMysqlSetting('MYSQL_DATABASE', process.env.MYSQL_DATABASE),
  },
});
