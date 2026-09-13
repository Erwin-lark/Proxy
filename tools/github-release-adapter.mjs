import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildManifest, ROOT } from './proxy-manifest.mjs';

function mismatch(message, code = 'proxy_release_readback_mismatch') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * 生成给 RelayDeck github-write-client.commitTree 的纯本地输入。
 * 本模块不读取凭据、不执行网络请求、不创建 tag/Release；网络副作用仍由 RelayDeck
 * 的独立适配器负责，并且必须在提交、tag、Release 后按同一 releaseId 回读。
 */
export function preparePublication({ root = ROOT, releaseId = 'v1.0', createdAt } = {}) {
  const manifest = buildManifest({ root, releaseId, ...(createdAt ? { createdAt } : {}) });
  const files = manifest.files.map(entry => ({
    path: entry.path,
    content: readFileSync(join(root, entry.path), 'utf8'),
    // Web github-write-client.stableFiles 使用此字段在提交入口校验正文未被篡改。
    contentHash: entry.sha256,
    byteLength: entry.bytes,
  }));
  const manifestContent = `${JSON.stringify(manifest)}\n`;
  files.push({
    path: `releases/${releaseId}/manifest.json`,
    // 与 RelayDeck github-write-client.safeFiles 的 manifest 字节合同保持一致。
    content: manifestContent,
    contentHash: sha256(manifestContent),
    byteLength: Buffer.byteLength(manifestContent),
  });
  return Object.freeze({
    version: releaseId,
    releaseId,
    manifest,
    files,
    commitMessage: `RelayDeck ${releaseId}`,
  });
}

export function verifyPublicationReadback(expected, actual) {
  if (!expected || !actual || actual.version !== expected.version || actual.releaseId !== expected.releaseId
    || actual.manifestHash !== expected.manifest.manifestHash) {
    throw mismatch('remote publication identity does not match local manifest');
  }
  if (!actual.commitSha || !/^[a-f0-9]{40}$/i.test(actual.commitSha)) {
    throw mismatch('remote publication commit identity is invalid', 'proxy_release_readback_invalid');
  }
  return { version: expected.version, releaseId: expected.releaseId, manifestHash: expected.manifest.manifestHash, commitSha: actual.commitSha };
}
