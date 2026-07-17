# Node.js + MySQL setup

This project targets Node.js 22.12 or newer and MySQL 8. It produces a
standalone Astro server. The application, Drizzle Kit, and administrator
initializer use the same `MYSQL_*` connection settings.

## Environment

Create the local environment file:

```bash
cp .env.example .env
```

Configure these values:

```dotenv
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=user
MYSQL_PASSWORD=password
MYSQL_DATABASE=database
BETTER_AUTH_SECRET=replace-with-a-long-random-secret
BETTER_AUTH_URL=http://localhost:4321
EMAIL_PROVIDER=console
```

Do not commit `.env`. `MYSQL_PASSWORD` may be empty only when the configured
database account has no password. In production, set the variables through the
hosting platform or process manager instead of placing secrets in a deployed
file. Keep `BETTER_AUTH_SECRET` stable, and set `BETTER_AUTH_URL` to the exact
public HTTPS origin.

## Database and migrations

Create an empty MySQL 8 database and a least-privileged application user using
your provider, administration tool, or an authorized MySQL account. For
example, an administrator can create the database with:

```sql
CREATE DATABASE database CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
```

Configure the `MYSQL_*` values for that database, then apply the committed
migrations:

```bash
npm run db:migrate
```

After an intentional change to `src/config/schema.ts`, generate and review a
new migration before applying it:

```bash
npm run db:generate
npm run db:migrate
```

Use `npm run db:studio` to inspect the configured database. Back up production
data before schema changes and verify that restore procedures work.

## Administrator and development

Create the first verified user with the `admin` role:

```bash
npm run init:admin
```

The command prompts for a name, email, and password and uses the same MySQL
settings. Start the development server with:

```bash
npm run dev
```

Before deployment, run the complete check, lint, test, and build pipeline:

```bash
npm run verify
```

## Email providers

The supported providers for this preset are:

- `console`: non-delivering local output; no additional variables.
- `resend`: set `RESEND_API_KEY` and `EMAIL_FROM`.
- `mailgun`: set `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, and `EMAIL_FROM`.

`EMAIL_REPLY_TO` is optional for Resend and Mailgun. Provider API keys and the
Better Auth secret belong in secret storage, not source control.

## Build and production operation

Build the standalone server and run its entrypoint through the project scripts:

```bash
npm run build
npm run start
```

Use a process manager such as systemd, a container supervisor, or your hosting
platform to restart the process after failures and deployments. Put a reverse
proxy in front of the private application port to terminate TLS, forward the
original host and protocol, set appropriate request-size and timeout limits,
and route health checks to `/api/health`.

Deployment checklist:

1. Use a supported Node.js version and an empty or migrated MySQL 8 database.
2. Supply all five `MYSQL_*` settings, a stable `BETTER_AUTH_SECRET`, and the
   public `BETTER_AUTH_URL` through production secret/configuration storage.
3. Configure `console`, Resend, or Mailgun intentionally and test auth email.
4. Run `npm run db:migrate` and `npm run verify`.
5. Run `npm run build`, then supervise `npm run start` behind the reverse proxy.
6. Check `/api/health`, sign-in, sign-out, password reset, and administrator
   access after deployment.
7. Confirm database backups, restore testing, logs, and process monitoring.
