import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { preparePublication, verifyPublicationReadback } from '../tools/github-release-adapter.mjs';
import { createGitHubReadbackClient } from '../tools/github-readback.mjs';
import { summarizePublication } from '../tools/prepare-publication.mjs';
import { ROOT } from '../tools/proxy-manifest.mjs';
import { readbackRelease } from '../tools/readback-release.mjs';
import { loadTargetModel } from '../tools/target-tree.mjs';
import { prepareTargetPublication } from '../tools/target-publication.mjs';
import { createRelayDeckPublicationInputFixture, createRelayDeckTargetTreePublicationInputFixture } from './fixtures/relaydeck-publication-input.mjs';

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
  assert.equal(prepared.files.every(file => /^[a-f0-9]{64}$/.test(file.contentHash)), true);
  assert.equal(prepared.files.every(file => file.byteLength === Buffer.byteLength(file.content)), true);
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

test('prepare-publication emits a digest-only summary and performs no network write', () => {
  const prepared = preparePublication({ releaseId: 'v1.0' });
  const summary = summarizePublication(prepared);
  assert.equal(summary.ok, true);
  assert.equal(summary.mode, 'prepare-only');
  assert.equal(summary.networkWrites, false);
  assert.equal(summary.commitFileCount, prepared.files.length);
  assert.equal(summary.managedFileCount, prepared.manifest.files.length);
  assert.equal(summary.files.some(file => Object.hasOwn(file, 'content')), false);
  assert.equal(summary.files.at(-1).path, 'releases/v1.0/manifest.json');

  const cli = fileURLToPath(new URL('../tools/prepare-publication.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [cli, '--release', 'v1.0'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const cliSummary = JSON.parse(result.stdout);
  assert.equal(cliSummary.manifestHash, summary.manifestHash);
  assert.equal(cliSummary.files.length, prepared.files.length);
  assert.equal(cliSummary.files.some(file => Object.hasOwn(file, 'content')), false);
});

test('RelayDeck fixture exposes the complete publication input, not the CLI summary', () => {
  const fixture = createRelayDeckPublicationInputFixture();
  assert.equal(fixture.version, 'v1.0');
  assert.equal(fixture.releaseId, 'v1.0');
  assert.equal(Array.isArray(fixture.manifest.files), true);
  assert.equal(fixture.files.length, fixture.manifest.files.length + 1);
  assert.equal(fixture.files.every(file => typeof file.content === 'string'), true);
  assert.equal(fixture.files.every(file => /^[a-f0-9]{64}$/.test(file.contentHash)), true);
  assert.equal(Object.hasOwn(fixture, 'mode'), false);
  assert.equal(Object.hasOwn(fixture, 'networkWrites'), false);
});

test('target-tree publication input includes the root tree and complete R1/R2 snapshots', () => {
  const fixture = createRelayDeckTargetTreePublicationInputFixture();
  const paths = new Set(fixture.files.map(file => file.path));
  assert.equal(fixture.version, 'v1.1');
  assert.equal(fixture.releaseId, 'v1.1');
  assert.equal(fixture.targetReleaseId, 'r2');
  assert.equal(fixture.files.length, fixture.manifest.files.length + 1);
  for (const path of [
    'source/manifest.json',
    'source/common/groups.json',
    'source/rulesets/ai-messaging-speed-test/entries.json',
    'rules/catalog.json',
    'rules/hong-kong-banks/Clash.yaml',
    'rules/hong-kong-banks/Loon.lsr',
    'releases/r1/manifest.json',
    'releases/r2/configs/clash/config.yaml',
    'releases/r2/assets/common/icons/public-routing-groups.svg',
    'releases/v1.1/manifest.json',
  ]) assert.equal(paths.has(path), true, path);
  assert.equal(fixture.manifest.sourceHash, JSON.parse(fixture.files.find(file => file.path === 'source/manifest.json').content).sourceHash);
  assert.equal(fixture.manifest.files.length, 96);
  assert.equal(fixture.files.every(file => file.byteLength === Buffer.byteLength(file.content)), true);
  assert.equal(fixture.files.every(file => /^[a-f0-9]{64}$/.test(file.contentHash)), true);
});

test('source-driven target publication materializes caller input and preserves the old tree', () => {
  const sourceBefore = loadTargetModel(ROOT);
  const oldPublication = preparePublication({ releaseId: 'v1.0' });
  const r1Source = structuredClone(sourceBefore);
  const r2Source = structuredClone(sourceBefore);
  const editedRule = r2Source.common.rules.rules.find(rule => rule.id === 'rule-ai-messaging-speed-test');
  editedRule.tags = [...editedRule.tags, 'draft-edited'];
  r2Source.clients.clash.overrides.tagOverrides[editedRule.id] = [...editedRule.tags];
  r2Source.clients.clash.order.groupOrder = [
    'group-global-tools', 'group-hk-finance', 'group-auto', 'builtin-direct',
  ];

  const prepared = preparePublication({
    releaseId: 'v1.2',
    source: r2Source,
    snapshots: [
      { releaseId: 'r1', source: r1Source },
      { releaseId: 'r2', source: r2Source },
    ],
    targetReleaseId: 'r2',
  });
  const sourceManifest = JSON.parse(prepared.files.find(file => file.path === 'source/manifest.json').content);
  const clashRules = prepared.files.find(file => file.path === 'rules/ai-messaging-speed-test/Clash.yaml').content;
  const r2Manifest = JSON.parse(prepared.files.find(file => file.path === 'releases/r2/manifest.json').content);

  assert.equal(prepared.version, 'v1.2');
  assert.equal(prepared.releaseId, 'v1.2');
  assert.equal(prepared.targetReleaseId, 'r2');
  assert.equal(prepared.manifest.targetReleaseId, 'r2');
  assert.equal(prepared.manifest.sourceHash, sourceManifest.sourceHash);
  assert.equal(prepared.manifest.sourceHash, r2Manifest.sourceHash);
  assert.match(clashRules, /draft-edited/);
  assert.equal(prepared.files.length, prepared.manifest.files.length + 1);
  assert.deepEqual(loadTargetModel(ROOT), sourceBefore);
  assert.deepEqual(preparePublication({ releaseId: 'v1.0' }).manifest, oldPublication.manifest);
  assert.deepEqual(preparePublication({ releaseId: 'v1.0' }).files, oldPublication.files);
});

test('two source inputs produce distinct hashes and identity errors are rejected', () => {
  const base = loadTargetModel(ROOT);
  const first = structuredClone(base);
  const second = structuredClone(base);
  second.common.settings.settings.publicArtifact = 'no-node-strategy-edited';
  second.common.rules.rules.find(rule => rule.id === 'rule-hong-kong-banks').tags = ['finance', 'reviewed'];
  const snapshots = source => [
    { releaseId: 'r1', source: first },
    { releaseId: 'r2', source },
  ];
  const one = preparePublication({ releaseId: 'v1.2', source: first, snapshots: snapshots(first) });
  const two = preparePublication({ releaseId: 'v1.3', source: second, snapshots: snapshots(second) });
  assert.notEqual(one.manifest.sourceHash, two.manifest.sourceHash);
  assert.notEqual(one.manifest.manifestHash, two.manifest.manifestHash);
  assert.equal(one.manifest.snapshots.find(snapshot => snapshot.releaseId === 'r2').sourceHash, one.manifest.sourceHash);
  assert.equal(two.manifest.snapshots.find(snapshot => snapshot.releaseId === 'r2').sourceHash, two.manifest.sourceHash);

  assert.throws(
    () => preparePublication({
      releaseId: 'v1.2', source: second, snapshots: snapshots(first), targetReleaseId: 'r2',
    }),
    /does not match the publication source/,
  );
  assert.throws(
    () => preparePublication({
      releaseId: 'v1.2', source: first, snapshots: snapshots(first), targetReleaseId: 'r3',
    }),
    /must identify one supplied snapshot/,
  );
  assert.throws(
    () => prepareTargetPublication({
      releaseId: 'v1.2', source: first, snapshots: snapshots(first), targetReleaseId: 'r2',
      // 直接调用底层函数时，version 与 releaseId 也必须保持同一发布身份。
      version: 'v1.3',
    }),
    /target publication version and releaseId must match/,
  );
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
