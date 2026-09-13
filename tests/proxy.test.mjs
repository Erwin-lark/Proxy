import assert from 'node:assert/strict';
import test from 'node:test';
import { preparePublication, verifyPublicationReadback } from '../tools/github-release-adapter.mjs';
import { readbackRelease } from '../tools/readback-release.mjs';

test('v1.0 manifest is deterministic and reads back every managed asset', () => {
  const result = readbackRelease({ releaseId: 'v1.0' });
  assert.equal(result.releaseId, 'v1.0');
  assert.equal(result.files >= 12, true);
  assert.match(result.manifestHash, /^[a-f0-9]{64}$/);
});

test('publication adapter prepares a safe RelayDeck-compatible tree without network access', () => {
  const prepared = preparePublication({ releaseId: 'v1.0' });
  assert.equal(prepared.version, 'v1.0');
  assert.equal(prepared.files.at(-1).path, 'releases/v1.0/manifest.json');
  assert.equal(prepared.files.at(-1).content, `${JSON.stringify(prepared.manifest)}\n`);
  assert.equal(prepared.files.some(file => /(?:token|password|secret|privateKey)/i.test(file.content)), false);
  const readback = verifyPublicationReadback(prepared, {
    version: 'v1.0', releaseId: 'v1.0', manifestHash: prepared.manifest.manifestHash,
    commitSha: 'a'.repeat(40),
  });
  assert.equal(readback.commitSha, 'a'.repeat(40));
  assert.throws(() => verifyPublicationReadback(prepared, {
    version: 'v1.0', releaseId: 'v1.0', manifestHash: 'b'.repeat(64), commitSha: 'a'.repeat(40),
  }), error => error.code === 'proxy_release_readback_mismatch');
});
