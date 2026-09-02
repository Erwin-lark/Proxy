# 本地规则配置

用于发布个人使用的 Clash、Loon 与 Quantumult X 远端规则订阅。

## 文件说明

- `clash-rules.yaml`：Clash/Mihomo 规则集
- `loon-rules.lsr`：Loon 远程规则
- `quantumult-x-rules.list`：Quantumult X 远程过滤器

## 安全提示

本仓库只发布可公开的规则域名，不包含节点订阅地址、账号凭据、VPS IP 或个人服务域名。

## 订阅地址

仓库公开后，三端可使用以下 Raw 地址：

```text
Clash/Mihomo: https://raw.githubusercontent.com/Erwin-lark/Proxy/main/clash-rules.yaml
Loon:         https://raw.githubusercontent.com/Erwin-lark/Proxy/main/loon-rules.lsr
Quantumult X: https://raw.githubusercontent.com/Erwin-lark/Proxy/main/quantumult-x-rules.list
```

在各客户端中将对应地址作为远程规则添加，并按规则文件中的策略组名称匹配本地策略组。

完整本地配置、节点订阅地址、历史备份和 `vps-subscription-hub/` 不属于本仓库内容，默认不发布。
