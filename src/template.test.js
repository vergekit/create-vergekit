import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  downloadAndExtractTemplate,
  fetchLatestReleaseTag,
  getTemplateTarballUrl,
  LATEST_RELEASE_API,
  resolveTemplateRef,
  toVersionTag,
  VERGEKIT_REPO,
} from './template.js';

test('toVersionTag normalizes version strings', () => {
  assert.equal(toVersionTag('0.1.2'), 'v0.1.2');
  assert.equal(toVersionTag('v0.1.2'), 'v0.1.2');
});

test('getTemplateTarballUrl builds a GitHub codeload URL for a ref', () => {
  assert.equal(
    getTemplateTarballUrl('v0.1.2'),
    `https://codeload.github.com/${VERGEKIT_REPO}/tar.gz/v0.1.2`,
  );
});

test('fetchLatestReleaseTag reads tag_name from the GitHub releases API', async () => {
  const requestedUrls = [];

  const tag = await fetchLatestReleaseTag(async (url, init) => {
    requestedUrls.push({ url, init });
    return {
      ok: true,
      json: async () => ({ tag_name: 'v0.2.0' }),
    };
  });

  assert.equal(tag, 'v0.2.0');
  assert.deepEqual(requestedUrls, [
    {
      url: LATEST_RELEASE_API,
      init: {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'create-vergekit',
        },
      },
    },
  ]);
});

test('resolveTemplateRef uses the latest GitHub release by default', async () => {
  const tag = await resolveTemplateRef({
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ tag_name: 'v0.2.0' }),
    }),
  });

  assert.equal(tag, 'v0.2.0');
});

test('resolveTemplateRef uses the latest release when the CLI matches it', async () => {
  const tag = await resolveTemplateRef({
    packageVersion: '0.2.0',
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ tag_name: 'v0.2.0' }),
    }),
  });

  assert.equal(tag, 'v0.2.0');
});

test('resolveTemplateRef pins to vX.Y.Z when create-vergekit@X.Y.Z is installed', async () => {
  const tag = await resolveTemplateRef({
    packageVersion: '0.1.1',
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ tag_name: 'v0.2.0' }),
    }),
  });

  assert.equal(tag, 'v0.1.1');
});

test('downloadAndExtractTemplate downloads the resolved release tarball and extracts it', async () => {
  const destinationPath = await mkdtemp(join(tmpdir(), 'create-vergekit-'));
  const requestedUrls = [];
  const extractedPaths = [];

  await downloadAndExtractTemplate(destinationPath, {
    packageVersion: '0.2.0',
    fetchImpl: async (url) => {
      requestedUrls.push(url);
      if (url === LATEST_RELEASE_API) {
        return {
          ok: true,
          json: async () => ({ tag_name: 'v0.2.0' }),
        };
      }

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

  assert.deepEqual(requestedUrls, [
    LATEST_RELEASE_API,
    getTemplateTarballUrl('v0.2.0'),
  ]);
  assert.deepEqual(extractedPaths, [destinationPath]);
});

test('downloadAndExtractTemplate reports failed downloads clearly', async () => {
  const destinationPath = await mkdtemp(join(tmpdir(), 'create-vergekit-'));

  await assert.rejects(
    () =>
      downloadAndExtractTemplate(destinationPath, {
        packageVersion: '0.1.1',
        fetchImpl: async (url) => {
          if (url === LATEST_RELEASE_API) {
            return {
              ok: true,
              json: async () => ({ tag_name: 'v0.2.0' }),
            };
          }

          return {
            ok: false,
            status: 404,
            statusText: 'Not Found',
          };
        },
      }),
    /Failed to download VergeKit template \(v0\.1\.1\): 404 Not Found/,
  );
});

test('downloadAndExtractTemplate reports network failures with the template URL', async () => {
  const destinationPath = await mkdtemp(join(tmpdir(), 'create-vergekit-'));
  const templateUrl = getTemplateTarballUrl('v0.2.0');

  await assert.rejects(
    () =>
      downloadAndExtractTemplate(destinationPath, {
        packageVersion: '0.2.0',
        fetchImpl: async (url) => {
          if (url === LATEST_RELEASE_API) {
            return {
              ok: true,
              json: async () => ({ tag_name: 'v0.2.0' }),
            };
          }

          throw new Error('fetch failed');
        },
      }),
    new RegExp(`Failed to download VergeKit template from ${templateUrl}`),
  );
});
