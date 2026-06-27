import { constants as fsConstants } from 'node:fs';
import { access, readdir, stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

const IGNORED_TARGET_ENTRIES = new Set([
  '.DS_Store',
  '.git',
  '.gitkeep',
  'Thumbs.db',
]);

export function normalizePackageName(value) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._~-]+/g, '-')
    .replace(/^[._-]+/, '')
    .replace(/[._-]+$/, '');

  return normalized || 'vergekit-app';
}

export function resolveTargetDirectory(target, cwd = process.cwd()) {
  const requestedTarget = target || '.';
  const path = resolve(cwd, requestedTarget);
  const folderName = requestedTarget === '.' ? basename(cwd) : basename(path);

  return {
    path,
    packageName: normalizePackageName(folderName),
  };
}

export async function getBlockingDirectoryEntries(targetPath) {
  try {
    await access(targetPath, fsConstants.F_OK);
  } catch {
    return [];
  }

  const targetStat = await stat(targetPath);
  if (!targetStat.isDirectory()) {
    return [basename(targetPath)];
  }

  const entries = await readdir(targetPath);
  return entries.filter((entry) => !IGNORED_TARGET_ENTRIES.has(entry));
}

export async function assertTargetDirectoryIsUsable(targetPath) {
  try {
    await access(targetPath, fsConstants.F_OK);
  } catch {
    return;
  }

  const targetStat = await stat(targetPath);
  if (!targetStat.isDirectory()) {
    throw new Error(`Target path exists and is not a directory: ${targetPath}`);
  }

  const blockingEntries = await getBlockingDirectoryEntries(targetPath);
  if (blockingEntries.length > 0) {
    throw new Error(
      `Target directory is not empty: ${blockingEntries.join(', ')}`,
    );
  }
}
