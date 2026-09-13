# 变更记录

本文件记录 Proxy 公开静态资产及其接入契约的可见变更。生产活动版本由 RelayDeck 单独管理。

## [Unreleased]

- 建立 `source/common`、`source/clients`、分端 `rules` 索引和 `releases/v1.0/manifest.json` 的首版目录合同。
- 增加确定性版本清单、SHA-256 回读、公开敏感信息扫描和 RelayDeck 发布输入适配器；本地工具不连接 GitHub、不执行远端发布。
- 保留根目录三端规则 Raw 路径，避免已有客户端订阅失效；Quantumult X 标记为 reference-only，不纳入当前启用发布目标。

## [2026-09-10]

- 建立 Proxy 作为 RelayDeck 公开静态资产仓库的定位。
- 增加运行手册，定义客户端分层目录、资产清单、哈希校验、发布门禁和回滚流程。
- 明确公开仓库不得包含节点、订阅 URL、令牌、密钥、证书、VPS IP 或个人服务域名。
- 保留现有三端规则 Raw 地址，避免影响已经配置的客户端。
