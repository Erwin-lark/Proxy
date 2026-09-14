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

// 目标树正式发布输入：v1.1 绑定当前 r2，并携带 source、rules、assets 及 r1/r2 快照。
export function createRelayDeckTargetTreePublicationInputFixture() {
  const prepared = preparePublication({ releaseId: 'v1.1', createdAt: FIXTURE_CREATED_AT });
  return {
    version: prepared.version,
    releaseId: prepared.releaseId,
    targetReleaseId: prepared.targetReleaseId,
    manifest: structuredClone(prepared.manifest),
    files: prepared.files.map(file => ({ ...file })),
    commitMessage: prepared.commitMessage,
  };
}

// 调用方源模型的真实适配入口；不会把生成目录当作第二编辑源。
export function createRelayDeckTargetTreePublicationInputFromSource({
  releaseId = 'v1.2',
  source,
  snapshots,
  targetReleaseId = 'r2',
}) {
  const prepared = preparePublication({
    releaseId,
    source,
    snapshots,
    targetReleaseId,
    createdAt: FIXTURE_CREATED_AT,
  });
  return {
    version: prepared.version,
    releaseId: prepared.releaseId,
    targetReleaseId: prepared.targetReleaseId,
    manifest: structuredClone(prepared.manifest),
    files: prepared.files.map(file => ({ ...file })),
    commitMessage: prepared.commitMessage,
  };
}
