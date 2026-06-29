import { basename } from 'node:path';

import { createProject } from './create-project.js';
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

  const positionalArgs = argv.filter((arg) => !arg.startsWith('-'));
  const unknownOptions = argv.filter((arg) => arg.startsWith('-'));

  if (unknownOptions.length > 0) {
    throw new Error(`Unknown option: ${unknownOptions[0]}`);
  }

  if (positionalArgs.length > 1) {
    throw new Error('Expected at most one target directory.');
  }

  const targetArg = positionalArgs[0] ?? '.';
  const target = resolveTargetDirectory(targetArg, cwd);

  await createProjectImpl({
    targetPath: target.path,
    packageName: target.packageName,
  });

  stdout.write(successText(targetArg, target.path));
  return 0;
}

function helpText() {
  return `create-vergekit

Usage: npm create vergekit@latest [directory]

Examples:
  npm create vergekit@latest
  npm create vergekit@latest my-app
  npm create vergekit@latest .
`;
}

function successText(targetArg, targetPath) {
  const projectLabel = targetArg === '.' ? basename(targetPath) : targetArg;

  return `
✅ Created VergeKit app in ${projectLabel}.

For next steps, see installation instructions at https://vergekit.com/docs/installation/
`;
}
