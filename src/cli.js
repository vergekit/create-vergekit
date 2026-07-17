import { basename } from 'node:path';

import { createProject } from './create-project.js';
import {
  DEFAULT_PRESET,
  SUPPORTED_PRESETS,
  validatePreset,
} from './presets.js';
import { resolveTargetDirectory } from './project.js';

export async function runCli(
  argv,
  {
    cwd = process.cwd(),
    stdout = process.stdout,
    createProjectImpl = createProject,
  } = {},
) {
  if (argv.includes('--help') || argv.includes('-h')) {
    stdout.write(helpText());
    return 0;
  }

  const { preset, targetArg } = parseCliArguments(argv);
  const target = resolveTargetDirectory(targetArg, cwd);

  await createProjectImpl({
    targetPath: target.path,
    packageName: target.packageName,
    preset,
  });

  stdout.write(successText(targetArg, target.path));
  return 0;
}

export function parseCliArguments(argv) {
  const positionalArgs = [];
  let preset = DEFAULT_PRESET;
  let presetWasProvided = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--preset') {
      if (presetWasProvided) {
        throw new Error('The --preset option may only be provided once.');
      }

      const value = argv[index + 1];
      if (!value || value.startsWith('-')) {
        throw new Error(
          `Missing value for --preset. Supported presets: ${SUPPORTED_PRESETS.join(', ')}.`,
        );
      }

      preset = validatePreset(value);
      presetWasProvided = true;
      index += 1;
      continue;
    }

    if (arg.startsWith('--preset=')) {
      if (presetWasProvided) {
        throw new Error('The --preset option may only be provided once.');
      }

      const value = arg.slice('--preset='.length);
      if (!value) {
        throw new Error(
          `Missing value for --preset. Supported presets: ${SUPPORTED_PRESETS.join(', ')}.`,
        );
      }

      preset = validatePreset(value);
      presetWasProvided = true;
      continue;
    }

    if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    }

    positionalArgs.push(arg);
  }

  if (positionalArgs.length > 1) {
    throw new Error('Expected at most one target directory.');
  }

  return {
    preset,
    targetArg: positionalArgs[0] ?? '.',
  };
}

function helpText() {
  return `create-vergekit

Usage: npm create vergekit@latest [directory] [--preset <preset>]
       npm create vergekit@latest [directory] [--preset=<preset>]

Presets:
  cloudflare-d1  Cloudflare Workers + D1 (default)
  node-mysql     Standalone Node.js + MySQL

Examples:
  npm create vergekit@latest
  npm create vergekit@latest my-app
  npm create vergekit@latest .
  npm create vergekit@latest my-app -- --preset node-mysql
`;
}

function successText(targetArg, targetPath) {
  const projectLabel = targetArg === '.' ? basename(targetPath) : targetArg;

  return `
✅ Created VergeKit app in ${projectLabel}.

For next steps, see installation instructions at https://vergekit.com/docs/installation/
`;
}
