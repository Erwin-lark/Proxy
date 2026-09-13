# Proxy 运行手册

## 1. 定位与职责

`Proxy` 是 RelayDeck 的公开静态资产仓库，负责保存可公开分发且可版本化的内容：远程脚本、规则集、插件、图标、配置模板与发布记录。

RelayDeck 是唯一的生产控制面，负责保存敏感来源、生成完整客户端配置、预览差异、发布活动版本、回滚，并向客户端提供固定链接。

```text
Proxy（公开静态资产） → RelayDeck（生成与发布） → 客户端固定链接
```

GitHub Raw 只可直接分发明确标记为公开静态资产的文件。含私人节点、令牌、凭据、设备绑定或活动授权的响应必须由 RelayDeck 分发；无节点、无私人数据、可公开复用的客户端策略产物和配置工件可以作为 Proxy 的版本化静态资产保存。判断边界是数据是否敏感、是否需要鉴权和动态绑定，而不是文件是否“完整”。

## 2. 安全红线

以下内容不得出现在 Git 历史、Issue、Release、测试快照或文档中：

- 节点、分享链接、订阅 URL、面板地址或真实私密 URL
- 令牌、密码、API Key、密钥、证书、Cookie、请求头
- VPS IP、个人服务域名、设备标识或用户资料
- 包含上述任何敏感内容的 Loon、Mihomo 或 Quantumult X 配置或策略产物

所有新资产先在本地脱敏、校验，再提交。发现敏感信息时，应立即停止发布并轮换已暴露的凭据；删除文件不足以消除 Git 历史风险。

## 3. 目标目录

目标树按“中立 source → 客户端适配 → 生成规则/配置 → 不可变 release”组织。只创建有内容、已登记并能通过校验的目录，不创建空占位文件。

```text
Proxy/
  source/
    manifest.json
    common/
      groups.json
      rules.json
      settings.json
      order.json
    clients/
      clash/order.json
      clash/overrides.json
      loon/order.json
      loon/overrides.json
    rulesets/<serviceId>/
      definition.json
      upstream-lock.json
      entries.json
      patches.json
  rules/
    catalog.json
    <serviceId>/Clash.yaml
    <serviceId>/Loon.lsr
    # QuantumultX.list 仅在正式验证后加入
  assets/
    common/icons/
    clash/
    loon/plugins/
    quantumultx/rewrites/  # 可选，启用前必须验证
  releases/<releaseId>/
    manifest.json
    source/
    configs/
      clash/config.yaml
      loon/profile.lcf
    rules/
    assets/
```

### 目录规则

- `source/manifest.json`：source 文件清单、sourceHash、启用目标和绑定关系；manifest 不把自身纳入 sourceHash。
- `source/common/`：保存跨客户端稳定 ID、策略组、规则引用、设置和默认顺序，不直接作为客户端订阅链接。
- `source/clients/clash/` 与 `source/clients/loon/`：分别保存三类顺序和端特有覆写。这里使用 `clash` 作为目录名；Mihomo 是该适配能力的运行时名称，不另建 `mihomo` 目录。
- `source/rulesets/<serviceId>/`：每个服务独立保存定义、公开上游锁、基础 entries 和可审阅 patches。补丁必须有稳定 ID，并检查 add/delete/replace 的前置条件。
- `rules/catalog.json`：目标规则目录的机器清单；`rules/<serviceId>/` 是由 source 生成的客户端文件。README 与 RelayDeck 导航应读取这个 catalog，不靠手写索引。
- 根目录三份旧 Raw 文件及 `rules/<client>/index.yaml` 继续保留为兼容输出；它们不是新的 source 真相，新的分端内容必须进入对应客户端文件夹。
- `assets/`：保存真实、可公开分发的脚本、插件和图标；不能以空文件代替未来资产。
- `releases/<releaseId>/`：保存完整 source/configs/rules/assets 快照和文件哈希。`r1`、`r2` 是当前本地验收用的不可变 fixture；正式 RelayDeck 版本仍使用其自己的 `vMAJOR.MINOR` 生命周期。
- `policies/`、`manifests/` 与 `releases/v1.0/`：保留旧 v1.0/RelayDeck 发布输入合同，供现有适配器回读，不取代新的 target-tree 合同。
- `fixtures/`：只存脱敏输入和预期输出，用于验证生成器，不作为生产资产。
- `tools/`：只做本地生成、回读、敏感信息校验和 RelayDeck 发布输入准备；不持有 GitHub 凭据、不直接发布。

## 4. 资产清单契约

目标规则服务必须登记在 `rules/catalog.json`；旧的根目录公开资产仍登记在 `manifests/catalog.yaml` / `manifests/catalog.json`，两者不可混用。`rules/catalog.json` 的最小结构如下：

```yaml
schemaVersion: 1
enabledTargets: [clash, loon]
services:
  - id: hong-kong-banks
    displayName: Hong Kong Banks
    category: hk-banks
    sources:
      - url: <public-upstream-url>
        selector: <locked-selector>
        entriesHash: <sha256-of-base-entries>
    clients:
      clash:
        enabled: true
        path: rules/hong-kong-banks/Clash.yaml
        sha256: <generated-file-sha256>
      loon:
        enabled: true
        path: rules/hong-kong-banks/Loon.lsr
        sha256: <generated-file-sha256>
```

字段约束：

- `id`：稳定、全小写、点分隔；一旦发布不得改作另一资产。
- `type`：`ruleset`、`script`、`plugin`、`icon` 或 `config-template`。
- 目标目录中的 `client`：`shared`、`clash` 或 `loon`；Mihomo 使用 Clash 兼容 YAML 适配，不另建目录。旧清单仍可能出现 `mihomo`，仅为兼容字段。
- `public`：只有 `true` 的资产可通过 GitHub Raw 或 RelayDeck 静态路径分发。
- `sha256`：发布前计算，用于 RelayDeck 同步完整性校验。
- `status`：`active`、`deprecated` 或 `retired`；弃用资产需提供替代 ID 与截止版本。

## 5. 三端规则与资产约定

| 客户端 | 规则文件 | 配置/资产边界 |
|---|---|---|
| Loon | `.lsr` | 可使用远程规则、脚本和插件；节点挂载、MITM、证书和设备设置保留本地。 |
| Clash / Mihomo | `.yaml` rule-provider 或相关 YAML 资产 | 目标树统一放在 `clients/clash`；RelayDeck 可将其生成 Mihomo 配置，客户端不保留全局覆写或扩展脚本。 |
| Quantumult X | `.list` 及 QX 资源格式 | 当前仅保留历史参考路径；目标树不生成 QX 文件，待独立语法与行为验收后再启用。 |

相同业务规则若客户端语法不同，分别生成到 `rules/<serviceId>/Clash.yaml` 与 `Loon.lsr`。纯域名、CIDR 或分类来源放在 `source/rulesets/<serviceId>/entries.json`，由生成器根据客户端顺序、Tag 和 policy binding 转换；不要用单一 `rules/<client>/index.yaml` 代替服务目录。

### 顺序与补丁规则

`source/common/order.json` 定义共享默认值，客户端的 `order.json` 可以显式覆盖。`ruleSequence` 是规则执行顺序，`groupOrder` 是策略组展示顺序，`memberOrder` 是组内成员顺序，三者不能合并。缺失或 `null` 才表示继承；空数组表示明确为空。`rule-final`/fallback 必须始终位于规则执行序列最后。每个 ruleset 的 `upstream-lock.json` 锁定公开来源及基础 entries 哈希，`patches.json` 只做可审阅、可重放的 add/delete/replace。

## 6. RelayDeck 接入契约

RelayDeck 接入 `Proxy` 时应遵循以下规则：

1. 仓库文件变更不等于生产发布；RelayDeck 先拉取指定 commit 或 Tag。
2. RelayDeck 读取 `rules/catalog.json` 和旧 `manifests/catalog.json`，分别拒绝未登记、哈希不符、客户端不匹配或 `public: false` 的目标规则/外部资产。
3. RelayDeck 生成草稿，执行结构、引用、客户端语法与敏感信息校验。
4. 管理页显示各客户端的只读生成结果和与活动版本的差异。
5. 经人工确认后，RelayDeck 才切换活动版本；客户端固定链接不变化。
6. 发布摘要记录使用的 Proxy commit/Tag、资产 ID、哈希、发布时间和验证结果，且不得记录机密正文。

当 GitHub 不可用或资产校验失败时，RelayDeck 必须继续保留并服务最近一次有效的活动版本，不能发布空配置。

## 7. 日常新增或修改资产

1. 确定服务/资产类型、适用客户端和稳定 ID。
2. 在 `source/rulesets/<serviceId>/` 更新定义、锁定来源、基础 entries 和 patches；在 `source/clients/<client>/` 更新端特有顺序或覆写。
3. 运行 `npm run target-tree -- --release <releaseId>` 生成客户端规则、配置、资产清单和 release 快照。
4. 运行目标树、格式、引用、哈希和敏感信息检查。
5. 更新 `CHANGELOG.md`：注明新增、修复、弃用或破坏性变更。
6. 提交到 `main` 前，确认 Raw 内容可公开且不携带动态生产数据。
7. RelayDeck 在后续草稿流程中引用指定版本；未经预览与人工确认不得发布到客户端。

本地最低检查为 `npm run check`、`npm run validate`、`npm run validate-target-tree` 和 `npm run readback -- --release v1.0`。目标树验收若要重现 R1/R2：先在 R1 source 状态运行 `npm run target-tree -- --release r1`，修改 source 后再运行 `npm run target-tree -- --release r2`；不要用新 source 覆盖历史 release。远端版本存在时，可运行 `npm run remote-readback -- --owner Erwin-lark --repo Proxy --version v1.0` 做只读回读；它按 tag、commit、Release、manifest 和 manifest 中的每个文件逐项校验，不带 GitHub 凭据，不执行任何写操作。远端没有该 tag 时返回安全的空结果，不能把它解释为发布成功。

在提交给 RelayDeck 前，可运行 `npm run prepare-publication -- --release v1.0` 查看待发布摘要。输出只包含路径、字节数、SHA-256、目标客户端和用途，不包含资产正文；`networkWrites: false` 表示该命令不会调用 GitHub、不会更新分支、不会创建 Tag/Release。

需要做跨仓库合同验收时，在独立的 Web worktree 上设置 `RELAYDECK_WEB_ROOT`，运行 `RELAYDECK_WEB_ROOT="<Web-worktree>" node --test tests/relaydeck-github-contract.test.mjs`。该测试消费 `tests/fixtures/relaydeck-publication-input.mjs` 的完整函数返回值，覆盖成功提交、正文篡改、重复路径和版本冲突；未设置 Web 路径时，普通 `npm run check` 会安全跳过这两项交叉测试。

## 8. 版本、发布与回滚

- `main` 代表当前可用的公开静态资产，不代表 RelayDeck 的活动生产版本。
- 每个可供 RelayDeck 采用的资产集合应创建 Git Tag。
- 破坏性变更必须提升主版本或创建新的资产 ID；不能悄悄改变已发布资产的语义。
- 回滚时先在 RelayDeck 选择已验证的历史版本；如需回退静态资产，使用 Git Tag 或对应 commit，而不是覆盖历史文件。
- 对目标树回滚时，读取 `releases/<releaseId>/source/` 重新导入 source，再从该快照恢复 `rules/`、`configs/` 和 `assets/`；不要改写既有 release manifest。

### RelayDeck 发布输入合同

`tools/github-release-adapter.mjs` 的 `preparePublication()` 输出完整的 `{version, releaseId, manifest, files, commitMessage}`，其中 `files` 包含根目录兼容资产、受管元数据和 `releases/<releaseId>/manifest.json`；每个文件同时提供 `contentHash` 和 `byteLength`，可直接交给 Web `github-write-client.commitTree()`，以便入口校验正文完整性。manifest 文件使用单行 JSON，与 RelayDeck `github-write-client.safeFiles` 的字节合同一致。该模块只准备输入并校验回读身份；reserve、commit/tree、分支更新、tag、Release、缓存和活动切换仍由 RelayDeck 的可恢复任务流水线负责。

`preparePublication({ releaseId: 'v1.0' })` 继续提供旧兼容输入。目标树演示输入可使用 `preparePublication({ releaseId: 'v1.1' })`，它读取当前仓库树并绑定 `targetReleaseId: r2`；这条兼容路径用于固定 fixture，不是网站编辑源的唯一入口。

网站接入目标树时应把同一份已脱敏源模型显式传给 `preparePublication()`，并同时传入不可变快照源：

```js
const prepared = preparePublication({
  releaseId: 'v1.2',
  source: currentSourceModel,
  snapshots: [
    { releaseId: 'r1', source: previousSourceModel },
    { releaseId: 'r2', source: currentSourceModel },
  ],
  targetReleaseId: 'r2',
});
```

`source` 与 `snapshots[].source` 使用 `loadTargetModel()` 返回的公开源模型形状：`common`、`clients.clash/loon` 和至少两个 `services`，不包含节点、凭据或私有来源。实现会在隔离暂存目录中写入 source，重新生成 `rules/`、`assets/`、configs 和每个 release 快照，再返回完整 `{version, releaseId, targetReleaseId, manifest, files, commitMessage}`；不会修改调用方对象或仓库源文件。`targetReleaseId` 必须对应传入快照，且该快照的 `sourceHash` 必须等于当前 `source`；`version === releaseId` 是正式发布身份，`targetReleaseId` 只是可追溯的源快照身份，不能用可变的演示目录代替正式版本。输出仍把 `source/manifest.json`、`source/common/`、`source/rulesets/`、`rules/catalog.json`、按服务规则、`assets/` 和所有指定快照纳入同一 manifest，提交 `files` 另包含 `releases/<version>/manifest.json`。

每次调用会重新计算 `sourceHash` 和 `manifestHash`；不同源模型必须产生不同的 `sourceHash`。RelayDeck 应把返回的完整函数结果交给 `github-write-client.commitTree()`，并以 `manifest.files`、逐文件 `contentHash`/`byteLength`、`version`、`releaseId`、`targetReleaseId` 和快照哈希作为只读门禁。`npm run target-publication` 仍只读取仓库当前 fixture；它不是携带网站编辑源的 API，也不调用 GitHub。目标树 manifest 的 `snapshots[]` 记录每个快照的 `releaseId`、`sourceHash` 和 `manifestHash`，不能把 CLI 摘要当作完整输入。

Proxy 静态资产清单与 Web 策略发布清单是两种不同的组件合同：Proxy manifest 的 `files[]` 描述公开仓库资产；Web loader 的 manifest 使用 `revisionId`、`artifacts[]` 和 `dependencies[]` 描述一次策略生成。两者共享 `version`、`releaseId`、`manifestHash` 及 `{path, content, contentHash}` 文件输入约束；Proxy 旧 v1.0 适配器要求静态 release 的 `releaseId === version`，目标 v1.1 输入也按 `releases/v1.1/manifest.json` 组织并把 r2 作为目标快照。不能把 CLI 摘要当作完整输入，也不能把 Proxy 的静态清单冒充 Web 的策略修订清单。网站方接入 Proxy 时应调用 `preparePublication()` 的函数返回值，并继续由现有 pipeline 执行版本预读、提交、Tag/Release、回读、缓存和活动切换。固定完整输入 fixture 位于 `tests/fixtures/relaydeck-publication-input.mjs`；目标目录只读门禁应检查 Proxy 的 `targetPublication`/`snapshots` 绑定，不应把生成规则文件当成第二编辑源。

## 9. 发布前检查清单

- [ ] 文件位于正确的资产类型和客户端目录。
- [ ] 资产 ID、客户端、策略 ID、路径、版本与哈希已登记。
- [ ] 文件通过对应客户端的语法校验。
- [ ] 所有引用存在，且没有跨客户端错误引用。
- [ ] 无节点、订阅 URL、令牌、密钥、证书、VPS IP 或个人服务域名。
- [ ] 变更已写入 `CHANGELOG.md`，弃用项已给出迁移路径。
- [ ] RelayDeck 草稿生成、差异预览和人工确认均已完成后，才允许正式发布。

目标树专用验收还必须确认：至少两个 service、Clash 与 Loon 两套输出、`ruleSequence`/`groupOrder`/`memberOrder` 有可见且可解释的端差异、Tag 和 policy binding 已落地、每个上游锁均有非占位哈希、R1/R2 的旧文件哈希未变化，并且 release 下没有空文件、节点、令牌或私有 URL。

## 10. 当前状态

当前仓库保留三端基础远端规则文件，并已建立目标 `source/`、按服务分层的 `rules/`、真实图标资产、`releases/r1` 与 `releases/r2` 本地快照、目标 v1.1 发布 manifest，以及 `target-tree`/`target-publication` 生成校验工具。`npm run check` 验证本地适配器、发布摘要、mock 远端回读和目标树；`npm run validate` 验证全仓库清单哈希、路径安全和敏感信息边界；`npm run validate-target-tree` 验证目标 source、客户端顺序、补丁、release 文件哈希和导入合同。`npm run prepare-publication -- --release v1.1` 可输出目标树的 digest-only 发布摘要；`npm run remote-readback` 只读真实公开仓库，当前工作未创建 tag/Release、未推送 GitHub，也不代表 Proxy 已正式发布到生产。
