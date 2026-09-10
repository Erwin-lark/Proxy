# Proxy 运行手册

## 1. 定位与职责

`Proxy` 是 RelayDeck 的公开静态资产仓库，负责保存可公开分发且可版本化的内容：远程脚本、规则集、插件、图标、配置模板与发布记录。

RelayDeck 是唯一的生产控制面，负责保存敏感来源、生成完整客户端配置、预览差异、发布活动版本、回滚，并向客户端提供固定链接。

```text
Proxy（公开静态资产） → RelayDeck（生成与发布） → 客户端固定链接
```

GitHub Raw 只可直接分发明确标记为公开静态资产的文件。节点订阅、完整远程配置、令牌与任何按设备或活动版本动态生成的内容必须由 RelayDeck 分发。

## 2. 安全红线

以下内容不得出现在 Git 历史、Issue、Release、测试快照或文档中：

- 节点、分享链接、订阅 URL、面板地址或真实私密 URL
- 令牌、密码、API Key、密钥、证书、Cookie、请求头
- VPS IP、个人服务域名、设备标识或用户资料
- 包含上述内容的完整 Loon、Mihomo 或 Quantumult X 配置

所有新资产先在本地脱敏、校验，再提交。发现敏感信息时，应立即停止发布并轮换已暴露的凭据；删除文件不足以消除 Git 历史风险。

## 3. 目标目录

以下是目标结构。目录可按资产接入顺序逐步建立；不要预先创建空目录作为占位。

```text
Proxy/
  README.md
  RUNBOOK.md
  SECURITY.md
  CHANGELOG.md
  manifests/
    catalog.yaml
    releases/
  policies/
    catalog.yaml
  rulesets/
    source/
    loon/
    mihomo/
    quantumult-x/
  scripts/
    loon/
    quantumult-x/
    mihomo/
  plugins/
    loon/
    quantumult-x/
  icons/
    shared/
    index.yaml
  config-templates/
    shared/
    loon/
    mihomo/
    quantumult-x/
  schemas/
  fixtures/
  tests/
  docs/
```

### 目录规则

- `source/`：仅保存跨客户端可复用的中立规则来源；不能直接作为客户端订阅链接。
- `loon/`、`mihomo/`、`quantumult-x/`：只保存对应客户端的最终静态产物，禁止混用语法。
- `policies/`：维护稳定策略 ID、显示名、默认行为和图标绑定。内部引用使用 ID，例如 `finance.hk-bank`，不依赖可变的展示名称。
- `config-templates/`：仅保存脱敏模板、覆写片段和映射，不保存最终完整配置。
- `fixtures/`：只存脱敏输入和预期输出，用于验证生成器，不作为生产资产。
- `manifests/releases/`：保存发布摘要与回滚指针，不保存真实令牌或客户端完整配置。

## 4. 资产清单契约

每个可被 RelayDeck 使用或公开分发的资产都必须登记在 `manifests/catalog.yaml`。最小字段如下：

```yaml
schema: 1
assets:
  - id: rules.finance.hk-bank.loon
    type: ruleset
    client: loon
    path: rulesets/loon/finance-hk-bank.lsr
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

## 8. 版本、发布与回滚

- `main` 代表当前可用的公开静态资产，不代表 RelayDeck 的活动生产版本。
- 每个可供 RelayDeck 采用的资产集合应创建 Git Tag。
- 破坏性变更必须提升主版本或创建新的资产 ID；不能悄悄改变已发布资产的语义。
- 回滚时先在 RelayDeck 选择已验证的历史版本；如需回退静态资产，使用 Git Tag 或对应 commit，而不是覆盖历史文件。

## 9. 发布前检查清单

- [ ] 文件位于正确的资产类型和客户端目录。
- [ ] 资产 ID、客户端、策略 ID、路径、版本与哈希已登记。
- [ ] 文件通过对应客户端的语法校验。
- [ ] 所有引用存在，且没有跨客户端错误引用。
- [ ] 无节点、订阅 URL、令牌、密钥、证书、VPS IP 或个人服务域名。
- [ ] 变更已写入 `CHANGELOG.md`，弃用项已给出迁移路径。
- [ ] RelayDeck 草稿生成、差异预览和人工确认均已完成后，才允许正式发布。

## 10. 当前状态

目前仓库仅包含三端的基础远端规则文件。上述目录、清单、校验和 RelayDeck 同步契约是后续建设目标；在建立对应资产前，不应假定目录或自动化已经存在。
