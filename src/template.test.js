import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  downloadAndExtractTemplate,
  TEMPLATE_TARBALL_URL,
} from './template.js';

test('downloadAndExtractTemplate downloads the VergeKit tarball and extracts it', async () => {
  const destinationPath = await mkdtemp(join(tmpdir(), 'create-vergekit-'));
  const requestedUrls = [];
  const extractedPaths = [];

  await downloadAndExtractTemplate(destinationPath, {
    fetchImpl: async (url) => {
      requestedUrls.push(url);
      return {
        ok: true,
        arrayBuffer: async () => new TextEncoder().encode('template').buffer,
      };
    },
    extractTarball: async (tarballPath, outputPath) => {
      extractedPaths.push(outputPath);
      assert.equal(await readFile(tarballPath, 'utf8'), 'template');
    },
  });

  assert.deepEqual(requestedUrls, [TEMPLATE_TARBALL_URL]);
  assert.deepEqual(extractedPaths, [destinationPath]);
});

test('downloadAndExtractTemplate reports failed downloads clearly', async () => {
  const destinationPath = await mkdtemp(join(tmpdir(), 'create-vergekit-'));

  await assert.rejects(
    () =>
      downloadAndExtractTemplate(destinationPath, {
        fetchImpl: async () => ({
          ok: false,
          status: 404,
          statusText: 'Not Found',
        }),
      }),
    /Failed to download VergeKit template: 404 Not Found/,
  );
});

test('downloadAndExtractTemplate reports network failures with the template URL', async () => {
  const destinationPath = await mkdtemp(join(tmpdir(), 'create-vergekit-'));

  await assert.rejects(
    () =>
      downloadAndExtractTemplate(destinationPath, {
        fetchImpl: async () => {
          throw new Error('fetch failed');
        },
      }),
    new RegExp(`Failed to download VergeKit template from ${TEMPLATE_TARBALL_URL}`),
  );
});
