import assert from 'node:assert/strict';
import test from 'node:test';
import { preparePublication, verifyPublicationReadback } from '../tools/github-release-adapter.mjs';
import { createGitHubReadbackClient } from '../tools/github-readback.mjs';
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

function response(status, payload) {
  return { status, ok: status >= 200 && status < 300, async json() { return payload; } };
}

test('remote readback verifies tag, commit, release and every manifest asset without credentials', async () => {
  const prepared = preparePublication({ releaseId: 'v1.0' });
  const commitSha = 'a'.repeat(40);
  const treeSha = 'b'.repeat(40);
  const contentByPath = new Map(prepared.files.map(file => [file.path, Buffer.from(file.content)]));
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    const path = new URL(url).pathname;
    if (path.endsWith('/git/ref/tags/v1.0')) return response(200, { object: { type: 'commit', sha: commitSha } });
    if (path.endsWith('/contents/releases/v1.0/manifest.json')) return response(200, { encoding: 'base64', content: contentByPath.get('releases/v1.0/manifest.json').toString('base64') });
    if (path.endsWith(`/git/commits/${commitSha}`)) return response(200, { sha: commitSha, tree: { sha: treeSha } });
    if (path.endsWith('/releases/tags/v1.0')) return response(200, { id: 91, tag_name: 'v1.0' });
    const relative = path.split('/contents/')[1];
    const content = contentByPath.get(relative);
    return content ? response(200, { encoding: 'base64', content: content.toString('base64') }) : response(404, {});
  };
  const result = await createGitHubReadbackClient({ owner: 'Erwin-lark', repo: 'Proxy', apiBaseUrl: 'https://mock.github.test', fetchImpl })
    .readPublication({ version: 'v1.0', expectedReleaseId: 'v1.0', expectedManifestHash: prepared.manifest.manifestHash });
  assert.equal(result.commitSha, commitSha);
  assert.equal(result.treeSha, treeSha);
  assert.equal(result.githubReleaseId, 91);
  assert.equal(result.fileCount, prepared.manifest.files.length);
  assert.equal(calls.every(call => !call.options.headers.authorization), true);
});

test('remote readback returns null for an absent tag and rejects a changed asset', async () => {
  const absent = createGitHubReadbackClient({
    owner: 'Erwin-lark', repo: 'Proxy', apiBaseUrl: 'https://mock.github.test',
    fetchImpl: async () => response(404, {}),
  });
  assert.equal(await absent.readPublication({ version: 'v1.0' }), null);

  const prepared = preparePublication({ releaseId: 'v1.0' });
  const commitSha = 'c'.repeat(40);
  const contentByPath = new Map(prepared.files.map(file => [file.path, Buffer.from(file.content)]));
  const fetchImpl = async url => {
    const path = new URL(url).pathname;
    if (path.endsWith('/git/ref/tags/v1.0')) return response(200, { object: { type: 'commit', sha: commitSha } });
    if (path.endsWith('/contents/releases/v1.0/manifest.json')) return response(200, { encoding: 'base64', content: contentByPath.get('releases/v1.0/manifest.json').toString('base64') });
    if (path.endsWith(`/git/commits/${commitSha}`)) return response(200, { sha: commitSha, tree: { sha: 'd'.repeat(40) } });
    if (path.endsWith('/releases/tags/v1.0')) return response(200, { id: 92, tag_name: 'v1.0' });
    const relative = path.split('/contents/')[1];
    const content = Buffer.from(contentByPath.get(relative) || '');
    if (relative === 'loon-rules.lsr') content[0] = content[0] ^ 1;
    return response(200, { encoding: 'base64', content: content.toString('base64') });
  };
  await assert.rejects(
    () => createGitHubReadbackClient({ owner: 'Erwin-lark', repo: 'Proxy', apiBaseUrl: 'https://mock.github.test', fetchImpl }).readPublication({ version: 'v1.0' }),
    error => error.message.includes('asset readback mismatch'),
  );
});
