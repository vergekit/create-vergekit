# create-vergekit

Create a new [VergeKit](https://github.com/vergekit/vergekit) app with an
interactive installer.

```bash
npm create vergekit@latest
```

The installer asks for a destination and preset, generates the project, creates
a local secrets file with a fresh Better Auth secret, and offers to install the
dependencies. Cloudflare Workers + D1 projects can also apply their local
migrations and launch the existing administrator initializer before finishing.
Node.js + MySQL projects collect the database connection in one grouped step,
then can run their migrations and administrator setup too.

Node.js 22.12 or newer is required.

## Presets

- `cloudflare-d1`: Cloudflare Workers + D1; the default and fully guided local
  setup path.
- `node-mysql`: standalone Node.js + MySQL. The installer creates `.env` and can
  install dependencies, collect credentials for a reachable MySQL 8 database,
  run migrations, and create the initial administrator.

Select a preset explicitly with either supported flag form:

```bash
npm create vergekit@latest my-app -- --preset node-mysql
npm create vergekit@latest my-app -- --preset=node-mysql
```

Use the current directory:

```bash
npm create vergekit@latest .
```

## Automation

Non-interactive terminals never prompt. With no setup flags, the CLI preserves
the pre-0.1.4 behavior: it generates the project and exits. Add flags to opt into
the setup stages:

```bash
# Generate, create secrets, install, and migrate local D1. Admin stays manual.
npm create vergekit@latest my-app -- --yes

# Choose individual stages.
npm create vergekit@latest my-app -- --install --migrate --no-admin

# Generate secrets but leave dependency installation for later.
npm create vergekit@latest my-app -- --no-install
```

Available controls:

- `-y`, `--yes`
- `--install` / `--no-install`
- `--migrate` / `--no-migrate`
- `--admin` / `--no-admin`

`--admin` requires a terminal because the generated command prompts for the
administrator name, email, and password. Node/MySQL `--migrate` and `--admin`
also require an interactive terminal so the installer can collect the database
connection without exposing the password in command history. Non-interactive
Node/MySQL setup leaves those steps manual.

## Failure and cancellation

Project generation is transactional. Post-generation setup is deliberately a
separate stage: if npm installation, migration, or administrator creation fails,
the generated project remains in place and the CLI prints the exact commands to
resume. Existing `.dev.vars` files are never overwritten. For Node/MySQL, an
existing `.env` keeps its secrets and unrelated settings; only the five MySQL
values explicitly confirmed in the grouped prompt are updated.

## Development

```bash
npm install
npm test
```

Run the CLI locally:

```bash
npm run preview:installer
```

The preview command uses the sibling `../boilerplate` working tree instead of a
published release, so the complete interactive flow can be tested before the
matching VergeKit tag exists. Give it a destination to keep the preview out of
the `create` repository:

```bash
npm run preview:installer -- /tmp/vergekit-preview
```

Set `VERGEKIT_BOILERPLATE_PATH` if the boilerplate repository lives elsewhere.
The preview harness is not included in the published npm package.

Check the npm package contents before publishing:

```bash
npm pack --dry-run
```
