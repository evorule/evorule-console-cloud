# P0-4 详细设计(业务执行台改造)

> **状态**:设计文档,2026-08-06 定稿。本文档是 evorule-doc-center `b2b2c-strategy.md §20.2 P0-4` 的可实施落地。
>
> **定位**:P0-4 改造内核 `ExecutionPadView`(原始 JSON 编辑"提交命令")为 `BusinessExecutionPad`(业务事件表单 + LLM 翻译 + 影响预览),让业务专家用表单提交业务事件,而非编辑 JSON 指令。
>
> **关联**:
>
> - 战略依据:`b2b2c-strategy.md §20.2 P0-4`(步骤 5 导入到 evorule)
> - 前置设计:`P01_BUILD_SCHEMA_DESIGN.md`(业务规则库 + LLM 集成)
> - 前置设计:`P02_BUSINESS_LANGUAGE_V0_DESIGN.md`(业务表单 schema + LLM assistant)
> - 前置设计:`P03_DATASET_DESIGN.md`(数据集组合,执行台运行数据集)
> - 三层架构:`evorule-three-layer-architecture.md`(执行台在 L2 Workspace + L3 Sandbox)
> - 内核导出:`@evorule/console`(`ExecutionPadView` / `submitCommand` / `CommandResult`)

---

## 1. 背景与动机

### 1.1 战略意图(来自 §20.2 P0-4)

> P0-4 业务执行台(改造:业务事件,替代"提交命令") — 步骤 5 导入到 evorule

**核心改造**:把内核 `ExecutionPadView` 的"编辑 JSON 指令文本"改造成"填写业务事件表单",降低业务专家使用门槛。

### 1.2 现有内核 ExecutionPadView 的不足

内核 `ExecutionPadView`([ExecutionPad.svelte](file:///d:/evorule-console/src/lib/views/ExecutionPad/ExecutionPad.svelte))现状:

| 现状 | 不足 |
| --- | --- |
| 用户在 textarea 编辑 instruction JSON 文本 | 业务专家不懂 JSON,无法使用 |
| instruction 是 evorule-tcb 4 元素指令(domain/action/payload/meta) | 4 元素格式对非技术人员是天书 |
| 有 `onaiGenerateInput` LLM 钩子 | 仅生成 JSON 文本,不解决"看不懂"问题 |
| 提交后直接 `submitCommand`,无预览 | 无法预知将触发哪些规则,盲提交 |
| 无业务事件模板 | 每次从空白开始,效率低 |

### 1.3 改造目标

```
内核 ExecutionPadView(开发者用)
  ↓ 包装
BusinessExecutionPad(业务专家用)
  ├── 业务事件表单(替代 JSON textarea)
  │   ├── 业务事件模板(预设常见事件)
  │   └── 业务字段(复用 P02 businessFormSchemaStore)
  ├── LLM 翻译(业务事件 → instruction JSON)
  ├── 影响预览(提交前预览将触发的规则)
  └── 提交(调内核 submitCommand)
```

### 1.4 与 P01/P02/P03 的关系

| 前置设计 | P0-4 复用 |
| --- | --- |
| P01 §1.3.4 session store | `submitCommand(id, instruction)` + `createSession()` |
| P01 §1.3.5 ExecutionPadView | 包装内核视图,加业务层 |
| P02 §4.3 businessFormSchemaStore | 业务事件表单的字段定义 |
| P02 §3.6 CloudLlmAssistant | `generateInput()` LLM 翻译业务事件→instruction |
| P03 数据集 | 执行台可选择运行哪个数据集的规则 |

### 1.5 与三层架构的关系

| 层 | 执行台用途 |
| --- | --- |
| **L2 Workspace** | 编辑/预览业务事件(不实际提交) |
| **L3 Sandbox** | 提交业务事件到沙盒 session 测试(合成数据) |
| **L1 Production** | 提交业务事件到 production session(真实业务) |

---

## 2. 目标与非目标

### 2.1 目标

- ✅ 实现 `BusinessExecutionPad.svelte`(包装内核 ExecutionPadView)
- ✅ 实现业务事件表单(替代 JSON textarea,复用 P02 businessFormSchemaStore)
- ✅ 实现业务事件模板(预设常见事件,如"病人就诊"/"药品开具")
- ✅ 实现 LLM 翻译(业务事件表单 → instruction JSON)
- ✅ 实现影响预览(提交前预览将触发的规则)
- ✅ 实现"开发者模式" toggle(切回 raw JSON 编辑,退路)
- ✅ 与内核 `submitCommand` / `CommandResult` 集成
- ✅ 与 P02 `CloudLlmAssistant.generateInput()` 集成
- ✅ 与 P03 数据集集成(选择运行哪个数据集)
- ✅ 延续 SvelteKit + Svelte 5 runes + provideXxx 注入模式
- ✅ 单元测试覆盖 store + 翻译 + 预览(Vitest)
- ✅ E2E 测试覆盖业务事件提交路径(Playwright)

### 2.2 非目标

- ❌ 不修改内核 `ExecutionPadView` 组件(包装,不改内核)
- ❌ 不实现后端 dry-run API(P0 影响预览用前端规则匹配,P1+ server dry-run)
- ❌ 不实现业务事件历史(P1+ 才做)
- ❌ 不实现批量业务事件提交(P1+ 批量导入)
- ❌ 不实现业务事件审批工作流(P0-8 协作工作流)
- ❌ 不实现 i18n / a11y / 移动端(P1/P2)

---

## 3. 关键架构决策

### 3.1 决策 1:包装内核 ExecutionPadView,不改内核

**决策**:在 console-cloud 层加 `BusinessExecutionPad.svelte` 包装内核 `ExecutionPadView`,加业务事件层。

**理由**(同 P01 §3.5):
1. 内核组件接受 LLM callback(已有 `onaiGenerateInput` 扩展槽)
2. 包装模式符合"组合优于继承"原则
3. 开发者模式保留 raw JSON 退路

### 3.2 决策 2:业务事件 = 表单数据 + LLM 翻译的 instruction

**决策**:业务事件分两层:
- **表单层**(业务专家可读):结构化字段(病人 ID / 体温 / 症状)
- **指令层**(内核可执行):LLM 翻译后的 instruction JSON(4 元素指令)

```typescript
interface BusinessEvent {
  /** 事件模板 ID(如"patient_visit") */
  templateId: string;
  /** 表单数据(业务专家填写) */
  formData: Record<string, unknown>;
  /** LLM 翻译后的 instruction(内核可执行) */
  instruction: object | null;
  /** LLM 翻译状态 */
  translateStatus: "idle" | "translating" | "translated" | "error";
}
```

**理由**:
1. 业务专家只看表单层,不接触 instruction
2. instruction 由 LLM 翻译,确保格式正确
3. 开发者模式可查看/编辑 instruction(JSON 退路)

### 3.3 决策 3:影响预览用前端规则匹配,不调 server dry-run

**决策**:P0 影响预览在前端做规则匹配(遍历数据集规则,检查 payload 是否匹配规则条件),不调 server dry-run API。

**理由**:
1. server 没有 dry-run API(P1+ 才做)
2. P0 数据集规则数少(5-50 条),前端遍历性能足够
3. 前端匹配可快速反馈(无网络延迟)

**取舍**:
- ✅ 无需 server 改动,纯前端实现
- ✅ 快速反馈(毫秒级)
- ❌ 前端匹配 ≠ 实际执行(server 可能有额外逻辑),预览结果仅供参考
- ❌ 复杂规则(io_request / 因果链)无法准确预览

### 3.4 决策 4:业务事件模板 = 预设表单 schema + 示例数据

**决策**:业务事件模板(如"病人就诊")= P02 businessFormSchemaStore 的字段定义 + 示例 formData。

```typescript
interface BusinessEventTemplate {
  id: string;
  name: string;          // "病人就诊"
  description: string;   // "记录病人就诊信息,触发诊疗规则"
  industry: Industry;    // "medical" / "finance" / "compliance"
  formSchema: FormField[];  // 复用 P02 businessFormSchemaStore
  sampleData: Record<string, unknown>;  // 示例数据
  /** LLM 翻译提示词模板 */
  translatePrompt: string;
}
```

**理由**:
1. 复用 P02 businessFormSchemaStore,不重新发明表单
2. 模板降低用户使用门槛(选模板→填表单→提交)
3. 行业区分(医疗/财务/合规),与 P02 起步行业一致

### 3.5 决策 5:LLM 翻译可编辑 + 可跳过

**决策**:LLM 翻译后的 instruction 可编辑(开发者模式),也可跳过 LLM 直接手写 instruction。

**理由**:
1. LLM 可能翻译错误,需人工校正(开发者模式)
2. 开发者可直接写 instruction,不依赖 LLM(退路)
3. LLM 未配置时(`!isConfigured()`),自动切开发者模式

---

## 4. 数据模型

### 4.1 BusinessEvent 类型

```typescript
// src/lib/stores/business-event.ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project

import type { Industry } from "$lib/stores/db";

export type TranslateStatus = "idle" | "translating" | "translated" | "error";

export interface BusinessEvent {
  /** 事件 ID(前端生成) */
  id: string;
  /** 事件模板 ID */
  templateId: string;
  /** 事件名称(用户可改,默认取模板名) */
  name: string;
  /** 表单数据(业务专家填写) */
  formData: Record<string, unknown>;
  /** LLM 翻译后的 instruction(内核 4 元素指令 JSON) */
  instruction: object | null;
  /** LLM 翻译状态 */
  translateStatus: TranslateStatus;
  /** LLM 翻译错误信息 */
  translateError: string | null;
  /** 提交历史(最近一次 CommandResult) */
  lastResult: CommandResult | null;
  /** 创建时间 */
  createdAt: string;
  /** 最后提交时间 */
  lastSubmittedAt: string | null;
}
```

### 4.2 BusinessEventTemplate 类型

```typescript
// src/lib/stores/business-event-templates.ts

import type { Industry } from "$lib/stores/db";

export interface FormField {
  /** 字段名 */
  name: string;
  /** 显示标签 */
  label: string;
  /** 字段类型 */
  type: "text" | "number" | "date" | "select" | "textarea" | "checkbox";
  /** 是否必填 */
  required: boolean;
  /** 默认值 */
  defaultValue?: unknown;
  /** select 类型的选项 */
  options?: { value: string; label: string }[];
  /** 校验规则 */
  validate?: {
    min?: number;
    max?: number;
    pattern?: string;
  };
  /** 业务术语提示(复用 P02 businessTermsStore) */
  termHint?: string;
}

export interface BusinessEventTemplate {
  /** 模板 ID */
  id: string;
  /** 模板名 */
  name: string;
  /** 描述 */
  description: string;
  /** 行业 */
  industry: Industry;
  /** 表单字段定义 */
  formSchema: FormField[];
  /** 示例数据 */
  sampleData: Record<string, unknown>;
  /** LLM 翻译提示词模板({formData} 占位符) */
  translatePrompt: string;
  /** 图标(emoji) */
  icon: string;
}
```

### 4.3 ImpactPreview 类型

```typescript
// src/lib/stores/impact-preview.ts

export interface RuleMatchResult {
  /** 规则 ID */
  ruleId: string;
  /** 规则描述 */
  ruleDescription: string;
  /** 是否匹配 */
  matched: boolean;
  /** 匹配的字段 */
  matchedFields: string[];
  /** 预计触发的 Fact 类型 */
  expectedFactType: string;
}

export interface ImpactPreview {
  /** 匹配的规则列表 */
  matches: RuleMatchResult[];
  /** 匹配的规则数 */
  matchedCount: number;
  /** 不匹配的规则数 */
  unmatchedCount: number;
  /** 预览生成时间 */
  generatedAt: string;
  /** 预览置信度(简单匹配=低,完整模拟=高) */
  confidence: "low" | "medium" | "high";
}
```

### 4.4 内核类型(复用,不修改)

```typescript
// 来自 @evorule/console(不修改)
import type { CommandResult } from "@evorule/console";
// CommandResult = { accepted: boolean; version?: number; error?: string }

// submitCommand(id: SessionId, instruction: object): Promise<CommandResult>
// instruction = evorule-tcb 4 元素指令 JSON(domain/action/payload/meta)
```

---

## 5. Store 设计

### 5.1 Store 一览

| Store | 文件 | 职责 | 持久化 |
| --- | --- | --- | --- |
| `businessEventStore` | `src/lib/stores/business-event.ts` | 业务事件 CRUD + 翻译状态 | localStorage |
| `businessEventTemplateStore` | `src/lib/stores/business-event-templates.ts` | 事件模板(预设,代码内置) | 代码内置 |
| `impactPreviewStore` | `src/lib/stores/impact-preview.ts` | 影响预览(派生计算) | 不持久化 |

### 5.2 businessEventStore

```typescript
// src/lib/stores/business-event.ts(核心 API)

export const businessEventStore = writable<BusinessEvent[]>(loadEvents());

// === CRUD ===

/** 从模板创建业务事件 */
export function createEventFromTemplate(templateId: string): string;

/** 更新表单数据 */
export function updateFormData(eventId: string, formData: Record<string, unknown>): void;

/** 更新 instruction(开发者模式手写) */
export function updateInstruction(eventId: string, instruction: object): void;

/** 删除事件 */
export function deleteEvent(eventId: string): void;

// === LLM 翻译 ===

/** 触发 LLM 翻译(表单数据 → instruction) */
export async function translateEvent(
  eventId: string,
  assistant: LlmAssistant,
): Promise<void>;

// === 提交 ===

/** 提交业务事件到 session */
export async function submitEvent(
  eventId: string,
  sessionId: number,
  backend: ExecutionBackend,
): Promise<CommandResult>;

// === 派生 ===

/** 当前编辑的事件 */
export const currentEvent = derived(businessEventStore, ($events) =>
  $events.find((e) => e.id === currentEventId),
);
```

### 5.3 businessEventTemplateStore(代码内置)

```typescript
// src/lib/stores/business-event-templates.ts

/** 内置业务事件模板(P0 起步:医疗 + 财务) */
export const BUILTIN_TEMPLATES: BusinessEventTemplate[] = [
  {
    id: "patient_visit",
    name: "病人就诊",
    description: "记录病人就诊信息,触发诊疗规则",
    industry: "medical",
    icon: "🏥",
    formSchema: [
      { name: "patientId", label: "病人 ID", type: "text", required: true, termHint: "病人唯一标识" },
      { name: "temperature", label: "体温(°C)", type: "number", required: true, validate: { min: 30, max: 45 } },
      { name: "symptom", label: "症状", type: "select", required: true, options: [
        { value: "fever", label: "发热" },
        { value: "cough", label: "咳嗽" },
        { value: "chest_pain", label: "胸痛" },
      ]},
      { name: "age", label: "年龄", type: "number", required: true, validate: { min: 0, max: 150 } },
    ],
    sampleData: { patientId: "P-1283", temperature: 39.2, symptom: "fever", age: 65 },
    translatePrompt: `将以下病人就诊信息翻译为 evorule 指令 JSON(4 元素:domain/action/payload/meta):
{formData}
domain 应为 "medical",action 应为 "patient_visit"`,
  },
  {
    id: "drug_prescribe",
    name: "药品开具",
    description: "记录药品开具信息,触发用药规则",
    industry: "medical",
    icon: "💊",
    formSchema: [
      { name: "patientId", label: "病人 ID", type: "text", required: true },
      { name: "drugName", label: "药品名称", type: "text", required: true },
      { name: "dosage", label: "剂量(mg)", type: "number", required: true, validate: { min: 0 } },
      { name: "isHighRisk", label: "高风险药品", type: "checkbox", required: false, defaultValue: false },
    ],
    sampleData: { patientId: "P-1283", drugName: "阿莫西林", dosage: 500, isHighRisk: false },
    translatePrompt: `将以下药品开具信息翻译为 evorule 指令 JSON(4 元素):
{formData}
domain 应为 "medical", action 应为 "drug_prescribe"`,
  },
  {
    id: "invoice_approve",
    name: "发票审批",
    description: "提交发票审批请求,触发财务规则",
    industry: "finance",
    icon: "💰",
    formSchema: [
      { name: "invoiceId", label: "发票编号", type: "text", required: true },
      { name: "amount", label: "金额(元)", type: "number", required: true, validate: { min: 0 } },
      { name: "department", label: "申请部门", type: "text", required: true },
      { name: "urgency", label: "紧急程度", type: "select", required: true, options: [
        { value: "normal", label: "普通" },
        { value: "urgent", label: "紧急" },
        { value: "critical", label: "特急" },
      ]},
    ],
    sampleData: { invoiceId: "INV-2026-001", amount: 50000, department: "急诊科", urgency: "urgent" },
    translatePrompt: `将以下发票审批信息翻译为 evorule 指令 JSON(4 元素):
{formData}
domain 应为 "finance", action 应为 "invoice_approve"`,
  },
];
```

### 5.4 impactPreviewStore(派生计算)

```typescript
// src/lib/stores/impact-preview.ts

import { getAllRules } from "@evorule/console";
import { derived } from "svelte/store";
import { businessEventStore, currentEventId } from "./business-event";

/**
 * 影响预览:当前事件的 instruction 与数据集规则的匹配结果
 * P0 用前端简单匹配(检查 payload 字段是否命中规则条件)
 */
export const impactPreview = derived(
  [businessEventStore, currentEventId],
  ([$events, $currentId]) => {
    const event = $events.find((e) => e.id === $currentId);
    if (!event || !event.instruction) {
      return null;
    }

    const allRules = getAllRules();
    const matches = allRules.map((rule) => matchRule(rule, event.instruction!));

    return {
      matches,
      matchedCount: matches.filter((m) => m.matched).length,
      unmatchedCount: matches.filter((m) => !m.matched).length,
      generatedAt: new Date().toISOString(),
      confidence: "low" as const, // P0 前端匹配,低置信度
    };
  },
);

/**
 * 简单规则匹配(P0):检查 instruction payload 字段是否出现在规则 content 中
 * P1+ 替换为 server dry-run API
 */
function matchRule(rule: Rule, instruction: object): RuleMatchResult {
  try {
    const ruleContent = JSON.parse(rule.content);
    const payload = (instruction as any).payload || {};

    // P0 简单匹配:检查 payload 的字段名是否出现在规则条件中
    const payloadKeys = Object.keys(payload);
    const ruleKeys = Object.keys(ruleContent).filter((k) => k !== "id");
    const matchedFields = payloadKeys.filter((k) => ruleKeys.includes(k));

    return {
      ruleId: rule.id,
      ruleDescription: rule.description,
      matched: matchedFields.length > 0,
      matchedFields,
      expectedFactType: ruleContent.action || "unknown",
    };
  } catch {
    return {
      ruleId: rule.id,
      ruleDescription: rule.description,
      matched: false,
      matchedFields: [],
      expectedFactType: "unknown",
    };
  }
}
```

---

## 6. 组件树

### 6.1 BusinessExecutionPad 组件树

```
src/lib/views/ExecutionPad/
├── BusinessExecutionPad.svelte   (业务执行台主视图,包装内核)
│   ├── EventToolbar.svelte       (顶部工具栏:模板选择 + 模式 toggle)
│   ├── EventFormPanel.svelte     (业务事件表单区,左半)
│   │   ├── TemplateSelector.svelte   (模板下拉选择)
│   │   ├── DynamicForm.svelte        (动态表单,根据 formSchema 渲染)
│   │   └── FormValidationBadge.svelte(校验状态徽标)
│   ├── InstructionPanel.svelte   (指令区,右半)
│   │   ├── TranslateButton.svelte    ([LLM 翻译]按钮 + 状态)
│   │   ├── InstructionViewer.svelte  (instruction JSON 查看器)
│   │   └── InstructionEditor.svelte  (开发者模式:raw JSON 编辑)
│   ├── ImpactPreviewPanel.svelte (影响预览区,底部)
│   │   ├── MatchedRulesList.svelte   (匹配规则列表)
│   │   └── ConfidenceNote.svelte     (置信度提示)
│   └── SubmitBar.svelte          (提交栏:session 选择 + [提交])
│
└── (内核 ExecutionPadView 保留,开发者模式渲染)
```

### 6.2 布局示意

```
┌─────────────────────────────────────────────────────────────────┐
│ BusinessExecutionPad                                            │
│ ┌─工具栏─────────────────────────────────────────────────────┐ │
│ │ [模板:病人就诊 ▼]  [📋 加载示例]  模式:[业务|开发者] toggle│ │
│ └──────────────────────────────────────────────────────────┘ │
│ ┌─业务事件表单(左)────────┐ ┌─指令区(右)──────────────────┐ │
│ │ 病人 ID:  [P-1283      ] │ │ [🔄 LLM 翻译]  ✅ 已翻译     │ │
│ │ 体温(°C): [39.2        ] │ │                            │ │
│ │ 症状:     [发热 ▼       ] │ │ instruction:               │ │
│ │ 年龄:     [65           ] │ │ {                          │ │
│ │                          │ │   "domain": "medical",     │ │
│ │ ✅ 表单校验通过           │ │   "action": "patient_visit"│ │
│ └──────────────────────────┘ │   "payload": { ... }       │ │
│                              │   "meta": { ... }          │ │
│                              │ }                          │ │
│                              │ (开发者模式可编辑)          │ │
│                              └──────────────────────────┘ │
│ ┌─影响预览(底部)──────────────────────────────────────────┐ │
│ │ ⚡ 预览:3 条规则可能匹配(低置信度 — 前端简单匹配)        │ │
│ │   ✅ R-005 发烧处理规则 (匹配: temperature, symptom)    │ │
│ │   ✅ R-018 老年人特殊处理 (匹配: age)                   │ │
│ │   ✅ R-042 高烧 CT 检查 (匹配: temperature)             │ │
│ │   ⬜ R-067 药品相互作用 (不匹配)                         │ │
│ └──────────────────────────────────────────────────────────┘ │
│ ┌─提交栏──────────────────────────────────────────────────┐ │
│ │ Session: [production ▼]  [提交业务事件]  上次:✅ v142   │ │
│ └──────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### 6.3 开发者模式

开发者模式 toggle 切换到内核 `ExecutionPadView`(原始 JSON 编辑):
- 业务模式(默认):`BusinessExecutionPad` 组件树
- 开发者模式:内核 `ExecutionPadView`(raw JSON textarea + submitCommand)
- toggle 状态持久化到 localStorage

---

## 7. 数据流

### 7.1 业务事件提交流(完整路径)

```
1. 用户选模板"病人就诊"
  ↓
TemplateSelector → 加载 sampleData 到表单
  ↓
2. 用户填写/修改表单
  ↓
DynamicForm → formData 更新
  ↓
FormValidationBadge:实时校验(必填/范围/pattern)
  ↓ 校验通过
3. 用户点[LLM 翻译]
  ↓
translateEvent(eventId, assistant)
  ↓
CloudLlmAssistant.generateInput(template.translatePrompt, formData)
  ↓ LLM 返回 instruction JSON
businessEventStore 更新:translateStatus = "translated", instruction = {...}
  ↓
InstructionViewer 显示翻译后的 instruction
  ↓
4. 影响预览自动计算
  ↓
impactPreview 派生:遍历 getAllRules(),简单匹配 instruction payload
  ↓
ImpactPreviewPanel 显示匹配/不匹配规则
  ↓
5. 用户选 session + 点[提交业务事件]
  ↓
submitEvent(eventId, sessionId, backend)
  ↓
backend.submitCommand(sessionId, instruction)
  ↓
CommandResult { accepted: true, version: 143 }
  ↓
businessEventStore 更新:lastResult, lastSubmittedAt
  ↓
SubmitBar 显示"✅ 已接受 v143"
  ↓
(可选)L1 监控大屏 SSE 收到新 Fact(P05)
```

### 7.2 LLM 翻译流(详细)

```
用户点[LLM 翻译]
  ↓
translateStatus = "translating"
  ↓
检查 LLM 是否配置(isConfigured)
  ├─ 未配置 → toast"请先在设置页配置 LLM" → translateStatus = "error"
  └─ 已配置 → 继续
  ↓
组装 prompt:
  template.translatePrompt
    .replace("{formData}", JSON.stringify(event.formData))
  ↓
CloudLlmAssistant.generateInput(prompt)
  ↓ LLM 返回 JSON 文本
解析 JSON:
  ├─ 解析失败 → translateStatus = "error", translateError = "LLM 返回无效 JSON"
  └─ 解析成功 → translateStatus = "translated", instruction = parsed
  ↓
(可选)RuleValidator.validate(instruction) 验证指令格式
  ↓
影响预览自动更新
```

### 7.3 影响预览流(自动)

```
event.instruction 变化(翻译/手写)
  ↓
impactPreview 派生计算
  ↓
getAllRules() 获取当前规则库所有规则
  ↓
for each rule:
  matchRule(rule, instruction)
    → 解析 rule.content JSON
    → 检查 instruction.payload 字段是否出现在规则条件中
    → 返回 RuleMatchResult
  ↓
ImpactPreview { matches, matchedCount, unmatchedCount, confidence: "low" }
  ↓
ImpactPreviewPanel 渲染:
  - 匹配规则:绿色 ✅ + 匹配字段
  - 不匹配:灰色 ⬜
  - 置信度提示:"低置信度 — 前端简单匹配,实际执行可能不同"
```

### 7.4 开发者模式切换流

```
用户点模式 toggle [业务 → 开发者]
  ↓
homeModeStore(或 localStore)更新:executionPadMode = "developer"
  ↓
BusinessExecutionPad 条件渲染:
  {:else if mode === 'developer'}
    <ExecutionPadView onaiGenerateInput={handleGenerate} />
  ↓
内核 ExecutionPadView 渲染(raw JSON textarea)
  ↓
用户可直接编辑 instruction JSON + submitCommand
```

---

## 8. 关键代码示例

### 8.1 BusinessExecutionPad.svelte(主视图)

```svelte
<!-- src/lib/views/ExecutionPad/BusinessExecutionPad.svelte -->
<script lang="ts">
  import { get } from 'svelte/store';
  import { ExecutionPadView } from '@evorule/console';
  import { useBackend } from '$lib/backend/backend-context';
  import { useLlmAssistantOrNull } from '$lib/assistant/llm-context';
  import {
    businessEventStore,
    createEventFromTemplate,
    updateFormData,
    translateEvent,
    submitEvent,
    currentEventId,
  } from '$lib/stores/business-event';
  import { BUILTIN_TEMPLATES } from '$lib/stores/business-event-templates';
  import { impactPreview } from '$lib/stores/impact-preview';
  import { sessions, currentSessionId, createSession } from '@evorule/console';
  import EventFormPanel from './EventFormPanel.svelte';
  import InstructionPanel from './InstructionPanel.svelte';
  import ImpactPreviewPanel from './ImpactPreviewPanel.svelte';
  import SubmitBar from './SubmitBar.svelte';

  let mode = $state<'business' | 'developer'>('business');
  let selectedTemplateId = $state<string>(BUILTIN_TEMPLATES[0]?.id ?? '');
  let submitting = $state(false);

  const backend = useBackend();
  const assistant = useLlmAssistantOrNull();
  const preview = $derived(get(impactPreview));
  const sessionId = $derived(get(currentSessionId));

  function handleNewEvent(): void {
    if (!selectedTemplateId) return;
    const id = createEventFromTemplate(selectedTemplateId);
    currentEventId.set(id);
  }

  async function handleTranslate(): Promise<void> {
    if (!assistant) {
      alert('请先在设置页配置 LLM');
      return;
    }
    const eventId = get(currentEventId);
    if (eventId) {
      await translateEvent(eventId, assistant);
    }
  }

  async function handleSubmit(): Promise<void> {
    const eventId = get(currentEventId);
    if (!eventId || !sessionId) return;

    submitting = true;
    try {
      const result = await submitEvent(eventId, sessionId, backend);
      if (!result.accepted) {
        alert(`提交被拒绝: ${result.error ?? '未知错误'}`);
      }
    } catch (e) {
      alert(`提交失败: ${(e as Error).message}`);
    } finally {
      submitting = false;
    }
  }
</script>

{#if mode === 'developer'}
  <ExecutionPadView onaiGenerateInput={handleTranslate} />
{:else}
  <div class="business-execution-pad">
    <div class="toolbar">
      <select bind:value={selectedTemplateId}>
        {#each BUILTIN_TEMPLATES as t}
          <option value={t.id}>{t.icon} {t.name}</option>
        {/each}
      </select>
      <button onclick={handleNewEvent}>新建事件</button>
      <button onclick={() => (mode = 'developer')}>开发者模式</button>
    </div>

    <div class="main-area">
      <EventFormPanel />
      <InstructionPanel onTranslate={handleTranslate} />
    </div>

    <ImpactPreviewPanel {preview} />

    <SubmitBar
      {sessionId}
      {submitting}
      onSubmit={handleSubmit}
    />
  </div>
{/if}
```

### 8.2 translateEvent(LLM 翻译)

```typescript
// src/lib/stores/business-event.ts(翻译部分)
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project

import { get } from "svelte/store";
import type { LlmAssistant } from "$lib/assistant/types";
import { businessEventStore } from "./business-event";
import { BUILTIN_TEMPLATES } from "./business-event-templates";

export async function translateEvent(
  eventId: string,
  assistant: LlmAssistant,
): Promise<void> {
  // 设置翻译中状态
  businessEventStore.update((all) =>
    all.map((e) =>
      e.id === eventId
        ? { ...e, translateStatus: "translating", translateError: null }
        : e,
    ),
  );

  try {
    const events = get(businessEventStore);
    const event = events.find((e) => e.id === eventId);
    if (!event) throw new Error("Event not found");

    const template = BUILTIN_TEMPLATES.find((t) => t.id === event.templateId);
    if (!template) throw new Error("Template not found");

    // 组装 prompt
    const prompt = template.translatePrompt.replace(
      "{formData}",
      JSON.stringify(event.formData, null, 2),
    );

    // 调 LLM 翻译
    const instructionJson = await assistant.generateInput(prompt);
    const instruction = JSON.parse(instructionJson);

    // 更新事件
    businessEventStore.update((all) =>
      all.map((e) =>
        e.id === eventId
          ? {
              ...e,
              instruction,
              translateStatus: "translated",
              translateError: null,
            }
          : e,
      ),
    );
  } catch (e) {
    businessEventStore.update((all) =>
      all.map((ev) =>
        ev.id === eventId
          ? {
              ...ev,
              translateStatus: "error",
              translateError: (e as Error).message,
            }
          : ev,
      ),
    );
  }
}
```

### 8.3 submitEvent(提交)

```typescript
// src/lib/stores/business-event.ts(提交部分)

import type { ExecutionBackend, CommandResult } from "$lib/backend/types";

export async function submitEvent(
  eventId: string,
  sessionId: number,
  backend: ExecutionBackend,
): Promise<CommandResult> {
  const events = get(businessEventStore);
  const event = events.find((e) => e.id === eventId);

  if (!event) throw new Error("Event not found");
  if (!event.instruction) throw new Error("Event not translated yet");

  const result = await backend.submitCommand(sessionId, event.instruction);

  // 更新提交历史
  const now = new Date().toISOString();
  businessEventStore.update((all) =>
    all.map((e) =>
      e.id === eventId
        ? { ...e, lastResult: result, lastSubmittedAt: now }
        : e,
    ),
  );

  return result;
}
```

### 8.4 DynamicForm.svelte(动态表单)

```svelte
<!-- src/lib/views/ExecutionPad/DynamicForm.svelte -->
<script lang="ts">
  import type { FormField } from '$lib/stores/business-event-templates';

  let {
    fields = [],
    data = {},
    onChange,
  }: {
    fields: FormField[];
    data: Record<string, unknown>;
    onChange: (data: Record<string, unknown>) => void;
  } = $props();

  let localData = $state({ ...data });
  let errors = $state<Record<string, string>>({});

  function validate(field: FormField, value: unknown): string | null {
    if (field.required && (value === null || value === undefined || value === '')) {
      return `${field.label} 必填`;
    }
    if (field.validate) {
      if (typeof value === 'number') {
        if (field.validate.min !== undefined && value < field.validate.min) {
          return `${field.label} 不能小于 ${field.validate.min}`;
        }
        if (field.validate.max !== undefined && value > field.validate.max) {
          return `${field.label} 不能大于 ${field.validate.max}`;
        }
      }
    }
    return null;
  }

  function handleChange(name: string, value: unknown): void {
    localData[name] = value;
    const field = fields.find((f) => f.name === name);
    if (field) {
      const error = validate(field, value);
      if (error) {
        errors[name] = error;
      } else {
        delete errors[name];
      }
    }
    onChange({ ...localData });
  }

  const isValid = $derived(Object.keys(errors).length === 0);
</script>

{#each fields as field}
  <div class="form-field">
    <label for={field.name}>
      {field.label}
      {#if field.required}<span class="required">*</span>{/if}
    </label>

    {#if field.type === 'text'}
      <input
        id={field.name}
        type="text"
        value={localData[field.name] ?? ''}
        onchange={(e) => handleChange(field.name, e.currentTarget.value)}
      />
    {:else if field.type === 'number'}
      <input
        id={field.name}
        type="number"
        value={localData[field.name] ?? ''}
        onchange={(e) => handleChange(field.name, Number(e.currentTarget.value))}
      />
    {:else if field.type === 'select'}
      <select
        id={field.name}
        value={localData[field.name] ?? ''}
        onchange={(e) => handleChange(field.name, e.currentTarget.value)}
      >
        {#each field.options ?? [] as opt}
          <option value={opt.value}>{opt.label}</option>
        {/each}
      </select>
    {:else if field.type === 'checkbox'}
      <input
        id={field.name}
        type="checkbox"
        checked={localData[field.name] ?? false}
        onchange={(e) => handleChange(field.name, e.currentTarget.checked)}
      />
    {:else if field.type === 'textarea'}
      <textarea
        id={field.name}
        value={localData[field.name] ?? ''}
        onchange={(e) => handleChange(field.name, e.currentTarget.value)}
      ></textarea>
    {/if}

    {#if field.termHint}
      <small class="term-hint">💡 {field.termHint}</small>
    {/if}
    {#if errors[field.name]}
      <span class="error">{errors[field.name]}</span>
    {/if}
  </div>
{/each}
```

---

## 9. 测试策略

### 9.1 单元测试(Vitest)

| 测试目标 | 测试文件 | 覆盖点 |
| --- | --- | --- |
| businessEventStore | `business-event.test.ts` | create/update/delete + 翻译状态机 + 提交历史 |
| BUILTIN_TEMPLATES | `business-event-templates.test.ts` | 模板完整性(字段/示例数据/prompt) |
| translateEvent | `business-event-translate.test.ts` | LLM 翻译成功/失败/未配置 |
| submitEvent | `business-event-submit.test.ts` | 提交成功/被拒绝/网络错误 |
| matchRule | `impact-preview.test.ts` | 匹配/不匹配/解析失败 |
| DynamicForm 校验 | `dynamic-form.test.ts` | 必填/范围/select/checkbox |

### 9.2 E2E 测试(Playwright)

| 测试路径 | 步骤 |
| --- | --- |
| 完整提交路径 | 选模板→填表单→LLM 翻译→预览→提交→验证 accepted |
| 开发者模式 | 切开发者模式→编辑 JSON→提交→验证 accepted |
| LLM 未配置 | 不配置 LLM→点翻译→验证错误提示 |
| 影响预览 | 填表单→翻译→验证预览显示匹配规则 |
| 表单校验 | 必填留空→验证校验错误→填完→验证通过 |

---

## 10. 与其他文档的关系

### 10.1 与 P01/P02/P03 的关系

| 前置设计 | P0-4 复用 |
| --- | --- |
| P01 §1.3.4 session store | `submitCommand` / `createSession` / `currentSessionId` |
| P01 §1.3.5 ExecutionPadView | 包装内核视图(开发者模式) |
| P02 §3.6 CloudLlmAssistant | `generateInput()` LLM 翻译 |
| P02 §4.3 businessFormSchemaStore | FormField 类型复用 |
| P03 数据集 | 执行台可选运行哪个数据集(P03 assembleRuleset) |

### 10.2 与三层架构的关系

| 三层架构章节 | P0-4 对应 |
| --- | --- |
| L2 Workspace | 执行台在 L2 编辑/预览业务事件 |
| L3 Sandbox | 提交到沙盒 session 测试 |
| L1 Production | 提交到 production session(真实业务) |

### 10.3 与战略文档的关系

| 战略文档章节 | 本设计文档章节 |
| --- | --- |
| §20.2 P0-4 业务执行台 | §1-§10(全文) |
| §15.5 步骤 5 导入到 evorule | §7.1 业务事件提交流 |

---

## 11. 长期演进路径

### 11.1 P0 → P1

| P0 | P1+ |
| --- | --- |
| 前端简单匹配(低置信度) | server dry-run API(高置信度) |
| 3 个内置模板 | 模板市场(用户上传/分享) |
| 单事件提交 | 批量事件导入(CSV/JSON) |
| 无事件历史 | 事件历史 + 回放 |

### 11.2 P2

- 业务事件审批工作流(P0-8 协作)
- 跨 session 事件对比(What-If 分析,复用 ttd whatif 视图)
- 业务事件与审计链关联(审计追溯)

---

## 12. 代码变更列表

### 12.1 新增文件

| 文件 | 类型 | 说明 |
| --- | --- | --- |
| `src/lib/stores/business-event.ts` | Store | 业务事件 CRUD + 翻译 + 提交 |
| `src/lib/stores/business-event-templates.ts` | Data | 内置事件模板(3 个:医疗×2 + 财务×1) |
| `src/lib/stores/impact-preview.ts` | Store | 影响预览(派生计算) |
| `src/lib/views/ExecutionPad/BusinessExecutionPad.svelte` | Component | 业务执行台主视图 |
| `src/lib/views/ExecutionPad/EventFormPanel.svelte` | Component | 事件表单区 |
| `src/lib/views/ExecutionPad/DynamicForm.svelte` | Component | 动态表单(schema 驱动) |
| `src/lib/views/ExecutionPad/InstructionPanel.svelte` | Component | 指令区(查看/编辑) |
| `src/lib/views/ExecutionPad/ImpactPreviewPanel.svelte` | Component | 影响预览区 |
| `src/lib/views/ExecutionPad/SubmitBar.svelte` | Component | 提交栏 |

### 12.2 修改文件

| 文件 | 修改 |
| --- | --- |
| `src/lib/views/Home/WorkspaceConsole.svelte` | L2 编辑台加 BusinessExecutionPad 入口 |

---

## 13. 待办

- [ ] server dry-run API(P1,影响预览高置信度)
- [ ] 业务事件模板市场(P1)
- [ ] 批量事件导入(P1)
- [ ] 事件历史 + 回放(P1)
- [ ] 业务事件审批工作流(P0-8)

---

> 设计文档 — 2026-08-06 定稿
