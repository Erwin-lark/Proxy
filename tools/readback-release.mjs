import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildManifest, ROOT } from './proxy-manifest.mjs';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function safePath(value) {
  const path = String(value || '');
  if (!path || path.startsWith('/') || path.includes('\\') || path.split('/').includes('..') || path.includes('\0')) {
    throw new Error(`unsafe manifest path: ${path}`);
  }
  return path;
}

export function verifyManifest(root, manifest) {
  if (!manifest || manifest.manifestVersion !== 1 || manifest.version !== manifest.releaseId) {
    throw new Error('manifest identity is invalid');
  }
  const expected = buildManifest({ root, releaseId: manifest.releaseId, createdAt: manifest.createdAt });
  if (expected.manifestHash !== manifest.manifestHash) throw new Error('manifest hash mismatch');
  if (!Array.isArray(manifest.files) || manifest.files.length !== expected.files.length) throw new Error('manifest file inventory mismatch');
  const seen = new Set();
  for (const entry of manifest.files) {
    const path = safePath(entry.path);
    if (seen.has(path)) throw new Error(`duplicate manifest path: ${path}`);
    seen.add(path);
    const fullPath = join(root, path);
    if (lstatSync(fullPath).isSymbolicLink()) throw new Error(`symbolic link is not allowed: ${path}`);
    const content = readFileSync(fullPath);
    if (content.length !== entry.bytes || sha256(content) !== entry.sha256) throw new Error(`asset readback mismatch: ${path}`);
  }
  return { releaseId: manifest.releaseId, manifestHash: manifest.manifestHash, files: manifest.files.length };
}

export function readbackRelease({ root = ROOT, releaseId = 'v1.0' } = {}) {
  const path = join(root, 'releases', releaseId, 'manifest.json');
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  return verifyManifest(root, manifest);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const releaseIndex = process.argv.indexOf('--release');
  const releaseId = releaseIndex >= 0 ? process.argv[releaseIndex + 1] : 'v1.0';
  console.log(JSON.stringify(readbackRelease({ releaseId }), null, 2));
}
