<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->

# P0-10 详细设计(任务流 + 在线 demo + README 决策者入口)

> **状态**:设计文档,2026-08-06 定稿。本文档是 evorule-doc-center `b2b2c-strategy.md §20.2 P0-10` 的可实施落地。
>
> **定位**:P0-10 是 P0 收尾的体验层 — 把 P03-P09 已设计好的 9 视图,用「任务流」串成用户路径,把首页状态 A 的 demo 模式做成可在线访问的部署,并在 README 中为决策者开一个 30 秒能看懂的入口。
>
> **关联**:
>
> - 战略依据:`b2b2c-strategy.md §20.2 P0-10`(步骤 0 + 全程)+ §3.2(角色 B 决策者)+ §4.3(5 任务类型)+ §5.3-§5.4(9 视图架构 + 任务流)+ §5.8.4(状态 A demo 模式)
> - 三层架构:`evorule-three-layer-architecture.md §11.4`(同步状态表)
> - 首页设计:`HOME_DESIGN.md §3`(状态机)+ §5.8(首页细化)+ §6.4(demoDatasetStore)+ §8.3(DemoHome)+ §8.4(预填数据)
> - 前置设计:`P03_DATASET_DESIGN.md` / `P04_BUSINESS_EXECUTION_PAD_DESIGN.md` / `P05_MONITOR_DASHBOARD_DESIGN.md` / `P06_BUSINESS_AUDIT_TT_DESIGN.md` / `P07_RESULT_EXPORT_DESIGN.md` / `P08_COLLAB_WORKFLOW_DESIGN.md` / `P09_IMPORT_EXPORT_INFRA_DESIGN.md`

---

## 1. 背景与动机

### 1.1 战略意图(来自 §20.2 P0-10)

> P0-10 任务流 + 业务仪表板快捷入口 + 在线 demo + 文档 — 步骤 0 + 全程 — 任务为主线(加规则/查问题/改规则/审规则/看历史)+ 在线 demo 部署 + README 决策者入口

P0-1 到 P0-9 完成了 9 视图的「点状」设计(每个视图都能独立工作),但用户真实使用是「线状」的 — 用户带着任务进来,跨多个视图完成。P0-10 把这些点连成线,并提供两个对外入口:

1. **任务流**:把 5 任务类型(加规则/查问题/改规则/审规则/看历史)做成多步向导,串起 P03-P09 的视图
2. **在线 demo**:状态 A 的 demo 模式部署成公网可访问,决策者无需注册即可试用
3. **README 决策者入口**:30 秒说服 + 在线 demo 链接 + 截图,放在 README 第一屏

### 1.2 三角色定位(§3)

| 角色        | 服务对象         | P0-10 对应交付                     |
| ----------- | ---------------- | ---------------------------------- |
| A 开发工具  | agent 公司开发者 | 任务流的上下文保留 API(可编程接入) |
| B 展示 demo | agent 公司决策者 | 在线 demo + README 决策者入口      |
| C 完整 C 端 | 公众用户         | 任务流(5 任务类型,日常使用)        |

**核心**:P0-10 主要服务角色 B(决策者)和角色 C(C 端用户),角色 A 通过 API 接入。

### 1.3 5 任务类型(§4.3)

| 任务类型   | 适用行业                 | 任务流主路径                                           |
| ---------- | ------------------------ | ------------------------------------------------------ |
| **加规则** | 全部 10 个               | 业务规则库 → 业务执行台 → 业务状态 → 业务审计          |
| **查问题** | 律所/合规/财务/审批      | 业务审计 → 业务时间旅行 → 因果链 → 决策支持            |
| **改规则** | 全部 10 个               | 业务规则库 → 影响分析 → 业务执行台(dry-run) → 业务审计 |
| **审规则** | 医院/律所/财务/合规/审批 | 协作工作流 → 业务规则库 → 业务执行台 → 协作工作流      |
| **看历史** | 全部 10 个               | 业务审计 → 业务时间旅行 → 审计导出 → BLAKE3 验证       |

**结论**:5 任务类型是跨行业的通用任务,evorule-console-cloud 的视图架构要服务这 5 任务类型,不只是 10 行业的垂类视图。

### 1.4 9 视图架构中的任务流定位(§5.3-§5.4)

```
[业务仪表板] (首屏入口)
   ↓
[任务流] (任务为主线)  ← P0-10 核心交付
   ├──→ 加规则 → [业务规则库] → [业务执行台] → [业务状态]
   │        ↓
   │     [LLM 辅助] → [业务审计]
   ├──→ 查问题 → [业务审计] → [业务时间旅行]
   ├──→ 改规则 → [业务规则库] → 影响分析 → [业务执行台(dry-run)]
   ├──→ 审规则 → [协作工作流]
   └──→ 看历史 → [业务审计 + 业务时间旅行]

[模板市场] (独立入口) → 安装 → [业务规则库]
```

任务流不是「第 10 个视图」,而是「视图间的连接器」 — 用户从顶部任务流入口选择任务类型,任务流向导引导跨视图完成,期间保留上下文(规则 ID / 事件 ID / 审计范围)。

### 1.5 现状:demo 模式已部分设计(HOME_DESIGN §5.8.4 + §8.3/§8.4)

HOME_DESIGN 已设计状态 A demo 模式:

- `DemoHome.svelte`:banner + 数据集切换 + 4 数据卡 + 3 引导任务 + 6 能力特性 + CTA
- `demoDatasetStore`:medical / finance 两套,localStorage 持久化
- `src/lib/data/demo-medical.ts` / `demo-finance.ts`:预填数据
- 3 引导任务:`add` / `query` / `edit` → 跳转到对应视图(`?demo=true&action=xxx`)

**P0-10 增量**:

1. 把 3 个引导任务升级为「只读任务流」(多步向导,而非单页跳转)+ 新增「合规门禁」引导任务(共 4 个)
2. 把 demo 模式部署为公网可访问(在线 demo)
3. 在 README 中加决策者入口章节

### 1.6 与其他 P0 的关系

| 前置设计                | P0-10 复用点                                                            |
| ----------------------- | ----------------------------------------------------------------------- |
| HOME_DESIGN             | 状态 A demo 模式 / demoDatasetStore / DemoHome 组件树 / 预填数据 schema |
| P01 业务规则库          | 加规则 / 改规则任务流的步骤 1 入口                                      |
| P02 业务语言层          | 任务流步骤中的业务术语展示                                              |
| P03 数据集              | 加规则任务流可选「加入数据集」步骤                                      |
| P04 业务执行台          | 加规则 / 改规则 / 审规则任务流的测试步骤                                |
| P05 监控大屏            | 任务流完成后的「查看运行效果」步骤                                      |
| P06 业务审计 + 时间旅行 | 查问题 / 看历史任务流的核心步骤                                         |
| P07 通用结果导出        | 看历史任务流的「导出审计」步骤                                          |
| P08 协作工作流          | 审规则任务流的核心步骤                                                  |
| P09 导入导出基础设施    | 模板市场入口(任务流外独立路径)                                          |

---

## 2. 目标与非目标

### 2.1 目标

- ✅ 实现 `TaskFlowWizard.svelte`(6 任务流的多步向导,顶部导航下拉触发)
- ✅ 实现 6 个 TaskFlow 定义(加规则/查问题/改规则/审规则/看历史 + 合规门禁),每个含 4 步骤
- ✅ 实现任务上下文保留(规则 ID / 事件 ID / 审计范围跨步骤传递)
- ✅ 实现 demo 模式的 4 个只读引导任务流(对应 add/query/edit/compliance)
- ✅ 实现在线 demo 部署(GitHub Pages + mock 后端,公网可访问)
- ✅ 实现 README 决策者入口章节(30 秒说服 + 在线 demo 链接 + 截图)
- ✅ 实现任务历史记录(用户可回看自己的任务流)
- ✅ 与 HOME_DESIGN 状态 C 真实工作台集成(顶部任务流下拉)
- ✅ 与 HOME_DESIGN 状态 A demo 模式集成(4 引导任务)
- ✅ 延续 SvelteKit + Svelte 5 runes + provideXxx 注入模式
- ✅ 单元测试覆盖 6 任务流定义 + 上下文传递(Vitest)
- ✅ E2E 测试覆盖 6 任务流跑通 + demo 4 引导任务(Playwright)

### 2.2 非目标

- ❌ 不实现模板市场 UI(P09 已设计,独立入口,非任务流)
- ❌ 不实现协作工作流 UI(P08 已设计,审规则任务流只调用其 API)
- ❌ 不实现业务仪表板独立视图(状态 C 真实工作台已覆盖入口功能)
- ❌ 不实现任务流的自定义编排(P2:用户自定义任务类型)
- ❌ 不实现任务流的多人协作(P2:团队任务分配)
- ❌ 不实现 demo 模式的真实后端(P0 用 mock,P1 接真实 evorule-server)
- ❌ 不实现 i18n / a11y / 移动端(P1/P2)
- ❌ 不做营销落地页 / SEO 优化(P1 由营销团队负责)

---

## 3. 关键架构决策

### 3.1 决策 1:任务流 = 多步向导 + 上下文保留,非新视图

**决策**:任务流不是「第 10 个视图」,而是「视图间的连接器」 — 一个全局 `TaskFlowWizard.svelte` 组件,浮在顶部导航下方,引导用户跨视图完成多步任务。

**理由**:

1. 9 视图已设计完整(P03-P09),任务流只是编排,不应重复实现视图能力
2. 用户心智是「我要完成 X 任务」,不是「我要用 Y 视图」 — 任务为主线,视图为任务服务
3. 多步向导 + 上下文保留,让用户跨视图时不丢失「我在做什么」
4. 避免新增独立路由(`/taskflow/add-rule`),复用现有视图路由 + query 参数传递步骤

**实现**:顶部导航的「任务流 ▼」下拉 → 选任务类型 → 顶部出现 TaskFlowWizard 进度条 → 每步跳转到对应视图 → 完成或取消。

### 3.2 决策 2:5 任务类型 + 合规门禁专项 = 6 个 TaskFlow 定义(代码内置)

**决策**:6 个 TaskFlow 定义硬编码在 `src/lib/data/task-flows.ts`,P0 不做用户自定义编排。其中 5 个对应 §4.3 跨行业通用任务类型,第 6 个 `compliance_gate` 是等保门禁专项(对应 `COMPLIANCE_GATE_DESIGN.md`)。

**理由**:

1. 5 任务类型来自 §4.3 跨行业分析,是通用任务,不需要用户自定义
2. 合规门禁是 evorule 的核心差异化卖点(BLAKE3 留痕 + 等保条款映射),需独立任务流让决策者直观体验
3. 代码内置保证任务流质量(每步经过设计验证)
4. P2 再开放自定义编排(用户拖拽步骤)

**6 个 TaskFlow**:

| TaskFlow          | 步骤数 | 步骤序列                                                                                 |
| ----------------- | ------ | ---------------------------------------------------------------------------------------- |
| `add_rule`        | 4      | 业务规则库(创建)→ 业务执行台(测试)→ 业务状态(验证)→ 业务审计(查看)                       |
| `query_issue`     | 4      | 业务审计(查找)→ 业务时间旅行(回溯)→ 因果链(分析)→ 决策支持(LLM)                          |
| `edit_rule`       | 4      | 业务规则库(找到)→ 影响分析(预览)→ 业务执行台(dry-run)→ 业务审计(确认)                    |
| `review_rule`     | 4      | 协作工作流(待审)→ 业务规则库(详情)→ 业务执行台(验证)→ 协作工作流(批准)                   |
| `view_history`    | 4      | 业务审计(选范围)→ 业务时间旅行(回放)→ 审计导出(导出)→ BLAKE3 验证(确认)                  |
| `compliance_gate` | 4      | 导入门禁规则(模板市场)→ 模拟工具调用(触发门禁)→ 查看门禁结果(监控大屏)→ 审计追溯(BLAKE3) |

### 3.3 决策 3:demo 模式 = 状态 A + 预填数据 + 只读引导任务流

**决策**:在线 demo 复用 HOME_DESIGN 状态 A 的 DemoHome,4 个引导任务(原 3 个 + 新增合规门禁)升级为只读 TaskFlow(预填上下文,不允许修改数据)。

**理由**:

1. HOME_DESIGN 状态 A 已设计完整(banner + 数据集切换 + 4 数据卡 + 6 能力特性 + CTA)
2. 原 3 引导任务是单页跳转,升级为只读 TaskFlow 后,决策者能体验「完整任务路径」,而非单点功能;新增合规门禁引导任务让决策者直观感受等保门禁 + BLAKE3 留痕
3. 只读模式保护预填数据(多个决策者访问不互相破坏)
4. 预填上下文(规则 ID / 事件 ID)让任务流步骤立即可见,无需用户手动选择

**4 个只读引导任务**:

| 引导任务     | 对应 TaskFlow     | 预填上下文                                                                    | 时长   |
| ------------ | ----------------- | ----------------------------------------------------------------------------- | ------ |
| 试试加规则   | `add_rule`        | 规则「65 岁以上发烧必须先 CT」(医疗)/「报销上限 5000」(财务)                  | 2 分钟 |
| 试试查问题   | `query_issue`     | 异常 Fact「病人 P-1283 体温 39.2°C」(医疗)/「报销 R-067 超 limit」(财务)      | 1 分钟 |
| 试试改规则   | `edit_rule`       | 规则「发烧阈值 38°C」→ 改为「37.5°C」(医疗)/「报销上限 5000」→「6000」(财务)  | 3 分钟 |
| 试试合规门禁 | `compliance_gate` | AI Agent 调用转账但未 MFA → 门禁阻断(医疗)/ 写入未加密身份证 → 门禁阻断(财务) | 2 分钟 |

### 3.4 决策 4:在线 demo 部署 = GitHub Pages + mock 后端

**决策**:在线 demo 部署到 GitHub Pages(纯前端 + mock 后端),不依赖真实 evorule-server。

**理由**:

1. GitHub Pages 免费 + 公网可访问 + 自动部署(GitHub Actions)
2. 纯前端部署降低运维成本(无需维护 server 实例)
3. mock 后端用预填数据(医疗/财务),覆盖 demo 4 引导任务所需的所有 API 响应
4. 决策者无需注册 / 登录 / 配置,打开链接即可体验
5. P1 再提供「真实后端 demo」(可选,接 evorule-server 试用实例)

**部署架构**:

```
GitHub repo: evo-rule-lab/evorule-console-cloud
  ├── main branch → GitHub Actions → build → GitHub Pages
  │   URL: https://evo-rule-lab.github.io/evorule-console-cloud/
  │
  └── demo 模式自动激活(未登录 → 状态 A)
      ├── 前端:SvelteKit adapter-static build 产物
      └── 后端:MockBackend(浏览器内,返回预填数据)
```

**MockBackend 设计**:

- 实现 `ExecutionBackend` 接口(HOME_DESIGN §1.2 / [backend/types.ts](file:///d:/evorule-console-cloud/src/lib/backend/types.ts))
- 所有方法返回预填数据(医疗/财务两套)
- SSE 用 `setTimeout` 模拟(每 2s 推一条 Fact)
- 不调用真实 HTTP(零网络依赖)

### 3.5 决策 5:README 决策者入口 = 30 秒说服 + 在线 demo + 截图

**决策**:在 README 顶部(「定位」章节前)新增「给决策者」章节,包含 30 秒说服 + 在线 demo 链接 + 截图 + case study 链接。

**理由**:

1. §3.2 明确「README 第一屏 = 决策者入口」
2. 当前 README 第一屏是「定位」(技术向),决策者看不懂
3. 决策者 30 秒内要 get:为什么需要 evorule / 能做什么 / 怎么试
4. 在线 demo 链接让决策者一键体验,无需 clone / install

**README 决策者入口结构**:

```markdown
## 给决策者(30 秒看懂)

> evorule 是 AI Agent 的「合规审计层」— 让 AI Agent 的每个决策可审计、可回放、可回滚。

### 为什么需要 evorule?

| 痛点                | evorule 解法                      |
| ------------------- | --------------------------------- |
| AI Agent 决策不透明 | BLAKE3 哈希链,每个决策可追溯      |
| 出问题无法定位根因  | 时间旅行 + 因果链分析             |
| 合规审计难通过      | 审计导出满足 EU AI Act Article 12 |

### 在线体验

👉 [在线 demo](https://evo-rule-lab.github.io/evorule-console-cloud/)(无需注册,医疗 + 财务两套场景)

### 4 个引导任务

1. **加规则**(2 分钟):给医院加一条「65 岁以上发烧必须先 CT」规则
2. **查问题**(1 分钟):定位病人 P-1283 为何触发异常告警
3. **改规则**(3 分钟):把发烧阈值从 38°C 改为 37.5°C
4. **合规门禁**(2 分钟):AI Agent 调用转账但未 MFA → 门禁阻断 + BLAKE3 留痕

### 截图

[截图 1:监控大屏] [截图 2:业务审计] [截图 3:时间旅行]

### Case Study

- [医疗行业 PoC](./docs/case-studies/medical.md)
- [财务行业 PoC](./docs/case-studies/finance.md)
```

---

## 4. 数据模型

### 4.1 TaskFlow 类型

```typescript
// src/lib/stores/task-flow-types.ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project

/**
 * 任务流类型(6 种:§4.3 5 任务类型 + 合规门禁专项)
 */
export type TaskFlowId =
  | "add_rule"
  | "query_issue"
  | "edit_rule"
  | "review_rule"
  | "view_history"
  | "compliance_gate";

/**
 * 任务流定义(代码内置,不可用户编辑)
 */
export interface TaskFlowDef {
  /** 任务流 ID */
  id: TaskFlowId;
  /** 显示名称(中文) */
  name: string;
  /** 图标(emoji) */
  icon: string;
  /** 一句话描述 */
  description: string;
  /** 预计时长(分钟) */
  estimatedMinutes: number;
  /** 步骤序列 */
  steps: TaskStepDef[];
  /** 适用的行业(用于 demo 引导任务匹配) */
  applicableIndustries: string[];
}

/**
 * 任务流步骤定义
 */
export interface TaskStepDef {
  /** 步骤 ID(任务流内唯一) */
  id: string;
  /** 步骤序号(从 1 开始) */
  order: number;
  /** 显示名称 */
  name: string;
  /** 目标视图路由(跳转 URL) */
  targetRoute: string;
  /** 步骤说明(用户看到的指引) */
  instruction: string;
  /** 完成条件(用户如何判断这步做完) */
  completionHint: string;
  /** 可选:自动填充的 query 参数(demo 模式用) */
  demoParams?: Record<string, string>;
}

/**
 * 任务流运行实例(用户启动一次任务流 = 一个实例)
 */
export interface TaskFlowInstance {
  /** 实例 ID(UUID) */
  instanceId: string;
  /** 任务流 ID */
  flowId: TaskFlowId;
  /** 当前步骤序号(从 1 开始) */
  currentStep: number;
  /** 启动时间(ISO) */
  startedAt: string;
  /** 上下文(跨步骤传递的数据) */
  context: TaskContext;
  /** 是否 demo 模式(只读) */
  isDemo: boolean;
  /** 状态:running / completed / cancelled */
  status: "running" | "completed" | "cancelled";
}

/**
 * 任务上下文(跨步骤传递)
 */
export interface TaskContext {
  /** 规则 ID(加规则/改规则/审规则) */
  ruleId?: string;
  /** 业务事件 ID(加规则测试 / 查问题) */
  eventId?: string;
  /** 审计范围(查问题/看历史) */
  auditRange?: { from: number; to: number };
  /** 选中的业务对象(如病人 ID / 案件 ID) */
  businessObject?: { type: string; id: string };
  /** 数据集 ID(加规则可选加入数据集) */
  datasetId?: string;
  /** 协作任务 ID(审规则) */
  reviewTaskId?: string;
  /** 自由扩展字段 */
  extra?: Record<string, unknown>;
}
```

### 4.2 GuidedTask 类型(demo 引导任务)

```typescript
// src/lib/data/guided-tasks.ts

import type { TaskFlowId, TaskContext } from "$lib/stores/task-flow-types";

/**
 * demo 模式引导任务(4 个,对应 HOME_DESIGN §5.8.4)
 */
export interface GuidedTask {
  /** 引导任务 ID */
  id: "try_add" | "try_query" | "try_edit" | "try_compliance";
  /** 显示名称 */
  name: string;
  /** 预计时长 */
  estimatedMinutes: number;
  /** 对应的 TaskFlowId */
  flowId: TaskFlowId;
  /** 预填上下文(医疗/财务两套) */
  presetContext: {
    medical: TaskContext;
    finance: TaskContext;
  };
  /** 引导文案(显示在 DemoHome 卡片上) */
  pitch: string;
}

export const GUIDED_TASKS: GuidedTask[] = [
  {
    id: "try_add",
    name: "试试加规则",
    estimatedMinutes: 2,
    flowId: "add_rule",
    presetContext: {
      medical: {
        ruleId: "R-DEMO-001",
        businessObject: { type: "patient", id: "P-1283" },
      },
      finance: {
        ruleId: "R-DEMO-F-001",
        businessObject: { type: "invoice", id: "INV-2024-0183" },
      },
    },
    pitch: "给医院加一条「65 岁以上发烧必须先 CT」规则",
  },
  {
    id: "try_query",
    name: "试试查问题",
    estimatedMinutes: 1,
    flowId: "query_issue",
    presetContext: {
      medical: {
        eventId: "E-DEMO-042",
        businessObject: { type: "patient", id: "P-1283" },
        auditRange: { from: 100, to: 150 },
      },
      finance: {
        eventId: "E-DEMO-F-042",
        businessObject: { type: "invoice", id: "INV-2024-0183" },
        auditRange: { from: 80, to: 120 },
      },
    },
    pitch: "定位病人 P-1283 为何触发异常告警",
  },
  {
    id: "try_edit",
    name: "试试改规则",
    estimatedMinutes: 3,
    flowId: "edit_rule",
    presetContext: {
      medical: {
        ruleId: "R-DEMO-001",
        extra: {
          editField: "temperature_threshold",
          oldValue: 38,
          newValue: 37.5,
        },
      },
      finance: {
        ruleId: "R-DEMO-F-001",
        extra: {
          editField: "reimbursement_limit",
          oldValue: 5000,
          newValue: 6000,
        },
      },
    },
    pitch: "把发烧阈值从 38°C 改为 37.5°C",
  },
  {
    id: "try_compliance",
    name: "试试合规门禁",
    estimatedMinutes: 2,
    flowId: "compliance_gate",
    presetContext: {
      medical: {
        ruleId: "djbh.identity.mfa_required",
        extra: {
          toolCall: {
            name: "transfer_money",
            category: "finance",
            amount: 50000,
          },
          userAuth: { factors: ["password"], count: 1 },
          expectBlocked: true,
          clause: "8.1.4.1.d",
        },
      },
      finance: {
        ruleId: "djbh.confidentiality.storage_encryption",
        extra: {
          toolCall: {
            name: "db_write",
            fields: { id_card: "310101199001011234" },
          },
          encryption: "none",
          expectBlocked: true,
          clause: "8.1.4.7.b",
        },
      },
    },
    pitch: "AI Agent 调用转账工具但未双因子认证 → 看门禁如何阻断 + BLAKE3 留痕",
  },
];
```

### 4.3 TaskHistoryEntry 类型

```typescript
// src/lib/stores/task-history.ts

import type { TaskFlowId } from "./task-flow-types";

/**
 * 任务历史记录(用户可回看)
 */
export interface TaskHistoryEntry {
  /** 实例 ID */
  instanceId: string;
  /** 任务流 ID */
  flowId: TaskFlowId;
  /** 任务流名称(快照,防止定义变更后历史失配) */
  flowName: string;
  /** 完成的步骤数 */
  completedSteps: number;
  /** 总步骤数 */
  totalSteps: number;
  /** 启动时间 */
  startedAt: string;
  /** 结束时间(completed/cancelled 时填充) */
  endedAt?: string;
  /** 最终状态 */
  status: "completed" | "cancelled";
  /** 是否 demo 模式 */
  isDemo: boolean;
}
```

### 4.4 DemoData 类型(复用 HOME_DESIGN §8.4)

```typescript
// src/lib/data/demo-data-types.ts
// 复用 HOME_DESIGN §8.4 DemoData,扩展任务流所需字段

import type { TaskContext } from "$lib/stores/task-flow-types";

export interface DemoData {
  /** 4 数据卡(规则数/执行数/异常数/待办数) */
  stats: {
    rules: number;
    executions: number;
    anomalies: number;
    todos: number;
  };
  /** 预填规则列表(用于业务规则库视图) */
  rules: DemoRule[];
  /** 预填业务事件列表(用于业务执行台 / 业务审计) */
  events: DemoEvent[];
  /** 预填审计条目(用于业务审计 / 时间旅行) */
  auditEntries: DemoAuditEntry[];
  /** 预填任务上下文(用于引导任务) */
  taskContexts: {
    add_rule: TaskContext;
    query_issue: TaskContext;
    edit_rule: TaskContext;
    compliance_gate: TaskContext;
  };
}

export interface DemoRule {
  id: string;
  name: string;
  description: string;
  json: unknown;
  status: "draft" | "final";
}

export interface DemoEvent {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  timestamp: string;
  triggeredRuleIds: string[];
}

export interface DemoAuditEntry {
  factId: number;
  factType: string;
  logicalTime: number;
  contentHash: string;
  timestamp: string;
  ruleId?: string;
  payload: unknown;
}
```

---

## 5. Store 设计

### 5.1 Store 一览

| Store              | 文件                             | 职责                             | 持久化                              |
| ------------------ | -------------------------------- | -------------------------------- | ----------------------------------- |
| `taskFlowStore`    | `src/lib/stores/task-flow.ts`    | 当前运行的任务流实例             | ❌(刷新即取消,P1 加恢复)            |
| `taskHistoryStore` | `src/lib/stores/task-history.ts` | 任务历史记录                     | ✅ localStorage                     |
| `demoDatasetStore` | `src/lib/stores/demo-dataset.ts` | demo 数据集切换(medical/finance) | ✅ localStorage(HOME_DESIGN 已实现) |
| `taskFlowsDef`     | `src/lib/data/task-flows.ts`     | 6 TaskFlow 定义(代码内置,只读)   | ❌(代码内置)                        |
| `guidedTasksDef`   | `src/lib/data/guided-tasks.ts`   | 4 引导任务定义(代码内置,只读)    | ❌(代码内置)                        |

### 5.2 taskFlowStore(当前任务流实例)

```typescript
// src/lib/stores/task-flow.ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 当前任务流实例 store。
// - 同一时刻只允许 1 个任务流运行(避免用户混淆)
// - 启动新任务流时,若已有运行中的,提示用户先完成或取消
// - demo 模式下,任务流只读(不允许修改预填上下文)
//
// 持久化:不持久化(刷新即取消)。
//   P1 可加「恢复上次未完成的任务流」功能(持久化到 localStorage)。

import { writable, get } from "svelte/store";
import { browser } from "$app/environment";
import { goto } from "$app/navigation";
import { taskFlowsDef } from "$lib/data/task-flows";
import {
  taskHistoryStore,
  addHistoryEntry,
  updateHistoryEntry,
} from "./task-history";
import type {
  TaskFlowInstance,
  TaskFlowId,
  TaskContext,
} from "./task-flow-types";

export const taskFlowStore = writable<TaskFlowInstance | null>(null);

/**
 * 启动任务流
 * @param flowId 任务流 ID
 * @param isDemo 是否 demo 模式(只读)
 * @param presetContext 预填上下文(demo 引导任务用)
 */
export function startTaskFlow(
  flowId: TaskFlowId,
  isDemo = false,
  presetContext?: Partial<TaskContext>,
): void {
  // 若已有运行中的任务流,先记入历史(状态:cancelled)
  const current = get(taskFlowStore);
  if (current && current.status === "running") {
    cancelTaskFlow(false); // 静默取消,不跳转
  }

  const def = taskFlowsDef.find((f) => f.id === flowId);
  if (!def) throw new Error(`Unknown task flow: ${flowId}`);

  const instance: TaskFlowInstance = {
    instanceId: crypto.randomUUID(),
    flowId,
    currentStep: 1,
    startedAt: new Date().toISOString(),
    context: presetContext ?? {},
    isDemo,
    status: "running",
  };

  taskFlowStore.set(instance);
  addHistoryEntry(instance, def);

  // 跳转到第一步
  navigateToStep(instance, 1);
}

/**
 * 推进到下一步
 * @param contextUpdate 可选:更新上下文(如本步选中的 ruleId)
 */
export function nextStep(contextUpdate?: Partial<TaskContext>): void {
  const current = get(taskFlowStore);
  if (!current || current.status !== "running") return;

  const def = taskFlowsDef.find((f) => f.id === current.flowId);
  if (!def) return;

  const next = current.currentStep + 1;
  if (next > def.steps.length) {
    completeTaskFlow();
    return;
  }

  const updated: TaskFlowInstance = {
    ...current,
    currentStep: next,
    context: { ...current.context, ...contextUpdate },
  };
  taskFlowStore.set(updated);
  updateHistoryEntry(updated, def);
  navigateToStep(updated, next);
}

/**
 * 回到上一步(不修改上下文)
 */
export function prevStep(): void {
  const current = get(taskFlowStore);
  if (!current || current.status !== "running") return;

  const prev = Math.max(1, current.currentStep - 1);
  if (prev === current.currentStep) return;

  const updated: TaskFlowInstance = { ...current, currentStep: prev };
  taskFlowStore.set(updated);
  navigateToStep(updated, prev);
}

/**
 * 跳转到指定步骤(允许跳步,用于用户点进度条)
 */
export function jumpToStep(step: number): void {
  const current = get(taskFlowStore);
  if (!current || current.status !== "running") return;

  const def = taskFlowsDef.find((f) => f.id === current.flowId);
  if (!def || step < 1 || step > def.steps.length) return;

  const updated: TaskFlowInstance = { ...current, currentStep: step };
  taskFlowStore.set(updated);
  navigateToStep(updated, step);
}

/**
 * 完成任务流
 */
export function completeTaskFlow(): void {
  const current = get(taskFlowStore);
  if (!current) return;

  const def = taskFlowsDef.find((f) => f.id === current.flowId);
  if (!def) return;

  const completed: TaskFlowInstance = {
    ...current,
    status: "completed",
  };
  taskFlowStore.set(completed);
  updateHistoryEntry(completed, def);

  // 显示完成 toast(P11 缺口修复会统一 toast 组件)
  if (browser) {
    console.log(`[task-flow] 完成: ${def.name}`);
  }

  // 3 秒后清空实例
  setTimeout(() => {
    const cur = get(taskFlowStore);
    if (cur && cur.instanceId === completed.instanceId) {
      taskFlowStore.set(null);
    }
  }, 3000);
}

/**
 * 取消任务流
 * @param navigate 是否跳转回首页(默认 true)
 */
export function cancelTaskFlow(navigate = true): void {
  const current = get(taskFlowStore);
  if (!current) return;

  const def = taskFlowsDef.find((f) => f.id === current.flowId);
  if (!def) return;

  const cancelled: TaskFlowInstance = {
    ...current,
    status: "cancelled",
  };
  taskFlowStore.set(cancelled);
  updateHistoryEntry(cancelled, def);

  setTimeout(() => taskFlowStore.set(null), 100);

  if (navigate && browser) {
    goto("/");
  }
}

/**
 * 更新上下文(不推进步骤)
 */
export function updateContext(patch: Partial<TaskContext>): void {
  const current = get(taskFlowStore);
  if (!current || current.status !== "running") return;
  if (current.isDemo) return; // demo 模式只读

  taskFlowStore.set({
    ...current,
    context: { ...current.context, ...patch },
  });
}

/**
 * 跳转到指定步骤的路由
 */
function navigateToStep(instance: TaskFlowInstance, step: number): void {
  if (!browser) return;

  const def = taskFlowsDef.find((f) => f.id === instance.flowId);
  if (!def) return;

  const stepDef = def.steps[step - 1];
  if (!stepDef) return;

  // 拼 URL:基础路由 + demo 参数 + 上下文参数
  const params = new URLSearchParams();
  if (instance.isDemo) params.set("demo", "true");
  params.set("task", instance.instanceId);
  params.set("step", String(step));

  // demo 模式叠加预填参数
  if (instance.isDemo && stepDef.demoParams) {
    for (const [k, v] of Object.entries(stepDef.demoParams)) {
      params.set(k, v);
    }
  }

  const url = `${stepDef.targetRoute}?${params.toString()}`;
  goto(url);
}

/**
 * 获取当前步骤定义(派生)
 */
export function getCurrentStepDef(): TaskStepDef | null {
  const current = get(taskFlowStore);
  if (!current) return null;
  const def = taskFlowsDef.find((f) => f.id === current.flowId);
  if (!def) return null;
  return def.steps[current.currentStep - 1] ?? null;
}
```

### 5.3 taskHistoryStore(任务历史记录)

```typescript
// src/lib/stores/task-history.ts

import { writable } from "svelte/store";
import { browser } from "$app/environment";
import type { TaskHistoryEntry } from "./task-history-types";
import type { TaskFlowInstance, TaskFlowDef } from "./task-flow-types";

const STORAGE_KEY = "evorule-console-cloud:task-history";
const MAX_ENTRIES = 100; // 最多保留 100 条历史

function loadHistory(): TaskHistoryEntry[] {
  if (!browser) return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export const taskHistoryStore = writable<TaskHistoryEntry[]>(loadHistory());

taskHistoryStore.subscribe((entries) => {
  if (!browser) return;
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(entries.slice(0, MAX_ENTRIES)),
  );
});

/** 启动任务流时,新增一条历史 */
export function addHistoryEntry(
  instance: TaskFlowInstance,
  def: TaskFlowDef,
): void {
  const entry: TaskHistoryEntry = {
    instanceId: instance.instanceId,
    flowId: instance.flowId,
    flowName: def.name,
    completedSteps: 0,
    totalSteps: def.steps.length,
    startedAt: instance.startedAt,
    status: "cancelled", // 默认 cancelled,完成时更新为 completed
    isDemo: instance.isDemo,
  };
  taskHistoryStore.update((entries) =>
    [entry, ...entries].slice(0, MAX_ENTRIES),
  );
}

/** 任务流状态变化时,更新对应历史 */
export function updateHistoryEntry(
  instance: TaskFlowInstance,
  def: TaskFlowDef,
): void {
  taskHistoryStore.update((entries) =>
    entries.map((e) =>
      e.instanceId === instance.instanceId
        ? {
            ...e,
            completedSteps:
              instance.status === "completed"
                ? def.steps.length
                : Math.max(e.completedSteps, instance.currentStep - 1),
            endedAt:
              instance.status === "completed" || instance.status === "cancelled"
                ? new Date().toISOString()
                : e.endedAt,
            status: instance.status,
          }
        : e,
    ),
  );
}

/** 清空历史 */
export function clearHistory(): void {
  taskHistoryStore.set([]);
}
```

### 5.4 task-flows.ts(6 TaskFlow 定义)

```typescript
// src/lib/data/task-flows.ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 6 任务流定义(代码内置,对应 §4.3 5 任务类型 + 合规门禁专项)。
// 每个任务流 4 步骤,串起 P03-P09 的视图。

import type { TaskFlowDef } from "$lib/stores/task-flow-types";

export const taskFlowsDef: TaskFlowDef[] = [
  // ========== 1. 加规则 ==========
  {
    id: "add_rule",
    name: "加规则",
    icon: "➕",
    description: "创建新业务规则并验证生效",
    estimatedMinutes: 5,
    applicableIndustries: [
      "医疗",
      "财务",
      "律所",
      "审批",
      "合规",
      "电商",
      "进销存",
      "办公",
      "个人",
      "教育",
    ],
    steps: [
      {
        id: "create",
        order: 1,
        name: "创建规则",
        targetRoute: "/view/rules",
        instruction: "在业务规则库中,用业务表单或 LLM 辅助创建一条新规则",
        completionHint: "规则创建成功,获得规则 ID",
        demoParams: { action: "create", ruleId: "R-DEMO-001" },
      },
      {
        id: "test",
        order: 2,
        name: "测试规则",
        targetRoute: "/view/execution",
        instruction: "在业务执行台,提交一个业务事件触发新规则",
        completionHint: "规则被触发,产生 Fact",
        demoParams: { action: "test", eventId: "E-DEMO-042" },
      },
      {
        id: "verify",
        order: 3,
        name: "验证生效",
        targetRoute: "/view/state",
        instruction: "在业务状态视图,确认规则已改变业务对象状态",
        completionHint: "业务对象状态符合预期",
        demoParams: { action: "verify" },
      },
      {
        id: "audit",
        order: 4,
        name: "查看审计",
        targetRoute: "/view/audit",
        instruction: "在业务审计视图,查看规则触发的 Fact 和因果链",
        completionHint: "审计链中有新规则触发的记录",
        demoParams: { action: "audit" },
      },
    ],
  },

  // ========== 2. 查问题 ==========
  {
    id: "query_issue",
    name: "查问题",
    icon: "🔍",
    description: "定位异常业务事件的根因",
    estimatedMinutes: 3,
    applicableIndustries: ["律所", "合规", "财务", "审批"],
    steps: [
      {
        id: "find",
        order: 1,
        name: "查找异常",
        targetRoute: "/view/audit",
        instruction: "在业务审计视图,找到异常的 Fact(红色标记)",
        completionHint: "定位到异常 Fact",
        demoParams: { action: "query", eventId: "E-DEMO-042" },
      },
      {
        id: "rewind",
        order: 2,
        name: "回溯时间",
        targetRoute: "/view/timetravel",
        instruction: "在业务时间旅行,回溯到异常发生前的版本",
        completionHint: "回溯到异常发生点",
        demoParams: { action: "rewind", version: "15" },
      },
      {
        id: "causal",
        order: 3,
        name: "分析因果",
        targetRoute: "/view/audit",
        instruction: "查看因果链,定位触发异常的根因规则",
        completionHint: "找到根因规则",
        demoParams: { action: "causal", factId: "42" },
      },
      {
        id: "decision",
        order: 4,
        name: "决策支持",
        targetRoute: "/view/audit",
        instruction: "点击「决策建议」按钮,让 LLM 分析并给出修复建议",
        completionHint: "获得 LLM 决策建议",
        demoParams: { action: "decision" },
      },
    ],
  },

  // ========== 3. 改规则 ==========
  {
    id: "edit_rule",
    name: "改规则",
    icon: "✏️",
    description: "修改已有规则并验证影响",
    estimatedMinutes: 5,
    applicableIndustries: [
      "医疗",
      "财务",
      "律所",
      "审批",
      "合规",
      "电商",
      "进销存",
      "办公",
      "个人",
      "教育",
    ],
    steps: [
      {
        id: "find",
        order: 1,
        name: "找到规则",
        targetRoute: "/view/rules",
        instruction: "在业务规则库中,找到要修改的规则",
        completionHint: "选中要修改的规则",
        demoParams: { action: "edit", ruleId: "R-DEMO-001" },
      },
      {
        id: "impact",
        order: 2,
        name: "影响预览",
        targetRoute: "/view/rules",
        instruction: "修改规则字段,查看影响预览(哪些 Fact 会变)",
        completionHint: "确认影响范围可接受",
        demoParams: { action: "impact", ruleId: "R-DEMO-001" },
      },
      {
        id: "dryrun",
        order: 3,
        name: "Dry-run 验证",
        targetRoute: "/view/execution",
        instruction: "在业务执行台,用 dry-run 模式跑一遍,确认新规则行为正确",
        completionHint: "Dry-run 结果符合预期",
        demoParams: { action: "dryrun", ruleId: "R-DEMO-001" },
      },
      {
        id: "audit",
        order: 4,
        name: "确认效果",
        targetRoute: "/view/audit",
        instruction: "在业务审计视图,确认改动后的规则触发符合预期",
        completionHint: "改动生效,审计链正常",
        demoParams: { action: "audit" },
      },
    ],
  },

  // ========== 4. 审规则 ==========
  {
    id: "review_rule",
    name: "审规则",
    icon: "✅",
    description: "审核他人提交的规则草案",
    estimatedMinutes: 4,
    applicableIndustries: ["医疗", "律所", "财务", "合规", "审批"],
    steps: [
      {
        id: "inbox",
        order: 1,
        name: "查看待审",
        targetRoute: "/view/collab",
        instruction: "在协作工作流,查看待我审核的规则列表",
        completionHint: "选中一条待审规则",
        demoParams: { action: "inbox", taskId: "T-DEMO-001" },
      },
      {
        id: "detail",
        order: 2,
        name: "查看详情",
        targetRoute: "/view/rules",
        instruction: "查看规则的业务详情和 JSON 定义",
        completionHint: "理解规则意图",
        demoParams: { action: "detail", ruleId: "R-DEMO-002" },
      },
      {
        id: "verify",
        order: 3,
        name: "验证规则",
        targetRoute: "/view/execution",
        instruction: "在业务执行台,跑测试用例验证规则行为",
        completionHint: "规则行为符合预期",
        demoParams: { action: "verify", ruleId: "R-DEMO-002" },
      },
      {
        id: "approve",
        order: 4,
        name: "批准 / 驳回",
        targetRoute: "/view/collab",
        instruction: "回到协作工作流,批准或驳回规则",
        completionHint: "完成审核决定",
        demoParams: { action: "approve", taskId: "T-DEMO-001" },
      },
    ],
  },

  // ========== 5. 看历史 ==========
  {
    id: "view_history",
    name: "看历史",
    icon: "📚",
    description: "回放历史审计并导出合规报告",
    estimatedMinutes: 4,
    applicableIndustries: [
      "医疗",
      "财务",
      "律所",
      "审批",
      "合规",
      "电商",
      "进销存",
      "办公",
      "个人",
      "教育",
    ],
    steps: [
      {
        id: "select",
        order: 1,
        name: "选时间范围",
        targetRoute: "/view/audit",
        instruction: "在业务审计视图,选择要回放的时间范围",
        completionHint: "选定时间范围",
        demoParams: { action: "select", from: "100", to: "150" },
      },
      {
        id: "replay",
        order: 2,
        name: "回放历史",
        targetRoute: "/view/timetravel",
        instruction: "在业务时间旅行,回放选定的历史段",
        completionHint: "回放完成",
        demoParams: { action: "replay", from: "100", to: "150" },
      },
      {
        id: "export",
        order: 3,
        name: "导出审计",
        targetRoute: "/view/audit",
        instruction: "点击「导出审计」按钮,导出 BLAKE3 审计链",
        completionHint: "审计文件下载完成",
        demoParams: { action: "export" },
      },
      {
        id: "verify",
        order: 4,
        name: "BLAKE3 验证",
        targetRoute: "/view/audit",
        instruction: "点击「验证审计链」按钮,确认审计完整性",
        completionHint: "验证通过(verified: true)",
        demoParams: { action: "verify" },
      },
    ],
  },

  // ========== 6. 合规门禁(对应 COMPLIANCE_GATE_DESIGN.md) ==========
  {
    id: "compliance_gate",
    name: "合规门禁",
    icon: "🛡️",
    description:
      "体验等保 2.0 三级 AI Agent 行为门禁:工具调用前合规检查 + BLAKE3 留痕",
    estimatedMinutes: 4,
    applicableIndustries: ["合规", "医疗", "财务", "教育"],
    steps: [
      {
        id: "import_rules",
        order: 1,
        name: "导入门禁规则",
        targetRoute: "/view/rules",
        instruction:
          "从模板市场导入 5 条等保 2.0 三级门禁规则(MFA / 存储加密 / 脱敏 / 高危端口 / 数据溯源)",
        completionHint: "5 条门禁规则导入成功,规则库中出现 djbh.* 前缀规则",
        demoParams: {
          action: "import",
          templateId: "builtin.compliance_starter",
          ruleCount: 5,
        },
      },
      {
        id: "simulate_call",
        order: 2,
        name: "模拟工具调用",
        targetRoute: "/view/execution",
        instruction:
          "模拟 AI Agent 调用 transfer_money(管理类工具),仅密码认证(无 MFA)→ 应被门禁阻断",
        completionHint:
          "门禁触发 block,返回「等保 §8.1.4.1.d: 管理类操作必须双因子认证」",
        demoParams: {
          action: "test",
          eventId: "E-DEMO-CG-001",
          toolCall: {
            name: "transfer_money",
            category: "finance",
            amount: 50000,
          },
          userAuth: { factors: ["password"], count: 1 },
          expectBlocked: true,
        },
      },
      {
        id: "view_gate_result",
        order: 3,
        name: "查看门禁结果",
        targetRoute: "/view/state",
        instruction:
          "在监控大屏查看门禁 Fact:blocked + 告警级别 + 阻断原因 + 等保条款号",
        completionHint: "监控大屏显示 1 条 critical 级门禁阻断事件",
        demoParams: {
          action: "verify",
          factType: "blocked",
          riskLevel: "high",
          clause: "8.1.4.1.d",
        },
      },
      {
        id: "audit_trace",
        order: 4,
        name: "审计追溯",
        targetRoute: "/view/audit",
        instruction:
          "在审计视图查看门禁事件的 BLAKE3 哈希链 + 因果链(谁触发了哪个工具 → 被哪条规则阻断)",
        completionHint: "审计链中有门禁记录,BLAKE3 验证通过,可导出合规报告",
        demoParams: {
          action: "audit",
          exportFormat: "pdf",
          reportType: "compliance_gate",
        },
      },
    ],
  },
];

/** 按 ID 查找任务流定义 */
export function findTaskFlow(id: string): TaskFlowDef | undefined {
  return taskFlowsDef.find((f) => f.id === id);
}
```

---

## 6. 组件树

### 6.1 顶层组件树

```
App
└── HomeRouter(HOME_DESIGN)
    ├── 状态 A:DemoHome
    │   ├── DemoBanner
    │   ├── DemoDatasetSwitcher
    │   ├── StatsCards
    │   ├── DemoGrid
    │   │   ├── GuidedTasks ← P0-10 增强:4 引导任务 → startTaskFlow(flowId, isDemo=true, presetContext)
    │   │   └── CapabilityList
    │   └── CtaFooter
    │
    ├── 状态 B:OnboardingWizard(P0-1)
    │
    └── 状态 C:RealWorkbench(层感知)
        ├── TopNav ← P0-10 增强:任务流下拉(6 任务流)
        │   └── TaskFlowDropdown ← 新增
        ├── MonitorDashboard(L1) 或 WorkspaceConsole(L2)
        └── TaskFlowWizard ← 新增(浮在顶部导航下方,运行中显示)
            ├── TaskStepBar(进度条 + 步骤点)
            ├── TaskInstruction(当前步骤指引)
            └── TaskActions(上一步 / 下一步 / 取消)
```

### 6.2 TaskFlowWizard 组件树

```
TaskFlowWizard.svelte
├── TaskHeader
│   ├── TaskIcon + TaskName(如「➕ 加规则」)
│   ├── TaskProgressBar(步骤 2/4)
│   └── TaskCancelButton(×)
│
├── TaskStepBar
│   ├── Step1 ●(已完成:绿色)
│   ├── Step2 ●(当前:蓝色)
│   ├── Step3 ○(未完成:灰色)
│   └── Step4 ○(未完成:灰色)
│
├── TaskInstruction
│   ├── StepName(如「测试规则」)
│   ├── InstructionText(如「在业务执行台,提交一个业务事件触发新规则」)
│   └── CompletionHint(如「规则被触发,产生 Fact」)
│
└── TaskActions
    ├── PrevButton(上一步)
    ├── NextButton(下一步,主按钮)
    └── CancelButton(取消)
```

### 6.3 TaskFlowDropdown 组件树

```
TaskFlowDropdown.svelte(顶部导航下拉)
├── DropdownTrigger
│   └── 「任务流 ▼」按钮
└── DropdownMenu
    ├── MenuItem(add_rule)→ startTaskFlow('add_rule')
    ├── MenuItem(query_issue)→ startTaskFlow('query_issue')
    ├── MenuItem(edit_rule)→ startTaskFlow('edit_rule')
    ├── MenuItem(review_rule)→ startTaskFlow('review_rule')
    ├── MenuItem(view_history)→ startTaskFlow('view_history')
    ├── MenuItem(compliance_gate)→ startTaskFlow('compliance_gate')
    └── MenuDivider
    └── MenuItem(history)→ goto('/view/history')
```

### 6.4 布局示意(状态 C,任务流运行中)

```
┌─────────────────────────────────────────────────────────────────┐
│ [logo] [任务流 ▼] [L1 监控] [L2 编辑] [🔔] [👤] [看 demo]      │ ← 顶部导航
├─────────────────────────────────────────────────────────────────┤
│ ┌─TaskFlowWizard─────────────────────────────────────────────┐ │
│ │ ➕ 加规则 · 步骤 2/4                                         │ │
│ │ ●─────●─────○─────○                                          │ │
│ │ 测试规则                                                      │ │
│ │ 在业务执行台,提交一个业务事件触发新规则                       │ │
│ │ ✓ 规则被触发,产生 Fact                                       │ │
│ │ [← 上一步]                              [下一步 →] [× 取消]  │ │
│ └────────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  当前视图内容(业务执行台 / 业务规则库 / 业务审计 等)             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 6.5 demo 模式 4 引导任务卡片(DemoHome 内)

```
┌─试试这些任务(4 个引导)──────────┐
│                                    │
│ 👉 试试加规则(2 分钟)             │ → startTaskFlow('add_rule', isDemo=true, presetContext=medical/finance)
│   给医院加一条「65 岁以上发烧...    │
│                                    │
│ 👉 试试查问题(1 分钟)             │ → startTaskFlow('query_issue', isDemo=true, presetContext=...)
│   定位病人 P-1283 为何触发异常...   │
│                                    │
│ 👉 试试改规则(3 分钟)             │ → startTaskFlow('edit_rule', isDemo=true, presetContext=...)
│   把发烧阈值从 38°C 改为 37.5°C    │
│                                    │
│ 🛡️ 试试合规门禁(2 分钟)           │ → startTaskFlow('compliance_gate', isDemo=true, presetContext=...)
│   AI Agent 调用转账但未 MFA → ...  │
│                                    │
└────────────────────────────────────┘
```

---

## 7. 数据流

### 7.1 启动任务流(从顶部导航下拉)

```
用户点「任务流 ▼」→ 选「加规则」
  ↓
TaskFlowDropdown 触发 onStart('add_rule')
  ↓
startTaskFlow('add_rule', isDemo=false)
  ↓
taskFlowStore.set({instanceId, flowId:'add_rule', currentStep:1, ...})
  ↓
addHistoryEntry(instance, def) → taskHistoryStore 更新
  ↓
navigateToStep(instance, 1)
  ↓
goto('/view/rules?task={instanceId}&step=1')
  ↓
RealWorkbench 检测 taskFlowStore 非空 → 渲染 TaskFlowWizard
  ↓
TaskFlowWizard 显示「➕ 加规则 · 步骤 1/4 · 创建规则」
  ↓
业务规则库视图加载,用户开始创建规则
```

### 7.2 启动 demo 引导任务(从 DemoHome)

```
访客打开 https://evo-rule-lab.github.io/evorule-console-cloud/
  ↓
未登录 → HomeRouter 选状态 A → 渲染 DemoHome
  ↓
DemoHome 加载 demoDatasetStore(默认 medical)
  ↓
渲染 4 个 GuidedTasks 卡片
  ↓
访客点「👉 试试加规则」
  ↓
GuidedTasks 触发 onTaskClick('try_add')
  ↓
查找 GUIDED_TASKS.find(g => g.id === 'try_add')
  ↓
presetContext = guidedTask.presetContext[$demoDatasetStore]  // medical 或 finance
  ↓
startTaskFlow('add_rule', isDemo=true, presetContext)
  ↓
taskFlowStore.set({instanceId, flowId:'add_rule', currentStep:1, isDemo:true, context:presetContext})
  ↓
navigateToStep(instance, 1)
  ↓
goto('/view/rules?demo=true&task={instanceId}&step=1&action=create&ruleId=R-DEMO-001')
  ↓
业务规则库视图检测 demo=true → 加载 demo 规则(只读模式)
  ↓
TaskFlowWizard 显示(带 demo 标记)
```

### 7.3 任务步骤推进(以加规则为例)

```
步骤 1 创建规则:用户在业务规则库创建规则 R-001
  ↓
用户点「下一步」
  ↓
TaskFlowWizard 触发 onNext({ruleId: 'R-001'})
  ↓
nextStep({ruleId: 'R-001'})
  ↓
taskFlowStore.set({...current, currentStep:2, context:{ruleId:'R-001'}})
  ↓
updateHistoryEntry(updated, def) → completedSteps=1
  ↓
navigateToStep(updated, 2)
  ↓
goto('/view/execution?task={instanceId}&step=2')
  ↓
TaskFlowWizard 显示「步骤 2/4 · 测试规则」
  ↓
用户在业务执行台提交事件 → 规则 R-001 触发
  ↓
用户点「下一步」
  ↓
nextStep({eventId: 'E-042'})
  ↓
... 步骤 3 验证生效 → 步骤 4 查看审计
  ↓
步骤 4 完成后点「下一步」(实际是「完成」)
  ↓
completeTaskFlow()
  ↓
taskFlowStore.set({...current, status:'completed'})
  ↓
updateHistoryEntry → status:'completed', completedSteps:4, endedAt:now
  ↓
TaskFlowWizard 显示「✓ 任务完成」toast(3 秒)
  ↓
taskFlowStore.set(null) → TaskFlowWizard 消失
```

### 7.4 demo 模式只读保护

```
demo 模式下,任务流步骤中的视图检测 ?demo=true
  ↓
视图进入只读模式:
  - 业务规则库:规则不可编辑,显示「这是 demo 数据」banner
  - 业务执行台:事件不可提交,显示「试用模式,仅查看」
  - 业务审计:只读,无修改操作
  - 业务时间旅行:只读回放,无 fork/rollback
  ↓
TaskFlowWizard 的「下一步」按钮仍可用(用户可推进步骤)
  ↓
updateContext() 被忽略(isDemo:true 时直接 return)
  ↓
预填上下文保持不变,多个访客互不影响
```

### 7.5 任务历史查看

```
用户点「任务流 ▼」→ 「历史」
  ↓
goto('/view/history')
  ↓
TaskHistoryView 加载 taskHistoryStore
  ↓
渲染历史列表:
  - ➕ 加规则 · 4/4 步 · 2026-08-06 14:30 · ✓ 完成
  - 🔍 查问题 · 2/4 步 · 2026-08-06 13:15 · × 取消
  - 📚 看历史 · 4/4 步 · 2026-08-05 18:00 · ✓ 完成(demo)
  ↓
用户点某条历史 → 查看详情(实例 ID / 上下文 / 各步骤时间)
```

---

## 8. 关键代码示例

### 8.1 TaskFlowWizard.svelte(主视图)

```svelte
<!-- src/lib/views/TaskFlow/TaskFlowWizard.svelte -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:任务流向导(浮在顶部导航下方,运行中显示)
    - 显示当前任务流名称 + 进度
    - 显示当前步骤的指引
    - 提供上一步 / 下一步 / 取消按钮
    - demo 模式显示 demo 标记
  依赖:taskFlowStore / taskFlowsDef
-->

<script lang="ts">
  import { taskFlowStore, nextStep, prevStep, cancelTaskFlow, jumpToStep } from '$lib/stores/task-flow';
  import { findTaskFlow } from '$lib/data/task-flows';

  const current = $derived($taskFlowStore);
  const def = $derived(current ? findTaskFlow(current.flowId) : null);
  const currentStepDef = $derived(
    def && current ? def.steps[current.currentStep - 1] : null,
  );
  const isLastStep = $derived(
    def && current ? current.currentStep === def.steps.length : false,
  );
</script>

{#if current && def && current.status === 'running' && currentStepDef}
  <div class="task-flow-wizard" class:demo={current.isDemo}>
    <div class="task-header">
      <span class="task-icon">{def.icon}</span>
      <span class="task-name">{def.name}</span>
      <span class="task-progress">步骤 {current.currentStep}/{def.steps.length}</span>
      {#if current.isDemo}
        <span class="demo-badge">DEMO</span>
      {/if}
      <button class="cancel-btn" onclick={() => cancelTaskFlow()}>×</button>
    </div>

    <div class="task-step-bar">
      {#each def.steps as step, i}
        <button
          class="step-dot"
          class:completed={i + 1 < current.currentStep}
          class:current={i + 1 === current.currentStep}
          onclick={() => jumpToStep(i + 1)}
          title={step.name}
        >
          {i + 1}
        </button>
        {#if i < def.steps.length - 1}
          <div class="step-line" class:filled={i + 1 < current.currentStep}></div>
        {/if}
      {/each}
    </div>

    <div class="task-instruction">
      <div class="step-name">{currentStepDef.name}</div>
      <div class="instruction-text">{currentStepDef.instruction}</div>
      <div class="completion-hint">✓ {currentStepDef.completionHint}</div>
    </div>

    <div class="task-actions">
      <button
        class="btn-prev"
        onclick={() => prevStep()}
        disabled={current.currentStep === 1}
      >
        ← 上一步
      </button>
      <button class="btn-next" onclick={() => nextStep()}>
        {isLastStep ? '✓ 完成' : '下一步 →'}
      </button>
    </div>
  </div>
{/if}

<style>
  .task-flow-wizard {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 8px;
    padding: 12px 16px;
    margin: 8px 0;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  }
  .task-flow-wizard.demo {
    border-color: var(--color-warning);
    background: var(--color-warning-bg);
  }
  .task-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }
  .task-icon { font-size: 18px; }
  .task-name { font-weight: 600; }
  .task-progress { color: var(--color-text-secondary); font-size: 13px; }
  .demo-badge {
    background: var(--color-warning);
    color: white;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 11px;
  }
  .cancel-btn {
    margin-left: auto;
    background: none;
    border: none;
    font-size: 20px;
    cursor: pointer;
    color: var(--color-text-secondary);
  }
  .task-step-bar {
    display: flex;
    align-items: center;
    gap: 4px;
    margin: 8px 0;
  }
  .step-dot {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    border: 2px solid var(--color-border);
    background: var(--color-surface);
    cursor: pointer;
    font-size: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .step-dot.completed {
    background: var(--color-success);
    border-color: var(--color-success);
    color: white;
  }
  .step-dot.current {
    background: var(--color-primary);
    border-color: var(--color-primary);
    color: white;
  }
  .step-line {
    flex: 1;
    height: 2px;
    background: var(--color-border);
  }
  .step-line.filled {
    background: var(--color-success);
  }
  .task-instruction {
    margin: 8px 0;
  }
  .step-name { font-weight: 600; margin-bottom: 4px; }
  .instruction-text { color: var(--color-text-secondary); font-size: 14px; margin-bottom: 4px; }
  .completion-hint { color: var(--color-success); font-size: 13px; }
  .task-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }
  .btn-prev, .btn-next {
    padding: 6px 16px;
    border-radius: 4px;
    cursor: pointer;
    border: 1px solid var(--color-border);
  }
  .btn-next {
    background: var(--color-primary);
    color: white;
    border-color: var(--color-primary);
  }
  .btn-prev:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
```

### 8.2 TaskFlowDropdown.svelte(顶部导航下拉)

```svelte
<!-- src/lib/views/TaskFlow/TaskFlowDropdown.svelte -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->

<script lang="ts">
  import { goto } from '$app/navigation';
  import { startTaskFlow } from '$lib/stores/task-flow';
  import { taskFlowsDef } from '$lib/data/task-flows';
  import { browser } from '$app/environment';

  let open = $state(false);

  function handleSelect(flowId: 'add_rule' | 'query_issue' | 'edit_rule' | 'review_rule' | 'view_history' | 'compliance_gate') {
    startTaskFlow(flowId, false);
    open = false;
  }

  function handleHistory() {
    goto('/view/history');
    open = false;
  }
</script>

<div class="task-flow-dropdown">
  <button class="dropdown-trigger" onclick={() => (open = !open)}>
    任务流 ▼
  </button>

  {#if open}
    <div class="dropdown-menu">
      {#each taskFlowsDef as flow}
        <button class="menu-item" onclick={() => handleSelect(flow.id)}>
          <span class="icon">{flow.icon}</span>
          <span class="name">{flow.name}</span>
          <span class="desc">{flow.description}</span>
        </button>
      {/each}
      <div class="menu-divider"></div>
      <button class="menu-item" onclick={handleHistory}>
        <span class="icon">📜</span>
        <span class="name">任务历史</span>
      </button>
    </div>
  {/if}
</div>

<style>
  .task-flow-dropdown {
    position: relative;
  }
  .dropdown-trigger {
    padding: 6px 12px;
    border: 1px solid var(--color-border);
    border-radius: 4px;
    background: var(--color-surface);
    cursor: pointer;
  }
  .dropdown-menu {
    position: absolute;
    top: 100%;
    left: 0;
    min-width: 280px;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 4px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    z-index: 100;
  }
  .menu-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px 12px;
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
  }
  .menu-item:hover {
    background: var(--color-hover);
  }
  .menu-item .icon { width: 20px; }
  .menu-item .name { font-weight: 600; min-width: 60px; }
  .menu-item .desc { color: var(--color-text-secondary); font-size: 12px; }
  .menu-divider {
    height: 1px;
    background: var(--color-border);
    margin: 4px 0;
  }
</style>
```

### 8.3 GuidedTasks.svelte(DemoHome 引导任务,增强版)

```svelte
<!-- src/lib/views/Home/Demo/GuidedTasks.svelte -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:demo 模式 4 引导任务卡片(增强版)
    - 原 HOME_DESIGN §8.3 是单页跳转,本组件升级为启动只读 TaskFlow
    - 根据 demoDatasetStore 选 medical/finance 的预填上下文
-->

<script lang="ts">
  import { demoDatasetStore } from '$lib/stores/demo-dataset';
  import { startTaskFlow } from '$lib/stores/task-flow';
  import { GUIDED_TASKS } from '$lib/data/guided-tasks';

  function handleTaskClick(taskId: 'try_add' | 'try_query' | 'try_edit' | 'try_compliance') {
    const task = GUIDED_TASKS.find((g) => g.id === taskId);
    if (!task) return;

    const dataset = $demoDatasetStore;
    const presetContext = task.presetContext[dataset];

    // 启动只读任务流
    startTaskFlow(task.flowId, true, presetContext);
  }
</script>

<div class="guided-tasks">
  <h3>试试这些任务(4 个引导)</h3>
  <div class="task-list">
    {#each GUIDED_TASKS as task}
      <button class="task-card" onclick={() => handleTaskClick(task.id)}>
        <span class="task-emoji">👉</span>
        <div class="task-content">
          <div class="task-name">
            {task.name}
            <span class="task-time">({task.estimatedMinutes} 分钟)</span>
          </div>
          <div class="task-pitch">{task.pitch}</div>
        </div>
      </button>
    {/each}
  </div>
</div>

<style>
  .guided-tasks {
    padding: 16px;
    background: var(--color-surface);
    border-radius: 8px;
  }
  h3 {
    margin: 0 0 12px 0;
    font-size: 15px;
  }
  .task-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .task-card {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 12px;
    background: var(--color-bg);
    border: 1px solid var(--color-border);
    border-radius: 6px;
    cursor: pointer;
    text-align: left;
  }
  .task-card:hover {
    border-color: var(--color-primary);
  }
  .task-emoji { font-size: 18px; }
  .task-name { font-weight: 600; font-size: 14px; }
  .task-time { color: var(--color-text-secondary); font-weight: normal; font-size: 12px; }
  .task-pitch { color: var(--color-text-secondary); font-size: 13px; margin-top: 4px; }
</style>
```

### 8.4 MockBackend(在线 demo 后端)

```typescript
// src/lib/backend/mock-backend.ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// MockBackend:在线 demo 用的浏览器内 mock 后端。
// - 实现 ExecutionBackend 接口(HOME_DESIGN §1.2)
// - 所有方法返回预填数据(医疗/财务两套)
// - SSE 用 setTimeout 模拟(不调用真实 HTTP)
// - 用于 GitHub Pages 部署(零后端依赖)

import type {
  ExecutionBackend,
  SessionId,
  SessionState,
  SessionAudit,
  VerifyResult,
  Fact,
  CausalEntry,
  CausalChain,
  HistoricalState,
  DiffResult,
  CommandResult,
} from "./types";
import { medicalData } from "$lib/data/demo-medical";
import { financeData } from "$lib/data/demo-finance";
import { demoDatasetStore } from "$lib/stores/demo-dataset";
import { get } from "svelte/store";

export class MockBackend implements ExecutionBackend {
  private sessionId: SessionId = 1;
  private listeners: ((event: unknown) => void)[] = [];
  private sseTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // 模拟 SSE Fact 流(每 3s 推一条)
    this.sseTimer = setInterval(() => {
      const dataset = get(demoDatasetStore);
      const data = dataset === "medical" ? medicalData : financeData;
      const randomEvent =
        data.events[Math.floor(Math.random() * data.events.length)];
      this.listeners.forEach((fn) =>
        fn({ type: "fact", payload: randomEvent }),
      );
    }, 3000);
  }

  async health(): Promise<boolean> {
    return true;
  }

  async createSession(): Promise<SessionId> {
    return this.sessionId;
  }

  async listSessions(): Promise<SessionId[]> {
    return [this.sessionId];
  }

  async closeSession(_id: SessionId): Promise<void> {
    // no-op
  }

  async getSessionState(_id: SessionId): Promise<SessionState> {
    const dataset = get(demoDatasetStore);
    const data = dataset === "medical" ? medicalData : financeData;
    return {
      payload: {},
      queue: [],
      reactor: {
        phase: "executing",
        causal_depth: 3,
        current_step: 142,
        pending_io_count: 0,
        structural_invariant_violations: 0,
      },
      version: 17,
    };
  }

  async submitCommand(
    _id: SessionId,
    _command: unknown,
  ): Promise<CommandResult> {
    // demo 模式:返回 accepted,不真正执行
    return { accepted: true, version: 18 };
  }

  async getHistory(_id: SessionId): Promise<Fact[]> {
    const dataset = get(demoDatasetStore);
    const data = dataset === "medical" ? medicalData : financeData;
    return data.events as Fact[];
  }

  async getReplay(_id: SessionId, _from: number, _to: number): Promise<Fact[]> {
    const dataset = get(demoDatasetStore);
    const data = dataset === "medical" ? medicalData : financeData;
    return data.events.slice(_from, _to) as Fact[];
  }

  async getFacts(_id: SessionId, _prefix: string): Promise<unknown[]> {
    const dataset = get(demoDatasetStore);
    const data = dataset === "medical" ? medicalData : financeData;
    return data.auditEntries;
  }

  async getAudit(_id: SessionId): Promise<SessionAudit> {
    const dataset = get(demoDatasetStore);
    const data = dataset === "medical" ? medicalData : financeData;
    return {
      entries: data.auditEntries,
      fact_count: data.auditEntries.length,
      verified: true,
    };
  }

  async verifyAudit(_id: SessionId): Promise<VerifyResult> {
    return { verified: true, detail: "BLAKE3 链验证通过(demo)" };
  }

  async getCausalChain(_id: SessionId, _factId: number): Promise<CausalChain> {
    const dataset = get(demoDatasetStore);
    const data = dataset === "medical" ? medicalData : financeData;
    return {
      chain: data.auditEntries.slice(0, 5).map((e) => ({
        fact_id: e.factId,
        fact_type: e.factType,
        logical_time: e.logicalTime,
        cause: e.factId > 1 ? e.factId - 1 : null,
        content_hash: e.contentHash,
      })) as CausalEntry[],
    };
  }

  async getStateAtVersion(
    _id: SessionId,
    _version: number,
  ): Promise<HistoricalState> {
    return { payload: {}, queue: [], version: _version };
  }

  async getDiff(_id: SessionId, _v1: number, _v2: number): Promise<DiffResult> {
    return { items: [] };
  }

  async forkSession(_parentId: SessionId): Promise<SessionId> {
    return this.sessionId + 1;
  }

  // === SSE 模拟 ===

  subscribeToEvents(
    _id: SessionId,
    callback: (event: unknown) => void,
  ): () => void {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter((fn) => fn !== callback);
    };
  }

  destroy(): void {
    if (this.sseTimer) clearInterval(this.sseTimer);
    this.listeners = [];
  }
}
```

### 8.5 预填数据示例(医疗,扩展 HOME_DESIGN §8.4)

```typescript
// src/lib/data/demo-medical.ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 医疗场景预填数据(扩展 HOME_DESIGN §8.4)。
// 用于 DemoHome 状态 A + 在线 demo + 4 引导任务。
// 决策者看到这个数据能秒懂「加规则 / 查问题 / 改规则 / 合规门禁」任务。

import type { DemoData } from "./demo-data-types";

export const medicalData: DemoData = {
  stats: {
    rules: 24,
    executions: 1432,
    anomalies: 3,
    todos: 8,
  },

  rules: [
    {
      id: "R-DEMO-001",
      name: "65 岁以上发烧必须先 CT",
      description: "病人年龄 ≥ 65 且体温 ≥ 38°C 时,触发 CT 检查医嘱",
      status: "final",
      json: {
        when: { all: [{ eq: ["age", 65] }, { lt: ["temperature", 38] }] },
        then: {
          io_request: {
            io_type: "call_tool",
            params: { tool: "order_ct_scan" },
          },
        },
      },
    },
    {
      id: "R-DEMO-002",
      name: "高烧告警通知医生",
      description: "病人体温 ≥ 39°C 时,通知主治医生",
      status: "draft",
      json: {
        when: { lt: ["temperature", 39] },
        then: {
          io_request: {
            io_type: "call_tool",
            params: { tool: "notify_doctor" },
          },
        },
      },
    },
  ],

  events: [
    {
      id: "E-DEMO-042",
      type: "patient_visit",
      payload: {
        patient_id: "P-1283",
        age: 72,
        temperature: 39.2,
        symptom: "fever",
      },
      timestamp: "2026-08-06T14:32:01Z",
      triggeredRuleIds: ["R-DEMO-001", "R-DEMO-002"],
    },
    {
      id: "E-DEMO-041",
      type: "patient_visit",
      payload: {
        patient_id: "P-1199",
        age: 45,
        temperature: 36.8,
        symptom: "cough",
      },
      timestamp: "2026-08-06T14:31:58Z",
      triggeredRuleIds: [],
    },
  ],

  auditEntries: [
    {
      factId: 142,
      factType: "rule_triggered",
      logicalTime: 142,
      contentHash: "blake3:abc123...",
      timestamp: "2026-08-06T14:32:01Z",
      ruleId: "R-DEMO-001",
      payload: { patient_id: "P-1283", action: "order_ct_scan" },
    },
    {
      factId: 141,
      factType: "rule_triggered",
      logicalTime: 141,
      contentHash: "blake3:def456...",
      timestamp: "2026-08-06T14:32:01Z",
      ruleId: "R-DEMO-002",
      payload: { patient_id: "P-1283", action: "notify_doctor" },
    },
  ],

  taskContexts: {
    add_rule: {
      ruleId: "R-DEMO-001",
      businessObject: { type: "patient", id: "P-1283" },
    },
    query_issue: {
      eventId: "E-DEMO-042",
      businessObject: { type: "patient", id: "P-1283" },
      auditRange: { from: 100, to: 150 },
    },
    edit_rule: {
      ruleId: "R-DEMO-001",
      extra: {
        editField: "temperature_threshold",
        oldValue: 38,
        newValue: 37.5,
      },
    },
    compliance_gate: {
      ruleId: "djbh.identity.mfa_required",
      extra: {
        toolCall: {
          name: "transfer_money",
          category: "finance",
          amount: 50000,
        },
        userAuth: { factors: ["password"], count: 1 },
        expectBlocked: true,
        clause: "8.1.4.1.d",
      },
    },
  },
};
```

### 8.6 README 决策者入口片段

```markdown
<!-- 在 README.md 顶部「定位」章节前插入 -->

## 给决策者(30 秒看懂)

> evorule 是 AI Agent 的「合规审计层」— 让 AI Agent 的每个决策可审计、可回放、可回滚。

### 为什么需要 evorule?

| 痛点                               | evorule 解法                                             |
| ---------------------------------- | -------------------------------------------------------- |
| AI Agent 决策不透明,出问题无法追溯 | BLAKE3 哈希链,每个决策不可篡改,满足 EU AI Act Article 12 |
| 出问题无法定位根因                 | 时间旅行(rewind/diff/replay)+ 因果链 DAG 分析            |
| 合规审计难通过                     | 审计导出(JSON/CSV/PDF/XML)+ BLAKE3 完整性验证            |
| 规则变更影响未知                   | 影响预览 + Dry-run + 一键回滚                            |

### 在线体验

👉 **[在线 demo](https://evo-rule-lab.github.io/evorule-console-cloud/)**(无需注册,医疗 + 财务两套场景)

### 4 个引导任务

| 任务            | 时长   | 场景                                               |
| --------------- | ------ | -------------------------------------------------- |
| ➕ 试试加规则   | 2 分钟 | 给医院加一条「65 岁以上发烧必须先 CT」规则         |
| 🔍 试试查问题   | 1 分钟 | 定位病人 P-1283 为何触发异常告警                   |
| ✏️ 试试改规则   | 3 分钟 | 把发烧阈值从 38°C 改为 37.5°C                      |
| 🛡️ 试试合规门禁 | 2 分钟 | AI Agent 调用转账但未 MFA → 门禁阻断 + BLAKE3 留痕 |

### 核心能力

- ✅ **确定性执行** — 规则即数据,LLM 只辅助,用户审核才生效
- ✅ **可审计** — BLAKE3 不可篡改审计链
- ✅ **可回放** — 时间旅行 5 视图(timeline/state/causal/diff/whatif)
- ✅ **LLM 辅助** — 自然语言写规则,业务表单输入
- ✅ **热重载** — 滚动 session 模式,不中断运行
- ✅ **合规架构** — 满足 EU AI Act / 中国等保 2.0

### 截图

| 监控大屏                                              | 业务审计                                           | 时间旅行                                        |
| ----------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------- |
| ![监控大屏](./docs/screenshots/monitor-dashboard.png) | ![业务审计](./docs/screenshots/business-audit.png) | ![时间旅行](./docs/screenshots/time-travel.png) |

### Case Study

- [医疗行业 PoC:三甲医院 AI 诊断合规](./docs/case-studies/medical.md)
- [财务行业 PoC:企业报销自动化审计](./docs/case-studies/finance.md)

### 与竞品对比

| 能力           | evorule   | LangSmith | Langfuse |
| -------------- | --------- | --------- | -------- |
| 审计链不可篡改 | ✅ BLAKE3 | ❌        | ❌       |
| 时间旅行回放   | ✅ 5 视图 | ❌        | 部分     |
| 因果链分析     | ✅ DAG    | ❌        | ❌       |
| 一键回滚       | ✅        | ❌        | ❌       |
| 合规导出       | ✅ 4 格式 | 部分      | 部分     |
| LLM 辅助       | ✅        | ✅        | ✅       |

---

<!-- 后接原「定位」章节 -->
```

### 8.7 在线 demo 部署(GitHub Actions)

```yaml
# .github/workflows/deploy-demo.yml
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 EvoRule Project
#
# 在线 demo 自动部署到 GitHub Pages。
# - main 分支 push 时触发
# - 构建 SvelteKit adapter-static 产物
# - 部署到 GitHub Pages(公网可访问)
# - demo 模式自动激活(未登录 → 状态 A)

name: Deploy Demo to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: "pages"
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"

      - run: npm ci

      - run: npm run build
        env:
          # demo 模式标志:构建时注入,运行时未登录自动进状态 A
          VITE_DEMO_MODE: "true"
          # base path(GitHub Pages 项目站点)
          VITE_BASE_PATH: "/evorule-console-cloud/"

      - uses: actions/upload-pages-artifact@v3
        with:
          path: ./build

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

---

## 9. 测试策略

### 9.1 单元测试(Vitest)

```typescript
// tests/unit/task-flow.test.ts

import { describe, it, expect, beforeEach } from "vitest";
import {
  startTaskFlow,
  nextStep,
  prevStep,
  cancelTaskFlow,
  taskFlowStore,
} from "$lib/stores/task-flow";
import { taskHistoryStore } from "$lib/stores/task-history";
import { taskFlowsDef } from "$lib/data/task-flows";
import { GUIDED_TASKS } from "$lib/data/guided-tasks";

describe("TaskFlow 定义", () => {
  it("应有 6 个任务流", () => {
    expect(taskFlowsDef).toHaveLength(6);
  });

  it("每个任务流应有 4 个步骤", () => {
    for (const flow of taskFlowsDef) {
      expect(flow.steps).toHaveLength(4);
    }
  });

  it("步骤序号应连续(1-4)", () => {
    for (const flow of taskFlowsDef) {
      expect(flow.steps.map((s) => s.order)).toEqual([1, 2, 3, 4]);
    }
  });

  it("每个步骤应有 targetRoute", () => {
    for (const flow of taskFlowsDef) {
      for (const step of flow.steps) {
        expect(step.targetRoute).toMatch(/^\/view\//);
      }
    }
  });
});

describe("GuidedTask 定义", () => {
  it("应有 4 个引导任务", () => {
    expect(GUIDED_TASKS).toHaveLength(4);
  });

  it("每个引导任务应有 medical 和 finance 预填上下文", () => {
    for (const task of GUIDED_TASKS) {
      expect(task.presetContext.medical).toBeDefined();
      expect(task.presetContext.finance).toBeDefined();
    }
  });
});

describe("taskFlowStore", () => {
  beforeEach(() => {
    taskFlowStore.set(null);
  });

  it("启动任务流后,store 应非空", () => {
    startTaskFlow("add_rule", false);
    expect(taskFlowStore).not.toBeNull();
  });

  it("demo 模式应标记 isDemo", () => {
    startTaskFlow("add_rule", true, { ruleId: "R-001" });
    expect(taskFlowStore?.isDemo).toBe(true);
  });

  it("启动任务流应记录历史", () => {
    startTaskFlow("add_rule", false);
    expect(taskHistoryStore).toHaveLength(1);
  });
});
```

### 9.2 E2E 测试(Playwright)

```typescript
// tests/e2e/task-flow.spec.ts

import { test, expect } from "@playwright/test";

test.describe("任务流", () => {
  test("从顶部导航启动加规则任务流", async ({ page }) => {
    await page.goto("/");
    // 模拟登录 + 有库(进入状态 C)
    await page.evaluate(() => {
      localStorage.setItem(
        "evorule-console-cloud:session",
        JSON.stringify({ userId: "test" }),
      );
      localStorage.setItem(
        "evorule-console-cloud:db",
        JSON.stringify({ id: "db1", name: "测试库", ruleCount: 5 }),
      );
    });
    await page.reload();

    // 点任务流下拉
    await page.click('button:has-text("任务流")');
    await page.click('button:has-text("加规则")');

    // 应出现 TaskFlowWizard
    await expect(page.locator(".task-flow-wizard")).toBeVisible();
    await expect(page.locator(".task-name")).toHaveText("加规则");
    await expect(page.locator(".task-progress")).toHaveText("步骤 1/4");
  });

  test("demo 模式 4 引导任务", async ({ page }) => {
    await page.goto("/");

    // 应在 DemoHome 看到 4 个引导任务
    await expect(page.locator(".guided-tasks .task-card")).toHaveCount(4);

    // 点「试试加规则」
    await page.click('button:has-text("试试加规则")');

    // 应启动 demo 任务流
    await expect(page.locator(".task-flow-wizard.demo")).toBeVisible();
    await expect(page.locator(".demo-badge")).toHaveText("DEMO");
  });

  test("6 个任务流都能启动", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.setItem(
        "evorule-console-cloud:session",
        JSON.stringify({ userId: "test" }),
      );
      localStorage.setItem(
        "evorule-console-cloud:db",
        JSON.stringify({ id: "db1", name: "测试库", ruleCount: 5 }),
      );
    });
    await page.reload();

    const flows = [
      "加规则",
      "查问题",
      "改规则",
      "审规则",
      "看历史",
      "合规门禁",
    ];
    for (const flow of flows) {
      await page.click('button:has-text("任务流")');
      await page.click(`button:has-text("${flow}")`);
      await expect(page.locator(".task-name")).toHaveText(flow);
      await page.click(".cancel-btn");
    }
  });
});
```

### 9.3 测试覆盖率目标

| 模块                     | 覆盖率目标 | 测试类型        |
| ------------------------ | ---------- | --------------- |
| task-flow-types.ts       | 100%       | 类型(编译时)    |
| task-flows.ts            | 100%       | 单元(Vitest)    |
| guided-tasks.ts          | 100%       | 单元(Vitest)    |
| task-flow.ts(store)      | ≥ 90%      | 单元(Vitest)    |
| task-history.ts(store)   | ≥ 90%      | 单元(Vitest)    |
| MockBackend              | ≥ 80%      | 单元(Vitest)    |
| TaskFlowWizard.svelte    | ≥ 80%      | E2E(Playwright) |
| TaskFlowDropdown.svelte  | ≥ 80%      | E2E(Playwright) |
| GuidedTasks.svelte(增强) | ≥ 80%      | E2E(Playwright) |
| 在线 demo 部署           | 手动验证   | 部署后访问 URL  |

---

## 10. 与其他文档的关系

### 10.1 与 HOME_DESIGN 的关系

| HOME_DESIGN 章节        | P0-10 关系                                                      |
| ----------------------- | --------------------------------------------------------------- |
| §3 状态机               | 任务流仅在状态 C(真实工作台)+ 状态 A(demo)触发                  |
| §5.8.4 状态 A demo 模式 | P0-10 增强:4 引导任务升级为只读 TaskFlow(原 3 + 新增合规门禁)   |
| §6.4 demoDatasetStore   | 复用(medical/finance 切换)                                      |
| §8.3 DemoHome.svelte    | 增强 GuidedTasks 组件(单页跳转 → TaskFlow)                      |
| §8.4 预填数据示例       | 扩展为 DemoData 类型(加 rules/events/auditEntries/taskContexts) |

### 10.2 与 P03-P09 的关系

| 文档                    | P0-10 复用点                                                  |
| ----------------------- | ------------------------------------------------------------- |
| P03 数据集              | 加规则任务流可选「加入数据集」步骤(P0 暂不实现,留 hook)       |
| P04 业务执行台          | 加规则步骤 2(测试)/ 改规则步骤 3(dry-run)/ 审规则步骤 3(验证) |
| P05 监控大屏            | 任务流完成后的「查看运行效果」(可选步骤,P1 加)                |
| P06 业务审计 + 时间旅行 | 查问题全流程 / 看历史全流程 / 加规则步骤 4(审计)              |
| P07 通用结果导出        | 看历史步骤 3(导出审计)                                        |
| P08 协作工作流          | 审规则全流程                                                  |
| P09 导入导出基础设施    | 模板市场入口(任务流外独立路径)                                |

### 10.3 与三层架构的关系

| 三层架构章节            | P0-10 关系                                    |
| ----------------------- | --------------------------------------------- |
| §3.1 Production Runtime | 任务流主要在 L2 Workspace 内运行(编辑 / 测试) |
| §3.2 Workspace          | 审规则任务流跨 L2 协作 + L3 测试              |
| §3.3 Sandbox Sessions   | 改规则步骤 3(dry-run)在 L3 沙盒执行           |
| §11.4 同步状态表        | P0-10 完成后更新为「✅ 已设计」               |

### 10.4 与战略文档的关系

| b2b2c-strategy 章节     | P0-10 落地                                                |
| ----------------------- | --------------------------------------------------------- |
| §3.2 角色 B 决策者      | 在线 demo + README 决策者入口                             |
| §4.3 5 任务类型         | 5 个通用 TaskFlow + 1 个合规门禁专项 = 6 个 TaskFlow 定义 |
| §5.3 9 视图架构         | 任务流串起 9 视图                                         |
| §5.4(b) 任务流详细设计  | TaskFlowWizard + 6 TaskFlow + 上下文保留                  |
| §5.8.4 状态 A demo 模式 | 在线 demo 部署 + 4 引导任务(含合规门禁)                   |
| §20.2 P0-10             | 完整覆盖(任务流 + demo + README)                          |

---

## 11. 长期演进路径

### 11.1 P0 → P1

| 演进项            | P0                    | P1                                   |
| ----------------- | --------------------- | ------------------------------------ |
| demo 后端         | MockBackend(浏览器内) | 真实 evorule-server 试用实例(限时)   |
| 任务流持久化      | 刷新即取消            | 恢复上次未完成的任务流(localStorage) |
| 任务历史          | 最近 100 条           | 持久化到 server,跨设备同步           |
| README 决策者入口 | 截图 + 文字           | 视频 + 交互式 demo                   |
| Case Study        | 2 篇(医疗/财务)       | 5+ 篇(加律所/合规/审批)              |
| 在线 demo 部署    | GitHub Pages          | 自定义域名 + CDN + 多语言            |

### 11.2 P2

| 演进项         | 说明                          |
| -------------- | ----------------------------- |
| 自定义任务编排 | 用户拖拽步骤,定义自己的任务流 |
| 团队任务分配   | 主管分配任务给下属,跟踪进度   |
| 任务流模板市场 | 分享 / 下载行业任务流模板     |
| 营销落地页     | 独立域名,SEO 优化,转化漏斗    |
| i18n           | 中英双语 demo + README        |

---

## 12. 代码变更列表

### 12.1 新增文件

```
src/lib/stores/task-flow-types.ts          # TaskFlow 类型定义
src/lib/stores/task-flow.ts                # taskFlowStore(当前任务流实例)
src/lib/stores/task-history-types.ts       # TaskHistoryEntry 类型
src/lib/stores/task-history.ts             # taskHistoryStore(任务历史)
src/lib/data/task-flows.ts                 # 6 TaskFlow 定义(代码内置)
src/lib/data/guided-tasks.ts               # 4 引导任务定义(代码内置)
src/lib/data/demo-data-types.ts            # DemoData 类型(扩展 HOME_DESIGN)
src/lib/data/demo-medical.ts               # 医疗预填数据(扩展 HOME_DESIGN §8.4)
src/lib/data/demo-finance.ts               # 财务预填数据(新增,对称 medical)
src/lib/backend/mock-backend.ts            # MockBackend(在线 demo 用)
src/lib/views/TaskFlow/TaskFlowWizard.svelte       # 任务流向导组件
src/lib/views/TaskFlow/TaskFlowDropdown.svelte     # 顶部导航下拉
src/lib/views/TaskFlow/TaskHistoryView.svelte      # 任务历史视图
src/lib/views/Home/Demo/GuidedTasks.svelte          # 增强:4 引导任务 → TaskFlow
.github/workflows/deploy-demo.yml                   # GitHub Pages 自动部署
docs/screenshots/monitor-dashboard.png              # 截图(手动添加)
docs/screenshots/business-audit.png                 # 截图
docs/screenshots/time-travel.png                    # 截图
docs/case-studies/medical.md                        # 医疗 PoC case study
docs/case-studies/finance.md                        # 财务 PoC case study
tests/unit/task-flow.test.ts                        # Vitest 单元测试
tests/unit/mock-backend.test.ts                     # MockBackend 测试
tests/e2e/task-flow.spec.ts                         # Playwright E2E
```

### 12.2 修改文件

```
README.md                                   # 顶部新增「给决策者」章节
src/lib/views/Home/RealWorkbench.svelte     # 顶部导航加 TaskFlowDropdown + TaskFlowWizard
src/lib/views/Home/DemoHome.svelte          # 引用增强版 GuidedTasks(已是新文件,引用关系)
src/lib/backend/index.ts                    # 加 MockBackend 导出(根据 demo 模式标志选择)
vite.config.ts                              # 配置 VITE_BASE_PATH / VITE_DEMO_MODE
svelte.config.js                            # adapter-static 的 base path 配置
```

### 12.3 待截图清单(手动)

| 截图                  | 用途              | 来源视图              |
| --------------------- | ----------------- | --------------------- |
| monitor-dashboard.png | README 决策者入口 | L1 监控大屏(P05)      |
| business-audit.png    | README 决策者入口 | 业务审计(P06)         |
| time-travel.png       | README 决策者入口 | 业务时间旅行(P06)     |
| task-flow-wizard.png  | (可选)文档插图    | TaskFlowWizard 运行中 |

---

## 13. 待办

### 13.1 立即可做(P0-10 实施前)

- [ ] 确认 6 TaskFlow 的步骤路由与 P03-P09 实际实现的路由一致
- [ ] 确认 demo 模式只读保护策略(各视图如何检测 ?demo=true)
- [ ] 设计截图构图(手动截图前先确定要展示的内容)
- [ ] 编写 2 篇 case study(医疗/财务,可基于 demo 数据扩展)

### 13.2 P0-10 实施时

- [ ] 实现 task-flow-types.ts / task-flow.ts / task-history.ts
- [ ] 实现 task-flows.ts / guided-tasks.ts(6 + 4 定义)
- [ ] 实现 TaskFlowWizard.svelte / TaskFlowDropdown.svelte
- [ ] 增强 GuidedTasks.svelte(单页跳转 → TaskFlow)
- [ ] 实现 MockBackend + 扩展 demo-medical / 新增 demo-finance
- [ ] 修改 README.md(加决策者入口章节)
- [ ] 配置 GitHub Actions(deploy-demo.yml)
- [ ] 截图 + 上传到 docs/screenshots/

### 13.3 后端接口契约(与 evorule-server 协调)

P0-10 不新增后端接口 — 任务流是纯前端编排,复用 P03-P09 已有的前端 store 和 backend 接口。

MockBackend 实现 `ExecutionBackend` 接口,与真实 CloudHttpBackend 接口一致,切换时零改动。

### 13.4 与战略文档同步

- [ ] 在 b2b2c-strategy.md §20.2 标注 P0-10 已设计(引用本文档)
- [ ] 在三层架构 §11.4 同步状态表新增 P10 条目(✅ 已设计)
- [ ] 在 临时1.md 标注 P10 已完成设计
