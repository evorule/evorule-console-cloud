# 首页详细设计(状态感知首页 + demo toggle)

> **状态**:设计文档,2026-08-06 定稿。本文档是 evorule-doc-center `b2b2c-strategy.md §5.8` 的可实施落地。
>
> **定位**:首页是用户每天登录后见到的第一页,是 agent 公司 / 用户采用产品的决定性因素。本设计文档把 §5.8 战略意图落到 SvelteKit + Svelte 5 的组件树 / 状态机 / 路由 / Store / 数据流层面,作为 P0-0b 首页实施依据。
>
> **关联**:
>
> - 战略依据:`D:\evorule-doc-center\shared\final\b2b2c-strategy.md §5.8`
> - 现有代码:`src/routes/+page.svelte`(5 视图渲染器,需迁移)
> - 现有代码:`src/routes/+layout.svelte`(顶部导航 + backend 注入)
> - 关联 store:`src/lib/stores/assistant-ui.ts`、`src/lib/config/net-config.ts`(风格参考)

---

## 1. 背景与动机

### 1.1 双重职责张力(战略层)

首页承担两个职责,设计目标冲突:

| 职责           | 设计目标                                 | 用户                    | 数据状态       |
| -------------- | ---------------------------------------- | ----------------------- | -------------- |
| 真实功能落地页 | 个性化、空状态友好、任务流入口、待办驱动 | 已登录用户(每天用)      | 用户库真实数据 |
| 通用 demo 展示 | 标准化、预填数据、卖点突出、30 秒说服    | 访客 / agent 公司决策者 | 预填数据       |

**核心判断**:真实 ≠ 展示。真实优先,demo 是辅助。详见战略文档 §5.8.1。

### 1.2 现有代码现状

当前 `src/routes/+page.svelte` 是"5 视图之一"的渲染器,通过 `currentView` store 切换 `RuleLibraryView` / `ExecutionPadView` / `StateView` / `AuditView` / `TimeTravelView`,**不是首页**。本设计需要:

1. 新增首页层(状态感知路由)
2. 现有 5 视图:4 视图(rules/execution/state/audit)降为工作台内的功能页;**时间旅行(timetravel)是 L1 监控大屏一等公民**(内核已嵌入 ttd v1.0,见三层架构 §3.5)
3. 延续现有 store + provideXxx 注入模式,不破坏内核边界

### 1.3 与战略文档的关系

| 战略文档 §5.8 章节                          | 本设计文档章节                               |
| ------------------------------------------- | -------------------------------------------- |
| §5.8.2 三状态路由(A/B/C)                    | §3 状态机 + §4 路由设计                      |
| §5.8.3 状态 C 真实工作台 5 区域             | §5.3 RealWorkbench 组件树                    |
| §5.8.4 状态 A demo 模式 + 医疗/财务两套数据 | §5.1 DemoHome 组件树 + §6.3 demoDatasetStore |
| §5.8.5 状态 B 建库向导 5 步                 | §5.2 OnboardingWizard 组件树                 |
| §5.8.7 备选方案 A 双首页                    | §10.1 备选方案 A 实现差异                    |
| §5.8.8 备选方案 B 三角色首页                | §10.2 备选方案 B 实现差异                    |
| §5.8.10 SaaS 长期演进                       | §11 长期演进路径                             |

**关联设计文档**:

- **P0-1 详细设计**:`D:\evorule-console-cloud\docs\P01_BUILD_SCHEMA_DESIGN.md`(建库向导数据层 + 业务规则库 + 业务模板)
- **三层运行架构**:`D:\evorule-doc-center\shared\draft\evorule-three-layer-architecture.md`(Runtime + Workspace + Sandbox 三层抽象)
- 本文档 §6.2 dbStore / §5.3 OnboardingWizard Step 3 / §7.1 / §7.3 数据流 与 P0-1 设计文档 §4.2 / §13 一致性更新 同步(2026-08-06 拍板:复用内核 rules store,派生计算替代持久化字段)

> **2026-08-06 三层架构同步**(对应三层架构 §11.2 / §11.4):
>
> 状态感知首页升级为**层感知**:
>
> - 状态 C(真实工作台)按三层架构拆为 **L1 监控大屏**(Production Runtime,消费 SSE 实时 Fact 流)与 **L2 Workspace**(编辑台,规则编辑 / 沙盒入口)两个层视图
> - 新用户(无已发布规则)默认进 L2;有已发布规则(production 运行中)默认进 L1;顶部 toggle 切换 L1 ↔ L2
> - RealWorkbench 从"任务中心"调整为"监控大屏(L1 主屏,消费 SSE)"
> - **U7 决策(2026-08-06 拍板)**:滚动 session 切换时采用**服务端推送切换通知**(SSE `session_switched` 事件),非客户端轮询 / 自动重连

---

## 2. 目标与非目标

### 2.1 目标

- ✅ 实现状态感知首页(`/`),根据登录态 + 库状态自动选 A/B/C
- ✅ 实现 demo 强制入口(`/demo`),已登录用户也能切回看 demo
- ✅ 实现 demo toggle(顶部导航切换"看 demo" ↔ "回我的工作台")
- ✅ 预填医疗 + 财务两套 demo 数据(对应 P0-2 业务语言层 v0 起步行业)
- ✅ 实现 5 步建库向导(对应功能流 1-5 步)
- ✅ 真实工作台 5 区域(顶部导航 / 数据卡 / 待办 + 快捷入口 / 最近活动)
- ✅ 延续 SvelteKit + Svelte 5 runes + provideXxx 注入模式
- ✅ adapter-static 兼容(纯静态部署)
- ✅ 单元测试覆盖状态机 + 路由 + Store(Vitest)
- ✅ E2E 测试覆盖关键用户路径(Playwright)

### 2.2 非目标

- ❌ 不实现后端 API(本文档只设计前端调用接口,后端 API 由 evorule-server 提供)
- ❌ 不实现认证系统(用 mock sessionStore,真实认证由 evorule-server 提供)
- ❌ 不实现多租户(SaaS 阶段才做,见 §11)
- ❌ 不实现 i18n / a11y / 移动端(P1/P2 才做)
- ❌ 不替换现有 5 视图(4 视图降为工作台功能页,时间旅行升为 L1 一等公民,代码不变)
- ❌ 不引入新的状态管理库(延续 Svelte writable store)
- ❌ 不引入路由库(用 SvelteKit 原生路由 + store 配合)

---

## 3. 状态机设计

### 3.1 三状态定义

| 状态 ID | 名称       | 触发条件                  | 渲染组件                  | 设计目标        |
| ------- | ---------- | ------------------------- | ------------------------- | --------------- |
| `A`     | demo 模式  | 未登录访客 / 强制 demo    | `DemoHome.svelte`         | 30 秒说服决策者 |
| `B`     | 建库向导   | 已登录 + 空库(0 条规则)   | `OnboardingWizard.svelte` | 5 分钟跑通      |
| `C`     | 真实工作台 | 已登录 + 有库(≥ 1 条规则) | `RealWorkbench.svelte`    | 每天上班打开    |

> **2026-08-06 层感知升级**(对应三层架构 §11.2):状态 C 内部按三层架构再分两个**层视图**,由 `layerStore` 控制,顶部 toggle 切换:
>
> | 层视图 | 名称                         | 渲染子组件                | 默认条件                          | 数据来源                         |
> | ------ | ---------------------------- | ------------------------- | --------------------------------- | -------------------------------- |
> | `L1`   | 监控大屏(Production Runtime) | `MonitorDashboard.svelte` | 有已发布规则(production 运行中)   | SSE 实时 Fact 流                 |
> | `L2`   | 编辑台(Workspace)            | `WorkspaceConsole.svelte` | 无已发布规则(刚建库,在编辑 Draft) | 内核 rules store + Workspace API |
>
> - 新用户完成向导后默认进 **L2**(还没有已发布规则,先编辑)
> - 首次发布规则后默认进 **L1**(监控大屏看运行时)
> - L1 / L2 可通过顶部 toggle 自由切换,互不中断(L1 的 SSE 流在切到 L2 时可保持后台订阅)

### 3.2 状态转换图

```
                         ┌───────────────────┐
                         │   demo toggle ON  │ ← 用户点击顶部"看 demo"
                         │   (force-demo)    │
                         └─────────┬─────────┘
                                   │
                                   ▼
   ┌───────────────────────────────────────────────────────┐
   │                  HomeRouter 决策                       │
   │                                                       │
   │   if (forceDemo)              → A DemoHome            │
   │   else if (!session.loggedIn) → A DemoHome             │
   │   else if (dbStore.empty)    → B OnboardingWizard     │
   │   else                       → C RealWorkbench        │
   └───────────────────────────────────────────────────────┘
        ▲                  ▲                  ▲
        │                  │                  │
   未登录访客         登录成功 + 空库       登录成功 + 有库
                          │                  ▲
                          │                  │
                          └── 完成建库向导 ──┘
```

### 3.3 状态转换条件矩阵

| 当前状态  | 事件                                 | 下一状态         | 触发动作                                                               |
| --------- | ------------------------------------ | ---------------- | ---------------------------------------------------------------------- |
| A(demo)   | 用户点"注册" / "登录"                | A(demo,等待回调) | 调用 `sessionStore.login()`                                            |
| A(demo)   | 登录成功 + 库空                      | B(向导)          | `sessionStore` 更新 + 路由重定向 `/`                                   |
| A(demo)   | 登录成功 + 有库                      | C(工作台)        | `sessionStore` 更新 + 路由重定向 `/`                                   |
| A(demo)   | 用户点"看 demo" toggle               | A(demo)          | `homeModeStore.set('force-demo')`                                      |
| B(向导)   | 完成第 5 步(内核 rules store 非空)   | C(工作台)        | 内核 `addRule()` 已让派生 `isEmptyDb` = false + 跳转 `/`(详见 P01 §13) |
| B(向导)   | 用户点"看 demo" toggle               | A(demo)          | `homeModeStore.set('force-demo')`                                      |
| B(向导)   | 用户主动退出向导(取消)               | A(demo)          | `sessionStore.logout()`                                                |
| C(工作台) | 用户点"看 demo" toggle               | A(demo)          | `homeModeStore.set('force-demo')`                                      |
| C(工作台) | 用户点"回工作台" toggle              | C(工作台)        | `homeModeStore.set('auto')`                                            |
| C(工作台) | 用户登出                             | A(demo)          | `sessionStore.logout()`                                                |
| 任意      | `force-demo` 模式下,用户点"回工作台" | 自动(A/B/C)      | `homeModeStore.set('auto')`                                            |

**层视图切换矩阵**(2026-08-06 三层架构同步,状态 C 内部):

| 当前层       | 事件                                 | 下一层       | 触发动作                                                         |
| ------------ | ------------------------------------ | ------------ | ---------------------------------------------------------------- |
| L2(编辑台)   | 首次发布规则成功(production 启动)    | L1(监控大屏) | `productionStateStore` 更新 + `layerStore.set('L1')` 自动跳转    |
| L2(编辑台)   | 用户点顶部"看运行时" toggle          | L1(监控大屏) | `layerStore.set('L1')`                                           |
| L1(监控大屏) | 用户点顶部"去编辑" toggle            | L2(编辑台)   | `layerStore.set('L2')`(SSE 后台保持订阅)                         |
| L1(监控大屏) | 收到 SSE `session_switched` 事件(U7) | L1(监控大屏) | 关闭旧 SSE → 订阅新 session_id 的 SSE → toast"规则集已更新到 vN" |
| L1(监控大屏) | 收到 SSE `anomaly` 事件              | L1(监控大屏) | 异常告警面板追加红条(不切层)                                     |

> **U7 决策(2026-08-06 拍板)**:滚动 session 切换时采用**服务端推送切换通知**。
>
> - 服务端在旧 production session 的 SSE 流上发一条 `session_switched` 事件(含 `new_session_id` + `new_ruleset_version`)
> - 客户端收到后**主动**关闭旧 SSE → 订阅新 session_id 的 SSE,无需轮询 / 重试探测
> - 对比"客户端自动重连":自动重连会重连到已关闭的旧 session(失败),且无法感知新 session_id;服务端推送切换通知是唯一能传递 `new_session_id` 的方式
> - 详见 §6.5 productionStateStore + §7.6 SSE 切换通知数据流

> **注**(2026-08-06 同步 P01 §13):空库判断改为派生计算 `isEmptyDb = derived(rules, $rules => $rules.length === 0)`,不再用 `dbStore.markAsNonEmpty()`。规则在内核 `@evorule/console` 的 `rules` store,详见 P0-1 §3.1 决策。

### 3.4 demo toggle 行为

`homeModeStore` 有两个值:

- `'auto'`(默认)— 根据 session + db 自动选 A/B/C
- `'force-demo'`— 强制 A,覆盖自动判断

**toggle 行为**:

- 当前在 C(工作台)→ 点"看 demo" → `homeModeStore.set('force-demo')` → 跳 A
- 当前在 A(demo,force-demo 模式)→ 点"回工作台" → `homeModeStore.set('auto')` → 回 C(若已登录 + 有库)
- 当前在 A(demo,未登录,auto 模式)→ toggle 不显示(用户未登录,demo 是唯一状态)

---

## 4. 路由设计

### 4.1 路由表

| 路径          | 渲染                                       | 说明                                         |
| ------------- | ------------------------------------------ | -------------------------------------------- |
| `/`           | `+page.svelte` → `HomeRouter.svelte`       | 智能首页,状态感知 + 层感知                   |
| `/demo`       | `+page.svelte` → `DemoHome.svelte`         | 强制 demo 入口(独立 URL,便于分享/SEO)        |
| `/runtime`    | `+page.svelte` → `MonitorDashboard.svelte` | L1 监控大屏强制入口(消费 SSE)                |
| `/workspace`  | `+page.svelte` → `WorkspaceConsole.svelte` | L2 编辑台强制入口(规则编辑 / 沙盒)           |
| `/view/[id]`  | `+page.svelte` → `ViewRenderer.svelte`     | 5 视图(含时间旅行,L1 监控大屏触发,见 §5.4.1) |
| `/onboarding` | `+page.svelte` → `OnboardingWizard.svelte` | 强制向导入口(用户中途离开后回到向导)         |
| `/settings`   | `+page.svelte` → `Settings.svelte`         | 设置页(网络配置 + LLM 配置,已实现,见 §15)    |

> **2026-08-06 三层架构同步**:`/runtime`(L1)与 `/workspace`(L2)是状态 C 的两个层视图强制入口。`/` 由 HomeRouter 按层感知决策(默认 L2 若无已发布规则,否则 L1),用户也可直接访问 `/runtime` / `/workspace` 强制进某一层。
>
> **2026-08-06 时间旅行修正**(对应三层架构 §3.5):`/view/[id]` 不再标记 "legacy"。其中 `timetravel` 视图是 **L1 监控大屏的一等公民功能**(内核已嵌入 ttd v1.0,5 视图:timeline/state/causal/diff/whatif),通过 InterventionBar 的 `[⏪ 时间旅行]` 按钮触发。其余 4 视图(rules/execution/state/audit)为工作台内功能页。

### 4.2 路由配置(SvelteKit adapter-static 兼容)

`adapter-static` 默认是 SPA fallback,需要在 `svelte.config.js` 配置 `fallback: 'index.html'`(已有)。多路由的预渲染策略:

```javascript
// svelte.config.js(已有,无需修改)
// 当前已是 SPA fallback 模式,所有路由都通过 index.html 接管
// SvelteKit 客户端路由会处理 /demo /view/[id] /onboarding 等路径
```

### 4.3 路由守卫

在 `+layout.ts` 中实现路由守卫(SvelteKit load 函数):

```typescript
// src/routes/+layout.ts
import type { LayoutLoad } from "./$types";
import { redirect } from "@sveltejs/kit";
import { browser } from "$app/environment";
import { get } from "svelte/store";
import { sessionStore } from "$lib/stores/session";
import { checkEmptyDb } from "$lib/stores/db";

export const load: LayoutLoad = ({ url }) => {
  if (!browser) return {}; // SSR 时跳过守卫(adapter-static 默认无 SSR)

  const session = get(sessionStore);
  const emptyDb = checkEmptyDb(); // 派生 isEmptyDb 的同步版(路由守卫用)

  // /onboarding 守卫:未登录或已有库时跳回 /
  if (url.pathname === "/onboarding") {
    if (!session.loggedIn || !emptyDb) {
      throw redirect(307, "/");
    }
  }

  // /runtime(L1) / /workspace(L2) / /view/[id] 守卫:未登录或库空时跳回 /
  // (向导未完成,不允许直接访问运行时 / 编辑台 / 视图)
  if (
    url.pathname === "/runtime" ||
    url.pathname === "/workspace" ||
    url.pathname.startsWith("/view/")
  ) {
    if (!session.loggedIn || emptyDb) {
      throw redirect(307, "/");
    }
  }

  // /demo 不守卫:任何状态都能访问

  return {};
};
```

### 4.4 状态感知路由(`/` 的决策逻辑)

`/` 路由的 `+page.svelte` 不直接渲染内容,而是把决策委托给 `HomeRouter.svelte`:

```svelte
<!-- src/routes/+page.svelte -->
<script lang="ts">
  import HomeRouter from '$lib/views/Home/HomeRouter.svelte';
</script>

<HomeRouter />
```

```svelte
<!-- src/lib/views/Home/HomeRouter.svelte -->
<script lang="ts">
  import { browser } from '$app/environment';
  import { get } from 'svelte/store';
  import { sessionStore } from '$lib/stores/session';
  import { isEmptyDb } from '$lib/stores/db';
  import { homeModeStore } from '$lib/stores/home-mode';
  import { layerStore, resolveDefaultLayer } from '$lib/stores/layer';
  import { productionStateStore } from '$lib/stores/production-state';
  import DemoHome from './DemoHome.svelte';
  import OnboardingWizard from './OnboardingWizard.svelte';
  import RealWorkbench from './RealWorkbench.svelte';

  // 状态决策(A/B/C)— 基于派生 isEmptyDb(内核 rules store)
  function resolveMode(): 'A' | 'B' | 'C' {
    const mode = get(homeModeStore);
    if (mode === 'force-demo') return 'A';

    const session = get(sessionStore);
    if (!session.loggedIn) return 'A';

    if (get(isEmptyDb)) return 'B';

    return 'C';
  }

  const mode = $derived(resolveMode());

  // 进入状态 C 时,若 layerStore 未初始化,按 production 状态选默认层
  // (有已发布规则 → L1 监控大屏;无 → L2 编辑台)
  $effect(() => {
    if (mode === 'C' && get(layerStore) === null) {
      layerStore.set(resolveDefaultLayer(get(productionStateStore)));
    }
  });
</script>

{#if mode === 'A'}
  <DemoHome />
{:else if mode === 'B'}
  <OnboardingWizard />
{:else}
  <RealWorkbench layer={$layerStore} />
{/if}
```

> **2026-08-06 三层架构同步**:
>
> - `dbStore.empty` → 派生 `isEmptyDb`(基于内核 rules store,见 §6.2)
> - 状态 C 内部由 `layerStore`('L1' | 'L2' | null)控制层视图,`RealWorkbench` 按 `layer` prop 渲染 `MonitorDashboard`(L1)或 `WorkspaceConsole`(L2)
> - 默认层由 `resolveDefaultLayer(productionState)` 决定:production 运行中 → L1,否则 → L2

---

## 5. 组件树

### 5.1 顶层组件树

```
src/routes/
├── +layout.svelte            (现有,顶部导航 + backend 注入)
├── +layout.ts                (新增,路由守卫)
├── +page.svelte              (改,渲染 HomeRouter)
├── demo/
│   └── +page.svelte          (新增,强制 demo 入口)
├── onboarding/
│   └── +page.svelte          (新增,强制向导入口)
└── view/[id]/
    └── +page.svelte          (新增,5 视图入口:4 视图工作台功能页 + 时间旅行 L1 一等公民)

src/lib/views/Home/
├── HomeRouter.svelte         (新增,状态感知路由)
├── DemoHome.svelte           (新增,状态 A)
├── OnboardingWizard.svelte   (新增,状态 B)
├── RealWorkbench.svelte      (新增,状态 C)
└── (子组件,见 5.2/5.3/5.4)

src/lib/stores/                (Store 层,见 §6)
├── session.ts                (新增,登录态)
├── db.ts                     (新增,库元数据)
├── home-mode.ts              (新增,demo toggle 状态)
├── demo-dataset.ts           (新增,demo 数据集切换)
└── activity-feed.ts          (新增,最近活动)

src/lib/data/
├── demo-medical.ts           (新增,医疗预填数据)
└── demo-finance.ts           (新增,财务预填数据)
```

### 5.2 DemoHome.svelte(状态 A)组件树

```
DemoHome.svelte
├── VisitorTopbar.svelte         (顶部导航,访客版)
│   ├── [logo]
│   ├── [功能菜单 ▼]              (功能介绍链接)
│   ├── [文档]
│   ├── [GitHub]
│   ├── [注册] [登录]             (CTA)
├── DemoBanner.svelte            (顶部 banner,"这是 demo")
│   └── [注册建自己的库]          (CTA)
├── DemoDatasetSwitcher.svelte   (医疗/财务两套数据切换)
│   ├── [医疗场景 ▼]
│   └── [财务场景 ▼]
├── StatsCards.svelte            (4 数据卡:规则数/执行数/异常数/待办数)
│   ├── 规则数卡(可点击 → /view/rules)
│   ├── 执行数卡(可点击 → /view/execution)
│   ├── 异常数卡(可点击 → 过滤异常)
│   └── 待办数卡(可点击 → 待办列表)
├── DemoMain.svelte              (左右两栏布局)
│   ├── GuidedTasks.svelte       (3 个引导任务)
│   │   ├── "试试加规则"(→ /view/rules,demo 模式)
│   │   ├── "试试查问题"(→ /view/audit,demo 模式)
│   │   └── "试试改规则"(→ /view/rules,demo 模式)
│   └── CapabilityList.svelte    (6 个能力特性)
│       ├── ✅ 确定性执行          (点击展开说明)
│       ├── ✅ 可审计(BLAKE3)
│       ├── ✅ 可回放(时间旅行)
│       ├── ✅ LLM 辅助写规则
│       ├── ✅ 热重载即时生效
│       └── ✅ 合规架构(P1)
└── CtaFooter.svelte             (底部 CTA)
    ├── "30 秒看懂 evorule" 标题
    ├── [注册]
    ├── [集成文档]
    └── [视频]
```

### 5.3 OnboardingWizard.svelte(状态 B)组件树

```
OnboardingWizard.svelte
├── WizardStepper.svelte         (5 步进度条)
│   └── [1 选起点] [2 命名+对象] [3 加规则] [4 试运行] [5 完成]
├── StepTemplatePicker.svelte    (步骤 1)
│   ├── [📋 空白库]
│   ├── [💰 财务审批模板]
│   └── [⚖ 合规审计模板]
├── StepDbConfig.svelte          (步骤 2)
│   ├── 库名输入框
│   ├── 业务对象多选(病人/案件/订单)
│   └── [自定义业务对象 +]
├── StepFirstRule.svelte         (步骤 3 — P0-1 §11.1 详细实现)
│   ├── BusinessForm.svelte     (业务表单填字段,P0-1 §6.2)
│   │   ├── [年龄 > 65]
│   │   ├── [发烧 = 是]
│   │   └── ...(根据 BusinessFormSchema 渲染)
│   └── LlmHelper.svelte       (LLM 辅助)
│       ├── 自然语言输入框
│       ├── [生成规则草案]      (调 CloudLlmAssistant.generateRuleDraft)
│       ├── RuleValidator.validate(jsonStr)  (内核校验)
│       └── BusinessPreview   (调 CloudLlmAssistant.explainRule)
├── StepTrialRun.svelte          (步骤 4 — P0-1 §6.5)
│   ├── 业务事件表单
│   ├── 提交 → createSession + submitCommand(内核 session store)
│   └── 执行结果预览(看 Fact + CausalChain)
└── StepComplete.svelte          (步骤 5)
    ├── "完成!" 提示
    └── [跳到工作台]             (goto('/') — 内核 addRule 已触发派生 isEmptyDb = false → HomeRouter 选 C)
```

### 5.4 RealWorkbench.svelte(状态 C,层感知)组件树

> **2026-08-06 三层架构同步**:RealWorkbench 从"任务中心"调整为**层感知工作台**。顶部 toggle 切换 L1(监控大屏)/ L2(编辑台),两个层视图并存(切到 L2 时 L1 的 SSE 后台保持订阅)。

```
RealWorkbench.svelte(layer: 'L1' | 'L2')(状态 C 壳)
├── WorkbenchTopbar.svelte       (顶部导航,层感知版)
│   ├── [logo]
│   ├── LayerToggle.svelte      (层切换 — 2026-08-06 新增)
│   │   ├── [🖥 运行时](→ layerStore.set('L1'),显示 ruleset vN)
│   │   └── [✏ 编辑台](→ layerStore.set('L2'))
│   ├── [🔔 通知]               (L1:异常告警数;L2:待办数)
│   ├── [👤 用户菜单]
│   └── [看 demo toggle]         (切换 homeModeStore)
│
├── {#if layer === 'L1'}
│   └── MonitorDashboard.svelte  (L1 监控大屏 — 消费 SSE,见 §5.4.1)
│
└── {:else}
    └── WorkspaceConsole.svelte  (L2 编辑台 — 规则编辑 / 沙盒入口,见 §5.4.2)
```

#### 5.4.1 MonitorDashboard.svelte(L1 监控大屏)

> 对应三层架构 §3.2 监控大屏设计。消费 `GET /api/sessions/{current_session_id}/events` SSE 推送(evorule-server 已就绪)。

```
MonitorDashboard.svelte
├── RuntimeStatusbar.svelte      (运行状态条)
│   ├── [🟢 运行中 / 🟡 切换中 / 🔴 离线](productionStateStore.status)
│   ├── [ruleset v17](productionStateStore.rulesetVersion)
│   └── [session #7](productionStateStore.currentSessionId)
├── DashboardMain.svelte         (主区,全宽)
│   ├── FactStream.svelte        (实时 Fact 流,虚拟列表,消费 SSE)
│   │   └── (1000+/秒不卡,用 svelte-virtual-list)
│   │   └── SSE 事件类型:
│   │       ├── fact        → 追加到 Fact 流
│   │       ├── anomaly     → 追加到异常告警面板
│   │       ├── session_switched(U7)→ 切换 SSE 到新 session_id
│   │       └── heartbeat   → 保活(15s)
│   ├── AnomalyPanel.svelte     (异常告警,红色面板)
│   │   └── ⚠ R-067 触发未授权变更 / ⚠ 延迟 > 500ms
│   └── PerfMetrics.svelte      (性能指标)
│       ├── 延迟 P50 / P99
│       ├── 吞吐 /s
│       └── 错误率
├── ReactorStateBar.svelte      (新增,Reactor 运行态栏,见三层架构 §3.2)
│   ├── phase(idle/draining/executing/awaiting_io/stable/error)
│   ├── causal_depth / current_step / pending_io_count
│   └── structural_invariant_violations(TCB 安全指标,> 0 变红)
├── InterventionBar.svelte      (副屏,操作按钮,需二次确认,见三层架构 §3.7)
│   ├── [⏸ 暂停] [▶ 重启] [⚙ 调参]   (P1,server 暂未实现 pause/resume)
│   ├── [📜 审计] (→ /view/audit)
│   ├── [⏪ 时间旅行] (→ /view/timetravel,内核 ttd v1.0 5 视图,见三层架构 §3.5)
│   ├── [↩ 回滚] (选 ruleset 版本,调 server 滚动 session 回滚,见三层架构 §3.4)
│   ├── [⛔ 中断] (POST interrupt,紧急止血,见三层架构 §3.7.1)
│   ├── [👣 单步] (GET step,单步调试,见三层架构 §3.7.1)
│   ├── [📸 快照] (GET snapshot,只读诊断)
│   ├── [🔍 不变量] (GET invariants,TCB 验证)
│   ├── [📥 导出审计] (GET audit/export,BLAKE3 链导出,合规卖点,见三层架构 §3.7.2)
│   ├── [📤 导入审计] (POST audit/import,审计员离线验证)
│   └── [🔄 热重载新规则] (→ 跳 L2 发布,或在 L1 触发 pending 发布)
└── SessionSwitchToast.svelte   (U7:收到 session_switched 时显示)
    └── "规则集已更新到 vN,已自动切换到新运行实例"
```

> **2026-08-06 干预操作补全**(对应三层架构 §3.6 / §3.7):InterventionBar 从原 7 按钮扩展到 13 按钮,新增中断/单步/快照/不变量/审计导出/审计导入。新增 ReactorStateBar 显示 Reactor 运行态(6 phase + invariants)。`awaiting_io` phase 时 ReactorStateBar 高亮提示 IO 等待(见三层架构 §3.6 io_request/io_response 机制)。

**SSE 订阅生命周期**(U7 服务端推送切换通知):

- 挂载时:`new EventSource('/api/sessions/{currentSessionId}/events')`
- 收到 `session_switched` 事件:关闭旧 EventSource → 更新 `productionStateStore.currentSessionId` → 新建 EventSource 订阅新 session_id → 显示 toast
- 收到 `fact` 事件:追加到 FactStream 虚拟列表
- 收到 `anomaly` 事件:追加到 AnomalyPanel
- 卸载时:关闭 EventSource

#### 5.4.2 WorkspaceConsole.svelte(L2 编辑台)

> 对应三层架构 §4 Workspace 层。P0 简化:单用户单 Workspace(无协作 / 无 review 流程)。

```
WorkspaceConsole.svelte
├── WorkspaceTopbar.svelte       (编辑台顶部)
│   ├── [当前 Workspace: 我的库](P0 单 WS,P1 多 WS 切换)
│   └── [🧪 启动沙盒测试] (→ L3 Sandbox,POST /api/sessions/from/{production_id})
├── StatsCards.svelte            (4 数据卡,编辑态)
│   ├── 规则数卡                (派生 $ruleCount — 来自内核 rules store,见 P0-1 §4.2)
│   ├── Draft 数卡              (调 server workspace API,P0 后端未实现,显示 "—")
│   ├── 已发布数卡              (productionStateStore 已发布规则数)
│   └── 待办数卡                (P0 后端无 todo API,显示 "—";P1 补)
├── WorkspaceMain.svelte         (左右两栏)
│   ├── BusinessRuleLibrary.svelte (规则编辑,P0-1 §6.2 包装内核 RuleLibraryView)
│   │   ├── 业务术语筛选 + 规则卡片
│   │   ├── BusinessForm(业务表单编辑)
│   │   └── DeveloperModeToggle(开发者模式:raw JSON)
│   └── QuickActions.svelte     (快捷入口)
│       ├── [加规则]            (→ /view/rules?action=add)
│       ├── [查问题]            (→ /view/audit?action=query)
│       ├── [改规则]            (→ /view/rules?action=edit)
│       ├── [审规则]            (→ /view/state?action=review)
│       ├── [看历史]            (→ /view/timetravel)
│       ├── [📚 模板市场]       (→ /view/templates,P1)
│       └── [📖 文档]           (外链)
└── PublishBar.svelte           (发布到 Production)
    ├── [提交发布] (Draft → Final → 滚动 session 热重载,见三层架构 §3.3)
    └── (P0 简化:单级发布,作者可直接发布;P1 三级权限 + Publish Queue)
```

---

## 6. Store 设计

### 6.1 sessionStore(登录态)

```typescript
// src/lib/stores/session.ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 用户登录态 store。
// 持久化:localStorage(key: evorule-console-cloud:session)
// 设计:
//   - 当前为 mock 实现(P0 阶段,认证由 evorule-server 提供)
//   - P1+ 接 evorule-server 真实认证后,API 不变,只改内部实现

import { writable } from "svelte/store";
import { browser } from "$app/environment";

export interface Session {
  loggedIn: boolean;
  userId: string | null;
  username: string | null;
  /** 登录时间戳(ms) */
  loginAt: number | null;
}

const STORAGE_KEY = "evorule-console-cloud:session";

const DEFAULT_SESSION: Session = {
  loggedIn: false,
  userId: null,
  username: null,
  loginAt: null,
};

function loadSession(): Session {
  if (!browser) return DEFAULT_SESSION;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SESSION;
    const parsed = JSON.parse(raw) as Partial<Session>;
    return {
      loggedIn: parsed.loggedIn === true,
      userId: typeof parsed.userId === "string" ? parsed.userId : null,
      username: typeof parsed.username === "string" ? parsed.username : null,
      loginAt: typeof parsed.loginAt === "number" ? parsed.loginAt : null,
    };
  } catch {
    return DEFAULT_SESSION;
  }
}

export const sessionStore = writable<Session>(loadSession());

sessionStore.subscribe((s) => {
  if (!browser) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
});

// === 便捷更新函数 ===

export function login(userId: string, username: string): void {
  sessionStore.set({
    loggedIn: true,
    userId,
    username,
    loginAt: Date.now(),
  });
}

export function logout(): void {
  sessionStore.set({ ...DEFAULT_SESSION });
}

export function isLoggedIn(): boolean {
  let v = false;
  const unsub = sessionStore.subscribe((s) => {
    v = s.loggedIn;
  });
  unsub();
  return v;
}
```

### 6.2 dbStore(库元数据)

```typescript
// src/lib/stores/db.ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 库元数据 store(2026-08-06 同步 P01 §4.2 — 派生计算替代持久化字段)。
// 设计:
//   - 只管"库元数据"(库名、业务对象、行业、创建时间)
//   - 不管规则(规则在内核 rules store,见 P0-1 §3.1 决策 1)
//   - 空库判断 = 内核 rules store 是否为空(派生计算,不在 dbStore)
// 持久化:localStorage(key: evorule-console-cloud:db-meta)

import { writable, derived, get } from "svelte/store";
import { browser } from "$app/environment";
import { rules } from "@evorule/console";

export type Industry = "blank" | "finance" | "compliance";

export interface DbMeta {
  /** 库 ID(P0 阶段固定 'default',P1+ 多库时扩展) */
  dbId: string;
  /** 库名(用户在向导里填) */
  dbName: string;
  /** 业务对象类型(病人/案件/订单/自定义...) */
  businessObjects: string[];
  /** 行业模板来源(blank / finance / compliance)— 2026-08-06 新增 */
  industry: Industry;
  /** 创建时间(ISO 字符串,null = 未初始化) */
  createdAt: string | null;
}

const DEFAULT_DB: DbMeta = {
  dbId: "default",
  dbName: "",
  businessObjects: [],
  industry: "blank",
  createdAt: null,
};

const STORAGE_KEY = "evorule-console-cloud:db-meta";

function loadDbMeta(): DbMeta {
  if (!browser) return DEFAULT_DB;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_DB;
    const parsed = JSON.parse(raw) as Partial<DbMeta>;
    return {
      dbId: typeof parsed.dbId === "string" ? parsed.dbId : "default",
      dbName: typeof parsed.dbName === "string" ? parsed.dbName : "",
      businessObjects: Array.isArray(parsed.businessObjects)
        ? parsed.businessObjects
        : [],
      industry:
        parsed.industry === "finance" ||
        parsed.industry === "compliance" ||
        parsed.industry === "blank"
          ? parsed.industry
          : "blank",
      createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : null,
    };
  } catch {
    return DEFAULT_DB;
  }
}

export const dbStore = writable<DbMeta>(loadDbMeta());

dbStore.subscribe((d) => {
  if (!browser) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(d));
});

// === 派生:空库判断(基于内核 rules store)— 2026-08-06 替代原 markAsNonEmpty ===

/** 是否空库(内核 rules store 为空) */
export const isEmptyDb = derived(rules, ($rules) => $rules.length === 0);

/** 当前规则数(派生,来自内核 rules store) */
export const ruleCount = derived(rules, ($rules) => $rules.length);

// === 便捷更新函数 ===

export function initDb(
  dbName: string,
  businessObjects: string[],
  industry: Industry,
): void {
  dbStore.set({
    dbId: "default",
    dbName,
    businessObjects,
    industry,
    createdAt: new Date().toISOString(),
  });
}

export function resetDb(): void {
  dbStore.set({ ...DEFAULT_DB });
}

/** 同步检查是否空库(非响应式,用于路由守卫) */
export function checkEmptyDb(): boolean {
  return get(rules).length === 0;
}

// === 已废弃(2026-08-06 移除,改用派生)===
// export function markAsNonEmpty(): void { ... }     // 改用内核 addRule() 自动触发派生
// export function setRuleCount(count: number): void { ... }  // 改用派生 ruleCount
// export function isEmpty(): boolean { ... }         // 改用派生 isEmptyDb / checkEmptyDb
```

> **2026-08-06 同步更新**(对应 P01 §13.2):
>
> - 移除 `ruleCount: number` 字段(改为派生 `ruleCount`)
> - 移除 `markAsNonEmpty()` / `setRuleCount()` / `isEmpty()` 函数
> - 新增 `industry: Industry` 字段(库元数据记录行业来源)
> - 新增派生 `isEmptyDb` / `ruleCount` store(基于内核 `rules` store)
> - 新增 `checkEmptyDb()` 同步函数(路由守卫用)
> - `createdAt` 改为 ISO 字符串(原为 `number | null`)

### 6.3 homeModeStore(demo toggle 状态)

```typescript
// src/lib/stores/home-mode.ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 首页模式 store。
// - 'auto':根据 sessionStore + dbStore 自动选 A/B/C
// - 'force-demo':强制 A(覆盖自动判断)
//
// 持久化:不持久化(刷新后回到 auto,符合"真实优先"原则)

import { writable } from "svelte/store";

export type HomeMode = "auto" | "force-demo";

export const homeModeStore = writable<HomeMode>("auto");

// === 便捷更新函数 ===

export function forceDemo(): void {
  homeModeStore.set("force-demo");
}

export function autoMode(): void {
  homeModeStore.set("auto");
}

export function toggleHomeMode(): void {
  homeModeStore.update((m) => (m === "auto" ? "force-demo" : "auto"));
}
```

### 6.4 demoDatasetStore(demo 数据集切换)

```typescript
// src/lib/stores/demo-dataset.ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// demo 模式数据集切换(医疗/财务)。
// 持久化:localStorage(key: evorule-console-cloud:demo-dataset)
// 默认:'medical'(业务直观,决策者秒懂)

import { writable } from "svelte/store";
import { browser } from "$app/environment";

export type DemoDataset = "medical" | "finance";

const STORAGE_KEY = "evorule-console-cloud:demo-dataset";
const DEFAULT_DATASET: DemoDataset = "medical";

function loadDataset(): DemoDataset {
  if (!browser) return DEFAULT_DATASET;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === "medical" || raw === "finance") return raw;
  return DEFAULT_DATASET;
}

export const demoDatasetStore = writable<DemoDataset>(loadDataset());

demoDatasetStore.subscribe((d) => {
  if (!browser) return;
  localStorage.setItem(STORAGE_KEY, d);
});

export function setDemoDataset(d: DemoDataset): void {
  demoDatasetStore.set(d);
}

export function toggleDemoDataset(): void {
  demoDatasetStore.update((d) => (d === "medical" ? "finance" : "medical"));
}
```

### 6.5 layerStore(层视图切换)— 2026-08-06 三层架构新增

```typescript
// src/lib/stores/layer.ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 层视图 store(状态 C 内部的 L1/L2 切换)。
// - 'L1':监控大屏(Production Runtime,消费 SSE)
// - 'L2':编辑台(Workspace,规则编辑 / 沙盒入口)
// - null:未初始化(HomeRouter 进入状态 C 时按 production 状态选默认层)
//
// 持久化:localStorage(key: evorule-console-cloud:layer)
//   刷新后保持上次所在层(符合"每天上班打开"的连续性)

import { writable } from "svelte/store";
import { browser } from "$app/environment";
import type { ProductionState } from "./production-state";

export type Layer = "L1" | "L2" | null;

const STORAGE_KEY = "evorule-console-cloud:layer";

function loadLayer(): Layer {
  if (!browser) return null;
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw === "L1" || raw === "L2" ? raw : null;
}

export const layerStore = writable<Layer>(loadLayer());

layerStore.subscribe((l) => {
  if (!browser || l === null) return;
  localStorage.setItem(STORAGE_KEY, l);
});

// === 便捷函数 ===

export function setLayer(l: "L1" | "L2"): void {
  layerStore.set(l);
}

/**
 * 按 production 状态选默认层。
 * - production 运行中(status='running' 且有已发布规则)→ L1 监控大屏
 * - 否则(刚建库,还没发布)→ L2 编辑台
 */
export function resolveDefaultLayer(ps: ProductionState | null): "L1" | "L2" {
  if (ps && ps.status === "running" && ps.rulesetVersion > 0) {
    return "L1";
  }
  return "L2";
}
```

### 6.6 productionStateStore(生产运行状态 + SSE 切换通知)— 2026-08-06 三层架构新增(U7)

```typescript
// src/lib/stores/production-state.ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 生产运行状态 store(L1 监控大屏的数据源)。
// 设计:
//   - 跟踪当前 production session_id(滚动 session 切换时原子更新)
//   - 跟踪 ruleset_version / ruleset_hash / status
//   - U7:SSE session_switched 事件触发 currentSessionId 切换 + 通知监听者
//
// 数据来源:evorule-server 应用层 production_state 表(单行,见三层架构 §6.8)
//   GET /api/production/state → ProductionState
//   SSE /api/sessions/{id}/events → session_switched 事件触发切换
//
// 持久化:不持久化(每次启动从 server 拉取最新状态)

import { writable } from "svelte/store";

export interface ProductionState {
  /** 当前生产 session 的 tcb session_id(SessionManager 返回) */
  currentSessionId: number | null;
  /** 当前规则集版本号(单调递增,0 = 未发布) */
  rulesetVersion: number;
  /** 当前规则集 BLAKE3 哈希 */
  rulesetHash: string | null;
  /** 运行状态:running(正常)/ switching(滚动 session 切换中)/ offline */
  status: "running" | "switching" | "offline";
  /** 最后更新时间(ISO 字符串) */
  updatedAt: string | null;
}

export const DEFAULT_PRODUCTION_STATE: ProductionState = {
  currentSessionId: null,
  rulesetVersion: 0,
  rulesetHash: null,
  status: "offline",
  updatedAt: null,
};

export const productionStateStore = writable<ProductionState>(
  DEFAULT_PRODUCTION_STATE,
);

// === SSE 切换通知回调链(U7) ===
// MonitorDashboard 订阅 SSE,收到 session_switched 时调用 onSessionSwitched
type SwitchHandler = (newSessionId: number, newVersion: number) => void;
let switchHandler: SwitchHandler | null = null;

export function setSessionSwitchHandler(handler: SwitchHandler): void {
  switchHandler = handler;
}

/**
 * U7:服务端推送切换通知处理。
 * 由 MonitorDashboard 的 SSE 监听器在收到 session_switched 事件时调用。
 *
 * 流程:
 *   1. 标记 status='switching'(大屏显示"切换中")
 *   2. 更新 currentSessionId + rulesetVersion(原子)
 *   3. 调用 switchHandler(由 MonitorDashboard 关闭旧 SSE → 开新 SSE)
 *   4. 标记 status='running'
 */
export function onSessionSwitched(
  newSessionId: number,
  newVersion: number,
): void {
  productionStateStore.update((s) => ({
    ...s,
    status: "switching",
  }));

  // 通知 MonitorDashboard 切换 SSE 订阅
  switchHandler?.(newSessionId, newVersion);

  productionStateStore.update((s) => ({
    ...s,
    currentSessionId: newSessionId,
    rulesetVersion: newVersion,
    status: "running",
    updatedAt: new Date().toISOString(),
  }));
}

// === 便捷函数 ===

export function setProductionState(ps: ProductionState): void {
  productionStateStore.set(ps);
}

/** 拉取最新 production 状态(应用启动 / 发布后调用) */
export async function refreshProductionState(
  fetcher: () => Promise<ProductionState>,
): Promise<void> {
  const ps = await fetcher();
  productionStateStore.set(ps);
}
```

> **U7 设计要点**(服务端推送切换通知,2026-08-06 拍板):
>
> 1. **为何不用客户端自动重连**:滚动 session 切换时,旧 session 被 `DELETE` 关闭。客户端 EventSource 自动重连会重连到已关闭的旧 session(返回 404),且无法得知新 session_id。唯一能传递 `new_session_id` 的方式是服务端在关闭旧 SSE 前主动推一条 `session_switched` 事件。
> 2. **事件契约**:SSE `session_switched` 事件 payload = `{ new_session_id: number, new_ruleset_version: number, ruleset_hash: string }`。服务端在旧 session 的 SSE 流上发送后,再关闭旧 session。
> 3. **客户端流程**:收到 `session_switched` → `onSessionSwitched()` → 关闭旧 EventSource → 更新 `productionStateStore` → 新建 EventSource 订阅 `/api/sessions/{new_session_id}/events` → 显示 toast。
> 4. **降级**:若客户端漏收 `session_switched`(网络抖动),EventSource 自动重连旧 session 会 404 → 触发 `refreshProductionState()` 从 server 拉最新 `currentSessionId` → 重订阅。这是兜底,非主路径。

---

## 7. 数据流

### 7.1 初始化数据流(应用启动)

```
+layout.svelte onMount
  │
  ├── 1. 主题恢复(localStorage)
  ├── 2. 视图恢复(restoreView)
  ├── 3. backend 健康检查(connected 状态)
  ├── 4. sessionStore 从 localStorage 恢复(已登录态)
  ├── 5. 内核 rules store 自动从 localStorage 恢复(已持久化 'evorule-console:rules:user')
  │    └── HomeRouter 订阅派生 isEmptyDb(基于内核 rules store)
  │        │
  │        └── isEmptyDb = true  → HomeRouter 选 B(向导)
  │        └── isEmptyDb = false → HomeRouter 选 C(工作台)
  ├── 6. layerStore 从 localStorage 恢复(上次所在层 L1/L2,2026-08-06 新增)
  └── 7. productionStateStore 从 server 拉取最新状态(2026-08-06 新增)
       └── GET /api/production/state → { currentSessionId, rulesetVersion, status, ... }
       └── 若 layerStore = null → resolveDefaultLayer(productionState)
           ├── production 运行中 → layerStore.set('L1') → MonitorDashboard 订阅 SSE
           └── 否则              → layerStore.set('L2') → WorkspaceConsole

注(2026-08-06 同步 P01 §13 + 三层架构):
  - 不再调 backend.getRuleCount() / setRuleCount()(P0 阶段后端无该 API)
  - 内核 rules store 已在内核层自动持久化 + 恢复,console-cloud 层无需重复同步
  - 派生 isEmptyDb 自动响应内核 rules store 变化
  - productionStateStore 不持久化(每次从 server 拉,保证滚动 session 切换后状态正确)
```

### 7.2 用户登录数据流

```
用户在 DemoHome 点[登录]
  │
  ├── 1. sessionStore.login(userId, username)
  │   └── localStorage 持久化
  ├── 2. 内核 rules store 已从 localStorage 恢复(无需异步拉取)
  ├── 3. 路由判断(基于派生 isEmptyDb)
  │   ├── isEmptyDb = true  → goto('/') → HomeRouter 选 B(向导)
  │   └── isEmptyDb = false → goto('/') → HomeRouter 选 C(工作台)
  └── 4. homeModeStore 保持 'auto'
```

### 7.3 建库向导完成数据流

```
OnboardingWizard StepComplete 点[跳到工作台]
  │
  ├── 1. (无操作 — 内核 addRule 已在 Step 3 触发)
  │   └── 内核 rules store 已更新 + localStorage 持久化
  │   └── 派生 isEmptyDb 自动变 false(因 rules store 非空)
  ├── 2. goto('/')
  └── 3. HomeRouter 订阅派生 isEmptyDb = false → 选 C(工作台)

注(2026-08-06 同步 P01 §13):
  - 不再调 dbStore.markAsNonEmpty()(已移除该函数)
  - 规则已在 Step 3 通过内核 addRule() 写入,派生 isEmptyDb 自动响应
  - 单一数据源:内核 rules store 是规则数的唯一权威
```

### 7.4 demo toggle 数据流

```
RealWorkbench WorkbenchTopbar 点[看 demo]
  │
  ├── 1. homeModeStore.set('force-demo')
  ├── 2. goto('/') 或 goto('/demo')
  └── 3. HomeRouter 检测 force-demo → 选 A(demo)

DemoHome 点[回工作台]
  │
  ├── 1. homeModeStore.set('auto')
  ├── 2. goto('/')
  └── 3. HomeRouter 检测 auto + 已登录 + 有库 → 选 C(工作台)
```

### 7.5 5 视图触发数据流(从工作台进入)

```
RealWorkbench WorkbenchTopbar 点[加规则]
  │
  ├── 1. setView('rules')           (现有 store,延续)
  ├── 2. goto('/view/rules?action=add')
  └── 3. ViewRenderer 检测 $currentView === 'rules' → 渲染 RuleLibraryView
       └── (现有内核组件,不变)
```

### 7.6 SSE 切换通知数据流(U7,2026-08-06 三层架构新增)

```
[服务端] 滚动 session 热重载发布新规则(三层架构 §3.3)
  │
  ├── 1. POST /api/rules/reload → core_eval 更新
  ├── 2. POST /api/sessions/from/{old_id} → fork 新 production session
  ├── 3. 切换 production_state.current_session_id
  ├── 4. 在旧 session 的 SSE 流推送 session_switched 事件
  │      payload: { new_session_id, new_ruleset_version, ruleset_hash }
  └── 5. 旧 session drain 后 DELETE

[客户端] MonitorDashboard SSE 监听器收到 session_switched
  │
  ├── 1. onSessionSwitched(new_session_id, new_version)
  │   ├── productionStateStore.status = 'switching'(大屏显示"切换中")
  │   ├── switchHandler(newSessionId, newVersion)
  │   │   ├── 关闭旧 EventSource
  │   │   └── new EventSource('/api/sessions/{new_session_id}/events')
  │   ├── productionStateStore 更新(currentSessionId + rulesetVersion + status='running')
  │   └── 显示 SessionSwitchToast("规则集已更新到 vN")
  │
  └── 2. 新 SSE 流开始推送新 session 的 Fact / anomaly 事件

[降级] 客户端漏收 session_switched(网络抖动)
  │
  ├── 旧 EventSource 自动重连 → 404(旧 session 已 DELETE)
  ├── 触发 refreshProductionState() → GET /api/production/state
  └── 拿到最新 currentSessionId → 重订阅新 SSE
  (兜底机制,非主路径)
```

### 7.7 层切换数据流(L1 ↔ L2,2026-08-06 三层架构新增)

```
[L2 → L1] 用户在 WorkspaceConsole 点顶部[🖥 运行时]
  │
  ├── 1. layerStore.set('L1')
  ├── 2. RealWorkbench 检测 layer='L1' → 渲染 MonitorDashboard
  └── 3. MonitorDashboard onMount:
       ├── 读 productionStateStore.currentSessionId
       ├── new EventSource('/api/sessions/{id}/events')
       └── setSessionSwitchHandler(切换回调,见 §6.6)

[L1 → L2] 用户在 MonitorDashboard 点顶部[✏ 编辑台]
  │
  ├── 1. layerStore.set('L2')
  ├── 2. RealWorkbench 检测 layer='L2' → 渲染 WorkspaceConsole
  └── 3. (可选)MonitorDashboard 的 SSE 后台保持订阅
       └── 收到 session_switched 仍更新 productionStateStore(切回 L1 时状态正确)

[L2 → L1 自动] 首次发布规则成功
  │
  ├── 1. PublishBar 点[提交发布]
  │   ├── Draft → Final → POST /api/production/publish(滚动 session 热重载)
  │   └── refreshProductionState() → rulesetVersion > 0, status='running'
  ├── 2. resolveDefaultLayer(productionState) = 'L1'
  └── 3. layerStore.set('L1') → 自动跳监控大屏
```

---

## 8. 关键代码示例

### 8.1 RealWorkbench(层感知工作台)+ MonitorDashboard SSE 订阅

> **2026-08-06 三层架构同步**:RealWorkbench 从"任务中心"改为**层感知壳**,按 `layerStore` 渲染 L1 监控大屏(消费 SSE)或 L2 编辑台。

```svelte
<!-- src/lib/views/Home/RealWorkbench.svelte -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:状态 C 层感知工作台(壳)
    - 顶部层 toggle(L1 运行时 ↔ L2 编辑台)+ demo toggle
    - 按 layerStore 渲染 MonitorDashboard(L1)或 WorkspaceConsole(L2)

  与内核边界:
    - 不感知 5 视图(通过 setView + goto 触发,内核组件不变)
    - L1 消费 evorule-server SSE(不经过内核 store)
    - L2 规则编辑复用内核 rules store(见 P0-1 §6.2)
-->

<script lang="ts">
  import { goto } from '$app/navigation';
  import { layerStore, setLayer } from '$lib/stores/layer';
  import { productionStateStore } from '$lib/stores/production-state';
  import { forceDemo } from '$lib/stores/home-mode';
  import WorkbenchTopbar from './WorkbenchTopbar.svelte';
  import MonitorDashboard from './Monitor/MonitorDashboard.svelte';
  import WorkspaceConsole from './Workspace/WorkspaceConsole.svelte';

  let { layer = $bindable($layerStore) } = $props<{ layer: 'L1' | 'L2' | null }>();

  function handleLayerToggle(target: 'L1' | 'L2'): void {
    setLayer(target);
  }

  function handleDemoToggle(): void {
    forceDemo();
    goto('/demo');
  }
</script>

<div class="workbench" data-testid="real-workbench">
  <WorkbenchTopbar
    layer={layer ?? 'L2'}
    rulesetVersion={$productionStateStore.rulesetVersion}
    onLayerToggle={handleLayerToggle}
    onDemoToggle={handleDemoToggle}
  />

  <main class="workbench-main">
    {#if layer === 'L1'}
      <MonitorDashboard />
    {:else}
      <WorkspaceConsole />
    {/if}
  </main>
</div>

<style>
  .workbench { min-height: 100vh; display: flex; flex-direction: column; }
  .workbench-main { flex: 1; display: flex; flex-direction: column; }
</style>
```

```svelte
<!-- src/lib/views/Home/Monitor/MonitorDashboard.svelte -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:L1 监控大屏(消费 SSE 实时 Fact 流)
    - 订阅 GET /api/sessions/{currentSessionId}/events(SSE,evorule-server 已就绪)
    - U7:收到 session_switched 事件 → 切换 SSE 到新 session_id
    - 虚拟列表渲染 Fact 流(1000+/秒不卡)

  对应三层架构 §3.2 监控大屏设计 + §3.3 滚动 session 热重载
-->

<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import {
    productionStateStore,
    setSessionSwitchHandler,
    onSessionSwitched,
    refreshProductionState,
  } from '$lib/stores/production-state';
  import { backend } from '$lib/backend/cloud-http-backend';
  import RuntimeStatusbar from './RuntimeStatusbar.svelte';
  import FactStream from './FactStream.svelte';
  import AnomalyPanel from './AnomalyPanel.svelte';
  import PerfMetrics from './PerfMetrics.svelte';
  import InterventionBar from './InterventionBar.svelte';
  import SessionSwitchToast from './SessionSwitchToast.svelte';

  let eventSource: EventSource | null = null;
  let facts = $state<Array<{ id: string; ts: string; text: string }>>([]);
  let anomalies = $state<Array<{ id: string; ts: string; text: string }>>([]);
  let switchToast = $state<string | null>(null);

  // U7:订阅 SSE
  function subscribe(sessionId: number): void {
    eventSource?.close();
    eventSource = new EventSource(`/api/sessions/${sessionId}/events`);

    eventSource.addEventListener('fact', (e) => {
      const data = JSON.parse((e as MessageEvent).data);
      facts = [...facts.slice(-999), data]; // 保留最近 1000 条
    });

    eventSource.addEventListener('anomaly', (e) => {
      const data = JSON.parse((e as MessageEvent).data);
      anomalies = [...anomalies, data];
    });

    // U7:服务端推送切换通知
    eventSource.addEventListener('session_switched', (e) => {
      const { new_session_id, new_ruleset_version } = JSON.parse(
        (e as MessageEvent).data,
      );
      onSessionSwitched(new_session_id, new_ruleset_version);
      switchToast = `规则集已更新到 v${new_ruleset_version},已自动切换到新运行实例`;
    });

    // 降级:旧 session 已关闭,重连 404 → 拉最新状态重订阅
    eventSource.onerror = () => {
      eventSource?.close();
      refreshProductionState(() => backend.getProductionState());
      // productionStateStore 更新后 $effect 会重订阅(见下方)
    };
  }

  // 注册切换回调(productionStateStore 调用)
  setSessionSwitchHandler((newSessionId) => {
    subscribe(newSessionId);
  });

  // productionStateStore.currentSessionId 变化时重订阅(初始化 + 切换 + 降级)
  $effect(() => {
    const sid = $productionStateStore.currentSessionId;
    if (sid !== null) subscribe(sid);
  });

  onMount(() => {
    // 拉取最新 production 状态(若还没拉)
    refreshProductionState(() => backend.getProductionState());
  });

  onDestroy(() => eventSource?.close());
</script>

<div class="monitor-dashboard" data-testid="monitor-dashboard">
  <RuntimeStatusbar
    status={$productionStateStore.status}
    rulesetVersion={$productionStateStore.rulesetVersion}
    sessionId={$productionStateStore.currentSessionId}
  />

  <div class="dashboard-main">
    <FactStream {facts} />
    <AnomalyPanel {anomalies} />
    <PerfMetrics />
  </div>

  <InterventionBar />

  {#if switchToast}
    <SessionSwitchToast message={switchToast} onDismiss={() => (switchToast = null)} />
  {/if}
</div>
```

### 8.2 OnboardingWizard 5 步状态机

```svelte
<!-- src/lib/views/Home/OnboardingWizard.svelte -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:状态 B 建库向导
    - 5 步引导,对应功能流 1-5 步
    - 步骤 1:选起点(空白库 / 财务 / 合规)
    - 步骤 2:命名 + 业务对象
    - 步骤 3:加第一条规则(业务表单 / LLM 辅助)
    - 步骤 4:试运行一条业务事件
    - 步骤 5:完成 → 跳到工作台
-->

<script lang="ts">
  import { goto } from '$app/navigation';
  import { initDb, type Industry } from '$lib/stores/db';
  import WizardStepper from './Wizard/Stepper.svelte';
  import StepTemplatePicker from './Wizard/StepTemplatePicker.svelte';
  import StepDbConfig from './Wizard/StepDbConfig.svelte';
  import StepFirstRule from './Wizard/StepFirstRule.svelte';
  import StepTrialRun from './Wizard/StepTrialRun.svelte';
  import StepComplete from './Wizard/StepComplete.svelte';

  type Step = 1 | 2 | 3 | 4 | 5;
  let currentStep = $state<Step>(1);

  // 各步骤累积状态
  let templateChoice = $state<'blank' | 'finance' | 'compliance' | null>(null);
  let dbName = $state('');
  let businessObjects = $state<string[]>([]);
  let firstRule = $state<object | null>(null);

  function next(): void {
    if (currentStep < 5) {
      currentStep = (currentStep + 1) as Step;
    }
  }

  function prev(): void {
    if (currentStep > 1) {
      currentStep = (currentStep - 1) as Step;
    }
  }

  function handleDbConfig(name: string, objects: string[], industry: Industry): void {
    dbName = name;
    businessObjects = objects;
    initDb(name, objects, industry);
    next();
  }

  function handleFirstRuleCreated(rule: object): void {
    firstRule = rule;
    // 注:不再调 markAsNonEmpty()(已移除)。
    // 内核 addRule() 已在 StepFirstRule 内触发,派生 isEmptyDb 自动变 false。
    next();
  }

  async function handleComplete(): Promise<void> {
    await goto('/');
  }
</script>

<div class="onboarding">
  <WizardStepper current={currentStep} />

  <main class="onboarding-main">
    {#if currentStep === 1}
      <StepTemplatePicker onPick={(t) => { templateChoice = t; next(); }} />
    {:else if currentStep === 2}
      <StepDbConfig
        template={templateChoice}
        onConfirm={handleDbConfig}
        onBack={prev}
      />
    {:else if currentStep === 3}
      <StepFirstRule
        template={templateChoice}
        businessObjects={businessObjects}
        onCreated={handleFirstRuleCreated}
        onBack={prev}
      />
    {:else if currentStep === 4}
      <StepTrialRun
        rule={firstRule}
        onConfirm={next}
        onBack={prev}
      />
    {:else}
      <StepComplete dbName={dbName} onComplete={handleComplete} />
    {/if}
  </main>
</div>
```

### 8.3 DemoHome 医疗/财务数据集切换

```svelte
<!-- src/lib/views/Home/DemoHome.svelte -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:状态 A demo 模式
    - 顶部 banner 标"这是 demo"
    - 数据集切换(医疗/财务两套预填数据)
    - 4 数据卡(预填数据)
    - 3 引导任务 + 6 能力特性(左右两栏)
    - 底部 CTA

  预填数据来源:src/lib/data/demo-medical.ts / demo-finance.ts
-->

<script lang="ts">
  import { goto } from '$app/navigation';
  import { demoDatasetStore, setDemoDataset } from '$lib/stores/demo-dataset';
  import { homeModeStore } from '$lib/stores/home-mode';
  import { medicalData } from '$lib/data/demo-medical';
  import { financeData } from '$lib/data/demo-finance';
  import DemoBanner from './Demo/DemoBanner.svelte';
  import DemoDatasetSwitcher from './Demo/DemoDatasetSwitcher.svelte';
  import StatsCards from './StatsCards.svelte';
  import GuidedTasks from './Demo/GuidedTasks.svelte';
  import CapabilityList from './Demo/CapabilityList.svelte';
  import CtaFooter from './Demo/CtaFooter.svelte';

  // 根据当前数据集选预填数据
  const dataset = $derived($demoDatasetStore === 'medical' ? medicalData : financeData);

  function handleSwitchDataset(d: 'medical' | 'finance'): void {
    setDemoDataset(d);
  }

  function handleGuidedTask(task: 'add' | 'query' | 'edit'): void {
    // demo 模式下进入视图,数据是预填的(只读模式)
    const urlMap = {
      add: '/view/rules?demo=true&action=add',
      query: '/view/audit?demo=true&action=query',
      edit: '/view/rules?demo=true&action=edit'
    };
    goto(urlMap[task]);
  }

  function handleRegister(): void {
    goto('/register'); // P1 实现认证后落地
  }

  function handleLogin(): void {
    // mock 登录(P0 阶段)
    // P1+ 接 evorule-server 真实认证
    goto('/login');
  }
</script>

<div class="demo-home">
  <DemoBanner onRegister={handleRegister} />

  <DemoDatasetSwitcher
    current={$demoDatasetStore}
    onSwitch={handleSwitchDataset}
  />

  <StatsCards stats={dataset.stats} demo={true} />

  <div class="demo-grid">
    <GuidedTasks onTaskClick={handleGuidedTask} />
    <CapabilityList />
  </div>

  <CtaFooter onRegister={handleRegister} onLogin={handleLogin} />
</div>
```

### 8.4 预填数据示例(医疗)

```typescript
// src/lib/data/demo-medical.ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 医疗场景预填数据。
// 用于 DemoHome 状态 A,展示"医疗行业真实场景"。
// 决策者看到这个数据能秒懂"加规则 / 查问题"任务。

export interface DemoData {
  stats: {
    rules: number;
    executions: number;
    anomalies: number;
    todos: number;
  };
  todos: Array<{
    id: string;
    type: "review" | "approve" | "anomaly" | "modified";
    title: string;
    createdAt: number; // 相对当前时间的偏移(ms 前)
  }>;
  activities: Array<{
    user: string;
    action: string;
    target: string;
    createdAt: number;
  }>;
}

export const medicalData: DemoData = {
  stats: {
    rules: 127,
    executions: 1432,
    anomalies: 3,
    todos: 8,
  },
  todos: [
    {
      id: "R-042",
      type: "review",
      title: "财务规则 R-042 待审核",
      createdAt: 2 * 60 * 60 * 1000, // 2h 前
    },
    {
      id: "P-1283",
      type: "anomaly",
      title: "病人 P-1283 异常未处理",
      createdAt: 1 * 60 * 60 * 1000, // 1h 前
    },
    {
      id: "R-018",
      type: "modified",
      title: "我改的 R-018 已通过",
      createdAt: 24 * 60 * 60 * 1000, // 昨天
    },
  ],
  activities: [
    {
      user: "张医生",
      action: "修改了",
      target: '"65岁以上发烧CT" 规则',
      createdAt: 2 * 60 * 60 * 1000,
    },
    {
      user: "李律师",
      action: "查询了",
      target: "案件 #C-2024-0183",
      createdAt: 3 * 60 * 60 * 1000,
    },
    {
      user: "王财务",
      action: "加了",
      target: '"新报销上限" 规则',
      createdAt: 24 * 60 * 60 * 1000,
    },
  ],
};
```

---

## 9. 测试策略

### 9.1 单元测试(Vitest)

#### 9.1.1 Store 测试

```typescript
// src/lib/stores/session.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { sessionStore, login, logout, isLoggedIn } from "./session";

describe("sessionStore", () => {
  beforeEach(() => {
    logout();
  });

  it("初始状态:未登录", () => {
    expect(isLoggedIn()).toBe(false);
  });

  it("login 后:已登录", () => {
    login("u-001", "张医生");
    expect(isLoggedIn()).toBe(true);
  });

  it("logout 后:未登录", () => {
    login("u-001", "张医生");
    logout();
    expect(isLoggedIn()).toBe(false);
  });
});
```

#### 9.1.2 HomeRouter 状态机测试

```typescript
// src/lib/views/Home/HomeRouter.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { get } from "svelte/store";
import { sessionStore, login, logout } from "$lib/stores/session";
import { isEmptyDb } from "$lib/stores/db";
import { rules, addRule, deleteRule } from "@evorule/console";
import { homeModeStore, forceDemo, autoMode } from "$lib/stores/home-mode";

// 复刻 HomeRouter 的决策逻辑(用于纯逻辑测试)
function resolveMode(): "A" | "B" | "C" {
  const session = get(sessionStore);
  if (!session.loggedIn) return "A";
  if (get(isEmptyDb)) return "B"; // 派生:内核 rules store 是否为空
  return "C";
}

// 辅助:清空 user 规则(派生 isEmptyDb 依赖内核 rules store)
function clearUserRules(): void {
  const current = get(rules).filter((r) => r.source === "user");
  for (const r of current) deleteRule(r.id);
}

// 辅助:加一条 user 规则(让派生 isEmptyDb = false)
function addTestRule(): void {
  addRule({
    id: `user.test.${Date.now()}`,
    version: 1,
    description: "测试规则",
    content: "{}",
  });
}

describe("HomeRouter 状态机", () => {
  beforeEach(() => {
    logout();
    clearUserRules();
    autoMode();
  });

  it("未登录 → A(demo)", () => {
    expect(resolveMode()).toBe("A");
  });

  it("已登录 + 空库 → B(向导)", () => {
    login("u-001", "张医生");
    clearUserRules();
    expect(resolveMode()).toBe("B");
  });

  it("已登录 + 有库 → C(工作台)", () => {
    login("u-001", "张医生");
    addTestRule();
    expect(resolveMode()).toBe("C");
  });

  it("force-demo 模式覆盖所有判断 → A", () => {
    login("u-001", "张医生");
    addTestRule();
    forceDemo();
    expect(resolveMode()).toBe("A"); // 因 force-demo 优先
  });
});
```

#### 9.1.3 demoDatasetStore 测试

```typescript
// src/lib/stores/demo-dataset.test.ts
import { describe, it, expect } from "vitest";
import {
  demoDatasetStore,
  setDemoDataset,
  toggleDemoDataset,
} from "./demo-dataset";

describe("demoDatasetStore", () => {
  it("默认 medical", () => {
    expect(get(demoDatasetStore)).toBe("medical");
  });

  it("setDemoDataset(finance) → finance", () => {
    setDemoDataset("finance");
    expect(get(demoDatasetStore)).toBe("finance");
  });

  it("toggle 切换", () => {
    setDemoDataset("medical");
    toggleDemoDataset();
    expect(get(demoDatasetStore)).toBe("finance");
    toggleDemoDataset();
    expect(get(demoDatasetStore)).toBe("medical");
  });
});
```

### 9.2 E2E 测试(Playwright)

```typescript
// tests/home.spec.ts
import { test, expect } from "@playwright/test";

test.describe("首页状态感知", () => {
  test("未登录访客看到 demo 模式", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('[data-testid="demo-banner"]')).toBeVisible();
    await expect(
      page.locator('[data-testid="demo-dataset-switcher"]'),
    ).toBeVisible();
  });

  test("demo 模式可切换医疗/财务数据集", async ({ page }) => {
    await page.goto("/");
    await page.click('[data-testid="dataset-finance"]');
    await expect(
      page.locator('[data-testid="stats-card-rules"]'),
    ).toContainText("89"); // 财务场景规则数
  });

  test("已登录空库 → 建库向导", async ({ page }) => {
    // mock 登录 + 空库
    await page.goto("/");
    await page.click('[data-testid="login-mock"]');
    await expect(page.locator('[data-testid="wizard-stepper"]')).toBeVisible();
    await expect(page.locator('[data-testid="step-1"]')).toBeVisible();
  });

  test("建库向导 5 步完整跑通", async ({ page }) => {
    // mock 登录 + 空库
    await page.goto("/");
    await page.click('[data-testid="login-mock"]');

    // Step 1:选空白库
    await page.click('[data-testid="template-blank"]');
    await page.click('[data-testid="next"]');

    // Step 2:命名 + 业务对象
    await page.fill('[data-testid="db-name"]', "我的第一个 evorule 库");
    await page.click('[data-testid="obj-patient"]');
    await page.click('[data-testid="next"]');

    // Step 3:加第一条规则(用 LLM 辅助)
    await page.fill('[data-testid="llm-input"]', "65 岁以上发烧必须先 CT");
    await page.click('[data-testid="generate-rule"]');
    await page.click('[data-testid="next"]');

    // Step 4:试运行
    await page.click('[data-testid="next"]');

    // Step 5:完成 → 跳工作台
    await page.click('[data-testid="complete"]');
    await expect(page.locator('[data-testid="real-workbench"]')).toBeVisible();
  });

  test("工作台 → demo toggle → demo 模式 → 回工作台", async ({ page }) => {
    // mock 登录 + 有库
    await page.goto("/");
    await page.click('[data-testid="login-mock-with-db"]');

    // 工作台 → demo
    await page.click('[data-testid="demo-toggle"]');
    await expect(page.locator('[data-testid="demo-banner"]')).toBeVisible();

    // demo → 工作台
    await page.click('[data-testid="back-to-workbench"]');
    await expect(page.locator('[data-testid="real-workbench"]')).toBeVisible();
  });
});
```

### 9.3 测试覆盖率目标

| 模块                                    | 单元测试 | E2E 测试 | 覆盖率目标               |
| --------------------------------------- | -------- | -------- | ------------------------ |
| Stores(session/db/homeMode/demoDataset) | ✅ 必做  | —        | ≥ 90%                    |
| HomeRouter 状态机                       | ✅ 必做  | —        | 100%(分支)               |
| DemoHome                                | —        | ✅ 必做  | 关键路径覆盖             |
| OnboardingWizard                        | —        | ✅ 必做  | 5 步完整路径             |
| RealWorkbench                           | —        | ✅ 必做  | 任务流触发 + demo toggle |
| 路由守卫(+layout.ts)                    | —        | ✅ 必做  | 未登录/空库访问受限路由  |

---

## 10. 备选方案实现差异

### 10.1 备选方案 A:双首页(独立 URL)

战略文档 §5.8.7 描述的备选方案,实现差异:

| 方面      | 主方案(状态感知)           | 备选方案 A(双首页)                                     |
| --------- | -------------------------- | ------------------------------------------------------ |
| 路由      | `/` 状态感知选 A/B/C       | `/` = 真实工作台(未登录跳 `/demo`)                     |
| demo 入口 | `/demo` 强制 + 顶部 toggle | `/demo` 独立营销页                                     |
| 组件      | `HomeRouter.svelte` 决策   | `WorkbenchPage.svelte` + `DemoPage.svelte` 独立        |
| 状态机    | A/B/C 三状态               | 工作台单一状态(已登录)/ demo 单一状态(访客)            |
| 守卫      | 复杂(根据状态选)           | 简单(未登录 → 跳 demo)                                 |
| 切换成本  | —                          | 把 `HomeRouter` 拆成两个独立 `+page.svelte`,删除状态机 |

**何时切换**:见战略文档 §5.8.7。

### 10.2 备选方案 B:三角色首页

战略文档 §5.8.8 描述的备选方案,实现差异:

| 方面     | 主方案                      | 备选方案 B(三角色)                                |
| -------- | --------------------------- | ------------------------------------------------- |
| 路由     | `/` 状态感知                | `/`(开发者) / `/decision`(决策者) / `/work`(C 端) |
| 角色判断 | session.loggedIn + db.empty | session.role(developer/decision-maker/end-user)   |
| 首页数   | 1 个 HomeRouter             | 3 个独立首页组件                                  |
| 切换成本 | —                           | 新增角色字段 + 3 个首页组件 + 路由表扩展          |

**何时切换**:见战略文档 §5.8.8。

---

## 11. 长期演进路径(SaaS 切入点)

战略文档 §5.8.10 的 SaaS 长期演进在本设计的落地:

### 11.1 MVP 阶段(P0-P1)

- **路由**:`/` + `/demo` + `/onboarding` + `/view/[id]`
- **认证**:mock sessionStore(localStorage)
- **库**:单租户单库(`dbId: 'default'`)
- **数据源**:本地 backend(CloudHttpBackend offline 模式)

### 11.2 试用阶段(P2-P3)

- **路由**:不变
- **认证**:接 evorule-server 真实认证(sessionStore API 不变,改内部实现)
- **库**:单租户多库(dbStore 加 `dbList: DbMeta[]` + `currentDbId: string`)
- **数据源**:远程 backend(online 模式)
- **首页变化**:RealWorkbench 顶部加"库切换"下拉

### 11.3 SaaS 阶段(P4+ 长期)

- **路由**:加 `/register` / `/billing` / `/admin`
- **认证**:多租户认证 + JWT
- **库**:多租户(`tenantId` 字段,dbStore 加 tenant 隔离)
- **数据源**:多租户 backend
- **首页变化**:
  - 未登录访客 → demo 模式(同 MVP)
  - 已登录 C 端用户 → 真实工作台(同 MVP,但数据多租户隔离)
  - 已登录租户管理员 → 加 `/admin` 路由
- **触发条件**:P3 试用验证 H7 假设(战略文档 §21)成立

### 11.4 兼容性保证

本设计的 Store 接口(sessionStore / dbStore / homeModeStore)在 MVP → 试用 → SaaS 三阶段保持不变,内部实现可替换。这保证:

- P0 阶段写的组件代码,P1/P2/P3 阶段不需要重写
- 只需扩展 Store 字段(如 dbStore 加 `dbList`),不破坏现有 API
- SaaS 阶段加多租户字段,不影响 MVP 阶段组件

---

## 12. 与现有代码的迁移路径

### 12.1 现有代码改动清单

| 文件                                 | 改动类型 | 说明                                                                   |
| ------------------------------------ | -------- | ---------------------------------------------------------------------- |
| `src/routes/+page.svelte`            | 改       | 从"5 视图渲染器"改为"渲染 HomeRouter"                                  |
| `src/routes/+layout.svelte`          | 微改     | 顶部导航调整为"工作台模式才显示 5 视图 tab"                            |
| `src/routes/+layout.ts`              | 新增     | 路由守卫                                                               |
| `src/routes/demo/+page.svelte`       | 新增     | 强制 demo 入口                                                         |
| `src/routes/onboarding/+page.svelte` | 新增     | 强制向导入口                                                           |
| `src/routes/view/[id]/+page.svelte`  | 新增     | 5 视图入口(4 视图工作台功能页 + 时间旅行 L1 一等公民,沿用现有渲染逻辑) |
| `src/lib/views/Home/*`               | 新增     | 本设计文档 §5 的所有组件                                               |
| `src/lib/stores/session.ts`          | 新增     | §6.1                                                                   |
| `src/lib/stores/db.ts`               | 新增     | §6.2                                                                   |
| `src/lib/stores/home-mode.ts`        | 新增     | §6.3                                                                   |
| `src/lib/stores/demo-dataset.ts`     | 新增     | §6.4                                                                   |
| `src/lib/stores/layer.ts`            | 新增     | §6.5(三层架构:L1/L2 层切换)                                            |
| `src/lib/stores/production-state.ts` | 新增     | §6.6(三层架构 + U7:生产状态 + SSE 切换通知)                            |
| `src/lib/data/demo-medical.ts`       | 新增     | §8.4                                                                   |
| `src/lib/data/demo-finance.ts`       | 新增     | 同 §8.4 风格,财务数据                                                  |
| `src/routes/runtime/+page.svelte`    | 新增     | §4.1(L1 监控大屏强制入口)                                              |
| `src/routes/workspace/+page.svelte`  | 新增     | §4.1(L2 编辑台强制入口)                                                |

### 12.2 迁移步骤(建议顺序)

1. **第 1 步:新增 Store**(不破坏现有代码)
   - `session.ts` / `db.ts` / `home-mode.ts` / `demo-dataset.ts`
   - 单元测试覆盖

2. **第 2 步:新增 Home 组件**(不破坏现有代码)
   - `HomeRouter.svelte` + `DemoHome.svelte` + `OnboardingWizard.svelte` + `RealWorkbench.svelte`
   - 子组件 + 预填数据
   - E2E 测试覆盖

3. **第 3 步:迁移 `+page.svelte`**(破坏性改动,但可灰度)
   - 老 5 视图渲染逻辑移到 `/view/[id]/+page.svelte`
   - 新 `+page.svelte` 渲染 `HomeRouter`
   - 测试 5 视图仍可访问

4. **第 4 步:加路由守卫**
   - `+layout.ts` 守卫逻辑
   - 测试未登录/空库访问受限路由

5. **第 5 步:新增 demo / onboarding 独立路由**
   - `demo/+page.svelte` / `onboarding/+page.svelte`
   - 测试独立 URL 可访问

6. **第 6 步:微调 `+layout.svelte` 顶部导航**
   - 工作台模式显示 5 视图 tab + 任务流入口
   - demo 模式只显示 demo toggle + 注册/登录
   - 向导模式只显示步骤进度

### 12.3 灰度策略

P0 阶段实施时,可以分阶段灰度:

- **第 1-2 步**(新增 Store + Home 组件)— 不影响现有代码,可独立合并
- **第 3-6 步**(迁移 +page.svelte + 路由守卫 + 独立路由)— 一次性合并,需要完整测试

---

## 13. 待办

### 13.1 立即可做(P0-0b 实施前)

- [ ] 4 个 Store 详细实现 + 单元测试(§6)
- [ ] 预填数据 medical + finance 详细化(§8.4 风格,扩到完整 demo 数据集)
- [ ] HomeRouter.svelte 详细实现 + 状态机单元测试(§3 + §8.2)
- [ ] DemoHome.svelte 详细实现 + 子组件(§5.2)
- [ ] OnboardingWizard.svelte 5 步详细实现 + 子组件(§5.3)
- [ ] RealWorkbench.svelte 详细实现 + 子组件(§5.4)

### 13.2 P0-0b 实施时

- [ ] 路由守卫 +layout.ts 实现(§4.3)
- [ ] 5 视图迁移到 /view/[id](§12.2 第 3 步)
- [ ] +layout.svelte 顶部导航微调(§12.2 第 6 步)
- [ ] E2E 测试 5 个关键路径(§9.2)

### 13.3 后端接口契约(与 evorule-server 协调)

L1 监控大屏 + L2 编辑台调用的 backend 接口(P0 阶段需要 evorule-server 提供):

```typescript
// 需要后端提供的接口(伪代码,具体契约由 evorule-server 定义)
interface Backend {
  // === L1 监控大屏(2026-08-06 三层架构新增)===
  /** 拉取当前生产状态(production_state 单行表,见三层架构 §6.8) */
  getProductionState(): Promise<{
    currentSessionId: number | null;
    rulesetVersion: number;
    rulesetHash: string | null;
    status: "running" | "switching" | "offline";
    updatedAt: string | null;
  }>;
  /**
   * SSE 事件流(evorule-server 已就绪)。
   * GET /api/sessions/{id}/events
   * 事件类型:fact / anomaly / session_switched(U7)/ heartbeat
   * 监控大屏直接用 EventSource 订阅,不走 backend 方法
   */

  // === L1 干预操作(需二次确认,见 §5.4.1 InterventionBar + 三层架构 §3.7)===
  rollbackRuleset(targetVersion: number): Promise<void>; // 滚动 session 回滚(写操作,见三层架构 §3.4)
  pauseRuntime(): Promise<void>; // P1(server 暂未实现)
  resumeRuntime(): Promise<void>; // P1(server 暂未实现)
  /** 中断会话(紧急止血,POST /api/sessions/{id}/interrupt) */
  interruptSession(id: number): Promise<void>;
  /** 单步执行(调试,GET /api/sessions/{id}/step) */
  stepSession(id: number): Promise<unknown>;
  /** 快照(GET /api/sessions/{id}/snapshot,只读诊断) */
  snapshotSession(id: number): Promise<unknown>;
  /** 结构不变量验证(GET /api/sessions/{id}/invariants,TCB 安全指标) */
  getInvariants(id: number): Promise<{ violations: number }>;
  /** IO 响应回调(POST /api/sessions/{id}/io_response,解除 awaiting_io,见三层架构 §3.6) */
  submitIoResponse(id: number, response: unknown): Promise<void>;

  // === L1 审计导出/导入(合规卖点,见三层架构 §3.7.2)===
  /** 导出 BLAKE3 审计链(GET /api/sessions/{id}/audit/export) */
  exportAudit(id: number): Promise<unknown>;
  /** 导入审计链(POST /api/sessions/{id}/audit/import,审计员离线验证) */
  importAudit(id: number, data: unknown): Promise<void>;
  /** 导出审计链压缩版(GET .../audit/export/compressed) */
  exportAuditCompressed(id: number): Promise<Blob>;
  /** 导入审计链压缩版(POST .../audit/import/compressed) */
  importAuditCompressed(id: number, data: Blob): Promise<void>;
  /** 自动验证开关 + 触发(GET/POST .../audit/auto_verify) */
  setAutoVerify(id: number, enabled: boolean): Promise<void>;

  // === L1 时间旅行(只读历史回溯,见三层架构 §3.5)===
  // 内核 @evorule/console 已嵌入 ttd v1.0,以下方法 cloud-http-backend.ts 已代理内核 HttpBackend
  /** 回溯到指定版本的状态快照(只读,不改 production) */
  getStateAtVersion(id: number, version: number): Promise<unknown>;
  /** 两版本 payload 差异(只读) */
  getDiff(id: number, a: number, b: number): Promise<unknown>;
  /** 因果链追溯(单个 Fact 的因果链) */
  getCausalChain(id: number, factId: number): Promise<unknown>;
  /** fork session(What-If 假设分析用,只读不影响 production) */
  forkSession(parentId: number, version: number): Promise<number>;
  // 注:rewind/replay/history/state 由 ttd v1.0 内部通过 console-adapter 直接调内核,
  //     不在 cloud-http-backend 显式代理(ttd api 已注入 HttpBackend,单一真相源)

  // === L2 编辑台 ===
  /** 发布规则到 Production(滚动 session 热重载,见三层架构 §3.3) */
  publishRuleset(rules: unknown[]): Promise<{ rulesetVersion: number }>;
  /** 启动沙盒测试(fork production session,见三层架构 §5.3) */
  startSandbox(
    productionSessionId: number,
  ): Promise<{ sandboxSessionId: number }>;

  // === 通用统计(P1 补,P0 用 mock)===
  getStats(): Promise<{
    rules: number;
    executions: number;
    anomalies: number;
    todos: number;
  }>;
  getTodos(filter: {
    assignee: "me" | "all";
    type?: "review" | "approve" | "anomaly";
  }): Promise<Todo[]>;
  getActivityFeed(filter: { limit: number }): Promise<Activity[]>;
}
```

> **2026-08-06 三层架构同步**:
>
> - 移除 `getRuleCount()`(规则数从内核 rules store 派生,见 §6.2)
> - 新增 `getProductionState()` / `publishRuleset()` / `startSandbox()` / `rollbackRuleset()`(三层架构 L1/L3 编排)
> - SSE 事件流直接用浏览器 `EventSource` 订阅 `/api/sessions/{id}/events`(evorule-server 已就绪,无需 backend 方法包装)

P0 阶段若后端未就绪,用 mock backend(本地 JSON 数据)。

### 13.4 与战略文档同步

- [ ] 本文档完成后,更新战略文档 §5.8.9 加 "P0-0 详细设计见 evorule-console-cloud/docs/HOME_DESIGN.md"
- [ ] 实施完成后,更新战略文档 §23.1 待办状态

---

## 14. 与战略文档的引用关系

| 战略文档 §5.8 章节           | 本设计文档对应章节  | 实现位置                              |
| ---------------------------- | ------------------- | ------------------------------------- |
| §5.8.1 双重职责张力          | §1.1                | —                                     |
| §5.8.2 主方案三状态路由      | §3 状态机 + §4 路由 | `HomeRouter.svelte`                   |
| §5.8.3 状态 C 真实工作台     | §5.4 + §8.1         | `RealWorkbench.svelte`                |
| §5.8.4 状态 A demo 模式      | §5.2 + §8.3 + §8.4  | `DemoHome.svelte` + `demo-medical.ts` |
| §5.8.5 状态 B 建库向导       | §5.3 + §8.2         | `OnboardingWizard.svelte`             |
| §5.8.6 主方案如何解决张力    | §2.1 目标           | —                                     |
| §5.8.7 备选方案 A 双首页     | §10.1               | —                                     |
| §5.8.8 备选方案 B 三角色首页 | §10.2               | —                                     |
| §5.8.9 P0-0 内部细化(a/b/c)  | §1.3 + §12 迁移     | —                                     |
| §5.8.10 SaaS 长期演进        | §11                 | —                                     |

---

## 15. 设置页设计(已实现,网络配置 + LLM 配置)

> **2026-08-06 补充**:设置页已有完整实现,本节描述其设计。对应三层架构 §14 大众版 vs 高级版双轨(网络配置是大众版独有,高级版 Tauri 不联网)。

### 15.1 已实现文件清单

| 文件                                                                                             | 功能                                                | 状态      |
| ------------------------------------------------------------------------------------------------ | --------------------------------------------------- | --------- |
| [Settings.svelte](file:///d:/evorule-console-cloud/src/lib/views/Settings/Settings.svelte)       | 通用设置页(语言/主题/LLM 入口)                      | ✅ 已实现 |
| [LlmSettings.svelte](file:///d:/evorule-console-cloud/src/lib/views/Settings/LlmSettings.svelte) | LLM 配置子页(厂商预设/endpoint/key/model)           | ✅ 已实现 |
| [net-config.ts](file:///d:/evorule-console-cloud/src/lib/config/net-config.ts)                   | 网络配置 store(offline/online + remoteBaseUrl)      | ✅ 已实现 |
| [llm-config.ts](file:///d:/evorule-console-cloud/src/lib/config/llm-config.ts)                   | LLM 配置 store(enabled/provider/endpoint/key/model) | ✅ 已实现 |
| [llm-presets.ts](file:///d:/evorule-console-cloud/src/lib/config/llm-presets.ts)                 | LLM 厂商预设(6 厂商)                                | ✅ 已实现 |
| [backend/types.ts](file:///d:/evorule-console-cloud/src/lib/backend/types.ts)                    | NetMode + CloudBackendConfig 类型                   | ✅ 已实现 |

### 15.2 网络配置(NetMode — offline / online)

大众版支持两种网络模式,运行时可切换:

| 模式            | baseUrl                                 | 用途                       |
| --------------- | --------------------------------------- | -------------------------- |
| `offline`(默认) | `http://localhost:18080`(本地 loopback) | 开发态:本地 evorule-server |
| `online`        | `remoteBaseUrl`(用户配置)               | 生产态:远程 evorule-server |

```typescript
// src/lib/config/net-config.ts(已实现)
export interface NetConfig {
  mode: NetMode; // 'offline' | 'online'
  remoteBaseUrl: string;
}
// 持久化:localStorage(key: evorule-console-cloud:net-config)
// 便捷函数:setNetMode() / setRemoteBaseUrl() / toggleNetMode() / resetNetConfig()
```

**CloudHttpBackend.reconfigure**:运行时切换 mode / baseUrl,无需重载页面(已实现 `reconfigure()` 方法)。

**localhost vs 127.0.0.1**([backend/types.ts L28-36](file:///d:/evorule-console-cloud/src/lib/backend/types.ts#L28)):大众版用 `localhost` 而非 `127.0.0.1`,与 vite dev host 对齐,避免跨 origin CORS 误判。

### 15.3 LLM 配置系统(6 厂商预设)

#### 15.3.1 CloudLlmConfig store

```typescript
// src/lib/assistant/types.ts(已实现)
export interface CloudLlmConfig {
  enabled: boolean; // LLM 开关(false 时 LLM 按钮不渲染)
  provider: string; // 'glm' | 'qwen' | 'deepseek' | 'openai' | 'ernie' | 'custom'
  apiEndpoint: string; // OpenAI 兼容端点完整 URL
  apiKey: string; // 明文(localStorage)
  model: string; // 如 glm-4-flash / qwen-plus / gpt-4o-mini
}
// 持久化:localStorage(key: evorule-console-cloud:llm-config)
```

#### 15.3.2 厂商预设(6 个,国产优先)

[llm-presets.ts](file:///d:/evorule-console-cloud/src/lib/config/llm-presets.ts) 已实现 6 个预设(按推荐度排序):

| provider   | 厂商             | 默认模型      | 备注                         |
| ---------- | ---------------- | ------------- | ---------------------------- |
| `glm`      | 智谱 GLM(推荐)   | glm-4-flash   | 免费额度大,适合开发测试      |
| `qwen`     | 通义千问(阿里云) | qwen-plus     | 需 DashScope API key         |
| `deepseek` | DeepSeek         | deepseek-chat | 性价比高                     |
| `openai`   | OpenAI           | gpt-4o-mini   | 需翻墙/代理                  |
| `ernie`    | 文心一言(百度)   | —             | `needsAdapter=true`,暂不兼容 |
| `custom`   | 自定义           | —             | 用户自填 endpoint            |

**兼容性**:所有预设都是 OpenAI 兼容的 `/v1/chat/completions` 端点。文心一言原生不兼容,标记 `needsAdapter=true`(后续适配)。

#### 15.3.3 LlmAssistant 接口(扩展内核)

```typescript
// src/lib/assistant/types.ts(已实现)
export interface LlmAssistant extends AssistantProvider {
  isConfigured(): boolean; // 配置完备性(apiKey/endpoint/model 都有)
  testConnection(): Promise<{ ok: boolean; message: string }>; // 测试连接(不产生草案)
}
```

**注入边界**:[llm-context.ts](file:///d:/evorule-console-cloud/src/lib/assistant/llm-context.ts) 的 `provideLlm(assistant)` 转发到内核 `provideAssistant()`。配置不完备时传 null(不注入,LLM 按钮不渲染)。

### 15.4 安全约束

| 约束         | 大众版                    | 高级版(Tauri,P1+) |
| ------------ | ------------------------- | ----------------- |
| apiKey 存储  | localStorage 明文(可接受) | Tauri 加密存储    |
| apiKey 不进  | 日志 / 错误 / URL         | 同                |
| 设置面板提示 | "key 存于本地,不上传"     | 同                |

### 15.5 设置页 UI 流程

```
/settings → Settings.svelte
  ├── 网络配置区
  │   ├── 模式 toggle(offline ↔ online)
  │   └── remoteBaseUrl 输入框(online 模式显示)
  ├── LLM 配置区(→ LlmSettings.svelte 子页)
  │   ├── enabled toggle(LLM 开关)
  │   ├── 厂商预设下拉(6 厂商,选预设自动填 endpoint + model)
  │   ├── apiEndpoint 输入框(custom 模式可编辑)
  │   ├── model 下拉(从预设 models 列表)
  │   ├── apiKey 输入框(password 类型 + "存于本地不上传"提示)
  │   └── [测试连接] 按钮(调 testConnection,显示成功/失败)
  └── 通用区(P1:语言/主题)
```

**配置完备性检查**:`isLlmConfigured(cfg)` = `enabled && apiEndpoint 非空 && apiKey 非空 && model 非空`。完备时才注入内核 provider,LLM 按钮渲染。

---

> 设计文档 — 2026-08-06 定稿
> 写者:Mavis(AI 助理) · 落地战略文档 §5.8 到可实施层
> 关联:`D:\evorule-doc-center\shared\final\b2b2c-strategy.md §5.8` / `src/routes/+page.svelte` / `src/routes/+layout.svelte`
