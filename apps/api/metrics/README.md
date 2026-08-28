# metrics 服务(待实现)

自托管访问统计(无第三方脚本)。

- `POST /t` — pageview beacon:date / path / 加盐 IP 哈希 / UA 摘要(不存原始 IP,`docs/security.md` §6)
- 聚合供 `/admin/stats` 使用:PV / UV / 路径分布 / 近 30 天趋势
