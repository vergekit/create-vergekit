# Verge Kit — Node.js + MySQL

This Verge Kit preset is an ordinary Astro server application using the
standalone Node.js adapter, MySQL 8, Drizzle ORM, and Better Auth.

## Quick start

Use Node.js 22.12 or newer and a MySQL 8 database. Install dependencies, copy
the environment template, and set a stable Better Auth secret:

```bash
npm install
cp .env.example .env
```

Set `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, and
`MYSQL_DATABASE` in `.env` for the database you created. `MYSQL_PASSWORD` may
be empty when the database account has no password. Set `BETTER_AUTH_SECRET`
to a long random value and keep it stable for the life of the deployment.

Apply the committed MySQL migration and create the first verified administrator:

```bash
npm run db:migrate
npm run init:admin
```

Start local development:

```bash
npm run dev
```

Run the complete project checks before deployment:

```bash
npm run verify
```

## Production

Build and run the standalone server:

```bash
npm run build
npm run start
```

Run the server under a process manager and place a TLS-terminating reverse
proxy in front of it. Supply production environment variables through the
process manager or hosting platform, set `BETTER_AUTH_URL` to the public HTTPS
origin, and keep the application port private.

`EMAIL_PROVIDER=console` is the non-delivering development default. Production
email delivery supports Resend and Mailgun through their HTTP APIs. Configure
the selected provider's API key plus `EMAIL_FROM`; Mailgun also requires
`MAILGUN_DOMAIN`.

See [the Node/MySQL setup guide](docs/setup/node-mysql.md) for database creation,
environment variables, migrations, email settings, and a deployment checklist.

## Common commands

```bash
npm run db:generate  # generate a migration after changing the schema
npm run db:migrate   # apply committed migrations
npm run db:studio    # inspect the configured database
npm run init:admin   # create a verified administrator
npm run dev          # local development server
npm run verify       # type-check, lint, test, and build
npm run build        # build the standalone server
npm run start        # run dist/server/entry.mjs
```
