import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createProject } from './create-project.js';

test('createProject copies the template and renames the generated package', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'create-vergekit-'));
  const targetPath = join(workspace, 'My App');

  await createProject({
    targetPath,
    packageName: 'my-app',
    downloadAndExtractTemplate: async (stagingPath) => {
      await writeFile(
        join(stagingPath, 'package.json'),
        `${JSON.stringify({ name: 'vk', private: true }, null, 2)}\n`,
      );
      await writeFile(join(stagingPath, 'README.md'), '# Verge Kit\n');
    },
  });

  const packageJson = JSON.parse(
    await readFile(join(targetPath, 'package.json'), 'utf8'),
  );
  const readme = await readFile(join(targetPath, 'README.md'), 'utf8');

  assert.equal(packageJson.name, 'my-app');
  assert.equal(packageJson.private, true);
  assert.equal(readme, '# Verge Kit\n');
});
