# P0-6 详细设计(业务审计 + 业务时间旅行)

> **状态**:设计文档,2026-08-06 定稿。本文档是 evorule-doc-center `b2b2c-strategy.md §20.2 P0-6` 的可实施落地。
>
> **定位**:P0-6 改造内核 `AuditView`(raw 审计数据)+ ttd v1.0 5 视图(时间旅行)为业务化版本 — BLAKE3 审计链业务化展示 + 因果链业务术语解释 + ttd 5 视图业务化包装 + 决策支持 + 一键回滚 UI。
>
> **关联**:
>
> - 战略依据:`b2b2c-strategy.md §20.2 P0-6`(步骤 9 查看运行结果 + 步骤 11 回放审计)
> - 三层架构:`evorule-three-layer-architecture.md §3.5`(时间旅行)+ §3.7.2(审计导出/导入)
> - 首页设计:`HOME_DESIGN.md §5.4`(InterventionBar 审计/时间旅行按钮)
> - 前置设计:`P05_MONITOR_DASHBOARD_DESIGN.md`(L1 监控大屏,审计入口)
> - 内核导出:`@evorule/console`(`AuditView` / `TimeTravelView` / audit store / ttd v1.0)

---

## 1. 背景与动机

### 1.1 战略意图(来自 §20.2 P0-6)

> P0-6 业务审计 + 业务时间旅行(改造三件套)— 步骤 9 查看运行结果 + 步骤 11 回放审计 — 审计链 + 因果图 + 决策支持 + 一键回滚

**三件套改造**:
1. **业务审计**:内核 `AuditView`(raw BLAKE3 链) → `BusinessAuditView`(业务化展示)
2. **业务时间旅行**:内核 ttd v1.0 5 视图(技术向) → `BusinessTimeTravel`(业务术语包装)
3. **决策支持 + 一键回滚**:审计 → LLM 决策建议 + 从审计直接回滚

### 1.2 内核已有能力(关键发现,无需重做)

内核 `@evorule/console` 已嵌入完整 ttd v1.0(2026-08-02 整体源码复制,见三层架构 §3.5):

| ttd 视图 | 能力 | 业务化需求 |
| --- | --- | --- |
| ⏱ timeline | Fact 流时间轴 + 播放/暂停/速度控制 | 用业务术语描述 Fact |
| 📦 state | 指定版本 payload 快照 | 用业务字段展示 payload |
| 🔗 causal | 因果链 DAG 可视化 | 用业务术语解释因果关系 |
| ⇄ diff | 两版本 payload 深度对比 | 用业务字段标注差异 |
| 🔀 whatif | What-If(fork + 假设命令) | 用业务事件描述假设 |

内核 `AuditView` 已实现(已集成 evorule-server 审计 API):
- `getAudit(id)` → 审计链
- `verifyAudit(id)` → BLAKE3 链验证
- `getCausalChain(id, factId)` → 因果链

**结论**:ttd 5 视图 + audit store 已完整实现,P0-6 只做业务化包装,不重新实现。

### 1.3 现有内核 AuditView 的不足

| 现状 | 不足 |
| --- | --- |
| 展示 raw BLAKE3 hash + Fact JSON | 业务专家看不懂 hash 和 JSON |
| 因果链用 fact_id 连接 | 业务专家不认识 fact_id |
| 无业务术语解释 | 无法回答"为什么这个决策被触发?" |
| 无决策支持 | 审计只看历史,不提建议 |
| 无一键回滚 | 回滚要去 L1 InterventionBar,不在审计视图 |

### 1.4 改造目标

```
内核 AuditView + ttd v1.0(开发者用)
  ↓ 业务化包装
BusinessAuditView + BusinessTimeTravel(业务专家用)
  ├── BLAKE3 审计链 → 业务化时间线(谁/何时/做了什么/触发了什么)
  ├── 因果链 → 业务因果图(用业务术语解释为什么)
  ├── ttd 5 视图 → 业务化 5 视图(业务术语包装)
  ├── 决策支持 → LLM 分析审计 + 生成建议
  └── 一键回滚 → 从审计视图直接回滚到某版本
```

### 1.5 与其他 P0 的关系

| 前置设计 | P0-6 关系 |
| --- | --- |
| P02 业务语言层 | 复用 businessTermsStore(术语高亮)+ explainRule(规则解释) |
| P05 监控大屏 | InterventionBar [📜 审计]/[⏪ 时间旅行] 跳转到 P0-6 视图 |
| 三层架构 §3.5 | 时间旅行已有完整实现(ttd v1.0),P0-6 做业务化包装 |
| 三层架构 §3.7.2 | 审计导出/导入 API 已就绪,P0-6 做 UI |

---

## 2. 目标与非目标

### 2.1 目标

- ✅ 实现 `BusinessAuditView.svelte`(包装内核 AuditView,业务化展示)
- ✅ 实现 `BusinessTimeTravel.svelte`(包装内核 TimeTravelView,业务术语包装)
- ✅ 实现 BLAKE3 审计链业务化时间线(谁/何时/做了什么/触发了什么)
- ✅ 实现因果链业务化(用业务术语解释因果关系)
- ✅ 实现审计导出/导入 UI(合规卖点,调三层架构 §3.7.2 API)
- ✅ 实现决策支持(LLM 分析审计 + 生成建议)
- ✅ 实现一键回滚(从审计视图直接回滚到某版本)
- ✅ 实现 ttd 5 视图业务术语包装(timeline/state/causal/diff/whatif)
- ✅ 与内核 audit store + ttd v1.0 集成(不重新实现)
- ✅ 与 P02 businessTermsStore + CloudLlmAssistant 集成
- ✅ 延续 SvelteKit + Svelte 5 runes + provideXxx 注入模式
- ✅ 单元测试覆盖业务化转换 + 决策支持(Vitest)
- ✅ E2E 测试覆盖审计查看 + 回滚 + 时间旅行路径(Playwright)

### 2.2 非目标

- ❌ 不修改内核 `AuditView` / `TimeTravelView` / ttd v1.0(包装,不改内核)
- ❌ 不重新实现 ttd 5 视图(复用内核 ttd,加业务术语层)
- ❌ 不实现审计审批工作流(P0-8 协作工作流)
- ❌ 不实现审计告警(P05 AnomalyPanel 已覆盖)
- ❌ 不实现多 session 审计对比(P2)
- ❌ 不实现 i18n / a11y / 移动端(P1/P2)

---

## 3. 关键架构决策

### 3.1 决策 1:包装内核 AuditView + ttd,不重新实现

**决策**:在 console-cloud 层加 `BusinessAuditView.svelte` / `BusinessTimeTravel.svelte` 包装内核组件,加业务术语层。

**理由**(同 P01 §3.5 / P04 §3.1):
1. 内核 ttd v1.0 已完整实现 5 视图(2026-08-02),重新实现是浪费
2. 内核 AuditView 已集成 evorule-server 审计 API
3. 包装模式符合"组合优于继承"原则
4. 开发者模式保留 raw 视图退路

### 3.2 决策 2:业务化 = 术语高亮 + 字段映射 + LLM 解释

**决策**:业务化包装分三层:
1. **术语高亮**:Fact JSON 中的 key 用业务术语替换(复用 P02 businessTermsStore)
2. **字段映射**:Fact payload 字段映射到业务表单字段(复用 P02 businessFormSchemaStore)
3. **LLM 解释**:用 CloudLlmAssistant.explainRule 生成自然语言解释

```typescript
// 业务化转换管道
rawFact → applyTerms(rawFact) → applyFormSchema(termedFact) → explainWithLLM(schemaFact)
```

### 3.3 决策 3:决策支持用 LLM 离线分析,不实时

**决策**:决策支持是用户手动触发的 LLM 分析(点[💡 决策建议]按钮),不是实时推送。

**理由**:
1. LLM 调用有成本 + 延迟,不适合实时
2. 用户需要时才分析(审计后想了解"为什么会这样")
3. 分析结果缓存(同一审计段不重复分析)

### 3.4 决策 4:一键回滚复用三层架构 §3.4 滚动 session

**决策**:审计视图的"一键回滚"复用 P05 InterventionBar 的回滚逻辑(三层架构 §3.4 滚动 session 热重载)。

**实现**:审计视图中选中某个 Fact/版本 → 点[↩ 回滚到此] → 调 `backend.rollbackRuleset(targetVersion)` → 触发 U7 session_switched。

### 3.5 决策 5:ttd 5 视图业务化用 CSS 注入 + 术语 overlay

**决策**:ttd 5 视图的业务化包装用"术语 overlay"模式 — 不改 ttd 内部渲染,在 ttd 渲染结果上叠加业务术语标签。

**理由**:
1. ttd 是整体源码复制进内核(性能优先),不宜大改
2. CSS 注入 + DOM overlay 可以在不改 ttd 源码的情况下加业务标签
3. 开发者模式关闭 overlay,显示 raw ttd 视图

---

## 4. 数据模型

### 4.1 BusinessAuditEntry 类型

```typescript
// src/lib/stores/business-audit.ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project

import type { FactRecord } from "@evorule/console";

/** 原始审计条目(来自内核 audit store) */
export interface RawAuditEntry {
  factId: string;
  factType: string;
  logicalTime: number;
  contentHash: string;
  prevHash: string;
  timestamp: string;
  ruleId?: string;
  payload: unknown;
}

/** 业务化审计条目(术语高亮 + 字段映射后) */
export interface BusinessAuditEntry {
  /** 原始条目(保留,开发者模式用) */
  raw: RawAuditEntry;
  /** 业务时间(可读格式) */
  businessTime: string;
  /** 业务动作(如"病人 P-1283 就诊") */
  businessAction: string;
  /** 触发的规则(业务描述) */
  triggeredRule: string | null;
  /** 业务结果(如"触发高烧 CT 检查") */
  businessResult: string | null;
  /** 术语高亮后的 payload(业务字段名) */
  businessPayload: Record<string, unknown>;
  /** BLAKE3 hash(保留,合规展示) */
  hash: string;
  /** 链验证状态 */
  verified: boolean;
}
```

### 4.2 BusinessCausalChain 类型

```typescript
// src/lib/stores/business-causal.ts

/** 业务化因果链节点 */
export interface BusinessCausalNode {
  /** 原始 causal entry */
  factId: string;
  factType: string;
  logicalTime: number;
  /** 业务描述(如"病人 P-1283 体温 39.2°C") */
  businessDescription: string;
  /** 因果关系描述(如"因为体温 > 38°C,触发规则 R-042") */
  causalExplanation: string;
  /** 父节点 ID(因果链上游) */
  parentIds: string[];
  /** 信心评分 */
  confidence: number;
}

export interface BusinessCausalChain {
  nodes: BusinessCausalNode[];
  /** LLM 生成的因果链总结 */
  summary: string | null;
}
```

### 4.3 DecisionSupport 类型

```typescript
// src/lib/stores/decision-support.ts

export interface DecisionSuggestion {
  /** 审计段 ID(被分析的条目范围) */
  auditRange: { from: number; to: number };
  /** LLM 生成的决策建议 */
  suggestions: string[];
  /** 风险提示 */
  risks: string[];
  /** 推荐操作(如"建议回滚到 v15") */
  recommendedActions: { action: string; targetVersion?: number }[];
  /** 生成时间 */
  generatedAt: string;
  /** LLM 模型 */
  model: string;
}
```

### 4.4 内核类型(复用,不修改)

```typescript
// 来自 @evorule/console(不修改)
import type { SessionAudit, CausalChain, CausalEntry } from "@evorule/console";
// SessionAudit = { entries: AuditEntry[], verified: boolean }
// CausalChain = { chain: CausalEntry[] }
// CausalEntry = { fact_id, fact_type, logical_time, cause, content_hash, prev_hash }
```

---

## 5. Store 设计

### 5.1 Store 一览

| Store | 文件 | 职责 | 持久化 |
| --- | --- | --- | --- |
| `businessAuditStore` | `src/lib/stores/business-audit.ts` | 业务化审计条目(派生自内核 audit store) | ❌ |
| `businessCausalStore` | `src/lib/stores/business-causal.ts` | 业务化因果链 | ❌ |
| `decisionSupportStore` | `src/lib/stores/decision-support.ts` | 决策支持(LLM 分析结果) | ❌ |
| `auditExportStore` | `src/lib/stores/audit-export.ts` | 审计导出/导入状态 | ❌ |

### 5.2 businessAuditStore(派生自内核 audit store)

```typescript
// src/lib/stores/business-audit.ts

import { derived, get } from "svelte/store";
import { auditStore, verifyAudit, getCausalChain } from "@evorule/console";
import { businessTermsStore, findTermsByPrefix } from "./business-terms";
import { getAllRules } from "@evorule/console";
import type { RawAuditEntry, BusinessAuditEntry } from "./business-audit-types";

/**
 * 业务化审计条目(派生自内核 audit store)
 * 内核 auditStore 更新时,自动转换为业务化条目
 */
export const businessAuditStore = derived(
  auditStore,
  ($audit) => {
    if (!$audit) return [];
    return $audit.entries.map((entry) => toBusinessAuditEntry(entry));
  },
);

/** 原始审计条目 → 业务化审计条目 */
function toBusinessAuditEntry(raw: RawAuditEntry): BusinessAuditEntry {
  const terms = get(businessTermsStore);

  // 1. 术语高亮:payload 字段名 → 业务术语
  const businessPayload = applyTerms(raw.payload, terms);

  // 2. 业务动作描述
  const businessAction = describeBusinessAction(raw.factType, businessPayload);

  // 3. 触发的规则(从 rules store 查找)
  const rule = raw.ruleId
    ? getAllRules().find((r) => r.id === raw.ruleId)
    : null;
  const triggeredRule = rule?.description ?? null;

  // 4. 业务结果
  const businessResult = describeBusinessResult(raw, rule);

  return {
    raw,
    businessTime: formatBusinessTime(raw.timestamp),
    businessAction,
    triggeredRule,
    businessResult,
    businessPayload,
    hash: raw.contentHash,
    verified: false, // 批量验证后更新
  };
}

/** 术语高亮:JSON key → 业务术语 */
function applyTerms(payload: unknown, terms: Term[]): Record<string, unknown> {
  if (typeof payload !== "object" || payload === null) return { value: payload };

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    const term = terms.find((t) => t.technicalName === key);
    result[term?.businessName ?? key] = value;
  }
  return result;
}

/** 生成业务动作描述 */
function describeBusinessAction(
  factType: string,
  payload: Record<string, unknown>,
): string {
  // P0 简化:用 factType + payload 的关键字段
  const id = payload["id"] ?? payload["ID"] ?? "?";
  return `${factType}: ${id}`;
}

/** 生成业务结果描述 */
function describeBusinessResult(raw: RawAuditEntry, rule: Rule | null): string | null {
  if (!rule) return null;
  return `触发规则: ${rule.description}`;
}

/** 格式化业务时间 */
function formatBusinessTime(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
```

### 5.3 decisionSupportStore(LLM 决策支持)

```typescript
// src/lib/stores/decision-support.ts

import { writable, get } from "svelte/store";
import type { LlmAssistant } from "$lib/assistant/types";
import { businessAuditStore } from "./business-audit";
import type { DecisionSuggestion } from "./decision-support-types";

export const decisionSupportStore = writable<DecisionSuggestion | null>(null);
export const isAnalyzing = writable(false);

/**
 * 请求 LLM 分析审计段 + 生成决策建议
 */
export async function requestDecisionSupport(
  assistant: LlmAssistant,
  auditRange: { from: number; to: number },
): Promise<void> {
  isAnalyzing.set(true);

  try {
    const audit = get(businessAuditStore);
    const segment = audit.slice(auditRange.from, auditRange.to + 1);

    // 组装 prompt
    const prompt = `分析以下 evorule 审计日志,生成决策建议:

${JSON.stringify(segment.map((e) => ({
  time: e.businessTime,
  action: e.businessAction,
  rule: e.triggeredRule,
  result: e.businessResult,
})), null, 2)}

请输出:
1. 决策建议(2-3 条)
2. 风险提示(1-2 条)
3. 推荐操作(如"建议回滚到某版本")

以 JSON 格式返回: { "suggestions": [...], "risks": [...], "recommendedActions": [...] }`;

    const result = await assistant.explainRule(prompt);
    const parsed = JSON.parse(result);

    decisionSupportStore.set({
      auditRange,
      suggestions: parsed.suggestions ?? [],
      risks: parsed.risks ?? [],
      recommendedActions: parsed.recommendedActions ?? [],
      generatedAt: new Date().toISOString(),
      model: assistant.getConfig()?.model ?? "unknown",
    });
  } catch (e) {
    console.error("Decision support failed:", e);
    decisionSupportStore.set(null);
  } finally {
    isAnalyzing.set(false);
  }
}

/** 清除决策支持 */
export function clearDecisionSupport(): void {
  decisionSupportStore.set(null);
}
```

### 5.4 auditExportStore(审计导出/导入)

```typescript
// src/lib/stores/audit-export.ts

import { writable } from "svelte/store";
import type { ExecutionBackend } from "$lib/backend/types";

export type ExportStatus = "idle" | "exporting" | "importing" | "done" | "error";

export const auditExportStore = writable<{
  status: ExportStatus;
  message: string;
  data: unknown | null;
}>({ status: "idle", message: "", data: null });

/** 导出审计链 */
export async function exportAudit(
  sessionId: number,
  backend: ExecutionBackend,
  compressed = false,
): Promise<void> {
  auditExportStore.set({ status: "exporting", message: "正在导出...", data: null });

  try {
    const data = compressed
      ? await backend.exportAuditCompressed(sessionId)
      : await backend.exportAudit(sessionId);

    // 触发文件下载
    const filename = `audit-session-${sessionId}.${compressed ? "json.gz" : "json"}`;
    downloadFile(data, filename);

    auditExportStore.set({
      status: "done",
      message: `审计链已导出: ${filename}`,
      data,
    });
  } catch (e) {
    auditExportStore.set({
      status: "error",
      message: `导出失败: ${(e as Error).message}`,
      data: null,
    });
  }
}

/** 导入审计链(验证) */
export async function importAudit(
  sessionId: number,
  backend: ExecutionBackend,
  data: unknown,
  compressed = false,
): Promise<void> {
  auditExportStore.set({ status: "importing", message: "正在导入验证...", data: null });

  try {
    if (compressed) {
      await backend.importAuditCompressed(sessionId, data as Blob);
    } else {
      await backend.importAudit(sessionId, data);
    }

    auditExportStore.set({
      status: "done",
      message: "审计链导入验证成功(BLAKE3 链完整)",
      data: null,
    });
  } catch (e) {
    auditExportStore.set({
      status: "error",
      message: `导入失败: ${(e as Error).message}`,
      data: null,
    });
  }
}
```

---

## 6. 组件树

### 6.1 BusinessAuditView 组件树

```
src/lib/views/Audit/
├── BusinessAuditView.svelte       (业务审计主视图,包装内核 AuditView)
│   ├── AuditToolbar.svelte        (工具栏:验证/导出/导入/决策建议)
│   ├── AuditTimeline.svelte       (业务化审计时间线)
│   │   └── AuditEntryCard.svelte  (单条审计条目,业务化展示)
│   ├── CausalGraph.svelte         (因果图,业务术语)
│   │   └── CausalNodeCard.svelte  (因果节点,业务描述)
│   ├── DecisionSupportPanel.svelte(决策支持面板,LLM 建议)
│   ├── RollbackButton.svelte      (一键回滚按钮)
│   └── (内核 AuditView 保留,开发者模式渲染)
│
src/lib/views/TimeTravel/
├── BusinessTimeTravel.svelte      (业务时间旅行,包装内核 TimeTravelView)
│   ├── TermOverlay.svelte         (术语 overlay,叠加在 ttd 上)
│   ├── BusinessFactCard.svelte    (业务化 Fact 卡片,复用 P02)
│   └── (内核 TimeTravelView 保留,ttd v1.0 5 视图)
```

### 6.2 BusinessAuditView 布局

```
┌─────────────────────────────────────────────────────────────────┐
│ BusinessAuditView                                               │
│ ┌─工具栏─────────────────────────────────────────────────────┐ │
│ │ [✅ 验证 BLAKE3 链] [📥 导出审计] [📤 导入审计]            │ │
│ │ [💡 决策建议]  模式:[业务|开发者] toggle                   │ │
│ └──────────────────────────────────────────────────────────┘ │
│ ┌─审计时间线(左)──────────┐ ┌─因果图(右)──────────────────┐ │
│ │ 14:32:01 病人 P-1283 就诊 │ │     [P-1283 体温 39.2°C]   │ │
│ │   → 触发:高烧 CT 检查     │ │          ↓ 因为 > 38°C     │ │
│ │   hash: a3f...e7  ✅      │ │     [规则 R-042 匹配]      │ │
│ │                          │ │          ↓ 触发            │ │
│ │ 14:32:00 订单 O-8821 审批 │ │     [高烧 CT 检查]         │ │
│ │   → 触发:金额校验         │ │                            │ │
│ │   hash: b8c...f2  ✅      │ │ 总结:因体温超阈值触发 CT   │ │
│ │ ...                      │ │                            │ │
│ └──────────────────────────┘ └────────────────────────────┘ │
│ ┌─决策支持(底部,展开时显示)──────────────────────────────┐ │
│ │ 💡 决策建议:                                              │ │
│ │   1. 建议对 65 岁以上发烧患者增加心电图检查                │ │
│ │   2. R-042 规则触发频率异常(7 次/小时),建议检查规则条件 │ │
│ │ ⚠ 风险: R-042 可能在正常体温时误触发(检查阈值配置)     │ │
│ │ 推荐操作: [↩ 回滚到 v15] (R-042 修改前的版本)            │ │
│ └──────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### 6.3 BusinessTimeTravel(包装 ttd v1.0)

```
BusinessTimeTravel.svelte
├── 顶部:模式 toggle [业务|开发者]
├── ttd 视图切换(5 视图 tab,复用内核 ttd)
│   ├── ⏱ timeline(时间线)
│   │   └── TermOverlay:Fact 卡片叠加业务术语标签
│   ├── 📦 state(状态快照)
│   │   └── TermOverlay:payload 字段叠加业务字段名
│   ├── 🔗 causal(因果链)
│   │   └── TermOverlay:因果节点叠加业务因果描述
│   ├── ⇄ diff(版本对比)
│   │   └── TermOverlay:差异标注叠加业务字段变更说明
│   └── 🔀 whatif(What-If)
│       └── TermOverlay:假设命令叠加业务事件描述
└── 底部:[↩ 回滚到此版本](在 state/diff 视图中显示)
```

### 6.4 开发者模式

- 业务模式(默认):`BusinessAuditView` / `BusinessTimeTravel` + TermOverlay
- 开发者模式:内核 `AuditView` / `TimeTravelView`(raw,无 overlay)
- toggle 状态持久化到 localStorage

---

## 7. 数据流

### 7.1 审计查看流

```
用户从 L1 InterventionBar 点[📜 审计]
  ↓
路由跳转 /view/audit → BusinessAuditView 挂载
  ↓
内核 audit store 已有数据(P05 初始化时加载)
  ↓
businessAuditStore 派生:raw audit entries → 业务化条目
  ↓
AuditTimeline 渲染业务化时间线
  ↓
用户点击某条审计 → CausalGraph 展示因果链
  ↓
backend.getCausalChain(sessionId, factId)
  ↓
内核 causal store 更新
  ↓
CausalGraph 渲染业务化因果图
```

### 7.2 BLAKE3 链验证流

```
用户点[✅ 验证 BLAKE3 链]
  ↓
backend.verifyAudit(sessionId)
  → GET /api/sessions/{id}/audit/verify
  ↓
返回 { verified: boolean, broken_at?: number }
  ↓
verified = true:
  → 所有审计条目显示 ✅
  → toast"BLAKE3 审计链验证通过,链完整不可篡改"
  ↓
verified = false:
  → broken_at 之前的条目显示 ✅,之后显示 🔴
  → toast"审计链在第 N 条断裂!可能被篡改"
```

### 7.3 决策支持流

```
用户在审计视图中选一段条目(from-to)
  ↓
点[💡 决策建议]
  ↓
isAnalyzing = true,按钮显示"分析中..."
  ↓
requestDecisionSupport(assistant, { from, to })
  ↓
LLM 分析审计段(见 §5.3)
  ↓
DecisionSupportPanel 展示:
  - 决策建议(2-3 条)
  - 风险提示(1-2 条)
  - 推荐操作(含回滚建议)
  ↓
用户可点推荐操作中的[↩ 回滚到 vN]
  ↓
触发回滚流(见 §7.5)
```

### 7.4 审计导出流

```
用户点[📥 导出审计]
  ↓
选择格式:[JSON] / [JSON 压缩]
  ↓
exportAudit(sessionId, backend, compressed)
  → GET /api/sessions/{id}/audit/export(或 /compressed)
  ↓
浏览器触发文件下载(audit-session-{id}.json)
  ↓
auditExportStore: status = "done"
  ↓
toast"审计链已导出"
```

### 7.5 一键回滚流

```
用户在审计/时间旅行视图中选中某版本
  ↓
点[↩ 回滚到此版本]
  ↓
ConfirmDialog:"确认回滚到 ruleset v{N}?将用旧规则产生新版本。"
  ↓ 用户确认
backend.rollbackRuleset(targetVersion)
  → 触发滚动 session 热重载(三层架构 §3.3):
    1. POST /api/rules/reload(旧规则)
    2. POST /api/sessions/from/{old_id}(fork)
    3. 应用层切换 production_session_id
    4. SSE 推送 session_switched(U7)
  ↓
P05 MonitorDashboard 收到 session_switched
  → 自动切换到新 session
  → SessionSwitchToast"已回滚到 ruleset v{N}"
  ↓
审计视图关闭,跳回 L1 监控大屏
```

### 7.6 时间旅行回放流

```
用户从 L1 点[⏪ 时间旅行]
  ↓
路由跳转 /view/timetravel → BusinessTimeTravel 挂载
  ↓
内核 ttd v1.0 初始化(5 视图)
  ↓
用户选 timeline 视图
  ↓
ttd 渲染 Fact 流时间轴(内核已实现)
  ↓
TermOverlay 叠加业务术语标签(不改 ttd 渲染)
  ↓
用户拖动时间轴 → state 视图显示该版本快照
  ↓
TermOverlay 叠加业务字段名
  ↓
用户切换 diff 视图 → 选两个版本对比
  ↓
ttd 渲染 deep-diff 结果(内核已实现)
  ↓
TermOverlay 叠加业务字段变更说明
  ↓
用户点[↩ 回滚到此版本] → 触发回滚流(§7.5)
```

---

## 8. 关键代码示例

### 8.1 BusinessAuditView.svelte(主视图)

```svelte
<!-- src/lib/views/Audit/BusinessAuditView.svelte -->
<script lang="ts">
  import { get } from 'svelte/store';
  import { AuditView, verifyAudit } from '@evorule/console';
  import { useBackend } from '$lib/backend/backend-context';
  import { useLlmAssistantOrNull } from '$lib/assistant/llm-context';
  import { businessAuditStore } from '$lib/stores/business-audit';
  import { decisionSupportStore, isAnalyzing, requestDecisionSupport } from '$lib/stores/decision-support';
  import { exportAudit, auditExportStore } from '$lib/stores/audit-export';
  import { currentSessionId } from '@evorule/console';
  import AuditTimeline from './AuditTimeline.svelte';
  import CausalGraph from './CausalGraph.svelte';
  import DecisionSupportPanel from './DecisionSupportPanel.svelte';
  import ConfirmDialog from '../Home/Monitor/ConfirmDialog.svelte';

  let mode = $state<'business' | 'developer'>('business');
  let selectedRange = $state<{ from: number; to: number } | null>(null);
  let showRollbackConfirm = $state(false);
  let rollbackVersion = $state<number | null>(null);

  const backend = useBackend();
  const assistant = useLlmAssistantOrNull();
  const auditEntries = $derived(get(businessAuditStore));
  const sessionId = $derived(get(currentSessionId));
  const decision = $derived(get(decisionSupportStore));
  const exportState = $derived(get(auditExportStore));

  async function handleVerify(): Promise<void> {
    if (!sessionId) return;
    const result = await backend.verifyAudit(sessionId);
    if (result.verified) {
      alert('✅ BLAKE3 审计链验证通过,链完整不可篡改');
    } else {
      alert(`🔴 审计链在第 ${result.broken_at} 条断裂!可能被篡改`);
    }
  }

  async function handleDecisionSupport(): Promise<void> {
    if (!assistant || !selectedRange) {
      alert('请先选择审计段范围(点击起止条目)');
      return;
    }
    await requestDecisionSupport(assistant, selectedRange);
  }

  function handleRollback(version: number): void {
    rollbackVersion = version;
    showRollbackConfirm = true;
  }

  async function executeRollback(): Promise<void> {
    if (rollbackVersion === null) return;
    await backend.rollbackRuleset(rollbackVersion);
    showRollbackConfirm = false;
    // 跳回 L1 监控大屏(session_switched 会自动触发)
    goto('/');
  }
</script>

{#if mode === 'developer'}
  <AuditView />
{:else}
  <div class="business-audit-view">
    <div class="toolbar">
      <button onclick={handleVerify}>✅ 验证 BLAKE3 链</button>
      <button onclick={() => sessionId && exportAudit(sessionId, backend)}>📥 导出审计</button>
      <button onclick={handleDecisionSupport} disabled={!assistant || isAnalyzing}>
        {isAnalyzing ? '分析中...' : '💡 决策建议'}
      </button>
      <button onclick={() => (mode = 'developer')}>开发者模式</button>
    </div>

    <div class="main-area">
      <AuditTimeline
        entries={auditEntries}
        onSelectRange={(range) => (selectedRange = range)}
      />
      <CausalGraph />
    </div>

    {#if decision}
      <DecisionSupportPanel
        {decision}
        onRollback={handleRollback}
      />
    {/if}

    {#if exportState.status === 'done'}
      <div class="toast">{exportState.message}</div>
    {/if}
  </div>
{/if}

{#if showRollbackConfirm}
  <ConfirmDialog
    title="一键回滚"
    message="确认回滚到 ruleset v{rollbackVersion}?将用旧规则产生新版本。"
    onConfirm={executeRollback}
    onCancel={() => (showRollbackConfirm = false)}
  />
{/if}
```

### 8.2 BusinessTimeTravel.svelte(包装 ttd)

```svelte
<!-- src/lib/views/TimeTravel/BusinessTimeTravel.svelte -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { TimeTravelView } from '@evorule/console';
  import { useBackend } from '$lib/backend/backend-context';
  import TermOverlay from './TermOverlay.svelte';
  import RollbackButton from '../Audit/RollbackButton.svelte';

  let mode = $state<'business' | 'developer'>('business');
  let ttdContainer: HTMLElement | null = $state(null);
  let selectedVersion = $state<number | null>(null);

  const backend = useBackend();

  // 监听 ttd 内部版本选择事件(通过 DOM 观察)
  $effect(() => {
    if (!ttdContainer || mode === 'developer') return;
    // TermOverlay 通过 MutationObserver 监听 ttd DOM 变化
    // 叠加业务术语标签
  });
</script>

<div class="business-time-travel">
  <div class="toolbar">
    <button onclick={() => (mode = mode === 'business' ? 'developer' : 'business')}>
      {mode === 'business' ? '开发者模式' : '业务模式'}
    </button>
    {#if selectedVersion !== null}
      <RollbackButton version={selectedVersion} {backend} />
    {/if}
  </div>

  <div class="ttd-wrapper" bind:this={ttdContainer}>
    <TimeTravelView />

    {#if mode === 'business'}
      <!-- TermOverlay 叠加在 ttd 渲染结果上 -->
      <TermOverlay target={ttdContainer} />
    {/if}
  </div>
</div>
```

### 8.3 AuditEntryCard.svelte(业务化审计条目)

```svelte
<!-- src/lib/views/Audit/AuditEntryCard.svelte -->
<script lang="ts">
  import type { BusinessAuditEntry } from '$lib/stores/business-audit-types';

  let {
    entry,
    selected = false,
    onSelect,
  }: {
    entry: BusinessAuditEntry;
    selected?: boolean;
    onSelect?: () => void;
  } = $props();
</script>

<div
  class="audit-entry-card"
  class:selected
  role="button"
  tabindex="0"
  onclick={onSelect}
  onkeydown={(e) => e.key === 'Enter' && onSelect?.()}
>
  <div class="header">
    <span class="time">{entry.businessTime}</span>
    <span class="action">{entry.businessAction}</span>
    <span class="hash" title={entry.hash}>{entry.hash.slice(0, 8)}...</span>
    <span class="verified">{entry.verified ? '✅' : '⏳'}</span>
  </div>

  {#if entry.triggeredRule}
    <div class="triggered">
      → 触发: <span class="rule">{entry.triggeredRule}</span>
    </div>
  {/if}

  {#if entry.businessResult}
    <div class="result">{entry.businessResult}</div>
  {/if}

  <details class="payload">
    <summary>业务数据</summary>
    <pre>{JSON.stringify(entry.businessPayload, null, 2)}</pre>
  </details>
</div>
```

### 8.4 CausalGraph.svelte(业务因果图)

```svelte
<!-- src/lib/views/Audit/CausalGraph.svelte -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { useBackend } from '$lib/backend/backend-context';
  import { currentSessionId } from '@evorule/console';
  import { businessTermsStore } from '$lib/stores/business-terms';
  import { getAllRules } from '@evorule/console';

  let {
    factId = null,
  }: { factId: string | null } = $props();

  let causalChain = $state<BusinessCausalChain | null>(null);

  const backend = useBackend();
  const sessionId = $derived(get(currentSessionId));

  async function loadCausalChain(): Promise<void> {
    if (!sessionId || !factId) return;

    const raw = await backend.getCausalChain(sessionId, factId);
    const terms = get(businessTermsStore);
    const rules = getAllRules();

    // 业务化转换
    const nodes = raw.chain.map((entry) => {
      const rule = rules.find((r) => r.id === entry.cause);
      return {
        factId: entry.fact_id,
        factType: entry.fact_type,
        logicalTime: entry.logical_time,
        businessDescription: describeFact(entry, terms),
        causalExplanation: rule
          ? `因为 ${rule.description}`
          : '直接输入',
        parentIds: entry.cause ? [entry.cause] : [],
        confidence: 90,
      };
    });

    causalChain = { nodes, summary: null };
  }

  $effect(() => {
    loadCausalChain();
  });
</script>

<div class="causal-graph">
  {#if causalChain}
    <div class="nodes">
      {#each causalChain.nodes as node}
        <div class="causal-node">
          <div class="description">{node.businessDescription}</div>
          {#if node.causalExplanation}
            <div class="explanation">↓ {node.causalExplanation}</div>
          {/if}
        </div>
      {/each}
    </div>
  {:else}
    <div class="empty">点击审计条目查看因果链</div>
  {/if}
</div>
```

---

## 9. 测试策略

### 9.1 单元测试(Vitest)

| 测试目标 | 测试文件 | 覆盖点 |
| --- | --- | --- |
| businessAuditStore | `business-audit.test.ts` | 派生转换 + 术语高亮 + 业务描述生成 |
| decisionSupportStore | `decision-support.test.ts` | LLM 分析成功/失败 + 结果缓存 |
| auditExportStore | `audit-export.test.ts` | 导出/导入 + 压缩 + 文件下载 |
| toBusinessAuditEntry | `business-audit.test.ts` | 原始→业务化转换 + 缺失规则处理 |
| describeBusinessAction | `business-audit.test.ts` | 各种 factType 的描述生成 |
| applyTerms | `business-audit.test.ts` | 术语映射 + 未知 key 保留 |

### 9.2 E2E 测试(Playwright)

| 测试路径 | 步骤 |
| --- | --- |
| 审计查看 | L1→点审计→验证时间线渲染→点击条目→验证因果图 |
| BLAKE3 验证 | 点验证→验证 ✅ 标记 + toast |
| 决策支持 | 选审计段→点决策建议→验证 LLM 建议 + 回滚按钮 |
| 审计导出 | 点导出→验证文件下载 |
| 一键回滚 | 选版本→点回滚→确认→验证 session_switched |
| 时间旅行 | L1→点时间旅行→验证 ttd 5 视图 + 术语 overlay |
| 开发者模式 | 切开发者模式→验证 raw AuditView/TimeTravelView |

---

## 10. 与其他文档的关系

### 10.1 与三层架构的关系

| 三层架构章节 | P0-6 对应 |
| --- | --- |
| §3.5 时间旅行(ttd v1.0 5 视图) | BusinessTimeTravel 包装 ttd |
| §3.5.6 HistoricalState vs SessionState | ttd state 视图消费 HistoricalState |
| §3.7.2 审计导出/导入 | auditExportStore + 导出/导入 UI |
| §3.9.3 audit store(resetAuditStore) | session 切换时清空 |

### 10.2 与 P02 的关系

| P02 章节 | P0-6 复用 |
| --- | --- |
| §4.1 businessTermsStore | 术语高亮(applyTerms) |
| §4.3 businessFormSchemaStore | 字段映射(业务字段名) |
| §3.6 CloudLlmAssistant | explainRule(决策支持) |

### 10.3 与 P05 的关系

| P05 章节 | P0-6 关系 |
| --- | --- |
| InterventionBar [📜 审计] | 跳转 BusinessAuditView |
| InterventionBar [⏪ 时间旅行] | 跳转 BusinessTimeTravel |
| InterventionBar [↩ 回滚] | P06 的回滚复用同一逻辑 |
| InterventionBar [📥 导出审计] | P06 的导出 UI |

### 10.4 与战略文档的关系

| 战略文档章节 | 本设计文档章节 |
| --- | --- |
| §20.2 P0-6 业务审计 + 业务时间旅行 | §1-§10(全文) |
| §15.5 步骤 9 查看运行结果 | §6.2 BusinessAuditView |
| §15.5 步骤 11 回放审计 | §6.3 BusinessTimeTravel + §7.6 回放流 |

---

## 11. 长期演进路径

### 11.1 P0 → P1

| P0 | P1+ |
| --- | --- |
| TermOverlay CSS 注入 | ttd 原生业务化(改 ttd 源码) |
| 手动触发决策支持 | 实时决策支持(异常自动分析) |
| 单 session 审计 | 多 session 审计对比 |
| 文本因果图 | 可交互 DAG 图(拖拽/缩放) |

### 11.2 P2

- 审计审批工作流(P0-8 协作)
- 审计合规报告(自动生成 EU AI Act / 等保 2.0 报告)
- 审计数据仓库(长期归档 + 趋势分析)

---

## 12. 代码变更列表

### 12.1 新增文件

| 文件 | 类型 | 说明 |
| --- | --- | --- |
| `src/lib/stores/business-audit.ts` | Store | 业务化审计(派生自内核 audit store) |
| `src/lib/stores/business-audit-types.ts` | Types | BusinessAuditEntry 类型 |
| `src/lib/stores/business-causal.ts` | Store | 业务化因果链 |
| `src/lib/stores/decision-support.ts` | Store | 决策支持(LLM 分析) |
| `src/lib/stores/audit-export.ts` | Store | 审计导出/导入 |
| `src/lib/views/Audit/BusinessAuditView.svelte` | Component | 业务审计主视图 |
| `src/lib/views/Audit/AuditTimeline.svelte` | Component | 审计时间线 |
| `src/lib/views/Audit/AuditEntryCard.svelte` | Component | 审计条目卡片 |
| `src/lib/views/Audit/CausalGraph.svelte` | Component | 因果图 |
| `src/lib/views/Audit/CausalNodeCard.svelte` | Component | 因果节点卡片 |
| `src/lib/views/Audit/DecisionSupportPanel.svelte` | Component | 决策支持面板 |
| `src/lib/views/Audit/RollbackButton.svelte` | Component | 一键回滚按钮 |
| `src/lib/views/TimeTravel/BusinessTimeTravel.svelte` | Component | 业务时间旅行 |
| `src/lib/views/TimeTravel/TermOverlay.svelte` | Component | 术语 overlay |

### 12.2 修改文件

| 文件 | 修改 |
| --- | --- |
| `src/routes/+layout.ts` | /view/audit 和 /view/timetravel 路由守卫 |

---

## 13. 待办

- [ ] ttd 原生业务化(P1,改 ttd 源码替代 overlay)
- [ ] 实时决策支持(P1,异常自动分析)
- [ ] 多 session 审计对比(P1)
- [ ] 可交互 DAG 因果图(P1)
- [ ] 审计合规报告自动生成(P2)
- [ ] 审计数据仓库(P2)

---

> 设计文档 — 2026-08-06 定稿
