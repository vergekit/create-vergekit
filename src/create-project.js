import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { assertTargetDirectoryIsUsable } from './project.js';

export async function createProject({
  targetPath,
  packageName,
  downloadAndExtractTemplate,
}) {
  await assertTargetDirectoryIsUsable(targetPath);

  const stagingPath = await mkdtemp(join(tmpdir(), 'create-vergekit-template-'));
  const extractTemplate =
    downloadAndExtractTemplate ?? (await loadDefaultTemplateExtractor());

  try {
    await mkdir(stagingPath, { recursive: true });
    await mkdir(targetPath, { recursive: true });
    await extractTemplate(stagingPath);
    await cp(stagingPath, targetPath, {
      recursive: true,
      force: true,
      errorOnExist: false,
    });
    await updateGeneratedPackageName(targetPath, packageName);
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
}
