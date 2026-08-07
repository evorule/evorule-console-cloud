# P0-1 详细设计(建库向导 + 通用 schema + 业务规则库)

> **状态**:设计文档,2026-08-06 定稿(2026-08-06 同步三层架构 U6/U7)。本文档是 evorule-doc-center `b2b2c-strategy.md §20.2 P0-1` 的可实施落地。
>
> **定位**:P0-1 三块工作 — 建库向导(5 步 UI 流程)+ 通用 schema(库元数据 + 业务对象)+ 业务规则库(在内核 RuleLibraryView 之上加业务语言层)。本文档把战略意图落到 SvelteKit + Svelte 5 + 内核 @evorule/console 集成层面,作为 P0-1 实施依据。
>
> **关联**:
>
> - 战略依据:`D:\evorule-doc-center\shared\final\b2b2c-strategy.md §20.2 P0-1`
> - 首页设计:`D:\evorule-console-cloud\docs\HOME_DESIGN.md`(P0-0b 首页 + P0-0c 建库向导 UI 流程)
> - 三层运行架构:`D:\evorule-doc-center\shared\draft\evorule-three-layer-architecture.md`(U6/U7 同步依据,§4.6 + §13.4)
> - 现有内核导出:`@evorule/console`(rules store + RuleValidator + RuleLibraryView 等,详见 §1.3)
> - 现有 backend:`src/lib/backend/cloud-http-backend.ts`(session-based,无库 CRUD,详见 §1.4)
> - 现有 LLM assistant:`src/lib/assistant/cloud-llm-assistant.ts`(generateRuleDraft / explainRule / generateInput)

---

## 1. 背景与动机

### 1.1 战略意图(来自 §20.2)

P0-1 三块工作:

| 子块        | 职责                                                                               | 对应功能流步骤                           |
| ----------- | ---------------------------------------------------------------------------------- | ---------------------------------------- |
| 建库向导    | 5 步引导用户建立第一个库 + 加第一条规则                                            | 步骤 1 建空白数据库 + 步骤 2-3 编写/整理 |
| 通用 schema | 库元数据(库名、业务对象、行业)+ 空白库初始化                                       | 步骤 1 建立空白数据库                    |
| 业务规则库  | 在内核 RuleLibraryView 之上加业务语言层(业务术语 + 业务表单 + 业务预览 + 业务命名) | 步骤 2-3 编写/整理规则                   |

### 1.2 双重职责张力(P0-1 特有)

P0-1 也面临张力,与首页类似但不同:

| 职责           | 设计目标                     | 用户                | 冲突点                       |
| -------------- | ---------------------------- | ------------------- | ---------------------------- |
| 真实业务规则库 | 业务语言、业务表单、业务预览 | 业务专家(不懂 JSON) | 隐藏 JSON,但 JSON 是内核权威 |
| 开发者视图     | raw JSON 编辑、内核字段      | 开发者 / 技术用户   | 业务包装会丢失原始字段       |

**核心判断**:业务优先,raw JSON 是开发者模式的退路。这与战略文档 §5.8.1 "真实优先" 原则一致。

### 1.3 内核已有能力(关键发现)

通过 `@evorule/console` 包导出的能力(详见 `node_modules/@evorule/console/dist/index.d.ts`):

#### 1.3.1 规则库 store(已实现 + 持久化)

```typescript
// 内核已有,无需重新发明
import {
  rules, // Writable<Rule[]>
  selectedRuleId, // Writable<string | null>
  selectedRule, // Readable<Rule | null>(派生)
  selectRule, // (id: string) => void
  getAllRules, // () => Rule[](非响应式)
  addRule, // (rule: Omit<Rule, 'source'|'createdAt'|'updatedAt'>) => string
  updateRule, // (id, patch: Partial<Pick<Rule, 'version'|'description'|'content'>>) => void
  deleteRule, // (id: string) => void
  duplicateRule, // (sourceId: string) => string(复制 builtin 为 user)
  importRule, // (jsonContent: string) => string
  exportRule, // (id: string) => string
  type Rule, // 内核规则类型
} from "@evorule/console";
```

#### 1.3.2 内核 Rule 类型

```typescript
// 来自 @evorule/console(dist/stores/rules.d.ts)
export interface Rule {
  /** 规则 id,如 "example.set_basic" 或 "user.xxx" */
  id: string;
  /** 版本号,从 1 开始 */
  version: number;
  /** 业务专家可读的描述 ← 这就是"业务命名"字段 */
  description: string;
  /** 原始 JSON 文本(用户编辑的对象) */
  content: string;
  /** 来源:builtin(内置示例)/ user(用户创建) */
  source: "builtin" | "user";
  /** 创建时间(ISO 字符串) */
  createdAt: string;
  /** 最后更新时间(ISO 字符串) */
  updatedAt: string;
}
```

**关键观察**:

- `description` 字段 = 业务专家可读的描述 = 战略文档 §6.1 "业务命名" 的天然落点
- `content` 字段 = 原始 JSON 文本 = 内核权威
- `source: 'builtin' | 'user'` = 区分内置(3 个示例,不持久化)和用户(持久化到 localStorage)
- **持久化**:localStorage key = `evorule-console:rules:user`(只持久化 user 规则)

#### 1.3.3 规则验证器(已实现)

```typescript
import { RuleValidator, type ValidationResult } from "@evorule/console";
// RuleValidator.validate(jsonStr: string): ValidationResult
// 用法见 cloud-llm-assistant.ts L139
```

#### 1.3.4 session 管理 store(已实现)

```typescript
import {
  sessions, // Writable<SessionId[]>
  currentSessionId, // Writable<SessionId | null>
  sessionState, // session 状态
  commandHistory, // 命令历史
  createSession, // () => Promise<SessionId>
  selectSession, // (id: SessionId) => void
  submitCommand, // (id: SessionId, instruction: object) => Promise<CommandResult>
} from "@evorule/console";
```

#### 1.3.5 视图组件(已实现)

```typescript
import {
  RuleLibraryView, // 内核规则库视图(raw JSON 编辑)
  ExecutionPadView, // 执行台
  StateView, // 状态
  AuditView, // 审计
  TimeTravelView, // 时间旅行
  currentView,
  setView,
  restoreView,
  VIEW_LIST,
  type ViewId,
} from "@evorule/console";
```

### 1.4 现有 backend 限制

`src/lib/backend/cloud-http-backend.ts` 只代理内核 `HttpBackend` 的 15 个方法(session-based):

- `createSession` / `listSessions` / `closeSession`
- `submitCommand(id, instruction)` / `getSessionState`
- `getFacts` / `getAudit` / `getCausalChain` / `verifyAudit`
- `getStateAtVersion` / `getDiff` / `forkSession`

**没有**:

- 库(database)的 CRUD 接口
- 规则的 CRUD 接口(规则 CRUD 在内核 store 层,不在 backend 层)
- 业务对象的接口

**含义**:P0-1 阶段所有"库 / 规则 / 业务对象"管理都在 console-cloud 前端层(用 localStorage 持久化),不需要扩展后端。P1+ 后端化时再迁移。

### 1.5 与战略文档的关系

| 战略文档章节                                   | 本设计文档章节                                          |
| ---------------------------------------------- | ------------------------------------------------------- |
| §20.2 P0-1 建库向导 + 通用 schema + 业务规则库 | §1-§15(全文)                                            |
| §6 业务语言层(基线)                            | §5.3 businessTermsStore + §6.2 BusinessRuleLibrary 组件 |
| §10 业务模板规范                               | §9 业务模板规范(财务 + 合规 两个起步)                   |
| §5.5 规则库 → 业务规则库(改造)                 | §6.2 BusinessRuleLibrary 包装内核 RuleLibraryView       |
| §11 P0 模板市场范围(1-2 个行业跑通)            | §9.1 财务审批 + §9.2 合规审计                           |

### 1.6 与 HOME_DESIGN.md 的关系

HOME_DESIGN.md §6.2 设计了 `dbStore`(库元数据),其中:

```typescript
// HOME_DESIGN.md 原设计
export interface DbMeta {
  dbId: string;
  dbName: string;
  businessObjects: string[];
  ruleCount: number; // ← 这个字段需要重新设计
  createdAt: number | null;
}
```

**重要一致性更新**(详见 §13):

- `ruleCount` 字段应**移除** — 改为派生计算 `get(rules).length`(从内核 rules store 派生)
- `markAsNonEmpty()` 函数应**移除** — 内核 `addRule()` 自动让 `get(rules).length > 0`
- `setRuleCount()` 函数应**移除** — 同上

本设计文档 §4.2 给出更新后的 `dbStore` 接口,§13 列出对 HOME_DESIGN.md 的同步修改清单。

### 1.7 与三层运行架构的关系(2026-08-06 同步)

`evorule-three-layer-architecture.md` 定义了 Production Runtime / Workspaces / Sandbox Sessions 三层抽象。本文档 §4.6 同步其 §6 数据模型设计与 §12.4 U6/U7 决策:

- **U6**:Workspace 状态管理放 evorule-server 新开独立 `workspace` crate(§4.6.10)
- **U7**:滚动 session 切换采用服务端推送 `session_switched` 事件(§4.6.9 + §4.6.10 `production.rs`)
- **P0 边界**:console-cloud P0 用 localStorage(§4.1-§4.5),server 应用层表(§4.6)是 P1+ 契约,提前定义以确保字段对齐

---

## 2. 目标与非目标

### 2.1 目标

- ✅ 复用内核 `rules` store(`addRule` / `updateRule` / `deleteRule` / `Rule` 类型 + localStorage 持久化)
- ✅ 扩展 `dbStore` 管理库元数据(库名、业务对象、行业、创建时间)
- ✅ 实现 5 步建库向导(对应 HOME_DESIGN.md §5.3 OnboardingWizard 的数据层支撑)
- ✅ 实现业务语言层 v0(2 个行业起步:财务审批 + 合规审计)
- ✅ 业务规则库 = 包装内核 `RuleLibraryView`,加业务术语 / 业务表单 / 业务预览 / 业务命名
- ✅ 实现业务模板(财务审批 + 合规审计,各 3-5 条 builtin 规则 + 业务术语 + 业务表单)
- ✅ 与内核 `RuleValidator` 集成(LLM 草案校验)
- ✅ 与内核 `CloudLlmAssistant` 集成(generateRuleDraft + explainRule)
- ✅ 延续 SvelteKit + Svelte 5 runes + provideXxx 注入模式
- ✅ 单元测试覆盖 Store + 状态机(Vitest)
- ✅ E2E 测试覆盖建库向导 5 步完整路径(Playwright)

### 2.2 非目标

- ❌ 不重新发明规则库 store(复用内核 `rules`)
- ❌ 不重新设计 Rule 类型(复用内核 `Rule`)
- ❌ 不实现后端 API(P0 阶段所有数据在 localStorage,P1+ 后端化)
- ❌ 不实现多租户 / 多库(P0 阶段单浏览器单库)
- ❌ 不实现规则版本历史(内核 Rule.version 字段已有,P1+ 才做完整版本管理 UI)
- ❌ 不实现规则审批工作流(P0-8 协作工作流基础,P1 合规审批工作流)
- ❌ 不实现 10 行业浅模板(P1 工作,见战略文档 §20.5)
- ❌ 不修改内核 `@evorule/console` 包(P0-1 全在 console-cloud 层)
- ❌ 不实现 i18n / a11y / 移动端(P1/P2)

---

## 3. 关键架构决策

### 3.1 决策 1:复用内核 rules store,不重新发明

**决策**:P0-1 不在 console-cloud 层创建独立的 `ruleStore`,直接 `import { rules, addRule, ... } from '@evorule/console'`。

**理由**:

1. 内核 `rules` store 已实现完整 CRUD + 持久化(localStorage `evorule-console:rules:user`)
2. 内核 `Rule` 类型已是 schema(id / version / description / content / source / createdAt / updatedAt)
3. 内核 `RuleValidator` 已实现 JSON 规则校验
4. 内核 `RuleLibraryView` 已实现 raw JSON 编辑 UI
5. 重新发明会破坏内核边界,违反"组合优于继承"原则(见 `cloud-http-backend.ts` L11-L13)

**含义**:

- 业务规则库 = 内核 `rules` store + 业务语言层(本设计文档 §5.3 + §6.2)
- 业务规则 = 内核 `Rule` 类型 + 业务元数据扩展(可选,见 §3.4)
- 持久化由内核负责(localStorage `evorule-console:rules:user`),console-cloud 不重复

### 3.2 决策 2:扩展 dbStore 管理库元数据(只管元,不管规则)

**决策**:`dbStore` 只管"库元数据"(库名、业务对象、行业、创建时间),不管规则。规则数从内核 `rules` store 派生计算。

**理由**:

1. 规则已在内核 `rules` store,`dbStore` 重复 = 数据冗余 + 一致性风险
2. "库"在 P0 阶段是元数据概念(库名 + 业务对象 + 行业),不是规则容器
3. 派生计算 `get(rules).length === 0` 判断"空库",比 `dbStore.ruleCount === 0` 更准确(单一数据源)

**含义**(对 HOME_DESIGN.md 的更新):

- 移除 `dbStore.ruleCount` 字段
- 移除 `markAsNonEmpty()` / `setRuleCount()` 函数
- 新增 `dbStore.industry` 字段(行业:finance / compliance / blank)
- 空库判断改为 `isEmptyDb = derived([rules], ([$rules]) => $rules.length === 0)`

### 3.3 决策 3:业务语言层 = 3 子层 + 1 派生层

**决策**:业务语言层由 3 个独立 store + 1 个派生计算组成:

| 子层            | Store                     | 职责                                        |
| --------------- | ------------------------- | ------------------------------------------- |
| 业务术语库      | `businessTermsStore`      | 行业词表(医疗 / 财务 / 律所术语)            |
| 业务表单 schema | `businessFormSchemaStore` | 业务字段定义(年龄 / 金额 / 日期)            |
| 业务预览        | (派生,无独立 store)       | 用内核 LLM `explainRule(rule)` 生成自然语言 |

**理由**:

1. 业务术语库是静态数据(行业词表),独立 store + localStorage 持久化
2. 业务表单 schema 是静态数据(字段定义),独立 store + localStorage
3. 业务预览是动态计算(LLM 调用),不需要 store,在组件内 `$state` + 异步调用

### 3.4 决策 4:业务元数据扩展用"扩展表",不污染内核 Rule

**决策**:不在内核 `Rule` 类型上加字段(不修改内核),在 console-cloud 层加"业务元数据扩展表"。

**理由**:

1. 修改内核 `Rule` 类型会破坏内核边界
2. 业务元数据(行业 / 业务对象 / 业务术语映射)是 console-cloud 层的概念
3. 内核 `Rule.description` 字段已足够承载"业务命名"(业务专家可读的描述)

**实现**:

- 内核 `Rule` 不变
- console-cloud 层加 `ruleBusinessMetaStore`:Map<ruleId, BusinessMeta>
- BusinessMeta = { industry, businessObject, businessTerms: string[] }
- 持久化:localStorage `evorule-console-cloud:rule-business-meta`

**取舍**:

- ✅ 内核边界清晰
- ✅ 业务元数据可选(不强制每条规则都有)
- ❌ 查询时要 join(ruleId → BusinessMeta),但 O(1) Map 查询,性能足够

### 3.5 决策 5:业务规则库 UI = 包装内核 RuleLibraryView

**决策**:不在内核 `RuleLibraryView` 上直接改,在 console-cloud 层加 `BusinessRuleLibrary.svelte` 包装它。

**实现**:

- `BusinessRuleLibrary.svelte`(新增)= 业务语言筛选 + 规则卡片 + 业务表单 + LLM 按钮 + 内核 `RuleLibraryView`(条件渲染)
- 工作台默认渲染 `BusinessRuleLibrary`
- "开发者模式" toggle 切换到 raw `RuleLibraryView`(完整 JSON 编辑)

**理由**:

1. 内核组件接受 LLM callback(已设计扩展槽),不需修改
2. 包装模式符合 `cloud-http-backend.ts` 的"组合优于继承"原则
3. 开发者模式保留 raw JSON 退路(决策 §1.2 双重职责)

### 3.6 决策 6:业务模板 = builtin 规则集 + 业务元数据

**决策**:业务模板(财务审批 / 合规审计)= builtin 规则集(代码内置)+ 业务术语 + 业务表单 schema + 业务元数据。

**实现**:

- 2 个模板各 3-5 条 builtin 规则(代码内置,不持久化)
- 模板 = builtin 规则 + businessTerms + businessFormSchema + dbMeta(industry + businessObjects)
- 用户选模板 → `loadTemplate(templateId)` 一次性应用所有

**与内核 builtin 的关系**:

- 内核已有 3 个 builtin 规则(`example.set_basic` 等,见 `rules.js`)
- P0-1 不修改内核 builtin,在 console-cloud 层加"业务模板 builtin"
- 业务模板 builtin 通过 `duplicateRule(sourceId)` 复制为 user 规则

---

## 4. 数据模型

### 4.1 内核 Rule 类型(复用,不修改)

```typescript
// 来自 @evorule/console(不修改)
export interface Rule {
  id: string;
  version: number;
  description: string; // ← 业务命名落点
  content: string; // ← raw JSON(内核权威)
  source: "builtin" | "user";
  createdAt: string;
  updatedAt: string;
}
```

### 4.2 DbMeta 类型(扩展 dbStore — 对 HOME_DESIGN.md 的更新)

```typescript
// src/lib/stores/db.ts(更新 HOME_DESIGN.md §6.2)
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 库元数据 store。
// 设计:
//   - 只管"库元数据"(库名、业务对象、行业、创建时间)
//   - 不管规则(规则在内核 rules store)
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
  /** 行业模板来源(blank / finance / compliance) */
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

// === 派生:空库判断(基于内核 rules store) ===

/** 是否空库(内核 rules store 为空) */
export const isEmptyDb = derived(rules, ($rules) => $rules.length === 0);

/** 当前规则数(派生) */
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
```

### 4.3 BusinessTerm 类型(业务术语库)

```typescript
// src/lib/stores/business-terms.ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 业务术语库 store。
// 设计:
//   - 行业词表(医疗/财务/律所术语)
//   - 用于 BusinessRuleLibrary 业务语言筛选 + 业务表单字段命名
//   - 每条术语 = 中文标签 + 英文 key + 同义词数组
// 持久化:localStorage(key: evorule-console-cloud:business-terms)
//   - builtin(代码内置,2 个行业起步)+ user(用户自定义)

import { writable } from "svelte/store";
import { browser } from "$app/environment";
import { BUILTIN_BUSINESS_TERMS } from "$lib/data/business-terms-builtin";

export interface BusinessTerm {
  /** 术语 ID,如 'finance.amount' */
  id: string;
  /** 行业:finance / compliance / medical / legal / ... */
  industry: string;
  /** 中文标签 */
  label: string;
  /** 英文 key(对应 evorule JSON 字段) */
  key: string;
  /** 同义词(用于业务语言筛选) */
  synonyms: string[];
  /** 业务解释(LLM 解释时用作上下文) */
  description: string;
}

const STORAGE_KEY = "evorule-console-cloud:business-terms:user";

function loadTerms(): BusinessTerm[] {
  if (!browser) return BUILTIN_BUSINESS_TERMS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return BUILTIN_BUSINESS_TERMS;
    const userTerms = JSON.parse(raw) as BusinessTerm[];
    return [...BUILTIN_BUSINESS_TERMS, ...userTerms];
  } catch {
    return BUILTIN_BUSINESS_TERMS;
  }
}

export const businessTermsStore = writable<BusinessTerm[]>(loadTerms());

// === 便捷函数 ===

export function getTermsByIndustry(industry: string): BusinessTerm[] {
  let v: BusinessTerm[] = [];
  const unsub = businessTermsStore.subscribe((t) => {
    v = t.filter((x) => x.industry === industry);
  });
  unsub();
  return v;
}

export function addBusinessTerm(term: Omit<BusinessTerm, "id">): string {
  const id = `${term.industry}.${term.key}`;
  businessTermsStore.update((list) => [...list, { ...term, id }]);
  return id;
}
```

### 4.4 BusinessFormSchema 类型(业务表单 schema)

```typescript
// src/lib/stores/business-form-schema.ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 业务表单 schema store。
// 设计:
//   - 业务字段定义(年龄/金额/日期/状态...)
//   - 用于 BusinessRuleLibrary 业务表单渲染(替代 raw JSON 编辑)
//   - 字段类型映射到 evorule JSON 字段
// 持久化:localStorage(key: evorule-console-cloud:business-form-schema)

import { writable } from "svelte/store";
import { browser } from "$app/environment";
import { BUILTIN_FORM_SCHEMAS } from "$lib/data/business-form-schemas-builtin";

export type FormFieldType = "number" | "string" | "date" | "enum" | "boolean";

export interface BusinessFormField {
  /** 字段 ID,如 'finance.amount_threshold' */
  id: string;
  /** 字段标签(中文) */
  label: string;
  /** 字段类型 */
  type: FormFieldType;
  /** 对应 evorule JSON 字段路径(如 'condition.value') */
  evorulePath: string;
  /** 枚举值(type='enum' 时) */
  options?: string[];
  /** 默认值 */
  defaultValue?: string | number | boolean;
  /** 业务解释 */
  description: string;
}

export interface BusinessFormSchema {
  /** schema ID,如 'finance.expense_limit' */
  id: string;
  /** 行业 */
  industry: string;
  /** 业务场景(如"报销上限规则") */
  scenario: string;
  /** 字段列表 */
  fields: BusinessFormField[];
}

const STORAGE_KEY = "evorule-console-cloud:business-form-schema:user";

function loadSchemas(): BusinessFormSchema[] {
  if (!browser) return BUILTIN_FORM_SCHEMAS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return BUILTIN_FORM_SCHEMAS;
    const userSchemas = JSON.parse(raw) as BusinessFormSchema[];
    return [...BUILTIN_FORM_SCHEMAS, ...userSchemas];
  } catch {
    return BUILTIN_FORM_SCHEMAS;
  }
}

export const businessFormSchemaStore =
  writable<BusinessFormSchema[]>(loadSchemas());

// === 便捷函数 ===

export function getSchemasByIndustry(industry: string): BusinessFormSchema[] {
  let v: BusinessFormSchema[] = [];
  const unsub = businessFormSchemaStore.subscribe((s) => {
    v = s.filter((x) => x.industry === industry);
  });
  unsub();
  return v;
}
```

### 4.5 RuleBusinessMeta 类型(规则业务元数据扩展表)

```typescript
// src/lib/stores/rule-business-meta.ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 规则业务元数据扩展表。
// 设计:
//   - 不修改内核 Rule 类型,在 console-cloud 层加扩展表
//   - Map<ruleId, BusinessMeta> 关联规则与业务元数据
//   - 业务元数据可选(不强制每条规则都有)
// 持久化:localStorage(key: evorule-console-cloud:rule-business-meta)

import { writable } from "svelte/store";
import { browser } from "$app/environment";

export interface RuleBusinessMeta {
  /** 关联的内核 Rule.id */
  ruleId: string;
  /** 行业 */
  industry: string;
  /** 业务对象类型(病人/案件/订单...) */
  businessObject: string;
  /** 关联的业务术语 ID 列表 */
  businessTermIds: string[];
  /** 业务场景说明(供 LLM explainRule 用作上下文) */
  scenarioContext: string;
  /** 合规元数据(可选,等保门禁规则专用,见 §4.5.1) */
  compliance?: RuleComplianceMeta;
}

/**
 * 合规元数据(等保门禁规则专用)
 *
 * 对应 COMPLIANCE_GATE_DESIGN.md §3.2 新增字段。
 * 仅当规则是等保门禁规则时填写,普通业务规则不需要。
 * P0 console-cloud 层在 ruleBusinessMetaStore 中管理;
 * P1 server 化后迁移到 rules 表的 compliance_json 列(见 §4.6.2)。
 */
export interface RuleComplianceMeta {
  /** 标准号,如 "GB/T 22239-2019" / "GA/T 2380-2026" */
  standard: string;
  /** 等保级别(1-5) */
  level: number;
  /** 条款号,如 "8.1.4.1.d" */
  clause: string;
  /** 条款标题 */
  clauseTitle: string;
  /** 风险等级 */
  riskLevel: "low" | "medium" | "high" | "critical";
  /** 整改建议(中文,供 AI Agent 输出给用户) */
  remediation: string;
}

type RuleBusinessMetaMap = Record<string, RuleBusinessMeta>;

const STORAGE_KEY = "evorule-console-cloud:rule-business-meta";

function loadMeta(): RuleBusinessMetaMap {
  if (!browser) return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as RuleBusinessMetaMap;
  } catch {
    return {};
  }
}

export const ruleBusinessMetaStore = writable<RuleBusinessMetaMap>(loadMeta());

ruleBusinessMetaStore.subscribe((m) => {
  if (!browser) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(m));
});

// === 便捷函数 ===

export function getMeta(ruleId: string): RuleBusinessMeta | null {
  let v: RuleBusinessMeta | null = null;
  const unsub = ruleBusinessMetaStore.subscribe((m) => {
    v = m[ruleId] ?? null;
  });
  unsub();
  return v;
}

export function setMeta(meta: RuleBusinessMeta): void {
  ruleBusinessMetaStore.update((m) => ({ ...m, [meta.ruleId]: meta }));
}

export function removeMeta(ruleId: string): void {
  ruleBusinessMetaStore.update((m) => {
    const next = { ...m };
    delete next[ruleId];
    return next;
  });
}
```

### 4.6 应用层数据模型契约(三层架构 U6 同步)

> **2026-08-06 三层架构同步**(对应三层架构 §6 / §11.4 / §12.4 U6 决策)。
>
> 本节定义 **evorule-server 应用层**的数据模型契约。console-cloud 通过 API 消费这些表,**不直接持有数据**。

#### 4.6.1 分层说明(关键)

| 层                        | schema 变更                            | 职责                                                             |
| ------------------------- | -------------------------------------- | ---------------------------------------------------------------- |
| **evorule-tcb**           | ❌ 无变更                              | Fact 是 enum,规则是 `Vec<JsonValue>`,session_id 不贯穿(物理隔离) |
| **evorule-server**        | ✅ 新增 8 张应用层表(见 §4.6.2-§4.6.9) | 管理 Workspace/Draft/Final/Publish 状态                          |
| **evorule-console-cloud** | ❌ 不直接持有,通过 API 消费            | L2 Workspace 视图调用 server API                                 |

> **P0 / P1 边界**:
>
> - **P0 console-cloud**:规则与库元数据在 localStorage(内核 `rules` store + `dbStore` + `ruleBusinessMetaStore`,见 §4.1-§4.5),**不依赖 server 应用层表**
> - **P1+ server 化**:evorule-server 新建 `workspace` crate(§4.6.10),落地 8 张应用层表,console-cloud 的 L2 Workspace 视图迁移到调用 server API
> - 本节作为 **目标契约**提前定义,确保 P0 前端设计(尤其 `RuleBusinessMeta` 字段命名)与 P1 server schema 兼容,迁移时字段对齐无需重命名

#### 4.6.2 规则表(rules)— 应用层

```
rules(evorule-server 应用层表)
├── id              (主键)
├── workspace_id    (NULL = 全局 Final;非 NULL = Workspace 内 Draft/Final候选)
├── rule_key        (规则业务标识,如 "fever.ct_required")
├── rule_json       (evorule JSON 规则体,发布时写入 rules_dir/*.json)
├── status          (draft / reviewing / final_candidate / published / archived)
├── version         (规则自身版本,Workspace 内递增)
├── ruleset_version (仅 published 状态:发布到 Production 时的版本号)
├── compliance_json (可选,JSON:等保门禁元数据 {standard,level,clause,clauseTitle,riskLevel,remediation},NULL = 普通业务规则)
├── created_by
├── created_at
├── updated_at
└── archived_at     (归档时间)
```

> **compliance_json 字段说明**(2026-08-06 新增,对应 COMPLIANCE_GATE_DESIGN.md §3.2):
>
> - 仅等保门禁规则填写,普通业务规则为 NULL
> - P0 console-cloud 层对应 `RuleBusinessMeta.compliance` 字段(见 §4.5)
> - P1 server 化后迁移到此列,JSON 结构与 `RuleComplianceMeta` 接口一致
> - 查询等保规则:`SELECT * FROM rules WHERE compliance_json IS NOT NULL`

**status 状态机**:

```
draft → reviewing → final_candidate → published → archived
                                ↓
                           (驳回回 draft)
```

**关键约束**:

- `workspace_id IS NULL` 的规则 = 全局已发布规则,只有 Production Runtime 加载
- `workspace_id IS NOT NULL` 的规则 = Workspace 内规则,仅成员可见
- 发布动作 = 把 `final_candidate` 规则的 `workspace_id` 置 NULL + `status` 改 `published` + 打 `ruleset_version` + 写入 rules_dir 触发 reload

> **与内核 Rule(§4.1)的映射**(P1 迁移时):
>
> | 内核 Rule(TS,P0 localStorage) | 应用层 rules(Rust,P1 server)                                                   |
> | ----------------------------- | ------------------------------------------------------------------------------ |
> | `id`                          | `rule_key`                                                                     |
> | `content`(raw JSON 文本)      | `rule_json`(JSON 规则体)                                                       |
> | `description`                 | (应用层无对应字段,迁移到 `ruleBusinessMetaStore` 的 `scenarioContext`,见 §4.5) |
> | `source: 'builtin' \| 'user'` | (应用层无对应,全部为 user)                                                     |
> | `version`                     | `version`                                                                      |
> | (无)                          | `workspace_id` / `status` / `ruleset_version`(新增,三层架构扩展)               |
> | `createdAt` / `updatedAt`     | `created_at` / `updated_at`                                                    |

#### 4.6.3 工作空间表(workspaces)

```
workspaces
├── id              (主键)
├── name            ("内科-发烧CT规则修订-20260806")
├── description     (议题说明)
├── team            (所属团队/科室,用于归类)
├── status          (active / archived)
├── created_by
├── created_at
└── archived_at
```

#### 4.6.4 工作空间成员表(workspace_members)

```
workspace_members
├── workspace_id
├── user_id
├── role            (author / reviewer / observer)
├── added_at
└── added_by
```

#### 4.6.5 沙盒会话表(sandbox_sessions)— 应用层编排表

```
sandbox_sessions(evorule-server 应用层表,映射到 SessionManager 的 session_id)
├── id              (应用层主键)
├── tcb_session_id  (SessionManager 返回的 session_id,如 2)
├── workspace_id
├── parent_session_id (Production 的 tcb_session_id,用于因果追溯)
├── draft_ruleset_hash (本次测试的 Draft 规则集 BLAKE3 哈希)
├── test_dataset_id (合成数据集 ID)
├── status          (running / closed)
├── started_by
├── started_at
└── closed_at
```

> **注**:test Fact 本身存在 SessionManager 的独立 FactsLog 中,不需要应用层另建 `sandbox_facts` 表。应用层通过 `GET /api/sessions/{tcb_session_id}/audit/export` 按需导出。

#### 4.6.6 Production 审计表(production_audit)— 应用层

```
production_audit(应用层维护的发布/回滚审计,与 tcb 的 BLAKE3 链互补)
├── id
├── event_type      (ruleset_published / ruleset_rollback)
├── ruleset_version (本次生效的版本号,单调递增)
├── previous_version
├── ruleset_hash    (BLAKE3)
├── tcb_session_id  (对应的 production session_id)
├── source_workspace_ids (发布来源)
├── operated_by
├── operated_at
├── reason          (回滚原因,可选)
└── test_report_ids (附带测试报告,发布时填)
```

> **注**:tcb 的 BLAKE3 链记录的是 Fact 级别的不可篡改哈希链;应用层 `production_audit` 记录的是业务级别的"哪个版本由谁发布"。二者互补,不冲突。

#### 4.6.7 合成数据集表(test_datasets)

```
test_datasets
├── id
├── name            ("fever-cases-v2")
├── description
├── scope           (workspace_id 或 "shared")
├── cases_json      (合成 case 数组)
├── created_by
└── created_at
```

#### 4.6.8 发布队列表(publish_queue)

```
publish_queue
├── id
├── workspace_id    (来源 Workspace)
├── final_candidate_rules  (待发布的规则集)
├── ruleset_hash    (BLAKE3)
├── test_report_id  (附带的测试报告)
├── status          (pending / approved / rejected / published)
├── submitted_by
├── submitted_at
├── reviewed_by     (审批者)
├── reviewed_at
├── review_comment
├── published_ruleset_version  (发布后填)
└── published_at
```

#### 4.6.9 当前生产状态表(production_state)— 应用层单行

```
production_state(单行表,记录当前生产 session 状态)
├── id              (固定 = 1)
├── current_session_id (当前生产 session 的 tcb session_id)
├── ruleset_version (当前规则集版本号)
├── ruleset_hash    (当前规则集 BLAKE3 哈希)
├── updated_at
└── updated_by
```

**用途**:console-cloud 的 `productionStateStore`(见 HOME_DESIGN.md §6.5)通过 `GET /api/production/state` 消费此表,用于路由 command 和 SSE 订阅。滚动 session 切换时原子更新此表 + 向旧 session SSE 推送 `session_switched` 事件(U7 决策)。

#### 4.6.10 workspace crate 设计(U6 决策落地)

> **U6 决策**(2026-08-06 拍板,详见三层架构 §12.4):Workspace 状态管理放 evorule-server 新开的独立 `workspace` crate,参照 `core/hot_reload` 的独立 crate 模式。

**crate 位置**:`d:\evorule-server\core\workspace\`(与 `core/hot_reload` 同级)

**Cargo.toml**:

```toml
[package]
name = "evorule-workspace"
version = "0.1.0"
edition = "2021"
description = "Workspace 编排服务(工作空间 + 规则状态 + 发布队列)"
license = "AGPL-3.0-or-later"
repository = "https://gitee.com/evo-rule-lab/evorule-server"
publish = false
homepage = "https://gitee.com/evo-rule-lab/evorule-server"

[dependencies]
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["full"] }
axum = { version = "0.8", features = ["macros"] }
tracing = "0.1"
# 持久化(P1 选型,候选 rusqlite / sqlx)
# rusqlite = { version = "0.31", features = ["bundled"] }

[lints]
workspace = true
```

**模块结构**(参照 `core/hot_reload` 的 `lib.rs + 子模块` 模式):

```
core/workspace/
├── Cargo.toml
└── src/
    ├── lib.rs          # WorkspaceService + HTTP handler + build_router(参照 hot_reload/lib.rs)
    ├── models.rs       # 8 张表的 serde struct(Rule / Workspace / WorkspaceMember / SandboxSession / ProductionAudit / TestDataset / PublishQueue / ProductionState)
    ├── store.rs        # 持久化层抽象(trait WorkspaceStore,rusqlite / 内存实现)
    ├── workspace.rs    # Workspace CRUD + 成员管理编排
    ├── rules.rs        # 规则状态机编排(draft → reviewing → final_candidate → published → archived)
    ├── publish.rs      # 发布队列 + 三级发布权限(Q3 决策)编排
    └── production.rs   # production_state 原子更新 + 滚动 session 切换编排(组合 reload + fork + session_switched 推送)
```

**职责边界**:

| 模块            | 职责                                                                   | 依赖                        |
| --------------- | ---------------------------------------------------------------------- | --------------------------- |
| `models.rs`     | 8 张表的 serde struct(§4.6.2-§4.6.9)                                   | serde / serde_json          |
| `store.rs`      | 持久化层 trait(`WorkspaceStore`),P1 用 rusqlite,P0 测试用内存实现      | rusqlite(P1)                |
| `workspace.rs`  | Workspace CRUD + 成员管理(author/reviewer/observer 角色)               | store                       |
| `rules.rs`      | 规则状态机编排 + `workspace_id` 隔离 + 发布动作(置 NULL + 打版本)      | store                       |
| `publish.rs`    | 发布队列 + 三级发布权限(Q3:普通医生/科室主任/信息科-院领导)            | store + rules               |
| `production.rs` | production_state 原子更新 + 滚动 session 编排(reload + fork + U7 推送) | store + evorule-server HTTP |
| `lib.rs`        | `WorkspaceService` + HTTP handler + `build_router`(暴露给主 server)    | 全部子模块                  |

**与 evorule-server 主 crate 的集成**:

- `workspace` crate 暴露 `build_router(service) -> Router`,主 server(`evorule-server/src/api/mod.rs`)在路由表中挂载 `/api/workspaces/*` / `/api/production/*` / `/api/publish-queue/*`
- `production.rs` 调用 evorule-server 已有的 `POST /api/rules/reload` + `POST /api/sessions/from/{id}`(滚动 session,三层架构 §3.3)
- `production.rs` 通过 evorule-server 的 SSE 通道向旧 session 订阅者推送 `session_switched` 事件(U7 决策)

**与 evorule-tcb 的关系**:**零依赖**。`workspace` crate 不引用 evorule-tcb,只通过 evorule-server 的 HTTP API 间接编排 session(fork/reload/SSE)。这保证 TCB 不可变语义不被违反。

**P0 实施顺序**(对应三层架构 §12.1):

1. 新建 `core/workspace/` crate 骨架(Cargo.toml + lib.rs + models.rs + 内存 store)
2. 落地 `workspaces` + `workspace_members` + `rules`(扩展字段)表 + CRUD API
3. 落地 `production_state` + `production_audit` + 滚动 session 编排(reload + fork + U7 推送)
4. 落地 `sandbox_sessions` + `test_datasets` + fork 编排
5. 落地 `publish_queue` + 三级发布权限(Q3)

---

## 5. Store 设计总览

### 5.1 Store 一览

| Store                             | 文件                                     | 职责                   | 持久化                                                         | 来源                      |
| --------------------------------- | ---------------------------------------- | ---------------------- | -------------------------------------------------------------- | ------------------------- |
| `rules`                           | `@evorule/console`(内核)                 | 规则 CRUD + 数组       | localStorage `evorule-console:rules:user`                      | 复用                      |
| `selectedRuleId` / `selectedRule` | `@evorule/console`(内核)                 | 当前选中规则           | localStorage                                                   | 复用                      |
| `dbStore`                         | `src/lib/stores/db.ts`                   | 库元数据(名/对象/行业) | localStorage `evorule-console-cloud:db-meta`                   | 扩展(更新 HOME_DESIGN.md) |
| `businessTermsStore`              | `src/lib/stores/business-terms.ts`       | 业务术语库             | localStorage `evorule-console-cloud:business-terms:user`       | 新增                      |
| `businessFormSchemaStore`         | `src/lib/stores/business-form-schema.ts` | 业务表单 schema        | localStorage `evorule-console-cloud:business-form-schema:user` | 新增                      |
| `ruleBusinessMetaStore`           | `src/lib/stores/rule-business-meta.ts`   | 规则业务元数据扩展表   | localStorage `evorule-console-cloud:rule-business-meta`        | 新增                      |
| `isEmptyDb` / `ruleCount`         | `src/lib/stores/db.ts`(派生)             | 空库判断 / 规则数      | (派生,不持久化)                                                | 新增(派生)                |

> **P1+ server 化目标契约**(2026-08-06 三层架构同步):上表为 P0 console-cloud localStorage stores。P1+ 迁移到 evorule-server 时,规则与库元数据迁移到应用层表(`rules` / `workspaces` 等 8 张表,见 §4.6),console-cloud 改为通过 API 消费,不再直接持有数据。

### 5.2 与内核 rules store 的协作

```
┌─────────────────────────────────────────────────────────────────┐
│                  console-cloud 层                                 │
│                                                                  │
│   dbStore (库元数据)                                            │
│     ├─ dbName / businessObjects / industry                       │
│     └─ 持久化:localStorage:evorule-console-cloud:db-meta       │
│                                                                  │
│   businessTermsStore (业务术语)                                  │
│   businessFormSchemaStore (业务表单 schema)                     │
│   ruleBusinessMetaStore (规则业务元数据扩展表)                 │
│                                                                  │
└──────────────────────────────┬──────────────────────────────────┘
                               │ 关联(ruleId)
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                  @evorule/console 内核层(不修改)              │
│                                                                  │
│   rules store (Rule[])                                          │
│     ├─ addRule / updateRule / deleteRule                        │
│     ├─ 持久化:localStorage:evorule-console:rules:user          │
│     └─ builtin(3 个示例,代码内置)                              │
│                                                                  │
│   RuleValidator / RuleLibraryView / 等                          │
└─────────────────────────────────────────────────────────────────┘
```

### 5.3 Store 间数据流

```
用户在 OnboardingWizard 加第一条规则:
  1. LLM generateRuleDraft("65 岁以上发烧必须先 CT")
     → { rule: object, confidence: number }
  2. RuleValidator.validate(JSON.stringify(rule))
     → ValidationResult
  3. 内核 addRule({
       id: 'user.fever_ct_65',
       version: 1,
       description: '65 岁以上发烧必须先 CT',
       content: JSON.stringify(rule)
     })
     → 内核 rules store 更新 + localStorage 持久化
  4. console-cloud setMeta({
       ruleId: 'user.fever_ct_65',
       industry: 'medical',
       businessObject: 'patient',
       businessTermIds: ['medical.fever', 'medical.age_65'],
       scenarioContext: '医院临床路径'
     })
     → ruleBusinessMetaStore 更新
  5. dbStore 不变(库元数据已在 Step 2 初始化)
  6. isEmptyDb 派生 store 自动变 false(因 rules store 非空)
  7. HomeRouter 检测 isEmptyDb = false → 切换到状态 C 工作台
```

---

## 6. 组件树

### 6.1 顶层组件结构

```
src/lib/views/Home/
├── OnboardingWizard.svelte       (HOME_DESIGN.md §5.3,UI 流程)
└── RealWorkbench.svelte          (HOME_DESIGN.md §5.4,工作台)

src/lib/views/Build/                (P0-1 新增,建库向导数据层支撑)
├── WizardSteps/
│   ├── StepTemplatePicker.svelte  (步骤 1:选模板,加 industry 字段)
│   ├── StepDbConfig.svelte        (步骤 2:命名 + 业务对象,扩展 industry)
│   ├── StepFirstRule.svelte       (步骤 3:加第一条规则,本设计文档 §6.4)
│   ├── StepTrialRun.svelte        (步骤 4:试运行,本设计文档 §6.5)
│   └── StepComplete.svelte        (步骤 5:完成,跳工作台)
└── templates.ts                   (业务模板定义:财务 + 合规)

src/lib/views/Rules/               (P0-1 新增,业务规则库)
├── BusinessRuleLibrary.svelte     (包装内核 RuleLibraryView,本设计文档 §6.2)
├── BusinessTermFilter.svelte      (业务语言筛选侧栏)
├── BusinessRuleCard.svelte        (规则卡片,业务语言呈现)
├── BusinessForm.svelte            (业务表单,替代 raw JSON 编辑)
├── BusinessPreview.svelte         (业务预览,LLM explainRule)
└── DeveloperModeToggle.svelte     (开发者模式切换)

src/lib/data/                       (业务模板内置数据)
├── business-terms-builtin.ts     (BUILTIN_BUSINESS_TERMS,§7.1)
├── business-form-schemas-builtin.ts (BUILTIN_FORM_SCHEMAS,§7.2)
├── template-finance.ts            (财务审批模板,§9.1)
└── template-compliance.ts        (合规审计模板,§9.2)
```

### 6.2 BusinessRuleLibrary.svelte 组件树

```
BusinessRuleLibrary.svelte
├── 顶部
│   ├── 业务语言筛选栏
│   │   └── BusinessTermFilter.svelte
│   │       ├── [全部分类]
│   │       ├── [财务术语 ▼]
│   │       ├── [合规术语 ▼]
│   │       └── [医疗术语 ▼]
│   ├── 搜索框
│   └── DeveloperModeToggle.svelte
│       └── [开发者模式:看 raw JSON](toggle)
├── 主体(左右两栏)
│   ├── 左侧:规则卡片列表
│   │   └── BusinessRuleCard.svelte (循环渲染)
│   │       ├── 业务标题(Rule.description)
│   │       ├── 业务摘要(BusinessPreview.svelte)
│   │       ├── 业务元数据徽标(industry / businessObject)
│   │       └── 操作按钮
│   │           ├── [编辑](→ BusinessForm)
│   │           ├── [复制](→ duplicateRule)
│   │           ├── [导出](→ exportRule)
│   │           └── [删除](→ deleteRule)
│   └── 右侧:规则详情(选中后)
│       ├── BusinessForm.svelte (业务表单编辑)
│       │   ├── 业务字段(根据 BusinessFormSchema 渲染)
│       │   └── evorule JSON 预览(可折叠)
│       ├── BusinessPreview.svelte (业务预览)
│       │   └── [LLM 解释这条规则](→ CloudLlmAssistant.explainRule)
│       └── 业务元数据编辑
│           ├── industry 下拉
│           ├── businessObject 下拉
│           └── scenarioContext 输入
└── 底部
    └── [+ 加规则](→ BusinessForm 新建模式)
```

### 6.3 与内核 RuleLibraryView 的协作

```
BusinessRuleLibrary.svelte
├── (业务模式,默认)
│   ├── BusinessTermFilter
│   ├── BusinessRuleCard list
│   └── BusinessForm + BusinessPreview
│
└── (开发者模式,toggle 切换)
    └── <RuleLibraryView />  (内核组件,raw JSON 编辑)
        + onaiGenerateDraft = {() => openAssistantDialog('draft')}
        + onaiExplainRule = {() => openAssistantDialog('explain')}
```

**切换实现**:

```svelte
{#if developerMode}
  <RuleLibraryView
    onaiGenerateDraft={() => openAssistantDialog('draft')}
    onaiExplainRule={() => openAssistantDialog('explain')}
  />
{:else}
  <!-- 业务模式 UI(BusinessTermFilter + BusinessRuleCard + BusinessForm) -->
{/if}
```

### 6.4 StepFirstRule.svelte(步骤 3:加第一条规则)

```
StepFirstRule.svelte
├── 模板预填(若 Step 1 选了 finance/compliance)
│   └── 显示"基于财务审批模板加规则"
├── 输入区(两栏)
│   ├── BusinessForm.svelte (业务表单填字段)
│   │   ├── [年龄 > 65]
│   │   ├── [发烧 = 是]
│   │   └── [必须 CT](动作)
│   └── LlmHelper.svelte (LLM 辅助)
│       ├── 自然语言输入框
│       │   └── [65 岁以上发烧必须先 CT]
│       └── [生成规则](→ CloudLlmAssistant.generateRuleDraft)
├── 预览区
│   ├── 生成的 evorule JSON(可编辑)
│   ├── RuleValidator 校验结果
│   │   ├── ✅ 校验通过(confidence: 0.7)
│   │   └── ❌ 校验失败(显示错误,confidence: 0.3,允许修改)
│   └── BusinessPreview.svelte (业务语言预览,LLM explainRule)
└── 操作按钮
    ├── [上一步](→ Step 2)
    └── [保存规则](→ addRule + setMeta + next())
```

### 6.5 StepTrialRun.svelte(步骤 4:试运行)

```
StepTrialRun.svelte
├── 顶部
│   └── "试运行:用业务事件测试规则"
├── 业务事件表单
│   ├── [业务对象:病人 ▼]
│   ├── 业务字段(根据 BusinessFormSchema 渲染)
│   │   ├── [病人 ID:P-001]
│   │   ├── [年龄:68]
│   │   └── [发烧:是]
│   └── [提交业务事件](→ createSession + submitCommand)
├── 执行结果预览
│   ├── Session 状态
│   ├── 触发的 Fact 列表
│   └── CausalChain(因果图,简化版)
└── 操作按钮
    ├── [上一步](→ Step 3)
    └── [下一步](→ Step 5)
```

---

## 7. 业务语言层内置数据(2 个行业起步)

### 7.1 BUILTIN_BUSINESS_TERMS

```typescript
// src/lib/data/business-terms-builtin.ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 业务术语库内置数据。
// P0 起步:2 个行业(财务 + 合规)
// P1 扩展:10 行业浅模板(见战略文档 §20.5)

import type { BusinessTerm } from "$lib/stores/business-terms";

export const BUILTIN_BUSINESS_TERMS: BusinessTerm[] = [
  // === 财务审批 ===
  {
    id: "finance.amount",
    industry: "finance",
    label: "金额",
    key: "amount",
    synonyms: ["报销金额", "支出金额", "申请金额"],
    description: "业务事件中的金额数值(单位:元)",
  },
  {
    id: "finance.threshold",
    industry: "finance",
    label: "审批阈值",
    key: "threshold",
    synonyms: ["上限", "限额", "审批线"],
    description: "触发审批的金额阈值(超过此值需要上级批准)",
  },
  {
    id: "finance.approver",
    industry: "finance",
    label: "审批人",
    key: "approver",
    synonyms: ["批准人", "签字人"],
    description: "负责审批的角色(CFO / 财务主管 / 部门经理)",
  },
  // === 合规审计 ===
  {
    id: "compliance.control_point",
    industry: "compliance",
    label: "控制点",
    key: "controlPoint",
    synonyms: ["SOX 控制点", "审计点", "合规检查项"],
    description: "合规审计的控制点编号(如 SOX-404)",
  },
  {
    id: "compliance.evidence",
    industry: "compliance",
    label: "审计证据",
    key: "evidence",
    synonyms: ["证据", "凭证", "审计材料"],
    description: "支持合规判断的证据(文档 / 日志 / 截图)",
  },
  {
    id: "compliance.regulator",
    industry: "compliance",
    label: "监管机构",
    key: "regulator",
    synonyms: ["监管", "审计方"],
    description: "需要报送的监管机构(SOX / SEC / 银保监)",
  },
];
```

### 7.2 BUILTIN_FORM_SCHEMAS

```typescript
// src/lib/data/business-form-schemas-builtin.ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 业务表单 schema 内置数据。
// P0 起步:2 个场景(财务报销上限 + 合规控制点检查)

import type { BusinessFormSchema } from "$lib/stores/business-form-schema";

export const BUILTIN_FORM_SCHEMAS: BusinessFormSchema[] = [
  // === 财务:报销上限规则 ===
  {
    id: "finance.expense_limit",
    industry: "finance",
    scenario: "报销上限规则",
    fields: [
      {
        id: "finance.amount_threshold",
        label: "金额阈值(元)",
        type: "number",
        evorulePath: "condition.value",
        defaultValue: 10000,
        description: "超过此金额的报销需要 CFO 批准",
      },
      {
        id: "finance.approver_role",
        label: "审批人角色",
        type: "enum",
        evorulePath: "action.params.role",
        options: ["CFO", "财务主管", "部门经理"],
        defaultValue: "CFO",
        description: "触发审批时通知的角色",
      },
      {
        id: "finance.notify_channel",
        label: "通知渠道",
        type: "enum",
        evorulePath: "action.params.channel",
        options: ["邮件", "短信", "IM"],
        defaultValue: "邮件",
        description: "审批通知的发送渠道",
      },
    ],
  },
  // === 合规:控制点检查规则 ===
  {
    id: "compliance.control_check",
    industry: "compliance",
    scenario: "控制点检查规则",
    fields: [
      {
        id: "compliance.control_point_id",
        label: "控制点编号",
        type: "string",
        evorulePath: "condition.value",
        defaultValue: "SOX-404",
        description: "合规控制点的标准编号",
      },
      {
        id: "compliance.required_evidence",
        label: "必需证据类型",
        type: "enum",
        evorulePath: "action.params.evidenceType",
        options: ["文档", "日志", "截图", "签字"],
        defaultValue: "文档",
        description: "合规审计要求的证据类型",
      },
      {
        id: "compliance.regulatory_body",
        label: "监管机构",
        type: "enum",
        evorulePath: "action.params.regulator",
        options: ["SOX", "SEC", "银保监", "等保 2.0"],
        defaultValue: "SOX",
        description: "需要报送的监管机构",
      },
    ],
  },
];
```

---

## 8. 状态机:建库向导 5 步 + 规则 CRUD

### 8.1 建库向导 5 步状态机

```
┌─────────────────────────────────────────────────────────────────┐
│                  OnboardingWizard 状态机                         │
│                                                                  │
│   ┌──────────────┐                                                │
│   │ Step 1:     │     ┌──────────────┐                          │
│   │ 选模板      │ ──→ │ Step 2:     │                          │
│   │ (industry)  │     │ 命名+对象   │                          │
│   └──────┬──────┘     └──────┬──────┘                          │
│          │                   │                                  │
│          │ blank             │ initDb(name, objects, industry) │
│          │ finance           │                                  │
│          │ compliance        ▼                                  │
│          │            ┌──────────────┐                          │
│          │            │ Step 3:     │                          │
│          │            │ 加第一条规则│                          │
│          │            │ (LLM 辅助) │                          │
│          │            └──────┬──────┘                          │
│          │                   │                                  │
│          │                   │ addRule() + setMeta()            │
│          │                   ▼                                  │
│          │            ┌──────────────┐                          │
│          │            │ Step 4:     │                          │
│          │            │ 试运行      │                          │
│          │            │ (session)   │                          │
│          │            └──────┬──────┘                          │
│          │                   │                                  │
│          │                   │ createSession + submitCommand    │
│          │                   ▼                                  │
│          │            ┌──────────────┐                          │
│          │            │ Step 5:     │                          │
│          │            │ 完成 → 工作台│                          │
│          │            └──────────────┘                          │
│          │                                                      │
└──────────┴──────────────────────────────────────────────────────┘
```

### 8.2 状态转换矩阵

| 当前状态 | 事件                       | 下一状态 | 触发动作                                                            |
| -------- | -------------------------- | -------- | ------------------------------------------------------------------- |
| Step 1   | 选 blank                   | Step 2   | `dbStore` 暂不初始化                                                |
| Step 1   | 选 finance                 | Step 2   | `dbStore` 暂不初始化,记 industry='finance'                          |
| Step 1   | 选 compliance              | Step 2   | `dbStore` 暂不初始化,记 industry='compliance'                       |
| Step 1   | 取消                       | (退出)   | `goto('/')` → HomeRouter 选 A(demo)                                 |
| Step 2   | 确认                       | Step 3   | `initDb(name, objects, industry)` + 加载模板 builtin 规则(若选模板) |
| Step 2   | 上一步                     | Step 1   | —                                                                   |
| Step 3   | LLM 生成 + 校验通过 + 保存 | Step 4   | `addRule(rule)` + `setMeta(meta)`                                   |
| Step 3   | 手动填表 + 校验通过 + 保存 | Step 4   | 同上                                                                |
| Step 3   | 校验失败 + 用户修改 + 保存 | Step 4   | 同上(confidence 由 0.3 提到 0.7)                                    |
| Step 3   | 上一步                     | Step 2   | —                                                                   |
| Step 4   | 提交业务事件 + 看结果      | Step 5   | `createSession()` + `submitCommand(id, instruction)`                |
| Step 4   | 上一步                     | Step 3   | —                                                                   |
| Step 5   | 完成                       | (退出)   | `goto('/')` → HomeRouter 检测 isEmptyDb=false → 选 C                |

### 8.3 规则 CRUD 状态机(在 BusinessRuleLibrary 中)

| 用户操作 | 触发函数                    | 内核调用                | 元数据更新                      |
| -------- | --------------------------- | ----------------------- | ------------------------------- |
| 加规则   | `handleAddRule()`           | `addRule(rule)`         | `setMeta(meta)`                 |
| 编辑规则 | `handleEditRule(id, patch)` | `updateRule(id, patch)` | `setMeta(meta)`(若元数据变)     |
| 复制规则 | `handleDuplicate(id)`       | `duplicateRule(id)`     | `setMeta(newMeta)`(关联到新 id) |
| 删除规则 | `handleDeleteRule(id)`      | `deleteRule(id)`        | `removeMeta(id)`                |
| 导入规则 | `handleImport(json)`        | `importRule(json)`      | `setMeta(meta)`(可选)           |
| 导出规则 | `handleExport(id)`          | `exportRule(id)`        | —                               |

---

## 9. 业务模板规范(2 个起步)

### 9.1 财务审批模板

```typescript
// src/lib/data/template-finance.ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 财务审批业务模板。
// 完整度:P0 浅模板(规则 + 业务术语 + 业务表单 schema + 业务元数据)
// 业务场景:报销上限规则 + CFO 审批 + 多级审批

import type { BusinessTerm } from "$lib/stores/business-terms";
import type { BusinessFormSchema } from "$lib/stores/business-form-schema";
import type { RuleBusinessMeta } from "$lib/stores/rule-business-meta";
import type { Rule } from "@evorule/console";

export interface BusinessTemplate {
  id: "finance" | "compliance";
  industry: string;
  displayName: string;
  description: string;
  /** builtin 规则集(代码内置,通过 duplicateRule 复制为 user) */
  builtinRules: Array<Omit<Rule, "source" | "createdAt" | "updatedAt">>;
  /** 业务术语(builtin,代码内置) */
  businessTerms: BusinessTerm[];
  /** 业务表单 schema(builtin) */
  formSchemas: BusinessFormSchema[];
  /** 默认业务对象 */
  defaultBusinessObjects: string[];
  /** 规则业务元数据模板(关联 builtin 规则 id) */
  ruleMetaTemplate: Array<Omit<RuleBusinessMeta, "ruleId">>;
}

export const FINANCE_TEMPLATE: BusinessTemplate = {
  id: "finance",
  industry: "finance",
  displayName: "财务审批",
  description: "报销上限规则 + CFO 审批 + 多级审批",
  defaultBusinessObjects: ["报销单", "审批流", "财务凭证"],
  builtinRules: [
    {
      id: "finance.expense_limit_cfo",
      version: 1,
      description: "报销金额 ≥ 10000 元需 CFO 批准",
      content: JSON.stringify({
        // evorule 规则 JSON(简化示例,实际由内核 schema 决定)
        kind: "rule",
        condition: { field: "amount", op: ">=", value: 10000 },
        action: { type: "require_approval", role: "CFO" },
      }),
    },
    {
      id: "finance.multi_level_approval",
      version: 1,
      description: "多级审批:5000-10000 财务主管,10000+ CFO",
      content: JSON.stringify({
        kind: "rule",
        condition: { field: "amount", op: ">=", value: 5000 },
        action: { type: "multi_level_approval", levels: ["财务主管", "CFO"] },
      }),
    },
    // P0 起步 2 条,P1 扩展到 5 条
  ],
  businessTerms: [
    // 复用 BUILTIN_BUSINESS_TERMS 的 finance.* 部分
  ],
  formSchemas: [
    // 复用 BUILTIN_FORM_SCHEMAS 的 finance.expense_limit
  ],
  ruleMetaTemplate: [
    {
      industry: "finance",
      businessObject: "报销单",
      businessTermIds: [
        "finance.amount",
        "finance.threshold",
        "finance.approver",
      ],
      scenarioContext: "财务审批流程:报销金额超阈值需上级批准",
    },
  ],
};
```

### 9.2 合规审计模板

```typescript
// src/lib/data/template-compliance.ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 合规审计业务模板。
// 完整度:P0 浅模板
// 业务场景:SOX 控制点检查 + 证据收集 + 监管报送

import type { BusinessTemplate } from "./template-finance";

export const COMPLIANCE_TEMPLATE: BusinessTemplate = {
  id: "compliance",
  industry: "compliance",
  displayName: "合规审计",
  description: "SOX 控制点检查 + 证据收集 + 监管报送",
  defaultBusinessObjects: ["控制点", "审计证据", "监管报告"],
  builtinRules: [
    {
      id: "compliance.sox_control_required",
      version: 1,
      description: "SOX-404 控制点必须填证据",
      content: JSON.stringify({
        kind: "rule",
        condition: { field: "controlPoint", op: "==", value: "SOX-404" },
        action: { type: "require_evidence", evidenceType: "文档" },
      }),
    },
    {
      id: "compliance.regulator_report",
      version: 1,
      description: "高风险事件需报送监管机构",
      content: JSON.stringify({
        kind: "rule",
        condition: { field: "riskLevel", op: "==", value: "high" },
        action: { type: "report_to_regulator", regulator: "SEC" },
      }),
    },
  ],
  businessTerms: [
    // 复用 BUILTIN_BUSINESS_TERMS 的 compliance.* 部分
  ],
  formSchemas: [
    // 复用 BUILTIN_FORM_SCHEMAS 的 compliance.control_check
  ],
  ruleMetaTemplate: [
    {
      industry: "compliance",
      businessObject: "控制点",
      businessTermIds: [
        "compliance.control_point",
        "compliance.evidence",
        "compliance.regulator",
      ],
      scenarioContext: "SOX 合规审计:控制点检查 + 证据收集 + 监管报送",
    },
  ],
};
```

### 9.3 模板加载流程

```typescript
// src/lib/views/Build/templates.ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project

import { addRule, duplicateRule, type Rule } from "@evorule/console";
import { initDb } from "$lib/stores/db";
import { setMeta } from "$lib/stores/rule-business-meta";
import {
  FINANCE_TEMPLATE,
  COMPLIANCE_TEMPLATE,
  type BusinessTemplate,
} from "$lib/data/template-finance";

const TEMPLATES: Record<string, BusinessTemplate> = {
  finance: FINANCE_TEMPLATE,
  compliance: COMPLIANCE_TEMPLATE,
};

/**
 * 加载业务模板(Step 2 确认时调用)。
 *
 * 流程:
 *   1. initDb(库名 + 业务对象 + 行业)
 *   2. 遍历 builtinRules,addRule() 加到内核 rules store
 *   3. 遍历 ruleMetaTemplate,setMeta() 关联业务元数据
 *
 * 注意:builtin 规则在内核 source='user'(因通过 addRule 加),
 *       模板的 builtin 性质由 businessMeta.industry 标识。
 */
export function loadTemplate(
  templateId: "finance" | "compliance",
  dbName: string,
): void {
  const tpl = TEMPLATES[templateId];
  if (!tpl) {
    throw new Error(`未知模板: ${templateId}`);
  }

  // 1. 初始化库元数据
  initDb(dbName, tpl.defaultBusinessObjects, tpl.industry);

  // 2. 加载 builtin 规则到内核 rules store
  for (const rule of tpl.builtinRules) {
    const newId = addRule(rule);
    // 3. 关联业务元数据
    const metaTpl = tpl.ruleMetaTemplate[0]; // 简化:所有规则用同一 meta 模板
    if (metaTpl) {
      setMeta({
        ruleId: newId,
        ...metaTpl,
      });
    }
  }
}
```

---

## 10. 数据流

### 10.1 建库向导完整数据流(5 步)

```
用户在 DemoHome 点[注册] → 登录(mock)
  │
  ▼
HomeRouter 检测 isEmptyDb = true(内核 rules store 空)
  │
  ▼
渲染 OnboardingWizard
  │
  ├── Step 1: 选模板
  │   ├── blank → industry='blank',不预填
  │   ├── finance → industry='finance',记下模板
  │   └── compliance → industry='compliance',记下模板
  │
  ├── Step 2: 命名 + 业务对象
  │   ├── 用户填库名 + 选业务对象
  │   ├── [确认] → initDb(name, objects, industry)
  │   │            └── dbStore 持久化 localStorage
  │   └── 若选模板 → loadTemplate(templateId, name)
  │       ├── addRule(builtin 规则 1) → 内核 rules store
  │       ├── addRule(builtin 规则 2) → 内核 rules store
  │       ├── setMeta(...) → ruleBusinessMetaStore
  │       └── (跳过 Step 3,直接到 Step 4 试运行)
  │       └── 注意:若选模板,Step 3 改为"查看预填规则"
  │
  ├── Step 3: 加第一条规则(blank 模式,或模板模式查看)
  │   ├── (LLM 辅助模式)
  │   │   ├── 用户输入自然语言:"65 岁以上发烧必须先 CT"
  │   │   ├── CloudLlmAssistant.generateRuleDraft(text)
  │   │   │   → { rule: object, confidence: 0.7 }
  │   │   ├── RuleValidator.validate(JSON.stringify(rule))
  │   │   │   → { valid: true, errors: [] }
  │   │   ├── BusinessPreview:CloudLlmAssistant.explainRule(rule)
  │   │   │   → "这条规则在病人 65 岁以上且发烧时,要求先做 CT"
  │   │   └── [保存] → addRule({ id, version, description, content })
  │   │              + setMeta({ ruleId, industry, ... })
  │   │              → 内核 rules store + ruleBusinessMetaStore
  │   │
  │   └── (业务表单模式)
  │       ├── 用户填 BusinessForm(年龄 > 65, 发烧 = 是)
  │       ├── 表单 → evorule JSON 转换(由 evorulePath 映射)
  │       ├── RuleValidator.validate(...)
  │       └── [保存] → 同上
  │
  ├── Step 4: 试运行
  │   ├── 用户填业务事件表单(病人 ID, 年龄, 发烧)
  │   ├── createSession() → sessionId
  │   ├── 把内核 rules store 里的规则集作为 instruction 推送
  │   │   (P0-3 数据集组合机制的工作,P0-1 这里用简化版:全推)
  │   ├── submitCommand(sessionId, { type: 'event', ... })
  │   │   → CommandResult
  │   └── 显示结果:Session 状态 + 触发的 Fact + 因果图
  │
  └── Step 5: 完成
      ├── [跳到工作台] → goto('/')
      └── HomeRouter 检测 isEmptyDb = false(因 rules store 非空)
                       → 渲染 RealWorkbench
```

### 10.2 业务规则库数据流(从工作台进入)

```
用户在 RealWorkbench 点[加规则](任务流入口)
  │
  ├── setView('rules')
  ├── goto('/view/rules?action=add')
  │
  ▼
ViewRenderer 检测 currentView === 'rules'
  │
  ▼
渲染 BusinessRuleLibrary
  │
  ├── 顶部:BusinessTermFilter(按行业 / 术语筛选)
  ├── 左侧:规则卡片列表(遍历内核 rules store)
  │   └── BusinessRuleCard
  │       ├── Rule.description(业务命名)
  │       ├── BusinessPreview(LLM 解释,异步)
  │       └── 业务元数据徽标(从 ruleBusinessMetaStore 关联)
  ├── 右侧:BusinessForm(选中规则后)
  │   ├── BusinessFormSchema 渲染字段
  │   ├── 字段值 → evorule JSON(通过 evorulePath 映射)
  │   └── [保存] → updateRule(id, { content: newJson })
  │
  └── [+ 加规则] → BusinessForm 新建模式
      ├── 用户填业务表单 + LLM 辅助
      ├── RuleValidator.validate(...)
      └── [保存] → addRule(rule) + setMeta(meta)
```

### 10.3 规则推送执行数据流(与 session 集成)

```
用户在 BusinessRuleLibrary 选规则 → [试运行这条]
  │
  ├── createSession() → sessionId
  ├── 把规则 content(JSON 字符串)解析为 instruction 对象
  ├── submitCommand(sessionId, parsedInstruction)
  │   → CommandResult
  └── goto('/view/execution') → 看执行结果
```

---

## 11. 关键代码示例

### 11.1 OnboardingWizard StepFirstRule(LLM 辅助 + 校验 + 保存)

```svelte
<!-- src/lib/views/Build/WizardSteps/StepFirstRule.svelte -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:建库向导步骤 3 — 加第一条规则
    - LLM 辅助模式:自然语言 → JSON 规则草案
    - 业务表单模式:字段填值 → evorule JSON
    - RuleValidator 校验
    - BusinessPreview(LLM explainRule)
    - 保存:addRule + setMeta
-->

<script lang="ts">
  import { addRule, RuleValidator, type Rule } from '@evorule/console';
  import { useAssistantOrNull } from '@evorule/console';
  import { dbStore } from '$lib/stores/db';
  import { setMeta } from '$lib/stores/rule-business-meta';
  import { businessTermsStore } from '$lib/stores/business-terms';
  import { businessFormSchemaStore } from '$lib/stores/business-form-schema';
  import BusinessForm from '$lib/views/Rules/BusinessForm.svelte';
  import BusinessPreview from '$lib/views/Rules/BusinessPreview.svelte';

  let { template, businessObjects, onCreated, onBack } = $props<{
    template: 'blank' | 'finance' | 'compliance' | null;
    businessObjects: string[];
    onCreated: (ruleId: string) => void;
    onBack: () => void;
  }>();

  const assistant = useAssistantOrNull();

  // === 输入模式 ===
  let inputMode = $state<'llm' | 'form'>('llm');

  // === LLM 模式状态 ===
  let naturalLanguage = $state('');
  let generatedRule = $state<object | null>(null);
  let confidence = $state<number>(0);
  let validation = $state<{ valid: boolean; errors: string[] } | null>(null);
  let isGenerating = $state(false);
  let llmError = $state<string | null>(null);

  // === 业务预览 ===
  let businessExplanation = $state<string>('');
  let isExplaining = $state(false);

  // === LLM 生成规则草案 ===
  async function handleGenerate(): Promise<void> {
    if (!assistant) {
      llmError = 'LLM 未配置,请在设置中配置 LLM 或切换到业务表单模式';
      return;
    }
    if (!naturalLanguage.trim()) {
      llmError = '请输入规则描述';
      return;
    }

    isGenerating = true;
    llmError = null;
    try {
      const result = await assistant.generateRuleDraft(naturalLanguage);
      generatedRule = result.rule;
      confidence = result.confidence;

      // 校验
      const jsonStr = JSON.stringify(result.rule, null, 2);
      const v = RuleValidator.validate(jsonStr);
      validation = { valid: v.valid, errors: v.errors };

      // 业务预览(异步,不阻塞保存)
      if (v.valid) {
        isExplaining = true;
        try {
          businessExplanation = await assistant.explainRule(result.rule);
        } catch (e) {
          businessExplanation = '(LLM 解释失败,但不影响保存)';
        } finally {
          isExplaining = false;
        }
      }
    } catch (e) {
      llmError = (e as Error).message;
    } finally {
      isGenerating = false;
    }
  }

  // === 保存规则 ===
  function handleSave(): void {
    if (!generatedRule || !validation?.valid) {
      llmError = '规则未校验通过,无法保存';
      return;
    }

    const db = $dbStore;
    const ruleId = addRule({
      id: `user.${Date.now()}`,
      version: 1,
      description: naturalLanguage,
      content: JSON.stringify(generatedRule, null, 2)
    });

    // 关联业务元数据
    setMeta({
      ruleId,
      industry: db.industry,
      businessObject: db.businessObjects[0] ?? '未指定',
      businessTermIds: [],
      scenarioContext: naturalLanguage
    });

    onCreated(ruleId);
  }
</script>

<div class="step-first-rule">
  <h2>步骤 3:加第一条规则</h2>

  <!-- 模板提示 -->
  {#if template && template !== 'blank'}
    <div class="template-hint">
      基于模板: <strong>{template}</strong>
      (若需查看预填规则,请到工作台规则库)
    </div>
  {/if}

  <!-- 输入模式切换 -->
  <div class="mode-tabs">
    <button class:active={inputMode === 'llm'} onclick={() => (inputMode = 'llm')}>
      LLM 辅助
    </button>
    <button class:active={inputMode === 'form'} onclick={() => (inputMode = 'form')}>
      业务表单
    </button>
  </div>

  {#if inputMode === 'llm'}
    <!-- LLM 模式 -->
    <div class="llm-section">
      <label>用自然语言描述规则:</label>
      <textarea
        bind:value={naturalLanguage}
        placeholder="例如:65 岁以上发烧必须先 CT"
        rows="3"
      ></textarea>

      <button onclick={handleGenerate} disabled={isGenerating}>
        {isGenerating ? '生成中...' : '生成规则草案'}
      </button>

      {#if llmError}
        <div class="error">{llmError}</div>
      {/if}

      {#if generatedRule}
        <div class="generated-rule">
          <h3>生成的规则</h3>
          <pre>{JSON.stringify(generatedRule, null, 2)}</pre>

          <div class="confidence">
            置信度: {confidence.toFixed(2)}
            {#if confidence < 0.5}
              (低,需修改)
            {/if}
          </div>

          {#if validation}
            <div class="validation" class:valid={validation.valid} class:invalid={!validation.valid}>
              {#if validation.valid}
                ✅ 校验通过
              {:else}
                ❌ 校验失败:
                <ul>
                  {#each validation.errors as error}
                    <li>{error}</li>
                  {/each}
                </ul>
              {/if}
            </div>
          {/if}

          {#if businessExplanation}
            <div class="business-preview">
              <h4>业务预览(LLM 解释)</h4>
              <p>{businessExplanation}</p>
            </div>
          {/if}
        </div>
      {/if}
    </div>
  {:else}
    <!-- 业务表单模式 -->
    <BusinessForm
      industry={$dbStore.industry}
      businessObjects={businessObjects}
      onSave={(ruleJson, description) => {
        generatedRule = ruleJson;
        naturalLanguage = description;
        const v = RuleValidator.validate(JSON.stringify(ruleJson));
        validation = { valid: v.valid, errors: v.errors };
        if (v.valid) handleSave();
      }}
    />
  {/if}

  <!-- 操作按钮 -->
  <div class="actions">
    <button onclick={onBack}>上一步</button>
    <button
      onclick={handleSave}
      disabled={!generatedRule || !validation?.valid}
    >
      保存规则
    </button>
  </div>
</div>
```

### 11.2 BusinessRuleLibrary(包装内核 RuleLibraryView)

```svelte
<!-- src/lib/views/Rules/BusinessRuleLibrary.svelte -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:业务规则库(包装内核 RuleLibraryView)
    - 业务模式(默认):业务术语筛选 + 规则卡片 + 业务表单 + LLM 预览
    - 开发者模式(toggle):raw JSON 编辑(内核 RuleLibraryView)
    - 加规则 / 编辑 / 复制 / 删除 / 导入 / 导出

  与内核边界:
    - 内核 rules store 提供数据 + CRUD
    - 内核 RuleLibraryView 提供 raw JSON 编辑(开发者模式)
    - 本组件加业务语言层(业务术语 + 业务表单 + 业务预览)
-->

<script lang="ts">
  import {
    rules,
    selectedRuleId,
    selectRule,
    addRule,
    updateRule,
    deleteRule,
    duplicateRule,
    importRule,
    exportRule,
    RuleLibraryView,
    RuleValidator,
    type Rule
  } from '@evorule/console';
  import { useAssistantOrNull, openAssistantDialog } from '$lib/stores/assistant-ui';
  // 注:openAssistantDialog 应从 $lib/stores/assistant-ui(已存在)
  import { dbStore } from '$lib/stores/db';
  import { businessTermsStore } from '$lib/stores/business-terms';
  import { businessFormSchemaStore } from '$lib/stores/business-form-schema';
  import { getMeta, setMeta, removeMeta } from '$lib/stores/rule-business-meta';
  import BusinessTermFilter from './BusinessTermFilter.svelte';
  import BusinessRuleCard from './BusinessRuleCard.svelte';
  import BusinessForm from './BusinessForm.svelte';
  import BusinessPreview from './BusinessPreview.svelte';
  import DeveloperModeToggle from './DeveloperModeToggle.svelte';

  // === 开发者模式 ===
  let developerMode = $state(false);

  // === 业务语言筛选 ===
  let filterIndustry = $state<string>($dbStore.industry);
  let filterTermId = $state<string | null>(null);
  let searchText = $state('');

  // === 选中规则 + 业务元数据 ===
  let selectedRuleIdState = $state<string | null>($selectedRuleId);
  let selectedMeta = $derived(
    selectedRuleIdState ? getMeta(selectedRuleIdState) : null
  );

  // === 过滤后的规则列表 ===
  let filteredRules = $derived.by(() => {
    let list = $rules;
    if (filterIndustry && filterIndustry !== 'all') {
      list = list.filter((r) => {
        const meta = getMeta(r.id);
        return meta?.industry === filterIndustry;
      });
    }
    if (filterTermId) {
      list = list.filter((r) => {
        const meta = getMeta(r.id);
        return meta?.businessTermIds.includes(filterTermId);
      });
    }
    if (searchText.trim()) {
      const q = searchText.trim().toLowerCase();
      list = list.filter(
        (r) =>
          r.description.toLowerCase().includes(q) ||
          r.content.toLowerCase().includes(q)
      );
    }
    return list;
  });

  // === 规则 CRUD(委托内核) ===
  function handleAddRule(): void {
    // 触发 BusinessForm 新建模式
    selectedRuleIdState = null;
  }

  function handleEditRule(id: string, patch: Partial<Rule>): void {
    updateRule(id, patch);
  }

  function handleDuplicate(id: string): void {
    const newId = duplicateRule(id);
    const meta = getMeta(id);
    if (meta) {
      setMeta({ ...meta, ruleId: newId });
    }
    selectRule(newId);
    selectedRuleIdState = newId;
  }

  function handleDelete(id: string): void {
    deleteRule(id);
    removeMeta(id);
    if (selectedRuleIdState === id) {
      selectedRuleIdState = null;
    }
  }

  function handleImportFile(jsonContent: string): void {
    const newId = importRule(jsonContent);
    // 用户可后续在 BusinessForm 设置业务元数据
  }

  function handleExport(id: string): void {
    const json = exportRule(id);
    // 触发浏览器下载
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
</script>

<div class="business-rule-library">
  <!-- 顶部:筛选 + 搜索 + 开发者模式切换 -->
  <header class="brl-header">
    <BusinessTermFilter
      industry={filterIndustry}
      termId={filterTermId}
      onIndustryChange={(i) => (filterIndustry = i)}
      onTermChange={(t) => (filterTermId = t)}
    />
    <input
      type="search"
      bind:value={searchText}
      placeholder="搜索规则(名称或 JSON 内容)"
    />
    <DeveloperModeToggle bind:enabled={developerMode} />
  </header>

  <!-- 主体:开发者模式 vs 业务模式 -->
  {#if developerMode}
    <!-- 开发者模式:raw JSON 编辑(内核组件) -->
    <RuleLibraryView
      onaiGenerateDraft={() => openAssistantDialog('draft')}
      onaiExplainRule={() => openAssistantDialog('explain')}
    />
  {:else}
    <!-- 业务模式:业务语言呈现 -->
    <div class="brl-main">
      <!-- 左:规则卡片列表 -->
      <aside class="brl-list">
        {#each filteredRules as rule (rule.id)}
          <BusinessRuleCard
            {rule}
            meta={getMeta(rule.id)}
            selected={selectedRuleIdState === rule.id}
            onclick={() => {
              selectRule(rule.id);
              selectedRuleIdState = rule.id;
            }}
            onDuplicate={() => handleDuplicate(rule.id)}
            onDelete={() => handleDelete(rule.id)}
            onExport={() => handleExport(rule.id)}
          />
        {:else}
          <div class="empty">没有匹配的规则</div>
        {/each}

        <button class="add-btn" onclick={handleAddRule}>+ 加规则</button>
      </aside>

      <!-- 右:规则详情 + 业务表单 -->
      <section class="brl-detail">
        {#if selectedRuleIdState}
          {@const rule = $rules.find((r) => r.id === selectedRuleIdState)}
          {#if rule}
            <BusinessForm
              {rule}
              meta={selectedMeta}
              onSave={(patch, metaPatch) => {
                handleEditRule(rule.id, patch);
                if (metaPatch) {
                  setMeta({ ...(selectedMeta ?? { ruleId: rule.id, industry: '', businessObject: '', businessTermIds: [], scenarioContext: '' }), ...metaPatch, ruleId: rule.id });
                }
              }}
            />
            <BusinessPreview {rule} />
          {/if}
        {:else}
          <!-- 新建模式 -->
          <BusinessForm
            industry={$dbStore.industry}
            businessObjects={$dbStore.businessObjects}
            onSave={(ruleJson, description, meta) => {
              const id = addRule({
                id: `user.${Date.now()}`,
                version: 1,
                description,
                content: JSON.stringify(ruleJson, null, 2)
              });
              if (meta) setMeta({ ...meta, ruleId: id });
              selectRule(id);
              selectedRuleIdState = id;
            }}
          />
        {/if}
      </section>
    </div>
  {/if}
</div>
```

### 11.3 业务表单 → evorule JSON 转换

```typescript
// src/lib/views/Rules/business-form-to-json.ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 业务表单值 → evorule JSON 转换。
// 根据 BusinessFormField.evorulePath 把表单值映射到 evorule JSON 字段。

import type {
  BusinessFormField,
  BusinessFormSchema,
} from "$lib/stores/business-form-schema";

export interface FormValues {
  [fieldId: string]: string | number | boolean;
}

/**
 * 把业务表单值转换为 evorule JSON 对象。
 *
 * @param schema 业务表单 schema
 * @param values 用户填的表单值
 * @returns evorule JSON 对象
 *
 * 转换规则:
 *   - 根据 evorulePath(如 'condition.value')用 lodash.set 风格赋值
 *   - 类型转换:string → number / boolean 由 field.type 决定
 */
export function formValuesToEvoruleJson(
  schema: BusinessFormSchema,
  values: FormValues,
): object {
  const result: Record<string, unknown> = {};

  for (const field of schema.fields) {
    const value = values[field.id];
    if (value === undefined) continue;

    const converted = convertValue(value, field);
    setPath(result, field.evorulePath, converted);
  }

  return result;
}

function convertValue(
  value: string | number | boolean,
  field: BusinessFormField,
): unknown {
  switch (field.type) {
    case "number":
      return typeof value === "string" ? Number(value) : value;
    case "boolean":
      return value === true || value === "true";
    case "enum":
    case "string":
    case "date":
    default:
      return String(value);
  }
}

/**
 * 简化版 setPath(避免引入 lodash)。
 * 支持点分路径:'condition.value' → result.condition.value
 */
function setPath(
  obj: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  const parts = path.split(".");
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    if (current[k] === undefined || typeof current[k] !== "object") {
      current[k] = {};
    }
    current = current[k] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}
```

---

## 12. 测试策略

### 12.1 单元测试(Vitest)

#### 12.1.1 Store 测试

```typescript
// src/lib/stores/db.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { dbStore, initDb, resetDb, isEmptyDb, ruleCount } from "./db";
import { rules, addRule, deleteRule } from "@evorule/console";
import { get } from "svelte/store";

describe("dbStore", () => {
  beforeEach(() => {
    resetDb();
    // 清空 user 规则
    const current = get(rules).filter((r) => r.source === "user");
    for (const r of current) deleteRule(r.id);
  });

  it("初始状态:未初始化,空库", () => {
    const db = get(dbStore);
    expect(db.dbName).toBe("");
    expect(db.createdAt).toBeNull();
    expect(get(isEmptyDb)).toBe(true);
    expect(get(ruleCount)).toBe(0);
  });

  it("initDb 后:已初始化,但仍空库(规则在内核 rules store)", () => {
    initDb("我的库", ["病人"], "medical");
    const db = get(dbStore);
    expect(db.dbName).toBe("我的库");
    expect(db.businessObjects).toEqual(["病人"]);
    expect(db.industry).toBe("medical");
    expect(get(isEmptyDb)).toBe(true); // 仍空库,因为没加规则
  });

  it("addRule 后:非空库(派生计算)", () => {
    initDb("我的库", ["病人"], "medical");
    addRule({
      id: "user.test1",
      version: 1,
      description: "测试规则",
      content: "{}",
    });
    expect(get(isEmptyDb)).toBe(false);
    expect(get(ruleCount)).toBeGreaterThanOrEqual(1);
  });
});
```

#### 12.1.2 业务术语库测试

```typescript
// src/lib/stores/business-terms.test.ts
import { describe, it, expect } from "vitest";
import { businessTermsStore, getTermsByIndustry } from "./business-terms";

describe("businessTermsStore", () => {
  it("内置 2 个行业的术语", () => {
    const financeTerms = getTermsByIndustry("finance");
    const complianceTerms = getTermsByIndustry("compliance");
    expect(financeTerms.length).toBeGreaterThan(0);
    expect(complianceTerms.length).toBeGreaterThan(0);
  });

  it("财务术语包含 amount / threshold / approver", () => {
    const financeTerms = getTermsByIndustry("finance");
    const keys = financeTerms.map((t) => t.key);
    expect(keys).toContain("amount");
    expect(keys).toContain("threshold");
    expect(keys).toContain("approver");
  });
});
```

#### 12.1.3 业务表单 → JSON 转换测试

```typescript
// src/lib/views/Rules/business-form-to-json.test.ts
import { describe, it, expect } from "vitest";
import { formValuesToEvoruleJson } from "./business-form-to-json";
import { BUILTIN_FORM_SCHEMAS } from "$lib/data/business-form-schemas-builtin";

describe("formValuesToEvoruleJson", () => {
  it("财务表单值正确映射到 evorule JSON", () => {
    const schema = BUILTIN_FORM_SCHEMAS.find(
      (s) => s.id === "finance.expense_limit",
    )!;
    const values = {
      "finance.amount_threshold": 15000,
      "finance.approver_role": "CFO",
      "finance.notify_channel": "邮件",
    };
    const json = formValuesToEvoruleJson(schema, values);
    expect(json).toEqual({
      condition: { value: 15000 },
      action: { params: { role: "CFO", channel: "邮件" } },
    });
  });
});
```

### 12.2 E2E 测试(Playwright)

```typescript
// tests/onboarding.spec.ts
import { test, expect } from "@playwright/test";

test.describe("建库向导 5 步", () => {
  test("blank 模式完整跑通", async ({ page }) => {
    await page.goto("/");
    // mock 登录 + 空库
    await page.click('[data-testid="login-mock"]');

    // Step 1:选 blank
    await page.click('[data-testid="template-blank"]');
    await page.click('[data-testid="next"]');

    // Step 2:命名 + 业务对象
    await page.fill('[data-testid="db-name"]', "我的第一个 evorule 库");
    await page.click('[data-testid="obj-patient"]');
    await page.click('[data-testid="next"]');

    // Step 3:LLM 辅助加规则
    await page.fill('[data-testid="llm-input"]', "65 岁以上发烧必须先 CT");
    await page.click('[data-testid="generate-rule"]');
    await expect(page.locator('[data-testid="generated-rule"]')).toBeVisible();
    await expect(
      page.locator('[data-testid="validation-valid"]'),
    ).toBeVisible();
    await page.click('[data-testid="save-rule"]');

    // Step 4:试运行
    await page.fill('[data-testid="event-patient-id"]', "P-001");
    await page.click('[data-testid="submit-event"]');
    await expect(
      page.locator('[data-testid="execution-result"]'),
    ).toBeVisible();
    await page.click('[data-testid="next"]');

    // Step 5:完成 → 工作台
    await page.click('[data-testid="complete"]');
    await expect(page.locator('[data-testid="real-workbench"]')).toBeVisible();
  });

  test("财务模板预填规则", async ({ page }) => {
    await page.goto("/");
    await page.click('[data-testid="login-mock"]');

    // Step 1:选 finance
    await page.click('[data-testid="template-finance"]');
    await page.click('[data-testid="next"]');

    // Step 2:命名
    await page.fill('[data-testid="db-name"]', "财务审批库");
    await page.click('[data-testid="next"]');

    // 预填规则(因选模板,Step 3 显示"已预填 2 条规则")
    await expect(
      page.locator('[data-testid="prefilled-rules-count"]'),
    ).toContainText("2");
    await page.click('[data-testid="next"]');

    // Step 4:试运行
    await page.click('[data-testid="next"]');

    // Step 5:完成
    await page.click('[data-testid="complete"]');
    await expect(page.locator('[data-testid="real-workbench"]')).toBeVisible();
  });
});

test.describe("业务规则库", () => {
  test("工作台进入业务规则库", async ({ page }) => {
    // 假设已建库
    await page.goto("/");
    await page.click('[data-testid="login-mock-with-db"]');

    // 点任务流入口"加规则"
    await page.click('[data-testid="task-add"]');

    // 进入 BusinessRuleLibrary
    await expect(
      page.locator('[data-testid="business-rule-library"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="business-term-filter"]'),
    ).toBeVisible();
  });

  test("开发者模式切换", async ({ page }) => {
    await page.goto("/view/rules");
    // 默认业务模式
    await expect(page.locator('[data-testid="business-mode"]')).toBeVisible();
    // 切换到开发者模式
    await page.click('[data-testid="developer-mode-toggle"]');
    await expect(page.locator('[data-testid="raw-json-editor"]')).toBeVisible();
  });
});
```

### 12.3 测试覆盖率目标

| 模块                                         | 单元测试 | E2E 测试 | 覆盖率目标              |
| -------------------------------------------- | -------- | -------- | ----------------------- |
| dbStore(派生 isEmptyDb / ruleCount)          | ✅ 必做  | —        | ≥ 90%                   |
| businessTermsStore / businessFormSchemaStore | ✅ 必做  | —        | ≥ 80%                   |
| ruleBusinessMetaStore                        | ✅ 必做  | —        | ≥ 90%                   |
| formValuesToEvoruleJson                      | ✅ 必做  | —        | 100%(分支)              |
| 模板加载(loadTemplate)                       | ✅ 必做  | —        | 100%                    |
| OnboardingWizard 5 步                        | —        | ✅ 必做  | 完整路径                |
| BusinessRuleLibrary(业务/开发者切换)         | —        | ✅ 必做  | 关键路径                |
| 规则 CRUD(委托内核)                          | —        | ✅ 必做  | 加/编/删/复制/导入/导出 |

---

## 13. 与 HOME_DESIGN.md 的一致性更新

### 13.1 需要同步修改 HOME_DESIGN.md 的章节

| HOME_DESIGN.md 章节     | 修改内容                                                                                                                         | 原因                                |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| §6.2 dbStore            | 移除 `ruleCount` 字段 / `markAsNonEmpty()` / `setRuleCount()` 函数;新增 `industry` 字段;新增派生 `isEmptyDb` / `ruleCount` store | 复用内核 rules store,避免数据冗余   |
| §5.3 OnboardingWizard   | Step 3 加第一条规则改为调内核 `addRule()`;Step 2 选模板时调 `loadTemplate()`                                                     | 复用内核 rules store + 业务模板加载 |
| §5.4 RealWorkbench      | "待办数" 卡片从 `backend.getTodoCount()` 改为 `get(ruleCount)`(P0 阶段无后端 todo API)                                           | P0 阶段后端未提供 todo 接口         |
| §3.3 状态转换矩阵       | "完成建库向导" 触发条件改为"内核 rules store 非空"(派生 `isEmptyDb` = false)                                                     | 不再依赖 `dbStore.markAsNonEmpty()` |
| §7.1 初始化数据流       | 第 5 步 `dbStore 异步同步` 改为 "无需同步 dbStore.ruleCount,直接订阅内核 rules store 派生"                                       | 派生计算替代持久化字段              |
| §7.3 建库向导完成数据流 | "dbStore.markAsNonEmpty()" 改为 "内核 addRule(rule) + setMeta(meta) → 派生 isEmptyDb = false"                                    | 同上                                |

### 13.2 修改示例:HOME_DESIGN.md §6.2 dbStore 更新

**原设计**(HOME_DESIGN.md §6.2):

```typescript
export interface DbMeta {
  dbId: string;
  dbName: string;
  businessObjects: string[];
  ruleCount: number;        // ← 移除
  createdAt: number | null; // ← 改 ISO 字符串
}

export function markAsNonEmpty(): void { ... }  // ← 移除
export function setRuleCount(count: number): void { ... }  // ← 移除
```

**更新后**(本设计文档 §4.2):

```typescript
export interface DbMeta {
  dbId: string;
  dbName: string;
  businessObjects: string[];
  industry: Industry; // ← 新增
  createdAt: string | null; // ← ISO 字符串
}

export const isEmptyDb = derived(rules, ($rules) => $rules.length === 0); // ← 派生
export const ruleCount = derived(rules, ($rules) => $rules.length); // ← 派生
// 不再有 markAsNonEmpty / setRuleCount
```

### 13.3 同步修改清单(实施时执行)

实施 P0-1 时,需要同步修改 HOME_DESIGN.md:

- [x] 更新 HOME_DESIGN.md §6.2 dbStore 接口(按本设计文档 §4.2)— 2026-08-06 已完成
- [x] 更新 HOME_DESIGN.md §5.3 OnboardingWizard Step 3 数据流(调内核 `addRule`)— 2026-08-06 已完成
- [x] 更新 HOME_DESIGN.md §3.3 状态转换矩阵(用派生 `isEmptyDb`)— 2026-08-06 已完成
- [x] 更新 HOME_DESIGN.md §7.1 / §7.3 数据流(派生替代持久化字段)— 2026-08-06 已完成
- [x] 在 HOME_DESIGN.md §1.3 加引用:"P0-1 详细设计见 docs/P01_BUILD_SCHEMA_DESIGN.md"— 2026-08-06 已完成

### 13.4 三层架构 U6/U7 同步(2026-08-06 完成)

> 对应三层架构 §11.4 / §12.4 U6 决策 + HOME_DESIGN.md U7 决策。

| 同步项                                                                                                                                     | 本文档章节                 | 状态                      |
| ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------- | ------------------------- |
| rules 表加 `workspace_id` / `status` / `ruleset_version` 字段                                                                              | §4.6.2                     | ✅ 已同步                 |
| 新增 7 张应用层表(workspaces / workspace_members / sandbox_sessions / production_audit / test_datasets / publish_queue / production_state) | §4.6.3-§4.6.9              | ✅ 已同步                 |
| workspace crate 设计(参照 core/hot_reload)                                                                                                 | §4.6.10                    | ✅ 已同步                 |
| 内核 Rule → 应用层 rules 字段映射(P1 迁移对齐)                                                                                             | §4.6.2 映射表              | ✅ 已同步                 |
| HOME_DESIGN.md U7(session_switched SSE 推送)                                                                                               | HOME_DESIGN.md §6.5 / §7.6 | ✅ 已同步(HOME_DESIGN 侧) |

---

## 14. 与现有代码的迁移路径

### 14.1 现有代码改动清单

| 文件                                                   | 改动类型                           | 说明                                   |
| ------------------------------------------------------ | ---------------------------------- | -------------------------------------- |
| `src/routes/+page.svelte`                              | 改(已在 HOME_DESIGN.md §12.1 计划) | 渲染 HomeRouter                        |
| `src/lib/stores/db.ts`                                 | 新增 + 覆盖 HOME_DESIGN.md 设计    | 按本设计文档 §4.2 实现(派生 isEmptyDb) |
| `src/lib/stores/business-terms.ts`                     | 新增                               | 本设计文档 §4.3                        |
| `src/lib/stores/business-form-schema.ts`               | 新增                               | 本设计文档 §4.4                        |
| `src/lib/stores/rule-business-meta.ts`                 | 新增                               | 本设计文档 §4.5                        |
| `src/lib/data/business-terms-builtin.ts`               | 新增                               | 本设计文档 §7.1                        |
| `src/lib/data/business-form-schemas-builtin.ts`        | 新增                               | 本设计文档 §7.2                        |
| `src/lib/data/template-finance.ts`                     | 新增                               | 本设计文档 §9.1                        |
| `src/lib/data/template-compliance.ts`                  | 新增                               | 本设计文档 §9.2                        |
| `src/lib/views/Build/templates.ts`                     | 新增                               | 本设计文档 §9.3                        |
| `src/lib/views/Build/WizardSteps/StepFirstRule.svelte` | 新增                               | 本设计文档 §11.1                       |
| `src/lib/views/Build/WizardSteps/StepTrialRun.svelte`  | 新增                               | 本设计文档 §6.5                        |
| `src/lib/views/Rules/BusinessRuleLibrary.svelte`       | 新增                               | 本设计文档 §11.2                       |
| `src/lib/views/Rules/BusinessTermFilter.svelte`        | 新增                               | 业务术语筛选侧栏                       |
| `src/lib/views/Rules/BusinessRuleCard.svelte`          | 新增                               | 规则卡片                               |
| `src/lib/views/Rules/BusinessForm.svelte`              | 新增                               | 业务表单                               |
| `src/lib/views/Rules/BusinessPreview.svelte`           | 新增                               | 业务预览(LLM explainRule)              |
| `src/lib/views/Rules/DeveloperModeToggle.svelte`       | 新增                               | 开发者模式切换                         |
| `src/lib/views/Rules/business-form-to-json.ts`         | 新增                               | 本设计文档 §11.3                       |

### 14.2 迁移步骤(建议顺序)

1. **第 1 步:新增 Store 层**(不破坏现有代码)
   - `db.ts`(更新版)/ `business-terms.ts` / `business-form-schema.ts` / `rule-business-meta.ts`
   - 单元测试覆盖

2. **第 2 步:新增内置数据**
   - `business-terms-builtin.ts` / `business-form-schemas-builtin.ts`
   - `template-finance.ts` / `template-compliance.ts`
   - `templates.ts`(loadTemplate)

3. **第 3 步:新增业务规则库组件**
   - `BusinessRuleLibrary.svelte` + 子组件(BusinessTermFilter / BusinessRuleCard / BusinessForm / BusinessPreview / DeveloperModeToggle)
   - `business-form-to-json.ts`
   - 单元测试 + E2E 测试覆盖

4. **第 4 步:新增建库向导 StepFirstRule / StepTrialRun**
   - 整合到 HOME_DESIGN.md §5.3 OnboardingWizard
   - E2E 测试 5 步完整路径

5. **第 5 步:同步更新 HOME_DESIGN.md**
   - 按 §13.3 清单更新
   - 确保两份设计文档一致

### 14.3 灰度策略

- **第 1-2 步**(Store + 内置数据)— 不影响现有代码,可独立合并
- **第 3 步**(业务规则库)— 需要在 `/view/rules` 路由加条件渲染(Business vs 开发者模式),与 HOME_DESIGN.md §12.2 第 3 步合并
- **第 4 步**(建库向导 Step 3/4)— 需要与 HOME_DESIGN.md §5.3 OnboardingWizard 集成
- **第 5 步**(HOME_DESIGN.md 同步)— 文档级修改,不影响代码

---

## 15. 长期演进路径

### 15.1 MVP 阶段(P0)

- **数据层**:全部 localStorage(内核 `evorule-console:rules:user` + console-cloud 4 个 key)
- **业务模板**:2 个 builtin(代码内置)
- **业务术语 / 表单 schema**:2 个行业(财务 + 合规)
- **库模型**:单租户单库(`dbId: 'default'`)

### 15.2 试用阶段(P1-P2)

- **数据层**:接 evorule-server 后端 API
  - 规则 CRUD:`/api/databases/{dbId}/rules`(GET/POST/PUT/DELETE)
  - 库元数据:`/api/databases/{dbId}`(GET/PUT)
  - 业务术语 / 表单 schema:可保持在 localStorage(用户偏好)
- **业务模板**:扩展到 10 行业浅模板(战略文档 §20.5 P1-5)
- **库模型**:单租户多库(`dbStore` 加 `dbList: DbMeta[]` + `currentDbId: string`)
- **Store 接口不变**:只换内部实现(localStorage → fetch)

### 15.3 SaaS 阶段(P4+ 长期)

- **数据层**:多租户后端 API
  - 加 `tenantId` 字段
- **业务模板**:用户自定义模板上传 / 分享
- **库模型**:多租户多库
- **触发条件**:P3 试用验证 H7 假设(战略文档 §21)成立

### 15.4 兼容性保证

本设计的 Store 接口(`dbStore` / `businessTermsStore` / `businessFormSchemaStore` / `ruleBusinessMetaStore`)在 MVP → 试用 → SaaS 三阶段保持不变,内部实现可替换:

- P0:`writable` + localStorage
- P1+:`writable` + fetch(异步 backend)
- SaaS:多租户 + fetch

这保证 P0 阶段写的组件代码,P1/P2/P3 阶段不需要重写。

### 15.5 与内核边界演进

P0 阶段 console-cloud 层加 4 个 store + 业务语言层,不修改内核。P1+ 演进路径:

- **路径 A(推荐)**:console-cloud 层 store 演进,内核 `@evorule/console` 保持不变
- **路径 B(长期)**:把业务语言层(业务术语 / 业务表单 schema)下沉到内核 `@evorule/console` 作为可选扩展
- **路径 C(更长期)**:把业务模板机制做成内核插件(配合 P2 插件机制)

路径 B/C 需要与内核团队协调,不在 P0-1 范围内。

---

## 16. 待办

### 16.1 立即可做(P0-1 实施前)

- [ ] 4 个 Store 详细实现 + 单元测试(§4 + §12.1)
- [ ] 2 个业务模板 builtin 数据详细化(§9.1 + §9.2,各 3-5 条规则)
- [ ] business-terms-builtin.ts / business-form-schemas-builtin.ts 详细化(§7)
- [ ] BusinessRuleLibrary.svelte + 5 个子组件(§6.2 + §11.2)
- [ ] StepFirstRule.svelte / StepTrialRun.svelte(§6.4 + §6.5 + §11.1)
- [ ] business-form-to-json.ts(§11.3)

### 16.2 P0-1 实施时

- [ ] 与 HOME_DESIGN.md §5.3 OnboardingWizard 集成
- [ ] 与 HOME_DESIGN.md §12.2 第 3 步路由迁移集成(/view/rules)
- [ ] E2E 测试 5 个关键路径(§12.2)
- [ ] 同步更新 HOME_DESIGN.md(§13.3 清单)

### 16.3 与内核 / 后端协调

- [ ] 确认内核 `Rule` 类型字段(content 是否能装任意 evorule JSON)— 已通过 `rules.d.ts` 确认为 `string`,可装任意 JSON
- [ ] 确认内核 `addRule` 的 id 生成策略(用户提供 vs 内核生成)— 已通过 `rules.d.ts` 确认为用户提供
- [ ] 后端 evorule-server 是否需要加"规则集批量推送" API(用 P0-3 数据集组合机制)— P0-3 工作,不影响 P0-1
- [ ] 业务表单 schema 的 `evorulePath` 字段路径与内核 instruction schema 对齐 — 实施时与内核 schema 对照
- [ ] evorule-server 新建 `workspace` crate(§4.6.10,U6 决策)— 与 server 团队协调,参照 `core/hot_reload` crate 模式;P0 console-cloud 不依赖,但 P1 迁移时字段需对齐(§4.6.2 映射表)

### 16.4 与战略文档 / 三层架构同步

- [ ] 本文档完成后,更新战略文档 §23.1 待办状态
- [ ] 实施完成后,更新战略文档 §5.5 "规则库 → 业务规则库" 章节,引用本文档作为落地
- [x] 三层架构 U6 同步:rules 表加字段 + 7 张应用层表 + workspace crate 设计(§4.6)— 2026-08-06 已完成
- [x] 三层架构 U7 同步:与 HOME_DESIGN.md §6.5 / §7.6 对齐(session_switched SSE 推送)— 2026-08-06 已完成

---

## 17. 与战略文档 / HOME_DESIGN.md 的引用关系

| 战略文档章节                                   | 本设计文档章节   | 实现位置                                                |
| ---------------------------------------------- | ---------------- | ------------------------------------------------------- |
| §20.2 P0-1 建库向导 + 通用 schema + 业务规则库 | §1-§16(全文)     | —                                                       |
| §6 业务语言层(基线)                            | §5.3 + §6.2 + §7 | businessTermsStore + BusinessRuleLibrary + BUILTIN 数据 |
| §10 业务模板规范                               | §9               | template-finance.ts + template-compliance.ts            |
| §5.5 规则库 → 业务规则库(改造)                 | §6.2 + §6.3      | BusinessRuleLibrary 包装内核 RuleLibraryView            |
| §11 P0 模板市场范围(1-2 个行业跑通)            | §9.1 + §9.2      | 财务审批 + 合规审计 两个模板                            |
| HOME_DESIGN.md §5.3 OnboardingWizard           | §6.4 + §11.1     | StepFirstRule(LLM 辅助 + 校验 + 保存)                   |
| HOME_DESIGN.md §6.2 dbStore                    | §4.2 + §13       | 扩展 dbStore + 一致性更新                               |
| HOME_DESIGN.md §3.3 状态转换矩阵               | §13.1            | 派生 isEmptyDb 替代 markAsNonEmpty                      |
| 三层架构 §6 数据模型设计                       | §4.6             | 应用层数据模型契约(U6 同步)                             |
| 三层架构 §11.4 / §12.4 U6 决策                 | §4.6.10 + §13.4  | workspace crate 设计 + 同步清单                         |
| 三层架构 §3.3 / §12.4 U7 决策                  | §4.6.9 + §4.6.10 | production_state + session_switched SSE 推送            |

---

> 设计文档 — 2026-08-06 定稿(2026-08-06 同步三层架构 U6/U7)
> 写者:Mavis(AI 助理) · 落地战略文档 §20.2 P0-1 到可实施层
> 关联:
>
> - `D:\evorule-doc-center\shared\final\b2b2c-strategy.md §20.2 P0-1`
> - `D:\evorule-console-cloud\docs\HOME_DESIGN.md`(P0-0b 首页 + P0-0c 建库向导 UI 流程)
> - `D:\evorule-doc-center\shared\draft\evorule-three-layer-architecture.md`(三层运行架构,U6/U7 同步依据)
> - `D:\evorule-console-cloud\node_modules\@evorule\console\dist\index.d.ts`(内核导出)
> - `src/lib/backend/cloud-http-backend.ts`(session-based backend)
> - `src/lib/assistant/cloud-llm-assistant.ts`(LLM assistant 三方法)
