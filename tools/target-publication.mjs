import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  buildTargetRelease,
  canonical,
  materializeTargetSource,
  ROOT,
  TARGET_TREE_VERSION,
  validateTargetTree,
} from './target-tree.mjs';

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

function assertVersion(value, label) {
  if (!/^v[0-9]+\.[0-9]+$/.test(value)) throw new Error(`${label} must match vMAJOR.MINOR`);
}

function validateSnapshotIds(snapshotIds) {
  if (!Array.isArray(snapshotIds) || snapshotIds.length < 2 || snapshotIds.some((id) => !/^r[0-9]+$/.test(id))) {
    throw new Error('target publication requires at least two rN snapshots');
  }
  if (new Set(snapshotIds).size !== snapshotIds.length) throw new Error('target publication snapshots must be unique');
}

function validateSnapshotSources(snapshots) {
  if (!Array.isArray(snapshots) || snapshots.length < 2) {
    throw new Error('source-driven target publication requires at least two snapshots');
  }
  const snapshotIds = snapshots.map((snapshot) => snapshot?.releaseId);
  validateSnapshotIds(snapshotIds);
  if (snapshots.some((snapshot) => !snapshot?.source || typeof snapshot.source !== 'object')) {
    throw new Error('each target snapshot must provide a source model');
  }
  return snapshotIds;
}

function buildManifest({ root, version, releaseId, targetReleaseId, createdAt, snapshotIds }) {
  validateTargetTree({ root, releases: snapshotIds });
  const sourceManifest = readJson(root, 'source/manifest.json');
  const targetManifest = readJson(root, `releases/${targetReleaseId}/manifest.json`);
  if (targetManifest.sourceHash !== sourceManifest.sourceHash) {
    throw new Error(`target snapshot ${targetReleaseId} does not match the publication source`);
  }
  const files = buildFiles(root, snapshotIds);
  const base = {
    manifestVersion: 1,
    version,
    releaseId,
    targetReleaseId,
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
      targetSnapshot: `releases/${targetReleaseId}`,
    },
    dependencies: targetManifest.dependencies,
    snapshots: snapshotIds.map((snapshotId) => targetReleaseSummary(root, snapshotId)),
  };
  return { ...base, manifestHash: sha256(canonical(base)) };
}

function prepareFromRoot({ root, version, releaseId, targetReleaseId, createdAt, snapshotIds }) {
  const manifest = buildManifest({ root, version, releaseId, targetReleaseId, createdAt, snapshotIds });
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
    releaseId,
    targetReleaseId,
    manifest,
    files,
    commitMessage: `RelayDeck target tree ${version}`,
  });
}

function copyAssets(baseRoot, destination) {
  const assetsRoot = join(baseRoot, 'assets');
  if (!existsSync(assetsRoot)) throw new Error('target source preparation requires a public assets tree');
  cpSync(assetsRoot, join(destination, 'assets'), { recursive: true });
}

function prepareSourceRoot({ baseRoot, source, snapshots, targetReleaseId }) {
  const stagingRoot = mkdtempSync(join(tmpdir(), 'proxy-target-publication-'));
  let targetSnapshotBackup;
  try {
    copyAssets(baseRoot, stagingRoot);
    for (const snapshot of snapshots) {
      const snapshotRoot = mkdtempSync(join(tmpdir(), 'proxy-target-snapshot-'));
      try {
        copyAssets(baseRoot, snapshotRoot);
        materializeTargetSource(snapshotRoot, snapshot.source);
        buildTargetRelease({ root: snapshotRoot, releaseId: snapshot.releaseId });
        cpSync(
          join(snapshotRoot, 'releases', snapshot.releaseId),
          join(stagingRoot, 'releases', snapshot.releaseId),
          { recursive: true },
        );
      } finally {
        rmSync(snapshotRoot, { recursive: true, force: true });
      }
    }
    targetSnapshotBackup = mkdtempSync(join(tmpdir(), 'proxy-target-snapshot-backup-'));
    cpSync(
      join(stagingRoot, 'releases', targetReleaseId),
      join(targetSnapshotBackup, targetReleaseId),
      { recursive: true },
    );
    materializeTargetSource(stagingRoot, source);
    buildTargetRelease({ root: stagingRoot, releaseId: targetReleaseId });
    rmSync(join(stagingRoot, 'releases', targetReleaseId), { recursive: true, force: true });
    cpSync(
      join(targetSnapshotBackup, targetReleaseId),
      join(stagingRoot, 'releases', targetReleaseId),
      { recursive: true },
    );
    return stagingRoot;
  } catch (error) {
    rmSync(stagingRoot, { recursive: true, force: true });
    throw error;
  } finally {
    if (targetSnapshotBackup) rmSync(targetSnapshotBackup, { recursive: true, force: true });
  }
}

/**
 * Prepare a complete, immutable publication from caller-owned source models.
 *
 * `source` is the current public target-tree model (the same shape returned by
 * loadTargetModel()). `snapshots` is an ordered array of `{ releaseId, source }`;
 * the target snapshot must contain the same sourceHash as `source`. The caller
 * therefore controls the editing source and the history mapping explicitly;
 * this function never treats generated rules/configs as editable input.
 */
export function prepareTargetPublication({
  root = ROOT,
  source,
  version = TARGET_PUBLICATION_VERSION,
  releaseId = version,
  createdAt = DEFAULT_CREATED_AT,
  snapshotIds,
  snapshots,
  targetReleaseId = TARGET_SNAPSHOT_ID,
} = {}) {
  assertVersion(version, 'target publication version');
  assertVersion(releaseId, 'target publication releaseId');
  if (releaseId !== version) throw new Error('target publication version and releaseId must match');

  if (source !== undefined || snapshots !== undefined) {
    if (source === undefined || snapshots === undefined) {
      throw new Error('source-driven target publication requires source and snapshots together');
    }
    const derivedSnapshotIds = validateSnapshotSources(snapshots);
    if (snapshotIds !== undefined && JSON.stringify(snapshotIds) !== JSON.stringify(derivedSnapshotIds)) {
      throw new Error('snapshotIds must match snapshots releaseId values');
    }
    if (!derivedSnapshotIds.includes(targetReleaseId)) {
      throw new Error('targetReleaseId must identify one supplied snapshot');
    }
    const preparedRoot = prepareSourceRoot({ baseRoot: root, source, snapshots, targetReleaseId });
    try {
      return prepareFromRoot({ root: preparedRoot, version, releaseId, targetReleaseId, createdAt, snapshotIds: derivedSnapshotIds });
    } finally {
      rmSync(preparedRoot, { recursive: true, force: true });
    }
  }

  const resolvedSnapshotIds = snapshotIds || ['r1', 'r2'];
  validateSnapshotIds(resolvedSnapshotIds);
  if (!resolvedSnapshotIds.includes(targetReleaseId)) throw new Error('targetReleaseId must identify one supplied snapshot');
  return prepareFromRoot({ root, version, releaseId, targetReleaseId, createdAt, snapshotIds: resolvedSnapshotIds });
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
