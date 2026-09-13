import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const GENERATOR_VERSION = 'proxy-manifest-0.1.0';
export const DEFAULT_CREATED_AT = '2026-09-13T00:00:00.000Z';

const RELEASE_PATTERN = /^v[0-9]+\.[0-9]+$/;
const CLIENT_METADATA = [
  ['source/clients/loon/adapter.yaml', 'loon', 'client adapter'],
  ['source/clients/mihomo/adapter.yaml', 'mihomo', 'client adapter'],
  ['source/clients/quantumult-x/adapter.yaml', 'quantumult-x', 'client adapter'],
  ['rules/loon/index.yaml', 'loon', 'rule index'],
  ['rules/mihomo/index.yaml', 'mihomo', 'rule index'],
  ['rules/quantumult-x/index.yaml', 'quantumult-x', 'rule index'],
];

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function safePath(value) {
  const path = String(value || '');
  if (!path || path.startsWith('/') || path.includes('\\') || path.split('/').includes('..') || path.includes('\0')) {
    throw new Error(`unsafe asset path: ${path}`);
  }
  return path;
}

function mediaType(path) {
  if (path.endsWith('.yaml') || path.endsWith('.yml')) return 'application/yaml';
  if (path.endsWith('.json')) return 'application/json';
  if (path.endsWith('.md')) return 'text/markdown';
  if (path.endsWith('.lsr') || path.endsWith('.list')) return 'text/plain';
  return 'application/octet-stream';
}

function readFile(root, relativePath) {
  const path = safePath(relativePath);
  const fullPath = join(root, path);
  const stat = statSync(fullPath);
  if (!stat.isFile()) throw new Error(`managed path is not a regular file: ${path}`);
  return readFileSync(fullPath);
}

function loadCatalog(root) {
  const catalog = JSON.parse(readFile(root, 'manifests/catalog.json').toString('utf8'));
  if (catalog.schema !== 1 || !Array.isArray(catalog.assets)) throw new Error('manifests/catalog.json has unsupported shape');
  return catalog;
}

function managedEntries(root) {
  const catalog = loadCatalog(root);
  const entries = [
    ['manifests/catalog.yaml', 'shared', 'asset catalog'],
    ['manifests/catalog.json', 'shared', 'machine-readable asset catalog'],
    ['policies/catalog.yaml', 'shared', 'policy catalog'],
    ['source/common/catalog.yaml', 'shared', 'common source catalog'],
  ];
  for (const [path, client, purpose] of CLIENT_METADATA) entries.push([path, client, purpose]);
  for (const asset of catalog.assets) {
    if (asset.status === 'retired') continue;
    entries.push([asset.path, asset.client, asset.purpose || 'public static asset']);
  }
  const seen = new Set();
  return entries.filter(([path]) => {
    safePath(path);
    if (seen.has(path)) return false;
    seen.add(path);
    return true;
  }).sort(([left], [right]) => left.localeCompare(right));
}

export function buildManifest({ root = ROOT, releaseId = 'v1.0', createdAt = DEFAULT_CREATED_AT } = {}) {
  if (!RELEASE_PATTERN.test(releaseId)) throw new Error('releaseId must match vMAJOR.MINOR');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(createdAt)) throw new Error('createdAt must be an ISO UTC timestamp');
  const files = managedEntries(root).map(([path, target, purpose]) => {
    const content = readFile(root, path);
    return {
      path,
      sha256: sha256(content),
      bytes: content.length,
      mediaType: mediaType(path),
      target,
      purpose,
      public: true,
    };
  });
  const sourceFiles = files.filter(file => file.path.startsWith('source/'));
  const sourceHash = sha256(sourceFiles.map(file => `${file.path}\0${file.sha256}\0${file.bytes}`).join('\n'));
  const base = {
    manifestVersion: 1,
    version: releaseId,
    releaseId,
    sourceSchemaVersion: 1,
    sourceHash,
    generatorVersion: GENERATOR_VERSION,
    enabledTargets: ['loon', 'mihomo'],
    createdAt,
    files,
    bindings: {
      commonSource: 'source/common/catalog.yaml',
      policyCatalog: 'policies/catalog.yaml',
      clients: {
        loon: 'source/clients/loon/adapter.yaml',
        mihomo: 'source/clients/mihomo/adapter.yaml',
        'quantumult-x': 'source/clients/quantumult-x/adapter.yaml',
      },
    },
    externalDependencies: [],
  };
  return { ...base, manifestHash: sha256(canonical(base)) };
}

export function writeManifest({ root = ROOT, releaseId = 'v1.0', createdAt = DEFAULT_CREATED_AT } = {}) {
  const manifest = buildManifest({ root, releaseId, createdAt });
  const output = join(root, 'releases', releaseId, 'manifest.json');
  mkdirSync(dirname(output), { recursive: true });
  // 发布适配器将 manifest 作为单行 JSON 写入 GitHub；本地文件保持同一字节合同。
  writeFileSync(output, `${JSON.stringify(manifest)}\n`);
  return { output, manifest };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const releaseIndex = process.argv.indexOf('--release');
  const createdIndex = process.argv.indexOf('--created-at');
  const releaseId = releaseIndex >= 0 ? process.argv[releaseIndex + 1] : 'v1.0';
  const createdAt = createdIndex >= 0 ? process.argv[createdIndex + 1] : DEFAULT_CREATED_AT;
  const result = writeManifest({ releaseId, createdAt });
  console.log(JSON.stringify({ releaseId, manifestHash: result.manifest.manifestHash, fileCount: result.manifest.files.length, output: result.output }, null, 2));
}
