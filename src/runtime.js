export const MINIMUM_NODE_VERSION = '22.12.0';

export function parseNodeVersion(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version);

  if (!match) {
    throw new Error(`Unable to determine the Node.js version from "${version}".`);
  }

  return match.slice(1).map(Number);
}

export function isNodeVersionSupported(
  version,
  minimumVersion = MINIMUM_NODE_VERSION,
) {
  const current = parseNodeVersion(version);
  const minimum = parseNodeVersion(minimumVersion);

  for (let index = 0; index < minimum.length; index += 1) {
    if (current[index] !== minimum[index]) {
      return current[index] > minimum[index];
    }
  }

  return true;
}

export function assertSupportedNodeVersion(version = process.versions.node) {
  if (!isNodeVersionSupported(version)) {
    throw new Error(
      `VergeKit requires Node.js ${MINIMUM_NODE_VERSION} or newer. Detected Node.js ${version}.`,
    );
  }
}
