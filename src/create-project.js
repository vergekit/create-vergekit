import { constants as fsConstants } from 'node:fs';
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { assertTargetDirectoryIsUsable } from './project.js';
import {
  applyPreset,
  DEFAULT_PRESET,
  validateStagedProject,
} from './presets.js';

export async function createProject({
  targetPath,
  packageName,
  preset = DEFAULT_PRESET,
  downloadAndExtractTemplate,
  applyPresetImpl = applyPreset,
}) {
  await assertTargetDirectoryIsUsable(targetPath);

  const extractTemplate =
    downloadAndExtractTemplate ?? (await loadDefaultTemplateExtractor());
  const stagingPath = await mkdtemp(join(tmpdir(), 'create-vergekit-template-'));

  try {
    await extractTemplate(stagingPath);
    await applyPresetImpl(stagingPath, preset);
    await updateGeneratedPackageName(stagingPath, packageName);
    await validateStagedProject(stagingPath, preset, {
      expectedPackageName: packageName,
    });

    await mkdir(targetPath, { recursive: true });
    await cp(stagingPath, targetPath, {
      recursive: true,
      force: true,
      errorOnExist: false,
    });
  } finally {
    await rm(stagingPath, { recursive: true, force: true });
  }
}

async function loadDefaultTemplateExtractor() {
  const { downloadAndExtractTemplate } = await import('./template.js');
  return downloadAndExtractTemplate;
}

async function updateGeneratedPackageName(targetPath, packageName) {
  const packageJsonPath = join(targetPath, 'package.json');
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
  packageJson.name = packageName;
  await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);

  const packageLockPath = join(targetPath, 'package-lock.json');
  if (!(await pathExists(packageLockPath))) {
    return;
  }

  const packageLock = JSON.parse(await readFile(packageLockPath, 'utf8'));
  packageLock.name = packageName;
  if (packageLock.packages?.['']) {
    packageLock.packages[''].name = packageName;
  }

  await writeFile(packageLockPath, `${JSON.stringify(packageLock, null, 2)}\n`);
}

async function pathExists(path) {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}
