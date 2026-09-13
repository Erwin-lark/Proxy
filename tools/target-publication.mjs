import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { canonical, ROOT, TARGET_TREE_VERSION, validateTargetTree } from './target-tree.mjs';

export const TARGET_PUBLICATION_VERSION = 'v1.1';
export const TARGET_PUBLICATION_RELEASE_ID = 'v1.1';
export const TARGET_SNAPSHOT_ID = 'r2';
export const DEFAULT_CREATED_AT = '2026-09-13T00:00:00.000Z';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function safePath(value) {
  const path = String(value || '');
  if (!path || path.startsWith('/') || path.includes('\\') || path.split('/').includes('..') || path.includes('\0')) {
    throw new Error(`unsafe target publication path: ${path}`);
  }
  return path;
}

function readJson(root, path) {
  return JSON.parse(readFileSync(join(root, safePath(path)), 'utf8'));
}

function walkFiles(root, prefix = '') {
  if (!existsSync(root)) return [];
  return readdirSync(root).sort().flatMap((name) => {
    const full = join(root, name);
    const path = prefix ? `${prefix}/${name}` : name;
    return statSync(full).isDirectory() ? walkFiles(full, path) : [path];
  });
}

function mediaType(path) {
  if (path.endsWith('.json')) return 'application/json';
  if (path.endsWith('.yaml') || path.endsWith('.yml')) return 'application/yaml';
  if (path.endsWith('.md')) return 'text/markdown';
  if (path.endsWith('.svg')) return 'image/svg+xml';
  if (path.endsWith('.lsr') || path.endsWith('.list') || path.endsWith('.lcf')) return 'text/plain';
  return 'application/octet-stream';
}

function addPath(paths, path) {
  const safe = safePath(path);
  paths.add(safe);
}

function targetRootPaths(root) {
  const sourceManifest = readJson(root, 'source/manifest.json');
  const paths = new Set(['source/manifest.json']);
  for (const entry of sourceManifest.files || []) addPath(paths, entry.path);
  const catalog = readJson(root, 'rules/catalog.json');
  addPath(paths, 'rules/catalog.json');
  for (const service of catalog.services || []) {
    for (const client of Object.values(service.clients || {})) {
      if (client.enabled && client.path) addPath(paths, client.path);
    }
  }
  const assets = readJson(root, 'assets/catalog.json');
  addPath(paths, 'assets/catalog.json');
  for (const asset of assets.assets || []) if (asset.public !== false && asset.path) addPath(paths, asset.path);
  return [...paths].sort();
}

function targetSnapshotPaths(root, snapshotIds) {
  return snapshotIds.flatMap((snapshotId) => walkFiles(join(root, 'releases', snapshotId))
    .map((path) => `releases/${snapshotId}/${path}`)).sort();
}

function buildFiles(root, snapshotIds) {
  const paths = [...new Set([...targetRootPaths(root), ...targetSnapshotPaths(root, snapshotIds)])].sort();
  return paths.map((path) => {
    const content = readFileSync(join(root, path));
    return {
      path,
      sha256: sha256(content),
      bytes: content.length,
      mediaType: mediaType(path),
      target: path.startsWith('source/') ? 'source' : path.startsWith('rules/') ? 'rules' : path.startsWith('assets/') ? 'assets' : 'release-snapshot',
      purpose: path === 'source/manifest.json' ? 'target source manifest' : 'public target-tree snapshot',
      public: true,
    };
  });
}

function targetReleaseSummary(root, snapshotId) {
  const manifest = readJson(root, `releases/${snapshotId}/manifest.json`);
  return {
    releaseId: snapshotId,
    manifestHash: manifest.manifestHash,
    sourceHash: manifest.sourceHash,
    manifestPath: `releases/${snapshotId}/manifest.json`,
  };
}

function buildManifest({ root, version, createdAt, snapshotIds }) {
  validateTargetTree({ root, releases: snapshotIds });
  const sourceManifest = readJson(root, 'source/manifest.json');
  const r2Manifest = readJson(root, `releases/${TARGET_SNAPSHOT_ID}/manifest.json`);
  const files = buildFiles(root, snapshotIds);
  const base = {
    manifestVersion: 1,
    version,
    releaseId: TARGET_PUBLICATION_RELEASE_ID,
    targetReleaseId: TARGET_SNAPSHOT_ID,
    targetPublication: true,
    generatorVersion: TARGET_TREE_VERSION,
    createdAt,
    sourceHash: sourceManifest.sourceHash,
    sourceManifestHash: sha256(readFileSync(join(root, 'source/manifest.json'))),
    enabledTargets: sourceManifest.enabledTargets,
    services: sourceManifest.serviceIds,
    files,
    bindings: {
      sourceManifest: 'source/manifest.json',
      rulesCatalog: 'rules/catalog.json',
      targetSnapshot: `releases/${TARGET_SNAPSHOT_ID}`,
    },
    dependencies: r2Manifest.dependencies,
    snapshots: snapshotIds.map((snapshotId) => targetReleaseSummary(root, snapshotId)),
  };
  return { ...base, manifestHash: sha256(canonical(base)) };
}

export function prepareTargetPublication({
  root = ROOT,
  version = TARGET_PUBLICATION_VERSION,
  createdAt = DEFAULT_CREATED_AT,
  snapshotIds = ['r1', 'r2'],
} = {}) {
  if (!/^v[0-9]+\.[0-9]+$/.test(version)) throw new Error('target publication version must match vMAJOR.MINOR');
  if (!Array.isArray(snapshotIds) || snapshotIds.length < 2 || snapshotIds.some((id) => !/^r[0-9]+$/.test(id))) {
    throw new Error('target publication requires at least two rN snapshots');
  }
  const manifest = buildManifest({ root, version, createdAt, snapshotIds });
  const files = manifest.files.map((entry) => {
    const content = readFileSync(join(root, entry.path), 'utf8');
    if (content.length !== entry.bytes || sha256(content) !== entry.sha256) throw new Error(`target publication asset drift: ${entry.path}`);
    return { path: entry.path, content, contentHash: entry.sha256, byteLength: entry.bytes };
  });
  const manifestPath = `releases/${version}/manifest.json`;
  const manifestContent = `${JSON.stringify(manifest)}\n`;
  files.push({ path: manifestPath, content: manifestContent, contentHash: sha256(manifestContent), byteLength: Buffer.byteLength(manifestContent) });
  return Object.freeze({
    version,
    releaseId: manifest.releaseId,
    targetReleaseId: TARGET_SNAPSHOT_ID,
    manifest,
    files,
    commitMessage: `RelayDeck target tree ${version}`,
  });
}

export function writeTargetPublicationManifest({ root = ROOT, ...options } = {}) {
  const prepared = prepareTargetPublication({ root, ...options });
  const path = join(root, `releases/${prepared.version}/manifest.json`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, prepared.files.at(-1).content);
  return { output: path, prepared };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = writeTargetPublicationManifest();
  console.log(JSON.stringify({
    version: result.prepared.version,
    releaseId: result.prepared.releaseId,
    targetReleaseId: result.prepared.targetReleaseId,
    manifestHash: result.prepared.manifest.manifestHash,
    sourceHash: result.prepared.manifest.sourceHash,
    fileCount: result.prepared.manifest.files.length,
    output: result.output,
  }, null, 2));
}
