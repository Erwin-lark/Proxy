# Proxy

`Proxy` 是 RelayDeck 配套的公开静态资产仓库：保存已脱敏、可版本化、可直接引用的规则集、脚本、插件、图标与配置模板。

RelayDeck 是节点订阅与完整远程配置的唯一生产生成和发布源。客户端的完整配置、节点、令牌和其他私密信息不会存入本仓库。

## 当前远端规则

- Clash / Mihomo：[clash-rules.yaml](https://raw.githubusercontent.com/Erwin-lark/Proxy/main/clash-rules.yaml)
- Loon：[loon-rules.lsr](https://raw.githubusercontent.com/Erwin-lark/Proxy/main/loon-rules.lsr)
- Quantumult X：[quantumult-x-rules.list](https://raw.githubusercontent.com/Erwin-lark/Proxy/main/quantumult-x-rules.list)

根目录三份规则文件暂时保留原路径，避免已配置客户端失效。新的可审阅目录从 `source/`、`rules/` 和 `releases/` 开始：`source/common/` 保存共享模型，`source/clients/clash/` 与 `source/clients/loon/` 保存端特有顺序和覆写，`source/rulesets/<serviceId>/` 保存服务定义、上游锁、entries 与 patches，`rules/<serviceId>/` 保存生成的 Clash/Loon 文件，`rules/catalog.json` 供 RelayDeck 导航，`releases/r1` 与 `releases/r2` 保存本地验收快照。Quantumult X 仍是延后启用目标，不生成正式目标树文件。

## 维护与 RelayDeck 接入

请阅读[运行手册](RUNBOOK.md)，其中定义了客户端目录分层、规则目录、版本与哈希校验、RelayDeck 接入门禁、发布和回滚流程。`npm run validate-target-tree` 可校验目标 source、补丁、双端输出和 R1/R2 快照；`preparePublication({ releaseId, source, snapshots, targetReleaseId })` 可从网站调用方源模型生成完整目标树发布输入，`npm run target-publication -- --release v1.1` 只输出仓库 fixture 的发布摘要；v1.0 兼容输入仍可用；`npm run validate` 可在本地执行全仓库清单回读和公开信息扫描；`npm run remote-readback` 只读核验已存在的公开 GitHub 版本，不执行发布。公开推送和针对 `main` 的 Pull Request 会自动运行 `.github/workflows/validate.yml`，但不会替代 RelayDeck 的生产门控或真机验收。

## 安全边界

禁止提交节点、订阅 URL、令牌、密钥、证书、VPS IP、个人服务域名，或包含它们的完整客户端配置。只有经过脱敏且确认可公开的静态资产，才能通过 GitHub Raw 分发。
