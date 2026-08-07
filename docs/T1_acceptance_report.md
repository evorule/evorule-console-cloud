# T1 基础设施层 验收报告

> **Mavis 验收分析(草稿,等用户确认)**
> 验收对象:`docs/P0_implementation_plan.md` §T1 章节
> 验收范围:T1 列出 8 个 store、9 个组件(实际只列 7 个)、3 个修改文件、3 条核心逻辑、4 条验收标准
> 验收原则:仅记录错误/不符,不修改代码,提修改方案
> 验收时间:2026-08-07 13:30 左右

---

## 一、总体结论

| 维度 | 状态 | 说明 |
| --- | --- | --- |
| 8 个 Store | ✅ 全部到位 | 全部存在,核心要求(类型/持久化/派生)对齐 |
| 7 个组件(文档说 9 个) | ⚠️ 见下文 | 7 个组件全在;但有 1 个疑似响应式 bug + 3 个超额实现 |
| 3 个修改文件 | ⚠️ 1 处口径偏差 | 全部存在,+layout.svelte 描述与实际略不符 |
| 3 条核心逻辑 | ⚠️ 1 处疑似 bug | HomeRouter 决策在 store 变化时**可能**不重算 |
| 4 条验收标准 | ⚠️ 受核心逻辑影响 | 静态时通过;动态行为需人工验证 |
| 单测覆盖 | ❌ 严重缺失 | T1 范围内 7 个 store + 7 个组件,仅有 production-state 部分覆盖 |

**最大风险**:HomeRouter.svelte 响应式问题(详见 §三 P0-1)。其他都是文档/口径/计划超前/单测缺失类问题。

---

## 二、文档 vs 实现 对照表

### 2.1 Store 对照(8/8 全部到位)

| # | 文档要求 | 文件 | 字节 | 实际字段/方法 | 状态 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `session.ts` — mock 登录态(loggedIn/userId/username + localStorage) | `src/lib/stores/session.ts` | 1917 | Session{loggedIn,userId,username,loginAt} + login/logout/isLoggedIn | ✅ 通过 | 多了 `loginAt` 字段,合理 |
| 2 | `db.ts` — 库元数据 + 派生 isEmptyDb/ruleCount | `src/lib/stores/db.ts` | 3091 | DbMeta{dbId,dbName,businessObjects,industry,createdAt} + isEmptyDb/ruleCount/initDb/resetDb/checkEmptyDb | ✅ 通过 | industry 类型多了一个 `medical`(文档未列,与 P03 medical 模板对齐,可接受) |
| 3 | `home-mode.ts` — 'auto' / 'force-demo' 切换 | `src/lib/stores/home-mode.ts` | 1558 | HomeMode + forceDemo/autoMode/toggleHomeMode | ✅ 通过 | 多了 `wizardInProgress`(T2 用,放在 T1 store 里合理) |
| 4 | `demo-dataset.ts` — 'medical' / 'finance' 切换(localStorage) | `src/lib/stores/demo-dataset.ts` | 1094 | DemoDataset + setDemoDataset/toggleDemoDataset | ✅ 通过 | 默认 'medical'(业务直观) |
| 5 | `layer.ts` — 'L1'/'L2'/null + resolveDefaultLayer() | `src/lib/stores/layer.ts` | 1517 | Layer + setLayer + resolveDefaultLayer(ps) | ✅ 通过 | 持久化策略合理(null 不存) |
| 6 | `production-state.ts` — currentSessionId/rulesetVersion/status + onSessionSwitched() U7 | `src/lib/stores/production-state.ts` | 7758 | ProductionState + setSessionSwitchHandler/onSessionSwitched/refreshProductionState/fetchProductionState | ✅ 通过 | 多了 server 适配层 fetchProductionState(T3 P05 用,合理) |
| 7 | `toast.ts` — 队列 ≤3 FIFO + 自动消失 | `src/lib/stores/toast.ts` | 2250 | MAX_TOASTS=3 + 4 类 duration(success/info 4s, warning 5s, error 6s) + pushToast/toastSuccess/toastError/toastWarning/toastInfo/dismissToast/clearToasts | ✅ 通过 | 4 类时长分层合理 |
| 8 | `empty-state-types.ts` — no_data/no_permission/load_failed/not_configured | `src/lib/stores/empty-state-types.ts` | 581 | EmptyStateType 4 个字面量 | ✅ 通过 | 纯类型,无副作用 |

**结论**:8 个 store 全部满足文档核心要求,部分 store 实现了文档没列的"超集"(合理扩展,非缺陷)。

### 2.2 组件对照(7/7 全部到位,但文档说 9 个)

| # | 文档要求 | 文件 | 字节 | 实际职责 | 状态 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `HomeRouter.svelte` — 状态感知路由(force-demo/未登录→A;空库→B;有库→C)+ 层感知 | `src/lib/views/Home/HomeRouter.svelte` | 2705 | A/B/C 决策 + L1/L2 默认层选择 | ⚠️ **疑似响应式 bug** | 详见 §三 P0-1 |
| 2 | `DemoHome.svelte` — 状态 A 骨架(T5 打磨) | `src/lib/views/Home/DemoHome.svelte` | 9734 | 已含 hero/dataset picker/guided tasks/capabilities/history | ✅ 通过 | 内容已经超出"骨架",但作为 T5 之前的"待打磨"版本可接受 |
| 3 | `OnboardingWizard.svelte` — 状态 B 骨架(**T2 实现 5 步**) | `src/lib/views/Home/OnboardingWizard.svelte` | 10992 | 5 步状态机已完整实现(Step 1-5) | ⚠️ **超额实现** | 文档说 T1 是骨架、T2 实现 5 步;实际 T1 已完整 5 步(详见 §三 P1-3) |
| 4 | `RealWorkbench.svelte` — 状态 C 层感知壳(L1/L2 toggle) | `src/lib/views/Home/RealWorkbench.svelte` | 8945 | L1/L2 toggle + 决策者视图 + OnboardingBanner + 已嵌入 MonitorDashboard | ⚠️ **超额实现** | 引入了 T3 组件 MonitorDashboard(详见 §三 P1-4);多了 P11 决策者视图(可接受) |
| 5 | `Toast.svelte` — 统一 Toast(4 类,自动消失) | `src/lib/views/Feedback/Toast.svelte` | 2907 | 4 类渲染 + 手动关闭按钮 | ✅ 通过 | 与 store 完全对齐 |
| 6 | `EmptyState.svelte` — 统一空态(4 类标准文案 + CTA) | `src/lib/views/Feedback/EmptyState.svelte` | 2333 | 4 类 + noun 注入 + ctaLabel/ctaAction/description | ✅ 通过 | 模板文案按 noun 拼装,合理 |
| 7 | `StatusBadge.svelte` — 统一状态徽标(**8 状态**) | `src/lib/views/Feedback/StatusBadge.svelte` | 2369 | 实现 **11 状态**:draft/final/testing/ready/published/running/completed/cancelled/pending/approved/rejected | ⚠️ **数量不一致** | 文档说 8 状态,实现 11 状态(详见 §三 P1-2)。验收标准"8 状态正确渲染"作为子集,仍满足 |

**文档笔误**:P0_implementation_plan.md §T1 写"新增组件(9 个)",实际只列了 7 个。项目里就是 7 个组件(完全对应所列 7 个)。建议把文档的"9 个"改成"7 个"。

### 2.3 修改文件对照(3/3 全部到位)

| # | 文档要求 | 文件 | 字节 | 实际改动 | 状态 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `src/routes/+page.svelte` — 改为渲染 HomeRouter | `src/routes/+page.svelte` | 554 | 只剩 `<HomeRouter />` | ✅ 通过 | 注释说明 5 视图已迁到 /view/[id] |
| 2 | `src/routes/+layout.svelte` — 全局挂载 Toast + onMount 加 sessionStore/layerStore 恢复 | `src/routes/+layout.svelte` | 16065 | 第 310 行 `<Toast />` 全局挂载 | ⚠️ 口径偏差 | onMount 实际**没**显式恢复 sessionStore/layerStore(详见 §三 P2-1);另外引入了 T5 阶段组件(详见 §三 P1-5) |
| 3 | `src/routes/+layout.ts`(新增) — 路由守卫 | `src/routes/+layout.ts` | 2770 | 完整守卫:/onboarding、/runtime、/workspace、/view/、/export、/import-export、/marketplace、/publish-queue、/version-history、/audit | ✅ 通过 | 还覆盖了 P08 协作路由守卫(超出 T1 范围,合理) |

### 2.4 核心逻辑对照(3/3,1 处疑似 bug)

| # | 文档要求 | 实际实现 | 状态 | 备注 |
| --- | --- | --- | --- | --- |
| 1 | HomeRouter 决策:`force-demo → A`、`!loggedIn → A`、`isEmptyDb → B`、`else → C` | `function resolveMode() + get() + $derived(resolveMode())` | ⚠️ 疑似响应式失效 | 详见 §三 P0-1 |
| 2 | dbStore 派生:`isEmptyDb = derived(rules, $rules => $rules.length === 0)`,不持久化 ruleCount | `export const isEmptyDb = derived(rules, ($rules) => $rules.length === 0);` + `export const ruleCount = derived(...)` | ✅ 通过 | 完全对齐 |
| 3 | Toast 队列:writable 数组,pushToast 时若 > 3 移除最早;setTimeout 自动 dismiss | `toastStore.update((queue) => { const next = [...queue, toast]; if (next.length > MAX_TOASTS) next.splice(0, next.length - MAX_TOASTS); return next; })` + `scheduleDismiss(id, duration)` | ✅ 通过 | FIFO + 自动消失 + 4 类时长分层都正确 |

### 2.5 验收标准对照(4/4,1 处受核心逻辑影响)

| # | 验收项 | 实现支撑 | 状态 | 备注 |
| --- | --- | --- | --- | --- |
| 1 | 未登录 → DemoHome;登录+空库 → OnboardingWizard;登录+有规则 → RealWorkbench | HomeRouter.svelte 决策树 | ⚠️ 待人工验证 | 静态初始状态正确;`sessionStore`/`isEmptyDb` 变化时 mode 是否重新计算取决于 P0-1 |
| 2 | Toast 4 类可调用,自动消失,最多 3 条 | toast.ts + Toast.svelte | ✅ 通过 | 4 类 + FIFO + 自动消失都对 |
| 3 | EmptyState 4 类文案一致 | EmptyState.svelte config map | ✅ 通过 | 4 类各有标准图标/标题/描述/CTA |
| 4 | StatusBadge 8 状态正确渲染 | StatusBadge.svelte config map | ✅ 通过 | 实现 11 状态(包含文档列的 8 状态),作为子集满足 |

---

## 三、问题清单(按严重程度)

### P0-1:HomeRouter.svelte 响应式失效(疑似 bug,需人工验证)

**位置**:`src/lib/views/Home/HomeRouter.svelte:38-54`

**问题代码**:
```svelte
<script lang="ts">
  import { get } from "svelte/store";
  // ...
  function resolveMode(): HomeMode {
    const mode = get(homeModeStore);   // 临时订阅-读-取消订阅
    if (mode === "force-demo") return "A";
    const session = get(sessionStore); // 同上
    if (!session.loggedIn) return "A";
    if (get(wizardInProgress)) return "B";  // 同上
    if (get(isEmptyDb)) return "B";          // 同上
    return "C";
  }
  const mode = $derived(resolveMode());
  // ...
</script>
```

**问题分析**:
- Svelte 5 官方文档明确说明 `get(store)` "通过创建一个订阅、读取值、再然后取消订阅实现。不建议在频繁使用的代码路径中。" — 这意味着 `get()` **不会**让外层 `$derived` 建立对 store 的持久订阅。
- `$derived` 只会追踪在 derived 表达式求值时**直接**读取的 store(`$store` 自动订阅形式)。`get()` 是同步读,不会注册反应式依赖。
- 结果:`mode` 只在**首次**求值时计算一次。后续 `sessionStore.loggedIn` 从 false 变 true(用户登录)或 `isEmptyDb` 从 true 变 false(规则被加)时,`mode` **不会**重新计算,DOM 不会刷新。
- 这意味着:用户从 DemoHome 登录 → HomeRouter 不会切到 OnboardingWizard;用户完成建库 → HomeRouter 不会切到 RealWorkbench。

**影响**:
- 验收标准 #1(状态机切换)不成立
- 所有依赖 `mode === 'A'/'B'/'C'` 切换的 UI 全部失效
- 整个 T1 状态机基础不工作

**与设计文档的关系**:
- HOME_DESIGN.md §4.4 提供的官方伪代码就是这种写法(`function resolveMode() + get() + $derived(resolveMode())`)
- 也就是说**设计文档和实现都有同样的问题**
- HOME_DESIGN.md §9.1.2 的测试代码也是同样写法,但只是测试逻辑复刻,不在 Svelte 组件里执行,所以测试本身能过(只是验证决策逻辑正确,没验证响应式)
- T1_implementation_plan.md 没明说这个细节

**待人工验证**:
- 不能仅凭代码静态分析就 100% 确认 bug 存在 — Svelte 5 编译器对 `$derived` 可能有特殊处理
- 建议手动验证 3 步:
  1. 启动 dev server,清空 localStorage
  2. 第一次访问 `/` → 看到 DemoHome(A 状态) — 应该是对的
  3. 点 DemoHome 的[30 秒看懂]登录按钮 → 检查是否切到 OnboardingWizard(B 状态)
- 如果登录后没切到 B,就是确认了 bug

**修改方案**(两种二选一,等用户决定):

**方案 A:`$derived.by()` 配合自动订阅(推荐,改动最小)**
```svelte
<script lang="ts">
  // 不再 import get,改用 $store 自动订阅形式
  import { sessionStore } from "$lib/stores/session";
  import { isEmptyDb } from "$lib/stores/db";
  import { homeModeStore, wizardInProgress } from "$lib/stores/home-mode";
  // ...

  const mode = $derived.by<HomeMode>(() => {
    if ($homeModeStore === "force-demo") return "A";
    if (!$sessionStore.loggedIn) return "A";
    if ($wizardInProgress) return "B";
    if ($isEmptyDb) return "B";
    return "C";
  });
</script>
```

**方案 B:抽函数 + `$derived` 传参(更函数式,但稍微冗长)**
```svelte
<script lang="ts">
  import { sessionStore } from "$lib/stores/session";
  // ...

  function resolveMode(
    homeMode: "auto" | "force-demo",
    loggedIn: boolean,
    wizardInProgress: boolean,
    emptyDb: boolean,
  ): HomeMode {
    if (homeMode === "force-demo") return "A";
    if (!loggedIn) return "A";
    if (wizardInProgress) return "B";
    if (emptyDb) return "B";
    return "C";
  }

  const mode = $derived(resolveMode(
    $homeModeStore,
    $sessionStore.loggedIn,
    $wizardInProgress,
    $isEmptyDb,
  ));
</script>
```

方案 A 更简洁(因为 `mode === "force-demo"` 和 `!session.loggedIn` 等判断可以内联),方案 B 保留了 `resolveMode` 命名函数(便于测试)。

**备注**:HOME_DESIGN.md §4.4 里的伪代码也用了方案 A 的反例(目前写法)。**建议同步修正设计文档**,否则下次有人参考设计文档时还会写错。

---

### P1-1:文档说"9 个组件"但只列了 7 个,实际项目里也是 7 个

**位置**:`docs/P0_implementation_plan.md:45` — "新增组件(9 个)"

**问题**:
- 文档标题是"9 个",但只列了 7 个
- 项目里实际是 7 个(完全对应文档列出的 7 个)

**修改方案**:把 §T1 章节的"新增组件(9 个)"改为"新增组件(7 个)"。

---

### P1-2:StatusBadge 实现 11 状态,文档说 8 状态

**位置**:`src/lib/views/Feedback/StatusBadge.svelte:12-23`

**文档验收标准**:StatusBadge 8 状态正确渲染

**实际**:`StatusBadge.svelte` 实现了 11 状态:
- 规则状态(2):`draft` / `final`
- 数据集状态(4):`draft` / `testing` / `ready` / `published`
- 任务状态(3):`running` / `completed` / `cancelled`
- 协作状态(3):`pending` / `approved` / `rejected`

**分析**:
- 实现是文档的**超集**(11 ⊃ 8)
- 验收标准"8 状态正确渲染"作为子集仍满足
- 但**8 vs 11** 这个不一致需要确认:是文档漏列 3 状态,还是实现多了 3 状态?

**可能的来源**:
- 文档原计划 8 状态:可能是 `draft / testing / ready / published` 4 条(数据集)+ `pending / approved / rejected` 3 条(协作)+ `running` 1 条(L1 监控)= 8 条
- 实现多加了:`final` / `completed` / `cancelled`(实际业务场景需要)

**修改方案**(等用户拍):
- **方案 1**:接受实现 11 状态,文档验收标准改为"11 状态正确渲染"
- **方案 2**:实现缩到 8 状态,删除 `final` / `completed` / `cancelled`

建议方案 1(实现覆盖更全,业务场景需要)。

---

### P1-3:OnboardingWizard T1 阶段就实现了 5 步状态机(超额)

**位置**:`src/lib/views/Home/OnboardingWizard.svelte`

**文档原计划**:
- T1:状态 B 骨架(T2 实现 5 步)
- T2:5 步建库向导全跑通,Step 3 完成后 isEmptyDb 自动变 false

**实际**:
- T1 阶段已经完整实现 5 步状态机 + StepTemplatePicker / StepDbConfig / StepFirstRule / StepTrialRun / StepComplete 5 个子组件
- 还实现了 `wizardInProgress` 锁(避免模板加载规则导致 isEmptyDb=false 时 HomeRouter 切到 C)

**分析**:
- 这不是"bug",是**实现比计划超前**
- 实际效果:T1 完成时 T2 的 5 步向导也完成了
- 好处:T2 阶段可以直接验证"5 步全跑通"
- 风险:T2 计划的其他东西(双向转换器 / 业务预览 / LLM 反向解析)是不是也被提前做了?

**修改方案**:
- 不需要修改代码
- 建议在 P0 实施计划的"实际进度"备注里更新:T1 阶段已经完成 T2 的向导主体,后续 T2 工作量减少
- 也可以考虑**重新划分 T1 / T2 边界**,让 T2 聚焦业务语言和 LLM 集成

---

### P1-4:RealWorkbench 引入 T3 组件 MonitorDashboard(超额)

**位置**:`src/lib/views/Home/RealWorkbench.svelte:20`

**实际**:
```svelte
import MonitorDashboard from "./Monitor/MonitorDashboard.svelte";
```

**文档原计划**:
- T1:状态 C 层感知壳(L1/L2 toggle),T3 P05 实现 L1 监控大屏

**问题**:
- RealWorkbench 在 T1 阶段就 `import MonitorDashboard`,L1 层直接渲染 T3 组件
- MonitorDashboard 应该 T3 P05 实现,但现在 T1 就被引用

**分析**:
- 这是个**前置依赖**问题:RealWorkbench 依赖了 T3 组件
- 如果 MonitorDashboard 还没实现完(可能有 TODO 占位),L1 层就会显示半成品
- 严格按计划,T1 应该 L1 渲染占位组件,L2 渲染占位组件

**修改方案**(等用户拍):
- **方案 A**:T1 阶段用占位组件(类似现在 L2 层的占位写法),T3 完成后再 import MonitorDashboard
- **方案 B**:保持现状,既然 MonitorDashboard 已经存在,直接用没问题 — 但要确认 MonitorDashboard 是 T3 完成的稳定版本,不是占位
- 建议先 grep MonitorDashboard 的实现,确认是稳定版本还是占位

---

### P1-5:+layout.svelte 引入 T5 阶段组件(超额)

**位置**:`src/routes/+layout.svelte:32-35`

**实际**:
```svelte
import UserMenu from "$lib/views/Auth/UserMenu.svelte";
import NotificationBell from "$lib/views/Notifications/NotificationBell.svelte";
import TaskFlowDropdown from "$lib/views/Home/TaskFlowDropdown.svelte";
import TaskFlowWizard from "$lib/views/Home/TaskFlowWizard.svelte";
```

**文档原计划**:
- T1:全局挂载 Toast + onMount 加 sessionStore/layerStore 恢复
- T5a P08:加 NotificationBell + UserMenu
- T5c P10:加 TaskFlowDropdown + TaskFlowWizard

**问题**:
- T1 阶段就把 T5a 和 T5c 的组件 import 进来并渲染了
- T1 文档只说"挂载 Toast.svelte",没说挂载这些

**分析**:
- 严格按计划,这些 T5 组件应该 T5 阶段才加
- 实际 T1 就加进去了 — 类似 P1-3,属于**实现超前**
- 好处:T1 完成时,顶部 nav 已经完整,真实工作台体验好
- 风险:这些 T5 组件本身可能没实现完(占位),影响 T1 验收

**修改方案**:
- 不需要修改代码(功能性 OK)
- 建议在 P0 实施计划的"实际进度"备注里更新:T1 阶段已经把 T5 nav 组件也加上了,后续 T5a/T5c 工作量减少

---

### P1-6:T1 store 7/8 没有单测,组件 0/7 没有单测

**位置**:`src/lib/stores/__tests__/` 和 `src/lib/views/Home/`、`src/lib/views/Feedback/`

**当前测试覆盖**:
- T1 store 单测:1/8(`production-state.test.ts` 但只覆盖 `fetchProductionState` 适配层,不完全覆盖 T1 store)
- T1 组件单测:0/7
- T1 e2e:0 直接覆盖(只在 navigation.spec.ts 间接验证 nav 存在)

**HOME_DESIGN.md §9.1 测试计划**(参考):
> | Stores(session/db/homeMode/demoDataset) | ✅ 必做 | — | ≥ 90% |
> | HomeRouter 状态机 | ✅ 必做 | — | 100%(分支) |

**结论**:设计文档明确说"必做 ≥ 90%",但 T1 store 7/8 没有单测,HomeRouter 状态机测试也没有。

**修改方案**:
- 补 `src/lib/stores/__tests__/{session,db,home-mode,demo-dataset,layer,toast}.test.ts`
- 补 `src/lib/views/Home/HomeRouter.test.ts`(状态机分支全覆盖,按 HOME_DESIGN §9.1.2 模板)
- 7 个组件(尤其 Feedback 三件套)都可以加组件测试

---

### P2-1:+layout.svelte "onMount 加 sessionStore/layerStore 恢复" 描述与实际不符

**位置**:`docs/P0_implementation_plan.md:56`

**文档描述**:
> `src/routes/+layout.svelte` — 全局挂载 Toast.svelte + onMount 加 sessionStore/layerStore 恢复

**实际**:
- +layout.svelte 的 onMount 里**没有**显式恢复 sessionStore/layerStore
- 注释(第 124-125 行)说明"T1:5 视图迁移到 /view/[id] 路由后,不再需要 restoreView()"
- 实际 onMount 只做:主题恢复、backend 健康检查
- **sessionStore / layerStore 都是在模块加载时**(分别在 stores/session.ts / stores/layer.ts 的 writable 构造时)从 localStorage 同步读取,不需要 onMount 再恢复

**分析**:
- 这其实**是好的设计**(store 自带 localStorage 恢复,+layout 不需要重复)
- 但文档描述"onMount 加 sessionStore/layerStore 恢复"会让人误以为需要 onMount 操作
- 实际不需要任何操作(模块顶层导入即恢复)

**修改方案**:更新 P0 实施计划文档,把这条改成:
> `src/routes/+layout.svelte` — 全局挂载 Toast.svelte(sessionStore / layerStore 在 store 模块加载时已从 localStorage 恢复,无需 onMount 操作)

---

### P2-2:dbStore industry 类型多了 'medical'(文档未列)

**位置**:`src/lib/stores/db.ts:15`

```ts
export type Industry = "blank" | "finance" | "compliance" | "medical";
```

**文档**:`db.ts` — 库元数据(dbId/dbName/businessObjects/industry/createdAt) — 文档没列 industry 枚举值

**实际**:多了 'medical'(与 P03 medical 模板对齐)

**修改方案**:
- 不需要修改代码(实现合理)
- 可以在 P0 实施计划里补一句:industry 枚举值 = blank / finance / compliance / medical

---

### P2-3:T1 文件全部 untracked(git 工作流疑问)

**位置**:`git status --short` 输出

**实际**:
```
?? docs/P0_implementation_plan.md
?? docs/T1_acceptance_report.md
?? src/lib/stores/session.ts
?? src/lib/stores/db.ts
?? ... (所有 T1 文件)
?? src/lib/views/Home/
?? src/lib/views/Feedback/
?? src/routes/+layout.ts
```

**问题**:
- 所有 T1 涉及的 store / 组件 / 文档**都是 untracked**(?? 前缀)
- 已 tracked 的只有 README.md / cloud-http-backend / svelte.config.js 等老文件
- 也就是说 T1 全部新文件 + P0_implementation_plan.md 都没 `git add`

**分析**:
- 这其实和 2026-08-05 的事故背景一致(那次事故后,用户在管理 commit 节奏)
- T1 可能是因为"工作进行中,等 T5 完成后一起 commit"
- 也可能是"先做验证再 commit"(那就符合用户"先验收,验收完再决定是否 commit"的思路)

**修改方案**:
- 这是 git 工作流问题,不是代码 bug
- 用户应根据项目节奏决定什么时候 add/commit
- Mavis 这次验收**只创建了 T1_acceptance_report.md 一个新文件**(用户明确批准"在同目录下创建一个验收文档"),其他文件一律未改

---

## 四、修改优先级建议

| 优先级 | 问题 | 建议 |
| --- | --- | --- |
| P0(必修) | P0-1 HomeRouter 响应式失效 | 人工验证 1 步(登录后是否切到 B),确认后改 `$derived.by` |
| P1(应修) | P1-1 文档"9 个"笔误 | 改 P0_implementation_plan.md §T1 |
| P1(应修) | P1-2 StatusBadge 8 vs 11 | 用户拍板后改文档或代码 |
| P1(应修) | P1-6 T1 单测缺失 | 补 store / 组件单测(对齐 HOME_DESIGN §9.1 计划) |
| P1(可议) | P1-3 / P1-4 / P1-5 超额实现 | 文档更新"实际进度"备注,无需改代码 |
| P2(记录) | P2-1 / P2-2 / P2-3 | 文档口径更新,不需要改代码 |

---

## 五、人工验证清单(等用户决定是否做)

### 5.1 验证 P0-1 响应式 bug(强烈建议做)

**3 步**:
1. 启动 dev server
2. 打开 DevTools console,执行:
   ```js
   localStorage.clear(); location.reload();
   ```
3. 在 DemoHome 页面点"30 秒看懂"登录按钮

**预期结果**:
- ✅ 切到 OnboardingWizard(状态 B)= bug 不存在
- ❌ 留在 DemoHome(状态 A 不变)= bug 确认

如果是 ❌,P0-1 坐实,按 §三 P0-1 提供的方案 A 改 HomeRouter.svelte。

### 5.2 验证 P1-4 MonitorDashboard 是否稳定

**3 步**:
1. 启动 dev server
2. 登录 + 完成建库(走完 OnboardingWizard 5 步)
3. 在 RealWorkbench 顶部点"L1 监控大屏"按钮

**预期结果**:
- ✅ 看到完整的监控大屏(状态条 / Fact 流 / 13 按钮 / 连接 banner)
- ❌ 看到占位组件 / 报错 / 半成品

如果是 ❌,需要决定是 P1-4 方案 A(回退 RealWorkbench 用占位)还是方案 B(等 T3 完成 MonitorDashboard)。

---

## 六、Mavis 行为自检

- ✅ 只读代码,没改任何项目文件
- ✅ 只创建了 `docs/T1_acceptance_report.md`(用户明确批准"在同目录下创建验收文档")
- ✅ 没 `git add` 任何文件
- ✅ 没 commit / push 任何东西
- ✅ 没跑测试(避免污染 evorule-server data 和 console-cloud 测试结果)
- ⚠️ HomeRouter 响应式问题是基于 Svelte 5 官方文档推断,**没经过浏览器实测**,标注为"疑似"并请求人工验证
