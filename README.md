# Proxy

`Proxy` 是 RelayDeck 配套的公开静态资产仓库：保存已脱敏、可版本化、可直接引用的规则集、脚本、插件、图标与配置模板。

RelayDeck 是节点订阅与完整远程配置的唯一生产生成和发布源。客户端的完整配置、节点、令牌和其他私密信息不会存入本仓库。

## 当前远端规则

- Clash / Mihomo：[clash-rules.yaml](https://raw.githubusercontent.com/Erwin-lark/Proxy/main/clash-rules.yaml)
- Loon：[loon-rules.lsr](https://raw.githubusercontent.com/Erwin-lark/Proxy/main/loon-rules.lsr)
- Quantumult X：[quantumult-x-rules.list](https://raw.githubusercontent.com/Erwin-lark/Proxy/main/quantumult-x-rules.list)

## 维护与 RelayDeck 接入

请阅读[运行手册](RUNBOOK.md)，其中定义了客户端目录分层、资产清单、版本与哈希校验、RelayDeck 接入门禁、发布和回滚流程。

## 安全边界

禁止提交节点、订阅 URL、令牌、密钥、证书、VPS IP、个人服务域名，或包含它们的完整客户端配置。只有经过脱敏且确认可公开的静态资产，才能通过 GitHub Raw 分发。
