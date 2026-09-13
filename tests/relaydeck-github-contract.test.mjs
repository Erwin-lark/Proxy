import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRelayDeckPublicationInputFixture } from './fixtures/relaydeck-publication-input.mjs';

const webRoot = process.env.RELAYDECK_WEB_ROOT;
const skipReason = webRoot ? false : '设置 RELAYDECK_WEB_ROOT 后运行跨仓库 GitHub 合同测试';

function response(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: () => null },
    json: async () => body,
  };
}

function createFetch() {
  return async (url, options = {}) => {
    const path = new URL(url).pathname;
    if (path.endsWith('/git/ref/tags/v1.0')) return response(404, {});
    if (path.endsWith('/git/ref/heads/main')) return response(200, { object: { sha: 'b'.repeat(64) } });
    if (path.endsWith(`/git/commits/${'b'.repeat(64)}`)) return response(200, { tree: { sha: 'c'.repeat(64) } });
    if (path.endsWith('/git/trees') && options.method === 'POST') return response(201, { sha: 'd'.repeat(64) });
    if (path.endsWith('/git/commits') && options.method === 'POST') return response(201, { sha: 'e'.repeat(64) });
    return response(404, {});
  };
}

test('Web github-write-client consumes the complete Proxy fixture', { skip: skipReason }, async () => {
  const { createGitHubWriteClient } = await import(pathToFileURL(join(webRoot, 'src/policies/github-write-client.js')).href);
  const fixture = createRelayDeckPublicationInputFixture();
  const github = createGitHubWriteClient({
    owner: 'Erwin-lark', repo: 'Proxy', token: 'fixture-token', fetchImpl: createFetch(),
  });
  const result = await github.commitTree({
    version: fixture.version,
    manifest: fixture.manifest,
    files: fixture.files,
    message: fixture.commitMessage,
  });
  assert.equal(result.version, 'v1.0');
  assert.equal(result.releaseId, 'v1.0');
  assert.equal(result.manifestHash, fixture.manifest.manifestHash);
  assert.equal(result.commitSha, 'e'.repeat(64));
});

test('Web github-write-client rejects Proxy正文篡改、路径冲突和版本冲突', { skip: skipReason }, async () => {
  const { createGitHubWriteClient } = await import(pathToFileURL(join(webRoot, 'src/policies/github-write-client.js')).href);
  const fixture = createRelayDeckPublicationInputFixture();
  const newClient = () => createGitHubWriteClient({
    owner: 'Erwin-lark', repo: 'Proxy', token: 'fixture-token', fetchImpl: createFetch(),
  });

  const tampered = fixture.files.map(file => ({ ...file }));
  tampered[0].content = `${tampered[0].content}tampered`;
  await assert.rejects(
    () => newClient().commitTree({ version: fixture.version, manifest: fixture.manifest, files: tampered }),
    error => error?.code === 'github_contract_invalid' && error.message.includes('content hash mismatch'),
  );

  const duplicate = [...fixture.files, { ...fixture.files[0] }];
  await assert.rejects(
    () => newClient().commitTree({ version: fixture.version, manifest: fixture.manifest, files: duplicate }),
    error => error?.code === 'github_contract_invalid' && error.message.includes('duplicate'),
  );

  const wrongVersion = fixture.files.map(file => ({ ...file }));
  await assert.rejects(
    () => newClient().commitTree({ version: 'v1.1', manifest: fixture.manifest, files: wrongVersion }),
    error => error?.code === 'github_manifest_conflict' && error.status === 409,
  );
});
