# P0-3 详细设计(数据集组合机制 + 标签/分类管理)

> **状态**:设计文档,2026-08-06 定稿。本文档是 evorule-doc-center `b2b2c-strategy.md §20.2 P0-3` 的可实施落地。
>
> **定位**:P0-3 两块工作 — 数据集组合机制(从规则库选规则组合成可运行集 + 参数配置)+ 业务规则库标签/分类管理(多对多标签 + 树形分类)。本文档把战略意图落到 SvelteKit + Svelte 5 + 内核 @evorule/console 集成层面,作为 P0-3 实施依据。
>
> **关联**:
>
> - 战略依据:`D:\evorule-doc-center\shared\final\b2b2c-strategy.md §20.2 P0-3`
> - 功能流步骤:`b2b2c-strategy.md §15.5 步骤 4 整理成准备运行的数据集` + `步骤 5 导入到 evorule 运行`
> - 前置设计:`P01_BUILD_SCHEMA_DESIGN.md`(建库向导 + 业务规则库,P0-3 在此之上加数据集组合层)
> - 前置设计:`P02_BUSINESS_LANGUAGE_V0_DESIGN.md`(业务语言层,P0-3 的标签/分类是业务语言层的扩展)
> - 三层架构:`evorule-three-layer-architecture.md`(数据集在 L2 Workspace 管理,L3 Sandbox 测试,L1 Production 运行)
> - 内核导出:`@evorule/console`(rules store + getAllRules,已修复 5 个遗漏导出)

---

## 1. 背景与动机

### 1.1 战略意图(来自 §20.2 P0-3)

P0-3 两块工作:

| 子块 | 职责 | 对应功能流步骤 |
| --- | --- | --- |
| 数据集组合机制 | 从规则库选规则组合成可运行集 + 参数配置 + 数据集 CRUD | 步骤 4 整理成准备运行的数据集 + 步骤 5 导入到 evorule |
| 标签/分类管理 | 规则的多对多标签 + 树形分类 + 按标签/分类筛选 | 步骤 3 整理数据库(增删改查 + 分类 + 标签) |

### 1.2 为什么需要数据集(规则组合)

**问题**:内核 rules store 是"扁平规则列表",所有规则一起加载到 Reactor。但实际业务中:

| 场景 | 需求 | 扁平列表的不足 |
| --- | --- | --- |
| 分科室运行 | 心内科只跑心血管规则,急诊科只跑急救规则 | 无法按场景选择规则子集 |
| A/B 测试 | 数据集 A 用旧版规则,数据集 B 用新版规则 | 无法保存"规则组合" |
| 渐进式上线 | 先上 5 条核心规则,验证后再加 10 条 | 无法分批组合 |
| 沙盒测试 | 测试时只加载待测规则 + 基础规则 | 无法区分"测试集"和"全集" |

**解决**:数据集 = 规则的命名组合 + 参数配置,是"准备运行"的规则集候选。

### 1.3 为什么需要标签/分类

**问题**:规则数量增长后(医院场景 50-200 条),扁平列表难以管理。

| 需求 | 标签(多对多) | 分类(树形一对一) |
| --- | --- | --- |
| 灵活标注 | ✅ 一条规则可多个标签("紧急"+"心血管") | ❌ 一条规则只能归一个分类 |
| 层级组织 | ❌ 标签是扁平的 | ✅ 分类有树形层级("诊疗" > "急诊" > "发热") |
| 筛选 | ✅ 按标签筛选(多选) | ✅ 按分类筛选(树形下钻) |
| 典型用法 | "紧急"、"高风险"、"需审批" | "诊疗规则"、"合规规则"、"配置规则" |

**核心判断**:标签 + 分类互补,不是二选一。标签管"横向特征",分类管"纵向归属"。

### 1.4 与 P01/P02 的关系

P01 建立了业务规则库(内核 rules store + 业务元数据扩展表),P02 加了业务语言层(术语/表单/预览)。P0-3 在此之上:

```
内核 rules store(P01 复用)
  ↓ 扩展
业务元数据(P01 §3.4 ruleBusinessMetaStore)
  ↓ 扩展
标签/分类(P0-3 新增 tagStore + categoryStore + 关联表)
  ↓ 组合
数据集(P0-3 新增 datasetStore,引用规则 ID 列表)
  ↓ 运行
Reactor(数据集 → ruleset → 发布/测试)
```

### 1.5 与三层架构的关系

| 层 | 数据集用途 |
| --- | --- |
| **L2 Workspace** | 创建/编辑/管理数据集(选规则组合 + 参数 + 标签/分类) |
| **L3 Sandbox** | 加载数据集到 fork session 跑沙盒测试(合成数据) |
| **L1 Production** | 数据集发布后成为 production ruleset(滚动 session 热重载) |

### 1.6 内核已有能力(关键发现)

通过 `@evorule/console` 包导出(2026-08-06 已修复 5 个遗漏导出):

```typescript
import {
  rules,           // Writable<Rule[]>
  getAllRules,     // () => Rule[](非响应式,数据集编辑用)
  addRule,         // 添加规则
  duplicateRule,   // 复制规则(P01 业务模板用)
  // ... 完整 12 个导出
} from "@evorule/console";
```

**关键**:内核没有 dataset store — 数据集是 console-cloud 层的新概念,引用内核 rules store 的规则 ID。

### 1.7 现有 backend 限制

`src/lib/backend/cloud-http-backend.ts` 没有数据集/规则集批量推送 API。P0-3 阶段:
- 数据集管理在前端(localStorage 持久化)
- "运行数据集"= 逐条 `addRule` 推入内核(P01 §13 简化版:全推)
- P1+ 后端化时,新增 `POST /api/rules/batch` 批量推送 API

---

## 2. 目标与非目标

### 2.1 目标

- ✅ 实现数据集 CRUD store(`datasetStore`,localStorage 持久化)
- ✅ 实现标签 CRUD store(`tagStore`,多对多关联规则)
- ✅ 实现分类 CRUD store(`categoryStore`,树形结构)
- ✅ 实现规则-标签关联(`ruleTagStore`,多对多)
- ✅ 实现规则-分类关联(`ruleCategoryStore`,一对一)
- ✅ 实现数据集编辑器(从规则库选规则 + 参数配置 + 运行前检查)
- ✅ 实现标签/分类管理 UI
- ✅ 实现按标签/分类筛选规则
- ✅ 实现"运行数据集"(推入 Reactor / 发到沙盒)
- ✅ 与内核 `getAllRules` / `rules` store 集成
- ✅ 与 P01 `ruleBusinessMetaStore` / P02 业务语言层集成
- ✅ 延续 SvelteKit + Svelte 5 runes + provideXxx 注入模式
- ✅ 单元测试覆盖 Store + 状态机(Vitest)
- ✅ E2E 测试覆盖数据集创建→编辑→运行路径(Playwright)

### 2.2 非目标

- ❌ 不实现后端数据集 API(P0 阶段 localStorage,P1+ 后端化)
- ❌ 不实现规则集批量推送 API(P1+ server 工作)
- ❌ 不实现数据集版本历史(P1+ 才做)
- ❌ 不实现数据集审批工作流(P0-8 协作工作流基础)
- ❌ 不实现数据集导入/导出(P0-9 各种导入导出)
- ❌ 不实现多租户数据集(P2 SaaS 阶段)
- ❌ 不修改内核 `@evorule/console` 包
- ❌ 不实现 i18n / a11y / 移动端(P1/P2)

---

## 3. 关键架构决策

### 3.1 决策 1:数据集 = 规则 ID 列表 + 参数配置,不复制规则内容

**决策**:数据集只存储规则 ID 列表(`ruleIds: string[]`)+ 参数配置,不复制规则的 JSON content。

**理由**:

1. 规则内容在内核 rules store,复制会数据冗余 + 一致性风险
2. 规则更新后,数据集自动引用最新版(单一数据源)
3. 数据集是"组合关系",不是"克隆关系"

**取舍**:
- ✅ 单一数据源(规则更新自动生效)
- ✅ 数据集轻量(只存 ID 列表)
- ❌ 规则删除时需级联检查数据集引用(见 §3.6 级联删除)

### 3.2 决策 2:标签多对多,分类树形一对一

**决策**:
- 标签(Tag):多对多(一条规则可多个标签,一个标签可关联多条规则)
- 分类(Category):树形结构,一条规则归一个分类(一对一)

**理由**:

1. 标签管"横向特征"(紧急/高风险/需审批),天然多对多
2. 分类管"纵向归属"(诊疗 > 急诊 > 发热),天然树形一对一
3. 两者互补,覆盖不同管理需求(见 §1.3)

### 3.3 决策 3:数据集有 status 状态机

**决策**:数据集有 4 个状态:`draft` → `testing` → `ready` → `published`。

```
draft(草稿)
  ↓ 用户点"测试"
testing(测试中,在 L3 Sandbox 跑)
  ↓ 测试通过
ready(就绪,可发布)
  ↓ 用户点"发布"(需权限,L2 → L1)
published(已发布,成为 production ruleset)
  ↓ 修改规则
draft(回到草稿)
```

**理由**:

1. 数据集有生命周期(草稿→测试→就绪→发布),与三层架构 L2→L3→L1 对应
2. 状态机防止"未测试就发布"(合规要求)
3. `published` 状态与三层架构 `publish_queue` 表对应

### 3.4 决策 4:参数配置 = JSON Patch 覆盖

**决策**:数据集的"参数配置"是 JSON Patch 格式,覆盖规则默认参数。

```typescript
interface DatasetParamOverride {
  ruleId: string;
  /** JSON Patch 覆盖(op: replace/add/remove) */
  patch: JsonPatch[];
}
```

**理由**:

1. 同一条规则在不同数据集中可能用不同参数(如"体温阈值"在急诊 38°C vs 普通 37.5°C)
2. JSON Patch 是标准格式(RFC 6902),不修改规则原内容
3. 运行时 apply patch 到规则 JSON,再推入 Reactor

**取舍**:
- ✅ 同规则复用 + 参数差异化
- ✅ 不修改规则原内容
- ❌ JSON Patch 对业务专家不友好(P0-3 用业务表单封装,P0-2 业务语言层)

### 3.5 决策 5:分类是树形结构,不限制层级

**决策**:分类用 `parentId` 实现树形结构,不限制层级深度。

```typescript
interface Category {
  id: string;
  name: string;
  parentId: string | null; // null = 根分类
  order: number;           // 同级排序
  icon?: string;           // 可选图标
}
```

**理由**:

1. 不同行业的分类深度不同(医疗 3-4 层,财务 2-3 层)
2. 树形结构比扁平 + tag 更适合"归属"语义
3. UI 用树形组件展示,支持拖拽排序(P1)

### 3.6 决策 6:规则删除时级联检查数据集引用

**决策**:删除规则前,检查所有数据集是否引用该规则:
- 若引用,提示"该规则被 N 个数据集引用,确认删除?删除后数据集自动移除该规则"
- 确认后,删除规则 + 从所有引用数据集的 `ruleIds` 中移除

**实现**:监听内核 `deleteRule`,在 console-cloud 层做级联清理。

---

## 4. 数据模型

### 4.1 Dataset 类型

```typescript
// src/lib/stores/dataset.ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project

import type { JsonPatch } from "$lib/types/json-patch";

export type DatasetStatus = "draft" | "testing" | "ready" | "published";

export interface DatasetParamOverride {
  /** 规则 ID */
  ruleId: string;
  /** JSON Patch 覆盖规则默认参数 */
  patch: JsonPatch[];
}

export interface Dataset {
  /** 数据集 ID */
  id: string;
  /** 数据集名称(如"心内科核心规则集 v1") */
  name: string;
  /** 描述 */
  description: string;
  /** 规则 ID 列表(引用内核 rules store) */
  ruleIds: string[];
  /** 参数覆盖(按规则 ID) */
  paramOverrides: DatasetParamOverride[];
  /** 标签 ID 列表 */
  tagIds: string[];
  /** 分类 ID(一对一) */
  categoryId: string | null;
  /** 状态 */
  status: DatasetStatus;
  /** 来源 workspace ID(三层架构 L2,P0 阶段固定 'default') */
  workspaceId: string;
  /** 创建时间(ISO 字符串) */
  createdAt: string;
  /** 最后更新时间 */
  updatedAt: string;
  /** 最后测试时间(L3 Sandbox 测试后更新) */
  lastTestedAt: string | null;
  /** 发布版本号(published 后有值,对应 production ruleset_version) */
  publishedVersion: number | null;
}
```

### 4.2 Tag 类型

```typescript
// src/lib/stores/tag.ts

export interface Tag {
  /** 标签 ID */
  id: string;
  /** 标签名(如"紧急"、"高风险") */
  name: string;
  /** 颜色(hex,如 "#ff0000") */
  color: string;
  /** 创建时间 */
  createdAt: string;
}
```

### 4.3 Category 类型

```typescript
// src/lib/stores/category.ts

export interface Category {
  /** 分类 ID */
  id: string;
  /** 分类名(如"诊疗规则"、"急诊") */
  name: string;
  /** 父分类 ID(null = 根分类) */
  parentId: string | null;
  /** 同级排序(从 0 开始) */
  order: number;
  /** 可选图标(emoji 或 icon name) */
  icon?: string;
  /** 创建时间 */
  createdAt: string;
}
```

### 4.4 规则-标签关联(多对多)

```typescript
// src/lib/stores/rule-tag.ts

export interface RuleTagAssociation {
  /** 规则 ID(内核 rules store 的 Rule.id) */
  ruleId: string;
  /** 标签 ID */
  tagId: string;
  /** 关联时间 */
  associatedAt: string;
}
```

**存储**:用 Map<ruleId, Set<tagId>> + Map<tagId, Set<ruleId>> 双向索引,O(1) 查询。

### 4.5 规则-分类关联(一对一)

```typescript
// src/lib/stores/rule-category.ts

export interface RuleCategoryAssociation {
  /** 规则 ID */
  ruleId: string;
  /** 分类 ID */
  categoryId: string;
  /** 关联时间 */
  associatedAt: string;
}
```

**存储**:用 Map<ruleId, categoryId> 单向索引,O(1) 查询。

### 4.6 类型关系图

```
内核 rules store(P01 复用)
  │
  ├── RuleTagAssociation(多对多)──→ Tag
  │
  ├── RuleCategoryAssociation(一对一)──→ Category(parentId 树形)
  │
  └── 被 Dataset 引用(ruleIds: string[])
                     │
                     ├── DatasetParamOverride(参数覆盖)
                     │
                     ├── tagIds[]──→ Tag
                     │
                     └── categoryId──→ Category
```

### 4.7 JsonPatch 类型(RFC 6902 子集)

```typescript
// src/lib/types/json-patch.ts

export type JsonPatchOp = "replace" | "add" | "remove";

export interface JsonPatch {
  op: JsonPatchOp;
  /** JSON Pointer 路径(如 "/params/threshold") */
  path: string;
  /** 新值(replace/add 用) */
  value?: unknown;
}
```

**P0 限制**:只支持 `replace` / `add` / `remove` 3 个 op(不含 move/copy/test,P1+ 扩展)。

---

## 5. Store 设计

### 5.1 Store 一览

| Store | 文件 | 职责 | 持久化 |
| --- | --- | --- | --- |
| `datasetStore` | `src/lib/stores/dataset.ts` | 数据集 CRUD + 状态机 | localStorage |
| `tagStore` | `src/lib/stores/tag.ts` | 标签 CRUD | localStorage |
| `categoryStore` | `src/lib/stores/category.ts` | 分类 CRUD(树形) | localStorage |
| `ruleTagStore` | `src/lib/stores/rule-tag.ts` | 规则-标签关联(多对多) | localStorage |
| `ruleCategoryStore` | `src/lib/stores/rule-category.ts` | 规则-分类关联(一对一) | localStorage |

### 5.2 datasetStore

```typescript
// src/lib/stores/dataset.ts(核心 API)

export const datasetStore = writable<Dataset[]>(loadDatasets());

// === CRUD ===

/** 创建数据集 */
export function createDataset(
  name: string,
  description: string,
  ruleIds: string[],
  tagIds: string[] = [],
  categoryId: string | null = null,
): string;

/** 更新数据集(名称/描述/规则列表/参数覆盖) */
export function updateDataset(
  id: string,
  patch: Partial<Pick<Dataset, "name" | "description" | "ruleIds" | "paramOverrides" | "tagIds" | "categoryId">>,
): void;

/** 删除数据集 */
export function deleteDataset(id: string): void;

/** 复制数据集(深拷贝,新 ID,状态回 draft) */
export function duplicateDataset(sourceId: string): string;

// === 状态机 ===

/** draft → testing(开始 L3 沙盒测试) */
export function startTesting(id: string): void;

/** testing → ready(测试通过) */
export function markReady(id: string, lastTestedAt: string): void;

/** ready → published(发布到 L1,需权限) */
export function publishDataset(id: string, publishedVersion: number): void;

/** published → draft(修改后回到草稿) */
export function revertToDraft(id: string): void;

// === 派生 ===

/** 按 status 筛选 */
export const datasetsByStatus = (status: DatasetStatus) =>
  derived(datasetStore, ($d) => $d.filter((ds) => ds.status === status));

/** 按标签筛选 */
export const datasetsByTag = (tagId: string) =>
  derived(datasetStore, ($d) => $d.filter((ds) => ds.tagIds.includes(tagId)));

/** 按分类筛选 */
export const datasetsByCategory = (categoryId: string) =>
  derived(datasetStore, ($d) => $d.filter((ds) => ds.categoryId === categoryId));

// === 级联清理(规则删除时) ===

/** 从所有数据集移除已删除的规则 ID */
export function removeRuleFromAllDatasets(ruleId: string): void;
```

### 5.3 tagStore

```typescript
// src/lib/stores/tag.ts(核心 API)

export const tagStore = writable<Tag[]>(loadTags());

/** 创建标签 */
export function createTag(name: string, color: string): string;

/** 更新标签 */
export function updateTag(id: string, patch: Partial<Pick<Tag, "name" | "color">>): void;

/** 删除标签(级联清理 ruleTagStore + datasetStore.tagIds) */
export function deleteTag(id: string): void;

// === 派生 ===

/** 按名称搜索 */
export const tagsByName = (query: string) =>
  derived(tagStore, ($t) => $t.filter((t) => t.name.includes(query)));
```

### 5.4 categoryStore

```typescript
// src/lib/stores/category.ts(核心 API)

export const categoryStore = writable<Category[]>(loadCategories());

/** 创建分类 */
export function createCategory(
  name: string,
  parentId: string | null = null,
  icon?: string,
): string;

/** 更新分类 */
export function updateCategory(
  id: string,
  patch: Partial<Pick<Category, "name" | "parentId" | "order" | "icon">>,
): void;

/** 删除分类(子分类递归删除,规则-分类关联级联清理) */
export function deleteCategory(id: string): void;

/** 移动分类(改 parentId) */
export function moveCategory(id: string, newParentId: string | null): void;

// === 派生 ===

/** 分类树(嵌套结构,UI 渲染用) */
export const categoryTree = derived(categoryStore, ($cats) => buildTree($cats));

/** 子分类列表 */
export function childrenOf(parentId: string | null): Category[];

/** 祖先链(面包屑用) */
export function ancestorsOf(categoryId: string): Category[];
```

### 5.5 ruleTagStore(多对多)

```typescript
// src/lib/stores/rule-tag.ts(核心 API)

/** 双向索引 */
const ruleToTags = writable<Map<string, Set<string>>>(new Map());
const tagToRules = writable<Map<string, Set<string>>>(new Map());

/** 给规则加标签 */
export function addTagToRule(ruleId: string, tagId: string): void;

/** 移除规则的标签 */
export function removeTagFromRule(ruleId: string, tagId: string): void;

/** 获取规则的所有标签 */
export function getTagsOfRule(ruleId: string): string[];

/** 获取标签下的所有规则 */
export function getRulesOfTag(tagId: string): string[];

/** 按标签筛选规则(多选 AND/OR) */
export function filterRulesByTags(tagIds: string[], mode: "AND" | "OR"): string[];
```

### 5.6 ruleCategoryStore(一对一)

```typescript
// src/lib/stores/rule-category.ts(核心 API)

const ruleToCategory = writable<Map<string, string>>(new Map());

/** 设置规则的分类(覆盖之前的) */
export function setRuleCategory(ruleId: string, categoryId: string): void;

/** 移除规则的分类 */
export function removeRuleCategory(ruleId: string): void;

/** 获取规则的分类 */
export function getCategoryOfRule(ruleId: string): string | null;

/** 获取分类下的所有规则 */
export function getRulesOfCategory(categoryId: string): string[];
```

### 5.7 派生:组合筛选规则

```typescript
// src/lib/stores/rule-filter.ts(组合筛选)

import { rules } from "@evorule/console";

export interface RuleFilter {
  tagIds: string[];      // 标签筛选(AND/OR)
  tagMode: "AND" | "OR";
  categoryId: string | null;  // 分类筛选(含子分类)
  searchQuery: string;   // 名称/描述搜索
  status: "all" | "builtin" | "user";  // 来源筛选
}

/** 组合筛选规则(标签 + 分类 + 搜索 + 来源) */
export const filteredRules = (filter: RuleFilter) =>
  derived([rules, ruleTagStore, ruleCategoryStore], ([$rules]) => {
    let result = $rules;

    // 来源筛选
    if (filter.status !== "all") {
      result = result.filter((r) => r.source === filter.status);
    }

    // 搜索
    if (filter.searchQuery) {
      const q = filter.searchQuery.toLowerCase();
      result = result.filter(
        (r) =>
          r.description.toLowerCase().includes(q) ||
          r.id.toLowerCase().includes(q),
      );
    }

    // 分类筛选(含子分类)
    if (filter.categoryId) {
      const categoryIds = getCategoryAndDescendants(filter.categoryId);
      result = result.filter((r) => {
        const catId = getCategoryOfRule(r.id);
        return catId && categoryIds.includes(catId);
      });
    }

    // 标签筛选
    if (filter.tagIds.length > 0) {
      result = result.filter((r) => {
        const ruleTags = getTagsOfRule(r.id);
        if (filter.tagMode === "AND") {
          return filter.tagIds.every((t) => ruleTags.includes(t));
        }
        return filter.tagIds.some((t) => ruleTags.includes(t));
      });
    }

    return result;
  });
```

---

## 6. 组件树

### 6.1 顶层组件树

```
src/lib/views/Dataset/
├── DatasetManager.svelte        (数据集管理主视图,L2 Workspace 内)
│   ├── DatasetList.svelte       (数据集列表,按状态/标签/分类筛选)
│   ├── DatasetEditor.svelte     (数据集编辑器,选规则 + 参数配置)
│   │   ├── RulePicker.svelte    (规则选择器,带标签/分类筛选)
│   │   ├── ParamOverrideEditor.svelte (参数覆盖编辑器,JSON Patch)
│   │   └── DatasetStatusBadge.svelte  (状态徽标)
│   ├── DatasetPreview.svelte    (运行前预览,规则列表 + 检查)
│   └── DatasetActions.svelte    (操作按钮:测试/发布/复制/删除)
│
src/lib/views/Tags/
├── TagManager.svelte            (标签管理)
│   ├── TagList.svelte           (标签列表,颜色标记)
│   └── TagEditor.svelte         (标签编辑器,名称+颜色)
│
src/lib/views/Categories/
├── CategoryManager.svelte       (分类管理)
│   ├── CategoryTree.svelte      (分类树,可展开/折叠)
│   └── CategoryEditor.svelte    (分类编辑器,名称+父级+图标)
```

### 6.2 DatasetManager 组件树(L2 Workspace 内)

```
DatasetManager.svelte
├── 顶部工具栏
│   ├── [新建数据集] 按钮
│   ├── 筛选区:标签多选(AND/OR) + 分类树选择 + 搜索框
│   └── 状态筛选:全部/草稿/测试中/就绪/已发布
│
├── DatasetList(数据集卡片列表)
│   └── DatasetCard × N
│       ├── 名称 + 状态徽标(draft灰/testing黄/ready绿/published蓝)
│       ├── 描述(截断)
│       ├── 规则数 + 标签 chips + 分类路径
│       ├── 最后测试时间 + 发布版本
│       └── 操作按钮:[编辑] [测试] [发布] [复制] [删除]
│
└── DatasetEditor(编辑模式,右侧抽屉或全屏)
    ├── 基本信息区:名称 + 描述 + 标签 + 分类
    ├── RulePicker(规则选择区)
    │   ├── 左侧:筛选树(分类树 + 标签多选)
    │   ├── 中间:规则列表(checkbox 多选,已选高亮)
    │   └── 右侧:已选规则列表(可拖拽排序 + 参数覆盖)
    ├── ParamOverrideEditor(参数覆盖区,选中规则后展开)
    │   └── 业务表单(复用 P02 businessFormSchemaStore)
    └── DatasetPreview(运行前检查)
        ├── 规则完整性检查(是否有 syntax error)
        ├── 参数覆盖检查(JSON Patch 是否有效)
        └── 依赖检查(规则间是否有冲突)
```

### 6.3 DatasetActions 操作按钮(按状态显示)

| 当前状态 | 显示按钮 | 点击行为 |
| --- | --- | --- |
| draft | [测试] [编辑] [复制] [删除] | 测试→startTesting;编辑→打开 DatasetEditor |
| testing | [查看测试] [标记就绪] [回草稿] | 查看测试→跳 L3 沙盒;标记就绪→markReady |
| ready | [发布] [编辑] [回草稿] | 发布→publishDataset(需权限,跳 publish flow) |
| published | [查看运行时] [回草稿] | 查看运行时→跳 L1 监控大屏;回草稿→revertToDraft |

---

## 7. 数据流

### 7.1 创建数据集流

```
用户在 DatasetManager 点[新建数据集]
  ↓
打开空 DatasetEditor
  ↓
填写名称 + 描述 + 选标签 + 选分类
  ↓
RulePicker:从规则库选规则(可按标签/分类/搜索筛选)
  ↓ 选择 N 条规则
ruleIds = ["user.rule1", "user.rule2", ...]
  ↓
(可选)ParamOverrideEditor:配置参数覆盖
  ↓
DatasetPreview:运行前检查
  ↓ 检查通过
createDataset(name, description, ruleIds, tagIds, categoryId)
  ↓
datasetStore 更新 + localStorage 持久化
  ↓
新数据集状态 = draft,显示在 DatasetList
```

### 7.2 测试数据集流(L3 Sandbox)

```
用户在 DatasetCard 点[测试]
  ↓
dataset.status = draft → startTesting(id) → testing
  ↓
组装运行规则集:
  for each ruleId in dataset.ruleIds:
    rule = getAllRules().find(r => r.id === ruleId)
    if (paramOverride exists):
      rule = applyJsonPatch(rule, paramOverride.patch)
    ruleset.push(rule)
  ↓
调用内核 createSession() + submitCommand(ruleset)
  ↓ (或调 server fork API,见三层架构 §5 L3 Sandbox)
L3 Sandbox session 加载数据集规则 + 合成测试数据
  ↓
测试完成,查看测试报告
  ↓ 通过
markReady(id, now()) → ready
  ↓ 不通过
revertToDraft(id) → draft,修改规则后重测
```

### 7.3 发布数据集流(L2 → L1)

```
用户在 DatasetCard 点[发布](需三级权限中的"信息科/院领导")
  ↓
dataset.status = ready → publishDataset(id, newVersion) → published
  ↓
组装运行规则集(同 §7.2)
  ↓
调用三层架构 §3.3 滚动 session 热重载:
  1. POST /api/rules/reload(新规则集)
  2. POST /api/sessions/from/{old_session_id}(fork 新 session)
  3. 应用层切换 current_production_session_id
  4. POST /api/sessions/{old_id}/events SSE 推送 session_switched(U7)
  5. BLAKE3 审计链记录发布动作
  ↓
dataset.publishedVersion = newVersion
  ↓
L1 监控大屏收到 session_switched,自动切换到新 session
  ↓
发布完成,数据集状态 = published
```

### 7.4 标签/分类筛选规则流

```
用户在 RulePicker 左侧筛选区操作
  ↓
选择分类"诊疗 > 急诊"(含子分类)
  ↓ categoryId = "cat_emergency"
选择标签"紧急" + "高风险"(AND 模式)
  ↓ tagIds = ["tag_urgent", "tag_high_risk"], tagMode = "AND"
输入搜索"发烧"
  ↓ searchQuery = "发烧"
  ↓
filteredRules(filter) 派生计算
  ↓
中间规则列表只显示:
  - 分类是"急诊"或其子分类
  - AND 标签"紧急"且"高风险"
  - 名称/描述包含"发烧"
  ↓
用户 checkbox 选择规则,加入数据集
```

### 7.5 规则删除级联清理流

```
用户在业务规则库删除规则 R-042
  ↓
内核 deleteRule("user.R-042")
  ↓
console-cloud 层监听规则删除事件
  ↓
removeRuleFromAllDatasets("user.R-042")
  → 遍历所有数据集,从 ruleIds 中移除 "user.R-042"
  → 从 paramOverrides 中移除 ruleId = "user.R-042" 的覆盖
  ↓
removeTagFromRule("user.R-042", ...) (清理规则-标签关联)
  ↓
removeRuleCategory("user.R-042") (清理规则-分类关联)
  ↓
受影响数据集状态 published → revertToDraft(已发布规则变了,需重新测试)
  ↓
toast 提示"规则 R-042 已删除,3 个数据集受影响,已自动回退到草稿"
```

---

## 8. 关键代码示例

### 8.1 datasetStore 完整实现(核心部分)

```typescript
// src/lib/stores/dataset.ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project

import { writable, derived, get } from "svelte/store";
import { browser } from "$app/environment";
import type { Dataset, DatasetStatus, DatasetParamOverride } from "./dataset-types";
import type { JsonPatch } from "$lib/types/json-patch";

const STORAGE_KEY = "evorule-console-cloud:datasets";

function loadDatasets(): Dataset[] {
  if (!browser) return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Dataset[];
  } catch {
    return [];
  }
}

export const datasetStore = writable<Dataset[]>(loadDatasets());

datasetStore.subscribe((datasets) => {
  if (!browser) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(datasets));
});

function genId(): string {
  return `dataset_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// === CRUD ===

export function createDataset(
  name: string,
  description: string,
  ruleIds: string[],
  tagIds: string[] = [],
  categoryId: string | null = null,
): string {
  const id = genId();
  const now = new Date().toISOString();
  const dataset: Dataset = {
    id,
    name,
    description,
    ruleIds,
    paramOverrides: [],
    tagIds,
    categoryId,
    status: "draft",
    workspaceId: "default",
    createdAt: now,
    updatedAt: now,
    lastTestedAt: null,
    publishedVersion: null,
  };
  datasetStore.update((all) => [...all, dataset]);
  return id;
}

export function updateDataset(
  id: string,
  patch: Partial<Pick<Dataset, "name" | "description" | "ruleIds" | "paramOverrides" | "tagIds" | "categoryId">>,
): void {
  datasetStore.update((all) =>
    all.map((ds) =>
      ds.id === id
        ? { ...ds, ...patch, updatedAt: new Date().toISOString() }
        : ds,
    ),
  );
}

export function deleteDataset(id: string): void {
  datasetStore.update((all) => all.filter((ds) => ds.id !== id));
}

export function duplicateDataset(sourceId: string): string {
  const source = get(datasetStore).find((ds) => ds.id === sourceId);
  if (!source) throw new Error(`Dataset ${sourceId} not found`);

  const newId = genId();
  const now = new Date().toISOString();
  const copy: Dataset = {
    ...source,
    id: newId,
    name: `${source.name} (副本)`,
    status: "draft",
    createdAt: now,
    updatedAt: now,
    lastTestedAt: null,
    publishedVersion: null,
  };
  datasetStore.update((all) => [...all, copy]);
  return newId;
}

// === 状态机 ===

export function startTesting(id: string): void {
  datasetStore.update((all) =>
    all.map((ds) =>
      ds.id === id && ds.status === "draft"
        ? { ...ds, status: "testing" as DatasetStatus, updatedAt: new Date().toISOString() }
        : ds,
    ),
  );
}

export function markReady(id: string): void {
  const now = new Date().toISOString();
  datasetStore.update((all) =>
    all.map((ds) =>
      ds.id === id && ds.status === "testing"
        ? { ...ds, status: "ready" as DatasetStatus, lastTestedAt: now, updatedAt: now }
        : ds,
    ),
  );
}

export function publishDataset(id: string, publishedVersion: number): void {
  datasetStore.update((all) =>
    all.map((ds) =>
      ds.id === id && ds.status === "ready"
        ? { ...ds, status: "published" as DatasetStatus, publishedVersion, updatedAt: new Date().toISOString() }
        : ds,
    ),
  );
}

export function revertToDraft(id: string): void {
  datasetStore.update((all) =>
    all.map((ds) =>
      ds.id === id
        ? { ...ds, status: "draft" as DatasetStatus, updatedAt: new Date().toISOString() }
        : ds,
    ),
  );
}

// === 级联清理 ===

export function removeRuleFromAllDatasets(ruleId: string): string[] {
  const affectedIds: string[] = [];
  datasetStore.update((all) =>
    all.map((ds) => {
      if (!ds.ruleIds.includes(ruleId)) return ds;
      affectedIds.push(ds.id);
      return {
        ...ds,
        ruleIds: ds.ruleIds.filter((r) => r !== ruleId),
        paramOverrides: ds.paramOverrides.filter((p) => p.ruleId !== ruleId),
        // published 的数据集规则变了,回退到草稿
        status: ds.status === "published" ? ("draft" as DatasetStatus) : ds.status,
        updatedAt: new Date().toISOString(),
      };
    }),
  );
  return affectedIds;
}

// === 派生筛选 ===

export function datasetsByStatus(status: DatasetStatus) {
  return derived(datasetStore, ($d) => $d.filter((ds) => ds.status === status));
}

export function datasetsByTag(tagId: string) {
  return derived(datasetStore, ($d) => $d.filter((ds) => ds.tagIds.includes(tagId)));
}

export function datasetsByCategory(categoryId: string) {
  return derived(datasetStore, ($d) => $d.filter((ds) => ds.categoryId === categoryId));
}
```

### 8.2 数据集运行规则集组装(推入 Reactor)

```typescript
// src/lib/dataset/assemble-ruleset.ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project

import { getAllRules } from "@evorule/console";
import type { Dataset } from "$lib/stores/dataset-types";
import { applyJsonPatch } from "$lib/utils/json-patch";

/**
 * 组装数据集的运行规则集(应用参数覆盖后的规则 JSON 数组)
 * 用于推入 Reactor(L3 沙盒测试 or L1 发布)
 */
export function assembleRuleset(dataset: Dataset): string[] {
  const allRules = getAllRules();
  const ruleset: string[] = [];

  for (const ruleId of dataset.ruleIds) {
    const rule = allRules.find((r) => r.id === ruleId);
    if (!rule) {
      console.warn(`Dataset ${dataset.id}: rule ${ruleId} not found, skipped`);
      continue;
    }

    // 应用参数覆盖
    const override = dataset.paramOverrides.find((p) => p.ruleId === ruleId);
    if (override && override.patch.length > 0) {
      const patched = applyJsonPatch(rule.content, override.patch);
      ruleset.push(patched);
    } else {
      ruleset.push(rule.content);
    }
  }

  return ruleset;
}
```

### 8.3 JSON Patch 应用工具

```typescript
// src/lib/utils/json-patch.ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project

import type { JsonPatch } from "$lib/types/json-patch";

/**
 * 应用 JSON Patch 到 JSON 字符串(P0 支持 replace/add/remove)
 * 返回 patch 后的 JSON 字符串
 */
export function applyJsonPatch(jsonStr: string, patches: JsonPatch[]): string {
  const obj = JSON.parse(jsonStr);

  for (const patch of patches) {
    const keys = parsePointer(patch.path);
    let target = obj;

    // 导航到目标位置的父对象
    for (let i = 0; i < keys.length - 1; i++) {
      target = target[keys[i]];
    }

    const lastKey = keys[keys.length - 1];

    switch (patch.op) {
      case "replace":
        target[lastKey] = patch.value;
        break;
      case "add":
        if (Array.isArray(target)) {
          target.push(patch.value);
        } else {
          target[lastKey] = patch.value;
        }
        break;
      case "remove":
        if (Array.isArray(target)) {
          target.splice(Number(lastKey), 1);
        } else {
          delete target[lastKey];
        }
        break;
    }
  }

  return JSON.stringify(obj, null, 2);
}

/** 解析 JSON Pointer 路径(如 "/params/threshold" → ["params", "threshold"]) */
function parsePointer(pointer: string): string[] {
  return pointer.split("/").filter(Boolean);
}
```

### 8.4 分类树构建

```typescript
// src/lib/stores/category.ts(树形构建)

import { derived, get } from "svelte/store";
import type { Category } from "./category-types";

export interface CategoryNode extends Category {
  children: CategoryNode[];
}

/** 构建分类树(从扁平列表) */
function buildTree(categories: Category[]): CategoryNode[] {
  const map = new Map<string, CategoryNode>();
  const roots: CategoryNode[] = [];

  // 第一遍:创建所有节点
  for (const cat of categories) {
    map.set(cat.id, { ...cat, children: [] });
  }

  // 第二遍:建立父子关系
  for (const cat of categories) {
    const node = map.get(cat.id)!;
    if (cat.parentId === null) {
      roots.push(node);
    } else {
      const parent = map.get(cat.parentId);
      if (parent) {
        parent.children.push(node);
      } else {
        // 父分类不存在,作为根节点
        roots.push(node);
      }
    }
  }

  // 排序
  const sortTree = (nodes: CategoryNode[]) => {
    nodes.sort((a, b) => a.order - b.order);
    nodes.forEach((n) => sortTree(n.children));
  };
  sortTree(roots);

  return roots;
}

export const categoryTree = derived(categoryStore, ($cats) => buildTree($cats));

/** 获取分类及其所有子孙分类 ID(筛选用) */
export function getCategoryAndDescendants(categoryId: string): string[] {
  const all = get(categoryStore);
  const result = [categoryId];

  const findChildren = (parentId: string) => {
    all
      .filter((c) => c.parentId === parentId)
      .forEach((c) => {
        result.push(c.id);
        findChildren(c.id);
      });
  };

  findChildren(categoryId);
  return result;
}
```

### 8.5 DatasetManager.svelte(主视图)

```svelte
<!-- src/lib/views/Dataset/DatasetManager.svelte -->
<script lang="ts">
  import { get } from 'svelte/store';
  import { datasetStore, datasetsByStatus } from '$lib/stores/dataset';
  import { tagStore } from '$lib/stores/tag';
  import { categoryTree } from '$lib/stores/category';
  import DatasetCard from './DatasetCard.svelte';
  import DatasetEditor from './DatasetEditor.svelte';
  import DatasetFilter from './DatasetFilter.svelte';

  let showEditor = $state(false);
  let editingId = $state<string | null>(null);
  let statusFilter = $state<'all' | 'draft' | 'testing' | 'ready' | 'published'>('all');

  const visibleDatasets = $derived.by(() => {
    const all = get(datasetStore);
    if (statusFilter === 'all') return all;
    return all.filter((ds) => ds.status === statusFilter);
  });

  function handleNew(): void {
    editingId = null;
    showEditor = true;
  }

  function handleEdit(id: string): void {
    editingId = id;
    showEditor = true;
  }

  function handleCloseEditor(): void {
    showEditor = false;
    editingId = null;
  }
</script>

<div class="dataset-manager">
  <div class="toolbar">
    <h2>数据集管理</h2>
    <button onclick={handleNew}>+ 新建数据集</button>
    <DatasetFilter bind:statusFilter />
  </div>

  <div class="dataset-list">
    {#each visibleDatasets as dataset (dataset.id)}
      <DatasetCard
        {dataset}
        onEdit={() => handleEdit(dataset.id)}
      />
    {:else}
      <div class="empty-state">
        <p>暂无数据集</p>
        <button onclick={handleNew}>创建第一个数据集</button>
      </div>
    {/each}
  </div>
</div>

{#if showEditor}
  <DatasetEditor datasetId={editingId} onClose={handleCloseEditor} />
{/if}
```

---

## 9. 测试策略

### 9.1 单元测试(Vitest)

| 测试目标 | 测试文件 | 覆盖点 |
| --- | --- | --- |
| datasetStore CRUD | `dataset.test.ts` | create/update/delete/duplicate + 状态机 4 状态转换 + 级联清理 |
| tagStore | `tag.test.ts` | create/update/delete + 级联清理 ruleTagStore |
| categoryStore | `category.test.ts` | create/update/delete/move + 树形构建 + 子孙递归 |
| ruleTagStore | `rule-tag.test.ts` | add/remove + 双向索引 + AND/OR 筛选 |
| ruleCategoryStore | `rule-category.test.ts` | set/remove + 一对一覆盖 |
| filteredRules | `rule-filter.test.ts` | 标签+分类+搜索+来源 组合筛选 |
| assembleRuleset | `assemble-ruleset.test.ts` | 规则组装 + 参数覆盖 + 缺失规则跳过 |
| applyJsonPatch | `json-patch.test.ts` | replace/add/remove + 嵌套路径 + 数组 |

### 9.2 状态机测试

```typescript
// dataset-state-machine.test.ts
describe("Dataset 状态机", () => {
  it("draft → testing → ready → published", () => {
    const id = createDataset("测试集", "", ["r1"]);
    expect(getDataset(id).status).toBe("draft");

    startTesting(id);
    expect(getDataset(id).status).toBe("testing");

    markReady(id);
    expect(getDataset(id).status).toBe("ready");
    expect(getDataset(id).lastTestedAt).not.toBeNull();

    publishDataset(id, 1);
    expect(getDataset(id).status).toBe("published");
    expect(getDataset(id).publishedVersion).toBe(1);
  });

  it("published → draft(revertToDraft)", () => {
    // ... 先 publish,再 revert
  });

  it("非法状态转换被拒绝", () => {
    const id = createDataset("测试集", "", ["r1"]);
    // draft 不能直接 publish
    publishDataset(id, 1);
    expect(getDataset(id).status).toBe("draft"); // 状态不变
  });

  it("规则删除时 published 数据集自动回退到 draft", () => {
    const id = createDataset("测试集", "", ["r1"]);
    // 模拟发布
    startTesting(id); markReady(id); publishDataset(id, 1);
    expect(getDataset(id).status).toBe("published");

    // 删除规则
    const affected = removeRuleFromAllDatasets("r1");
    expect(affected).toContain(id);
    expect(getDataset(id).status).toBe("draft"); // 自动回退
  });
});
```

### 9.3 E2E 测试(Playwright)

| 测试路径 | 步骤 |
| --- | --- |
| 创建数据集 | 打开 DatasetManager → 新建 → 选规则 → 保存 → 验证列表显示 |
| 编辑数据集 | 选中数据集 → 编辑 → 增减规则 → 保存 → 验证规则数变化 |
| 测试数据集 | 选中 draft → 点测试 → 验证状态变 testing → 标记就绪 → 验证 ready |
| 发布数据集 | 选中 ready → 点发布 → 验证 published + L1 收到 session_switched |
| 标签管理 | 创建标签 → 关联规则 → 按标签筛选 → 验证筛选结果 |
| 分类管理 | 创建树形分类 → 归类规则 → 按分类筛选 → 验证含子分类 |
| 级联清理 | 删除被引用规则 → 验证数据集自动移除 + published 回退 draft |

---

## 10. 与其他文档的关系

### 10.1 与 P01 的关系

| P01 章节 | P0-3 扩展 |
| --- | --- |
| §3.4 ruleBusinessMetaStore | P0-3 tagStore/categoryStore 是业务元数据的扩展(行业/业务对象/术语 → 标签/分类) |
| §6.2 BusinessRuleLibrary | P0-3 在 BusinessRuleLibrary 加标签/分类筛选区 + "加入数据集"按钮 |
| §13 一致性更新 | P0-3 的 removeRuleFromAllDatasets 与 P01 的 deleteRule 联动 |
| §4.6.2 rules 表 status 字段 | P0-3 的数据集 status 与 rules 表 status 不同(数据集有独立状态机) |

### 10.2 与 P02 的关系

| P02 章节 | P0-3 扩展 |
| --- | --- |
| §4.3 businessFormSchemaStore | P0-3 ParamOverrideEditor 复用 P02 业务表单(schema 驱动参数覆盖编辑) |
| §4.4 业务预览 | P0-3 DatasetPreview 复用 P02 业务预览(数据集内规则的预览) |
| §6.2 BusinessRuleLibrary | P0-3 标签/分类筛选集成到 P02 BusinessRuleLibrary 的筛选区 |

### 10.3 与三层架构的关系

| 三层架构章节 | P0-3 对应 |
| --- | --- |
| §3.3 滚动 session 热重载 | P0-3 publishDataset 触发滚动 session 发布 |
| §4 Layer 2 Workspace | P0-3 DatasetManager 在 L2 Workspace 内 |
| §5 Layer 3 Sandbox | P0-3 startTesting 加载数据集到 L3 Sandbox |
| §6 应用层数据模型 | P0-3 datasets 表(待 P1 后端化时,见 §11) |
| §7 发布工作流 | P0-3 publishDataset 对应 §7 发布流程 |

### 10.4 与战略文档的关系

| 战略文档章节 | 本设计文档章节 |
| --- | --- |
| §20.2 P0-3 数据集组合 + 标签/分类 | §1-§10(全文) |
| §15.5 步骤 4 整理成数据集 | §3.3 数据集状态机 + §7.1 创建数据集流 |
| §15.5 步骤 5 导入到 evorule | §7.2 测试流 + §7.3 发布流 |

---

## 11. 长期演进路径

### 11.1 P0 → P1 后端化

| P0(localStorage) | P1+(后端 API) |
| --- | --- |
| datasetStore localStorage | `POST/GET/PUT/DELETE /api/datasets` |
| 标签/分类 localStorage | `POST/GET/PUT/DELETE /api/tags` / `/api/categories` |
| assembleRuleset 前端组装 | `POST /api/datasets/{id}/assemble` 后端组装 |
| 全推(addRule 逐条) | `POST /api/rules/batch` 批量推送 |

### 11.2 P0 → P1 workspace 集成

| P0(单 workspace) | P1+(多 workspace) |
| --- | --- |
| `workspaceId: "default"` | `workspaceId: workspace.id`(三层架构 L2) |
| 数据集在单 workspace 内管理 | 数据集绑定到 workspace,workspace 间隔离 |
| 无协作 | 数据集协作编辑 + 审批(P0-8) |

### 11.3 P2 高级特性

- 数据集版本历史(diff / 回滚到旧版)
- 数据集模板(行业预设数据集,如"心内科标准规则集")
- 数据集依赖图(可视化规则间依赖)
- 数据集 A/B 测试(同时跑两个数据集对比效果)

---

## 12. 代码变更列表

### 12.1 新增文件

| 文件 | 类型 | 说明 |
| --- | --- | --- |
| `src/lib/stores/dataset.ts` | Store | 数据集 CRUD + 状态机 |
| `src/lib/stores/dataset-types.ts` | Types | Dataset / DatasetStatus / DatasetParamOverride 类型 |
| `src/lib/stores/tag.ts` | Store | 标签 CRUD |
| `src/lib/stores/category.ts` | Store | 分类 CRUD + 树形构建 |
| `src/lib/stores/rule-tag.ts` | Store | 规则-标签关联(多对多) |
| `src/lib/stores/rule-category.ts` | Store | 规则-分类关联(一对一) |
| `src/lib/stores/rule-filter.ts` | Store | 组合筛选规则(标签+分类+搜索) |
| `src/lib/types/json-patch.ts` | Types | JsonPatch 类型 |
| `src/lib/utils/json-patch.ts` | Utils | JSON Patch 应用工具 |
| `src/lib/dataset/assemble-ruleset.ts` | Utils | 数据集规则集组装 |
| `src/lib/views/Dataset/DatasetManager.svelte` | Component | 数据集管理主视图 |
| `src/lib/views/Dataset/DatasetList.svelte` | Component | 数据集列表 |
| `src/lib/views/Dataset/DatasetCard.svelte` | Component | 数据集卡片 |
| `src/lib/views/Dataset/DatasetEditor.svelte` | Component | 数据集编辑器 |
| `src/lib/views/Dataset/RulePicker.svelte` | Component | 规则选择器(带筛选) |
| `src/lib/views/Dataset/ParamOverrideEditor.svelte` | Component | 参数覆盖编辑器 |
| `src/lib/views/Dataset/DatasetPreview.svelte` | Component | 运行前预览 |
| `src/lib/views/Dataset/DatasetActions.svelte` | Component | 操作按钮 |
| `src/lib/views/Dataset/DatasetStatusBadge.svelte` | Component | 状态徽标 |
| `src/lib/views/Tags/TagManager.svelte` | Component | 标签管理 |
| `src/lib/views/Categories/CategoryManager.svelte` | Component | 分类管理 |
| `src/lib/views/Categories/CategoryTree.svelte` | Component | 分类树组件 |

### 12.2 修改文件

| 文件 | 修改 |
| --- | --- |
| `src/lib/views/Home/WorkspaceConsole.svelte` | L2 编辑台加入 DatasetManager 入口 |
| P01 `BusinessRuleLibrary.svelte` | 加标签/分类筛选区 + "加入数据集"按钮 |

---

## 13. 待办

- [ ] 后端 `POST /api/rules/batch` 批量推送 API(P1,server 工作)
- [ ] 数据集后端化 `POST/GET/PUT/DELETE /api/datasets`(P1)
- [ ] 数据集版本历史(P2)
- [ ] 数据集模板 / 行业预设(P2)
- [ ] 数据集依赖图可视化(P2)

---

> 设计文档 — 2026-08-06 定稿
