import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const TEMPLATE_TARBALL_URL =
  'https://codeload.github.com/jyoungblood/vergekit/tar.gz/main';

export async function downloadAndExtractTemplate(
  destinationPath,
  {
    fetchImpl = globalThis.fetch,
    extractTarball = extractTarballToDirectory,
  } = {},
) {
  if (!fetchImpl) {
    throw new Error('This package requires Node.js fetch support.');
  }

  let response;
  try {
    response = await fetchImpl(TEMPLATE_TARBALL_URL);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to download VergeKit template from ${TEMPLATE_TARBALL_URL}: ${reason}`,
      { cause: error },
    );
  }
  if (!response.ok) {
    throw new Error(
      `Failed to download VergeKit template: ${response.status} ${response.statusText}`,
    );
  }

  const tempPath = await mkdtemp(join(tmpdir(), 'create-vergekit-download-'));
  const tarballPath = join(tempPath, 'template.tar.gz');

  try {
    await writeFile(tarballPath, Buffer.from(await response.arrayBuffer()));
    await extractTarball(tarballPath, destinationPath);
  } finally {
    await rm(tempPath, { recursive: true, force: true });
  }
}

async function extractTarballToDirectory(tarballPath, destinationPath) {
  const tar = await import('tar');
  await tar.x({
    file: tarballPath,
    cwd: destinationPath,
    strip: 1,
  });
}
