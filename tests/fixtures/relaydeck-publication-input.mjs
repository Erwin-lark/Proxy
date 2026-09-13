import { preparePublication } from '../../tools/github-release-adapter.mjs';

// 固定时间和 v1.0 版本，给 RelayDeck/GitHub 适配器交叉测试提供可复现的完整输入。
export const FIXTURE_CREATED_AT = '2026-09-13T00:00:00.000Z';

export function createRelayDeckPublicationInputFixture() {
  const prepared = preparePublication({ releaseId: 'v1.0', createdAt: FIXTURE_CREATED_AT });
  return {
    version: prepared.version,
    releaseId: prepared.releaseId,
    manifest: structuredClone(prepared.manifest),
    files: prepared.files.map(file => ({ ...file })),
    commitMessage: prepared.commitMessage,
  };
}
