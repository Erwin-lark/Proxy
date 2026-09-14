import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const API_VERSION = '2022-11-28';
const NAME_PATTERN = /^[A-Za-z0-9_.-]{1,100}$/;
const SHA1_PATTERN = /^[a-f0-9]{40}$/i;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const MAX_FILES = 100;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_TOTAL_BYTES = 10 * 1024 * 1024;

function failure(message, status = 503, code = 'github_readback_invalid') {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function name(value, label) {
  const result = String(value || '');
  if (!NAME_PATTERN.test(result)) throw failure(`${label} is invalid`, 400, 'github_readback_config_invalid');
  return result;
}

function version(value) {
  const result = String(value || '');
  if (!/^v[0-9]+\.[0-9]+$/.test(result)) throw failure('version is invalid', 400, 'github_readback_config_invalid');
  return result;
}

function hash(value, pattern, label) {
  const result = String(value || '').toLowerCase();
  if (!pattern.test(result)) throw failure(`${label} is invalid`);
  return result;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function safePath(value) {
  const path = String(value || '');
  if (!path || path.startsWith('/') || path.includes('\\') || path.split('/').includes('..') || path.includes('\0')) {
    throw failure('manifest path is unsafe');
  }
  return path;
}

function validateManifest(input, expectedVersion, expectedManifestHash = null) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || input.manifestVersion !== 1) {
    throw failure('manifest shape is invalid');
  }
  const expected = version(expectedVersion);
  if (input.version !== expected || input.releaseId !== expected) throw failure('manifest version mismatch', 409, 'github_manifest_conflict');
  const seenKeys = new WeakSet();
  const scan = value => {
    if (!value || typeof value !== 'object') return;
    if (seenKeys.has(value)) throw failure('manifest must be acyclic');
    seenKeys.add(value);
    for (const [key, child] of Object.entries(value)) {
      if (/^(?:url|token|password|secret|credential|authorization|certificate|privateKey)$/i.test(key)) {
        throw failure('manifest contains forbidden private fields', 400, 'github_manifest_private_field');
      }
      scan(child);
    }
  };
  scan(input);
  const manifestHash = hash(input.manifestHash, SHA256_PATTERN, 'manifestHash');
  const { manifestHash: _ignored, ...withoutHash } = input;
  if (sha256(canonical(withoutHash)) !== manifestHash) throw failure('manifest hash mismatch');
  if (expectedManifestHash && manifestHash !== hash(expectedManifestHash, SHA256_PATTERN, 'expectedManifestHash')) {
    throw failure('manifest hash does not match expected identity', 409, 'github_manifest_conflict');
  }
  if (!Array.isArray(input.files) || input.files.length > MAX_FILES) throw failure('manifest file inventory is invalid');
  const seenPaths = new Set();
  let totalBytes = 0;
  const files = input.files.map(entry => {
    const path = safePath(entry?.path);
    if (seenPaths.has(path)) throw failure('manifest contains duplicate paths');
    seenPaths.add(path);
    const bytes = Number(entry?.bytes);
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > MAX_FILE_BYTES) throw failure('manifest file size is invalid');
    totalBytes += bytes;
    if (totalBytes > MAX_TOTAL_BYTES) throw failure('manifest inventory is too large');
    return { path, bytes, sha256: hash(entry?.sha256, SHA256_PATTERN, `${path}.sha256`) };
  });
  return { version: expected, releaseId: input.releaseId, manifestHash, files };
}

function decodeContent(payload) {
  if (!payload || payload.encoding !== 'base64' || typeof payload.content !== 'string') throw failure('GitHub content response is invalid');
  const normalized = payload.content.replace(/\s+/g, '');
  let content;
  try { content = Buffer.from(normalized, 'base64'); } catch { throw failure('GitHub content encoding is invalid'); }
  if (content.toString('base64') !== normalized) throw failure('GitHub content encoding is invalid');
  return content;
}

export function createGitHubReadbackClient({ owner, repo, apiBaseUrl = 'https://api.github.com', fetchImpl = globalThis.fetch } = {}) {
  const safeOwner = name(owner, 'owner');
  const safeRepo = name(repo, 'repo');
  if (typeof fetchImpl !== 'function') throw failure('fetchImpl is required', 400, 'github_readback_config_invalid');
  let base;
  try { base = new URL(String(apiBaseUrl)); } catch { throw failure('apiBaseUrl is invalid', 400, 'github_readback_config_invalid'); }
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || (base.pathname !== '/' && base.pathname !== '')) {
    throw failure('apiBaseUrl must be an https origin without credentials or query', 400, 'github_readback_config_invalid');
  }
  const prefix = `/repos/${encodeURIComponent(safeOwner)}/${encodeURIComponent(safeRepo)}`;

  async function request(path, { allowNotFound = false } = {}) {
    let url;
    try { url = new URL(path, base); } catch { throw failure('GitHub path is invalid'); }
    if (url.origin !== base.origin || !url.pathname.startsWith('/')) throw failure('GitHub path escaped apiBaseUrl');
    let response;
    try {
      response = await fetchImpl(url, {
        method: 'GET',
        headers: { accept: 'application/vnd.github+json', 'x-github-api-version': API_VERSION },
      });
    } catch { throw failure('GitHub network request failed', 503, 'github_network_error'); }
    if (response?.status === 404 && allowNotFound) return null;
    if (!response?.ok) throw failure(`GitHub readback failed (${Number(response?.status || 0)})`, 503, 'github_readback_http_error');
    try { return await response.json(); } catch { throw failure('GitHub response JSON is invalid'); }
  }

  async function readPublication({ version: inputVersion, expectedReleaseId = null, expectedManifestHash = null } = {}) {
    const requestedVersion = version(inputVersion);
    const ref = await request(`${prefix}/git/ref/tags/${encodeURIComponent(requestedVersion)}`, { allowNotFound: true });
    if (!ref) return null;
    if (ref.object?.type !== 'commit') throw failure('GitHub tag does not point to a commit');
    const commitSha = hash(ref.object.sha, SHA1_PATTERN, 'tag commitSha');
    const manifestPayload = await request(`${prefix}/contents/releases/${encodeURIComponent(requestedVersion)}/manifest.json?ref=${encodeURIComponent(commitSha)}`);
    const manifestBuffer = decodeContent(manifestPayload);
    let manifest;
    try { manifest = JSON.parse(manifestBuffer.toString('utf8')); } catch { throw failure('GitHub manifest JSON is invalid'); }
    const identity = validateManifest(manifest, requestedVersion, expectedManifestHash);
    if (expectedReleaseId && manifest.releaseId !== String(expectedReleaseId)) throw failure('GitHub release identity mismatch', 409, 'github_manifest_conflict');
    const commit = await request(`${prefix}/git/commits/${encodeURIComponent(commitSha)}`);
    if (hash(commit?.sha, SHA1_PATTERN, 'commitSha') !== commitSha) throw failure('GitHub commit identity mismatch');
    const treeSha = hash(commit?.tree?.sha, SHA1_PATTERN, 'treeSha');
    const release = await request(`${prefix}/releases/tags/${encodeURIComponent(requestedVersion)}`, { allowNotFound: true });
    if (!release || release.tag_name !== requestedVersion) throw failure('GitHub Release is missing or mismatched', 503, 'github_release_readback_invalid');
    for (const entry of identity.files) {
      const payload = await request(`${prefix}/contents/${entry.path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(commitSha)}`);
      const content = decodeContent(payload);
      if (content.length !== entry.bytes || sha256(content) !== entry.sha256) throw failure(`GitHub asset readback mismatch: ${entry.path}`);
    }
    return {
      repository: `${safeOwner}/${safeRepo}`,
      version: requestedVersion,
      releaseId: identity.releaseId,
      manifestHash: identity.manifestHash,
      commitSha,
      treeSha,
      githubReleaseId: Number.isSafeInteger(Number(release.id)) ? Number(release.id) : null,
      fileCount: identity.files.length,
    };
  }

  return Object.freeze({ readPublication });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const ownerIndex = process.argv.indexOf('--owner');
  const repoIndex = process.argv.indexOf('--repo');
  const versionIndex = process.argv.indexOf('--version');
  const owner = ownerIndex >= 0 ? process.argv[ownerIndex + 1] : 'Erwin-lark';
  const repo = repoIndex >= 0 ? process.argv[repoIndex + 1] : 'Proxy';
  const releaseVersion = versionIndex >= 0 ? process.argv[versionIndex + 1] : 'v1.0';
  try {
    const result = await createGitHubReadbackClient({ owner, repo }).readPublication({ version: releaseVersion });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ code: error.code || 'github_readback_failed', message: error.message }, null, 2));
    process.exitCode = 1;
  }
}
