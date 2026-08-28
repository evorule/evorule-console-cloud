<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->

# 如何使用工作台(/workbench)

> 极简首页 — Dashboard 风格,5 个 region 一屏看清一切。详细设计见 [workbench.md](../workbench.md)。

## 5 个 Region 速查

| Region | 用途 | 关键交互 |
|---|---|---|
| 1. 顶部状态条 | server/rule 连接 + workspace + 模式 | `🔄 刷新` / `📋 4 引导任务` 按钮 |
| 2. 4 统计卡 | 规则 / Sessions / 待审 / 最近 fact | 整张卡可点跳详情 |
| 3. 一键操作 | 加规则 / 试运行 / LLM 快速 | 3 tabs,表单在下方 |
| 4. 最近活动 | 当前 session 的 audit 最近 8 条 | 时间 `#N` / 颜色 (绿=命令/蓝=验证/黄=其它) |
| 5. 跳单页 | 8 常用页一键跳 | 治理 3 项未登录显示 🔒 锁 |

## 何时该看工作台

- **刚启动全栈** — 看状态条,确认 server/rule 都连上
- **新用户上手** — 5 region 涵盖最常用操作
- **日常巡检** — 一屏看清 3 件事:连接状态 / 待审数 / 最近活动
- **发现异常** — "最近 FACT" 卡显示 #N 时,直接点跳审计查

## 何时该跳单页(不用工作台)

- **深度操作**:在工作台做"加规则"只是应急,真正建复杂规则集去 `/view/rules`
- **长 session 操作**:执行台长时间调试,用 `/view/execution` 全屏
- **审计细节**:时间旅行/因果链分析,去 `/view/audit` / `/view/timetravel`

## 不会自动做的事

工作台**不**做的事(避免越界):

- ❌ 不持久化 tab 状态(刷新回"加规则" tab)
- ❌ 不接管路由守卫(点跳治理页仍受后端守卫保护)
- ❌ 不实现键盘快捷键(顶栏 `Ctrl+K` 搜索,搜索结果未跳到 workbench)
- ❌ 不监控后台进程(只反映"现在能不能连上",30 min 杀问题靠 nssm 服务化)

## 已知待修

- Region 3 加规则仅支持 `"type": "set"`,call/conditional 等 type 模板待加
- Region 4 activity 时间显示 `fact #N`(logical_time),需从 audit 拉 wall-clock
- Region 5 治理页"需登录"判断靠前端,后端路由守卫做最终拦截
- 不持久化 tab 状态
- 无键盘快捷键
- Region 1 ruleConnected 是间接探测(`listWorkspaces`),不是原生 health endpoint
