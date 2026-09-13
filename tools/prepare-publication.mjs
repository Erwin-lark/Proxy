import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { preparePublication } from './github-release-adapter.mjs';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function optionValue(args, name, fallback) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
}

/**
 * 将 RelayDeck 发布准备结果压缩成不含正文的安全摘要。
 * 该摘要用于人工复核和 CI 日志；完整文件内容只留在调用方内存中。
 */
export function summarizePublication(prepared) {
  const metadata = new Map(prepared.manifest.files.map(file => [file.path, file]));
  const files = prepared.files.map(({ path, content }) => {
    const entry = metadata.get(path);
    return {
      path,
      bytes: Buffer.byteLength(content),
      sha256: sha256(content),
      target: entry?.target || 'shared',
      purpose: entry?.purpose || 'release manifest',
      public: entry?.public ?? true,
    };
  });
  return {
    ok: true,
    mode: 'prepare-only',
    networkWrites: false,
    version: prepared.version,
    releaseId: prepared.releaseId,
    manifestHash: prepared.manifest.manifestHash,
    sourceHash: prepared.manifest.sourceHash,
    managedFileCount: prepared.manifest.files.length,
    commitFileCount: files.length,
    commitMessage: prepared.commitMessage,
    files,
  };
}

function main() {
  const args = process.argv.slice(2);
  const releaseId = optionValue(args, '--release', 'v1.0');
  const createdAt = optionValue(args, '--created-at', undefined);
  const prepared = preparePublication({
    releaseId,
    ...(createdAt ? { createdAt } : {}),
  });
  console.log(JSON.stringify(summarizePublication(prepared), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
    process.exitCode = 1;
  }
}
