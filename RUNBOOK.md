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

以下是目标结构。目录可按资产接入顺序逐步建立；不要预先创建空目录作为占位。

```text
Proxy/
  README.md
  RUNBOOK.md
  SECURITY.md
  CHANGELOG.md
  package.json
  source/
    common/
      catalog.yaml
    clients/
      loon/adapter.yaml
      mihomo/adapter.yaml
      quantumult-x/adapter.yaml
  rules/
    loon/index.yaml
    mihomo/index.yaml
    quantumult-x/index.yaml
  manifests/
    catalog.yaml
    catalog.json
  policies/
    catalog.yaml
  releases/
    v1.0/manifest.json
  tools/
    proxy-manifest.mjs
    readback-release.mjs
    github-release-adapter.mjs
    github-readback.mjs
    prepare-publication.mjs
    validate-proxy.mjs
  tests/
    fixtures/relaydeck-publication-input.mjs
  # 后续按需加入：assets/scripts、assets/plugins、assets/icons、assets/config-templates
```

### 目录规则

- `source/common/`：仅保存跨客户端可复用的中立规则来源和业务分类；不能直接作为客户端订阅链接。
- `source/clients/`：保存客户端适配器元数据、语法、输出路径和启用状态；不能写入节点或私人 URL。
- `rules/<client>/`：保存客户端规则索引。根目录三份旧 Raw 文件暂时保留作为兼容输出，不能再另起一套未登记的分端内容。
- `releases/<releaseId>/`：保存不可变版本 manifest；版本号使用 `vMAJOR.MINOR`，manifest 不对自身计算哈希。
- `assets/`：后续按需加入公开脚本、插件、图标和脱敏配置模板，分别登记到清单后再发布。
- `policies/`：维护稳定策略 ID、显示名、默认行为和图标绑定。内部引用使用 ID，例如 `finance.hk-bank`，不依赖可变的展示名称。
- `config-templates/`：仅保存脱敏模板、覆写片段和映射，不保存最终完整配置。
- `fixtures/`：只存脱敏输入和预期输出，用于验证生成器，不作为生产资产。
- `tools/`：只做本地清单生成、回读、敏感信息校验和 RelayDeck 发布输入准备；不持有 GitHub 凭据、不直接发布。

## 4. 资产清单契约

每个可被 RelayDeck 使用或公开分发的资产都必须登记在 `manifests/catalog.yaml`；`manifests/catalog.json` 是供本地工具读取的同内容机器清单。最小字段如下：

```yaml
schema: 1
assets:
  - id: rules.finance.hk-bank.loon
    type: ruleset
    client: loon
    path: rules/loon/finance-hk-bank.lsr
    version: 1.0.0
    public: true
    sha256: <published-file-sha256>
    policy: finance.hk-bank
    status: active
```

字段约束：

- `id`：稳定、全小写、点分隔；一旦发布不得改作另一资产。
- `type`：`ruleset`、`script`、`plugin`、`icon` 或 `config-template`。
- `client`：`shared`、`loon`、`mihomo` 或 `quantumult-x`。
- `public`：只有 `true` 的资产可通过 GitHub Raw 或 RelayDeck 静态路径分发。
- `sha256`：发布前计算，用于 RelayDeck 同步完整性校验。
- `status`：`active`、`deprecated` 或 `retired`；弃用资产需提供替代 ID 与截止版本。

## 5. 三端规则与资产约定

| 客户端 | 规则文件 | 配置/资产边界 |
|---|---|---|
| Loon | `.lsr` | 可使用远程规则、脚本和插件；节点挂载、MITM、证书和设备设置保留本地。 |
| Mihomo / Clash Verge Rev | YAML rule-provider 或相关 YAML 资产 | RelayDeck 生成完整 Mihomo 配置；客户端不保留全局覆写或扩展脚本。 |
| Quantumult X | `.list` 及 QX 资源格式 | 目前只维护可隔离验证的资产；完整关联配置在定型前不得发布到生产。 |

相同业务规则若三端语法不同，分别放入客户端目录。只有纯域名、CIDR 或分类来源确实可复用时，才放入 `rulesets/source/` 并由 RelayDeck 转换。

## 6. RelayDeck 接入契约

RelayDeck 接入 `Proxy` 时应遵循以下规则：

1. 仓库文件变更不等于生产发布；RelayDeck 先拉取指定 commit 或 Tag。
2. RelayDeck 读取 `manifests/catalog.yaml`，拒绝未登记、哈希不符、客户端不匹配或 `public: false` 的外部资产。
3. RelayDeck 生成草稿，执行结构、引用、客户端语法与敏感信息校验。
4. 管理页显示各客户端的只读生成结果和与活动版本的差异。
5. 经人工确认后，RelayDeck 才切换活动版本；客户端固定链接不变化。
6. 发布摘要记录使用的 Proxy commit/Tag、资产 ID、哈希、发布时间和验证结果，且不得记录机密正文。

当 GitHub 不可用或资产校验失败时，RelayDeck 必须继续保留并服务最近一次有效的活动版本，不能发布空配置。

## 7. 日常新增或修改资产

1. 确定资产类型、适用客户端和稳定资产 ID。
2. 在对应客户端目录创建或更新脱敏文件。
3. 更新策略目录、图标索引或资产清单中的关联项。
4. 运行格式、引用、哈希和敏感信息检查。
5. 更新 `CHANGELOG.md`：注明新增、修复、弃用或破坏性变更。
6. 提交到 `main` 前，确认 Raw 内容可公开且不携带动态生产数据。
7. RelayDeck 在后续草稿流程中引用指定版本；未经预览与人工确认不得发布到客户端。

本地最低检查为 `npm run check`、`npm run validate` 和 `npm run readback -- --release v1.0`。远端版本存在时，可运行 `npm run remote-readback -- --owner Erwin-lark --repo Proxy --version v1.0` 做只读回读；它按 tag、commit、Release、manifest 和 manifest 中的每个文件逐项校验，不带 GitHub 凭据，不执行任何写操作。远端没有该 tag 时返回安全的空结果，不能把它解释为发布成功。

在提交给 RelayDeck 前，可运行 `npm run prepare-publication -- --release v1.0` 查看待发布摘要。输出只包含路径、字节数、SHA-256、目标客户端和用途，不包含资产正文；`networkWrites: false` 表示该命令不会调用 GitHub、不会更新分支、不会创建 Tag/Release。

需要做跨仓库合同验收时，在独立的 Web worktree 上设置 `RELAYDECK_WEB_ROOT`，运行 `RELAYDECK_WEB_ROOT="<Web-worktree>" node --test tests/relaydeck-github-contract.test.mjs`。该测试消费 `tests/fixtures/relaydeck-publication-input.mjs` 的完整函数返回值，覆盖成功提交、正文篡改、重复路径和版本冲突；未设置 Web 路径时，普通 `npm run check` 会安全跳过这两项交叉测试。

## 8. 版本、发布与回滚

- `main` 代表当前可用的公开静态资产，不代表 RelayDeck 的活动生产版本。
- 每个可供 RelayDeck 采用的资产集合应创建 Git Tag。
- 破坏性变更必须提升主版本或创建新的资产 ID；不能悄悄改变已发布资产的语义。
- 回滚时先在 RelayDeck 选择已验证的历史版本；如需回退静态资产，使用 Git Tag 或对应 commit，而不是覆盖历史文件。

### RelayDeck 发布输入合同

`tools/github-release-adapter.mjs` 的 `preparePublication()` 输出完整的 `{version, releaseId, manifest, files, commitMessage}`，其中 `files` 包含根目录兼容资产、受管元数据和 `releases/<releaseId>/manifest.json`；每个文件同时提供 `contentHash` 和 `byteLength`，可直接交给 Web `github-write-client.commitTree()`，以便入口校验正文完整性。manifest 文件使用单行 JSON，与 RelayDeck `github-write-client.safeFiles` 的字节合同一致。该模块只准备输入并校验回读身份；reserve、commit/tree、分支更新、tag、Release、缓存和活动切换仍由 RelayDeck 的可恢复任务流水线负责。

Proxy 静态资产清单与 Web 策略发布清单是两种不同的组件合同：Proxy manifest 的 `files[]` 描述公开仓库资产；Web loader 的 manifest 使用 `revisionId`、`artifacts[]` 和 `dependencies[]` 描述一次策略生成。两者共享 `version`、`releaseId`、`manifestHash` 及 `{path, content, contentHash}` 文件输入约束；Proxy 适配器当前要求静态 release 的 `releaseId === version`，并按 `releases/<version>/manifest.json` 组织 manifest。不能把 CLI 摘要当作完整输入，也不能把 Proxy 的静态清单冒充 Web 的策略修订清单。网站方接入 Proxy 时应调用 `preparePublication()` 的函数返回值，并继续由现有 pipeline 执行版本预读、提交、Tag/Release、回读、缓存和活动切换。固定完整输入 fixture 位于 `tests/fixtures/relaydeck-publication-input.mjs`。

## 9. 发布前检查清单

- [ ] 文件位于正确的资产类型和客户端目录。
- [ ] 资产 ID、客户端、策略 ID、路径、版本与哈希已登记。
- [ ] 文件通过对应客户端的语法校验。
- [ ] 所有引用存在，且没有跨客户端错误引用。
- [ ] 无节点、订阅 URL、令牌、密钥、证书、VPS IP 或个人服务域名。
- [ ] 变更已写入 `CHANGELOG.md`，弃用项已给出迁移路径。
- [ ] RelayDeck 草稿生成、差异预览和人工确认均已完成后，才允许正式发布。

## 10. 当前状态

当前仓库保留三端基础远端规则文件，并已建立第一版 `source/`、`rules/`、`releases/v1.0/` 与本地校验工具。`npm run check` 验证本地适配器、发布摘要和 mock 远端回读，`npm run validate` 验证清单哈希、路径安全和敏感信息边界；`npm run prepare-publication` 只输出 RelayDeck 发布前摘要；`npm run remote-readback` 只读真实公开仓库，远端没有对应版本时安全返回空结果。当前工具只准备 RelayDeck 的发布输入，不创建 tag/Release，也不代表 Proxy 已正式发布到生产。
