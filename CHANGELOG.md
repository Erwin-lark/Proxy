# 变更记录

本文件记录 Proxy 公开静态资产及其接入契约的可见变更。生产活动版本由 RelayDeck 单独管理。

## [Unreleased]

- 完成目标树第一版：新增 `source/manifest.json`、共享/客户端顺序模型、两个服务 ruleset 的定义/上游锁/entries/patches、按服务生成的 Clash/Loon 规则、公开图标和 `releases/r1`、`releases/r2` 快照。
- 增加 `target-tree` 生成与校验命令，覆盖三类顺序、Tag/策略绑定、补丁前置条件、导入回放、文件哈希和无节点配置门禁；Quantumult X 继续延后，不生成未验证的正式输出。
- 建立 `source/common`、`source/clients`、分端 `rules` 索引和 `releases/v1.0/manifest.json` 的首版目录合同。
- 增加确定性版本清单、SHA-256 回读、公开敏感信息扫描和 RelayDeck 发布输入适配器；本地工具不连接 GitHub、不执行远端发布。
- 增加 `prepare-publication` 摘要命令，只输出待提交文件的路径、大小、哈希和用途，不泄露资产正文或执行网络写入。
- 保留根目录三端规则 Raw 路径，避免已有客户端订阅失效；Quantumult X 标记为 reference-only，不纳入当前启用发布目标。

## [2026-09-10]

- 建立 Proxy 作为 RelayDeck 公开静态资产仓库的定位。
- 增加运行手册，定义客户端分层目录、资产清单、哈希校验、发布门禁和回滚流程。
- 明确公开仓库不得包含节点、订阅 URL、令牌、密钥、证书、VPS IP 或个人服务域名。
- 保留现有三端规则 Raw 地址，避免影响已经配置的客户端。
