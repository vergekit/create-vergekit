import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertSupportedNodeVersion,
  isNodeVersionSupported,
  parseNodeVersion,
} from './runtime.js';

test('Node version parsing and comparison enforce the Astro runtime floor', () => {
  assert.deepEqual(parseNodeVersion('v22.12.0'), [22, 12, 0]);
  assert.equal(isNodeVersionSupported('22.11.9'), false);
  assert.equal(isNodeVersionSupported('22.12.0'), true);
  assert.equal(isNodeVersionSupported('22.12.1'), true);
  assert.equal(isNodeVersionSupported('23.0.0'), true);
});

test('unsupported Node versions report the required and detected versions', () => {
  assert.throws(
    () => assertSupportedNodeVersion('20.19.1'),
    /requires Node\.js 22\.12\.0 or newer.*Detected Node\.js 20\.19\.1/,
  );
  assert.throws(
    () => parseNodeVersion('unknown'),
    /Unable to determine the Node\.js version/,
  );
});
