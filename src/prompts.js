export class PromptCancelledError extends Error {
  constructor() {
    super('Installation cancelled.');
    this.name = 'PromptCancelledError';
  }
}

export async function loadPromptUi() {
  return createPromptUi(await import('@clack/prompts'));
}

export function createPromptUi(clack) {
  const valueOrCancel = (value) => {
    if (clack.isCancel(value)) {
      throw new PromptCancelledError();
    }

    return value;
  };

  return {
    intro() {
      clack.intro('Create a new Verge Kit app');
    },
    cancel(message = 'Installation cancelled.') {
      clack.cancel(message);
    },
    outro(message) {
      clack.outro(message);
    },
    note(message, title) {
      clack.note(message, title);
    },
    step(message) {
      clack.log.step(message);
    },
    warn(message) {
      clack.log.warn(message);
    },
    error(message) {
      clack.log.error(message);
    },
    async task(message, operation) {
      const spin = clack.spinner();
      spin.start(message);

      try {
        const result = await operation();
        spin.stop(message);
        return result;
      } catch (error) {
        spin.error(`${message} failed`);
        throw error;
      }
    },
    async askTarget() {
      return valueOrCancel(
        await clack.text({
          message: 'Where should we create your project?',
          defaultValue: './',
          placeholder: './',
          validate(value) {
            if (value !== undefined && !value.trim()) {
              return 'Enter a directory or use ./ for the current directory.';
            }
          },
        }),
      ).trim();
    },
    async askPreset() {
      return valueOrCancel(
        await clack.select({
          message: 'Choose a runtime and database',
          initialValue: 'cloudflare-d1',
          showInstructions: false,
          options: [
            {
              value: 'cloudflare-d1',
              label: 'Cloudflare Workers + D1',
              hint: 'default',
            },
            {
              value: 'node-mysql',
              label: 'Node.js + MySQL',
              // hint: 'requires a MySQL 8 database',
            },
          ],
        }),
      );
    },
    async askInstall() {
      return valueOrCancel(
        await clack.confirm({
          message: 'Install dependencies?',
          initialValue: true,
        }),
      );
    },
    async askMigrate() {
      return valueOrCancel(
        await clack.confirm({
          message: 'Initialize the local D1 database?',
          initialValue: true,
        }),
      );
    },
    async askMysqlConnection(defaults) {
      return clack.group(
        {
          host: () =>
            clack.text({
              message: 'MySQL host',
              defaultValue: defaults.host,
              placeholder: defaults.host,
              validate: requiredSetting('MySQL host', defaults.host),
            }),
          port: () =>
            clack.text({
              message: 'MySQL port',
              defaultValue: defaults.port,
              placeholder: defaults.port,
              validate(value) {
                const port = Number((value ?? defaults.port).trim());
                if (!Number.isInteger(port) || port < 1 || port > 65_535) {
                  return 'Enter a port between 1 and 65535.';
                }
              },
            }),
          database: () =>
            clack.text({
              message: 'Database name',
              defaultValue: defaults.database,
              validate: requiredSetting('Database name', defaults.database),
            }),
          user: () =>
            clack.text({
              message: 'Database user',
              defaultValue: defaults.user,
              validate: requiredSetting('Database user', defaults.user),
            }),
          password: () =>
            clack.password({
              message: 'Database password (leave blank for none)',
              mask: '•',
            }),
        },
        {
          onCancel() {
            throw new PromptCancelledError();
          },
        },
      );
    },
    async askMysqlMigrate() {
      return valueOrCancel(
        await clack.confirm({
          message: 'Connect and run the MySQL migrations?',
          initialValue: true,
        }),
      );
    },
    async askAdmin() {
      return valueOrCancel(
        await clack.confirm({
          message: 'Create the initial administrator now?',
          initialValue: true,
        }),
      );
    },
  };
}

function requiredSetting(label, defaultValue) {
  return (value) => {
    if (!(value ?? defaultValue).trim()) {
      return `${label} is required.`;
    }
  };
}
