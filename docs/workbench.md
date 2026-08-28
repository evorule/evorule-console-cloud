# 工作台(Workbench)使用指南

> evorule-console-cloud 极简首页 — 5 个 region,一屏看清一切。

## 定位

工作台是 **Dashboard 风格的极简首页**,不是分析视图。
所有 5 个分析视图(规则库 / 执行台 / 状态 / 审计 / 时间旅行)依然在侧栏"分析视图"分组下,
工作台只做 3 件事:

1. **状态** — server/rule 实时连接 + workspace 元信息
2. **概览** — 4 张统计卡(规则数 / Session 数 / 待审 / 最近 fact)
3. **快捷** — 一键加规则 / 试运行 / LLM 引导 + 8 个单页跳按钮

设计取舍详见 `docs/planning/2026-08-27-workspace-write-chain.md`(方案 C)。

## 5 个 Region 详解

### Region 1 · 顶部状态条
显示内容:
- `server ● 已连接 / ○ 离线` — evorule-server (18090) 连接状态
- `rule ● 已连接 / ○ 离线` — evorule-rule (18081) 连接状态
- `workspace: <name>` — 当前 workspace
- `模式: ☁ 联网 / 🖥 离线` — 网络模式
- `server: evorule-server v0.2.0 (18090)` — 版本+端口
- `rule: evorule-rule v0.2.0 (18081)` — 版本+端口
- `🔄 刷新` — 立即拉取所有数据
- `📋 4 引导任务` — 跳转 4 步引导向导(创建 workspace / 补种示例 / 加规则 / 执行)

**自动刷新**:每 30s 拉一次,健康检查每 15s。

### Region 2 · 4 个统计卡
| 卡 | 数据 | 跳页 |
|---|---|---|
| 📐 规则 | N 条(内置 X + 自建 Y) | `/view/rules` |
| ▶ Sessions | N 个 active | `/view/execution` |
| 📥 待审 | N 个待处理(>0 显示徽标) | `/publish-queue` |
| 🔍 最近 Fact | fact #N(type: ...) | `/view/audit` |

### Region 3 · 一键操作(3 个 tab)
- **➕ 加规则**:填规则 ID + JSON,点提交直接进当前 workspace
- **▶ 试运行**:选 session + payload,点执行走 `submitCommand`
- **🤖 LLM 快速**:检测 LLM 配置,未配置给引导,已配置跳规则库起草

**未登录限制**:加规则 / 试运行按钮置灰,显示"请先登录"。

### Region 4 · 最近活动
- 从当前 session 的 `audit.entries` 取最近 8 条
- 颜色:🟢 命令 / 🔵 验证 / 🟡 其它
- 空状态:`暂无审计活动 · 在执行台提交命令后这里会实时显示`
- 底部:`→ 完整审计链` 跳 `/view/audit`

### Region 5 · 跳单页(8 个)
网格 4×2,8 个常用页:
- 5 个分析视图(规则库 / 执行台 / 状态 / 审计 / 时间旅行)— 无需登录
- 3 个治理页(导出 / 发布队列 / 治理中心)— 需登录,未登录显示 🔒 锁图标

## 入口

- **侧栏最顶部**:`🚀 工作台` 按钮(在"分析视图"分组之上)
- **路由**:`/workbench`
- **键盘**:`Ctrl+K` 搜索(顶栏,支持规则集/数据集/发布记录全文搜索)

## 适用场景

- **首次用户**:`/workbench` 是最直观的"看一眼知道全栈在不在"的入口
- **日常用户**:Dashboard 比侧栏 tab 切换快一屏看清所有状态
- **运维**:连接状态 + 待审数 + 最近 fact,3 秒判断"系统是否正常"
- **演示**:可作为新功能的截图/录屏首页

## 已知待修(实施前已知)

- [ ] `?openSettings=llm` query param 暂未实现(LLM 配置入口靠 LlmChatSidebar 头部按钮)
- [ ] Region 3 加规则仅支持"set" type,其它 type(call/conditional/...)的 JSON 模板待加
- [ ] Region 4 activity 时间用 `Date.now()` 估算,未从 audit.logical_time 反推
- [ ] Region 5 治理页的"需登录"判断靠前端状态,后端路由守卫会做最终拦截(双重保护)
- [ ] 工作台不持久化 tab 状态(刷新回到"加规则"tab)
- [ ] 工作台无键盘快捷键(只有顶栏 Ctrl+K 搜索)

## 技术细节

- **5 region 拆分**:WorkbenchView(主组件,负责拉数据 + 派生) + 5 个 region 子组件
- **数据源**:`$lib/kernel` 提供 `rules / sessions / publishQueue / auditData / currentWorkspace`
- **后端注入**:`useBackend()` + `useWorkspaceBackend()`,由 `+layout.svelte` 注入
- **Svelte 5 runes**:`$state / $derived / $effect / $props`,与项目其它 view 风格一致
- **样式**:`var(--bg-card) / --primary / --success` 等 token,跟内核深色主题统一

## 修改指南

- 加新 region:在 `WorkbenchView.svelte` 加一段 + 在 `src/lib/views/Workbench/` 加子组件
- 改跳页逻辑:改 `WorkbenchJump.svelte` 的 `JUMP_TARGETS` 数组
- 改统计卡:改 `WorkbenchView.svelte` 的 `statsData` 派生 + `WorkbenchStats.svelte` 的 Props
- 改刷新频率:改 `WorkbenchView.svelte` 的 `setInterval`(健康 15s / 数据 30s / 时间 30s)
