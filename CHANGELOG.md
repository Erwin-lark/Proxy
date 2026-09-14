# 变更记录

本文件记录 Proxy 公开静态资产及其接入契约的可见变更。生产活动版本由 RelayDeck 单独管理。

## [Unreleased]

- 增加只读 GitHub Actions CI：公开推送和 Pull Request 在 Node.js 22 上自动运行自包含测试、公开清单校验和 source-driven target-tree 校验；跨仓库 Web 合同仍需本地显式提供 Web worktree。
- 完成目标树第一版：新增 `source/manifest.json`、共享/客户端顺序模型、两个服务 ruleset 的定义/上游锁/entries/patches、按服务生成的 Clash/Loon 规则、公开图标和 `releases/r1`、`releases/r2` 快照。
- 增加 `target-tree` 生成与校验命令，覆盖三类顺序、Tag/策略绑定、补丁前置条件、导入回放、文件哈希和无节点配置门禁；Quantumult X 继续延后，不生成未验证的正式输出。
- 增加 v1.1 target-tree 发布输入：完整纳入根级 source/rules/assets 与 r1/r2 快照，保持 v1.0 兼容输入不变；新增 digest-only 生成命令和 Web mock 合同测试。
- 增加源驱动目标树发布合同：RelayDeck 可传入公开 source model 与带 releaseId 的历史快照源，隔离生成完整 target tree；校验 version/releaseId、targetReleaseId、sourceHash 映射，覆盖双源差异、错误身份和旧输入不可变性。
- 建立 `source/common`、`source/clients`、分端 `rules` 索引和 `releases/v1.0/manifest.json` 的首版目录合同。
- 增加确定性版本清单、SHA-256 回读、公开敏感信息扫描和 RelayDeck 发布输入适配器；本地工具不连接 GitHub、不执行远端发布。
- 增加 `prepare-publication` 摘要命令，只输出待提交文件的路径、大小、哈希和用途，不泄露资产正文或执行网络写入。
- 保留根目录三端规则 Raw 路径，避免已有客户端订阅失效；Quantumult X 标记为 reference-only，不纳入当前启用发布目标。

## [2026-09-10]

- 建立 Proxy 作为 RelayDeck 公开静态资产仓库的定位。
- 增加运行手册，定义客户端分层目录、资产清单、哈希校验、发布门禁和回滚流程。
- 明确公开仓库不得包含节点、订阅 URL、令牌、密钥、证书、VPS IP 或个人服务域名。
- 保留现有三端规则 Raw 地址，避免影响已经配置的客户端。
