#!/usr/bin/env node
import process from 'node:process';
import { resolve } from 'node:path';

import { runCli } from '../src/cli.js';
import { createProject } from '../src/create-project.js';
import { copyLocalBoilerplate } from './verify-generated-projects.mjs';

const boilerplatePath = resolve(
  process.env.VERGEKIT_BOILERPLATE_PATH ?? '../boilerplate',
);

try {
  process.exitCode = await runCli(process.argv.slice(2), {
    createProjectImpl: (project) =>
      createProject({
        ...project,
        downloadAndExtractTemplate: (stagingPath) =>
          copyLocalBoilerplate(boilerplatePath, stagingPath),
      }),
  });
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
