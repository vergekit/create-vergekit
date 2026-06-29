import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const VERGEKIT_REPO = 'jyoungblood/vergekit';
export const LATEST_RELEASE_API = `https://api.github.com/repos/${VERGEKIT_REPO}/releases/latest`;

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

export function getTemplateTarballUrl(ref) {
  return `https://codeload.github.com/${VERGEKIT_REPO}/tar.gz/${ref}`;
}

export function toVersionTag(version) {
  return version.startsWith('v') ? version : `v${version}`;
}

export async function readCreateVergekitVersion() {
  const packageJson = JSON.parse(
    await readFile(join(packageRoot, 'package.json'), 'utf8'),
  );
  return packageJson.version;
}

export async function fetchLatestReleaseTag(fetchImpl = globalThis.fetch) {
  if (!fetchImpl) {
    throw new Error('This package requires Node.js fetch support.');
  }

  let response;
  try {
    response = await fetchImpl(LATEST_RELEASE_API, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'create-vergekit',
      },
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to resolve latest VergeKit release from ${LATEST_RELEASE_API}: ${reason}`,
      { cause: error },
    );
  }

  if (!response.ok) {
    throw new Error(
      `Failed to resolve latest VergeKit release: ${response.status} ${response.statusText}`,
    );
  }

  const release = await response.json();
  if (!release.tag_name) {
    throw new Error('Latest VergeKit release is missing a tag_name.');
  }

  return release.tag_name;
}

export async function resolveTemplateRef({
  packageVersion,
  fetchImpl = globalThis.fetch,
} = {}) {
  const latestTag = await fetchLatestReleaseTag(fetchImpl);

  if (!packageVersion) {
    return latestTag;
  }

  const requestedTag = toVersionTag(packageVersion);
  return requestedTag === latestTag ? latestTag : requestedTag;
}

export async function downloadAndExtractTemplate(
  destinationPath,
  {
    fetchImpl = globalThis.fetch,
    extractTarball = extractTarballToDirectory,
    packageVersion,
  } = {},
) {
  if (!fetchImpl) {
    throw new Error('This package requires Node.js fetch support.');
  }

  const resolvedPackageVersion =
    packageVersion ?? (await readCreateVergekitVersion());
  const templateRef = await resolveTemplateRef({
    packageVersion: resolvedPackageVersion,
    fetchImpl,
  });
  const templateTarballUrl = getTemplateTarballUrl(templateRef);

  let response;
  try {
    response = await fetchImpl(templateTarballUrl);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to download VergeKit template from ${templateTarballUrl}: ${reason}`,
      { cause: error },
    );
  }
  if (!response.ok) {
    throw new Error(
      `Failed to download VergeKit template (${templateRef}): ${response.status} ${response.statusText}`,
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
