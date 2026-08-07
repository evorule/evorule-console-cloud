# P0-2 业务语言层 v0 详细设计(业务术语库 + 业务表单 + 业务预览深化)

> **状态**:设计文档,2026-08-06 定稿(2026-08-06 同步三层架构 U6/U7)。本文档是 P0-1 `P01_BUILD_SCHEMA_DESIGN.md §3.3 业务语言层 = 3 子层 + 1 派生层` 的深化版,目标 v0(可发布给业务专家试用)。
>
> **定位**:把 P01 已设计的业务语言层骨架(业务术语库 / 业务表单 schema / 业务预览)从"基础可用"推进到"业务专家独立完成规则 CRUD + 试运行 + 自检"的 v0 状态,作为 P0-2 实施依据。
>
> **关联**:
>
> - 基础设计:`D:\evorule-console-cloud\docs\P01_BUILD_SCHEMA_DESIGN.md`(§3.3 / §4.3 / §4.4 / §4.5 / §6.2 / §6.4 / §11.1 / §11.3 / §7.1 / §7.2)
> - 首页设计:`D:\evorule-console-cloud\docs\HOME_DESIGN.md`(§5.3 OnboardingWizard Step 3 调用业务语言层)
> - 三层运行架构:`D:\evorule-doc-center\shared\draft\evorule-three-layer-architecture.md`(L2 编辑台 + L1 监控大屏业务语言显示,§1.7 + §4.5 + §6.6)
> - 战略依据:`D:\evorule-doc-center\shared\final\b2b2c-strategy.md §5.8 + §20.x`
> - 内核 API:`@evorule/console`(`rules` store / `RuleValidator` / `AssistantProvider`)
> - 现有代码:`src/lib/assistant/cloud-llm-assistant.ts`(LLM 三方法实现)
> - 现有代码:`src/lib/stores/db.ts`(派生 `isEmptyDb` / `ruleCount`)

---

## 1. 背景与动机

### 1.1 P0-1 业务语言层基础(已设计)

P0-1 §3.3 把业务语言层定为"3 子层 + 1 派生层":

| 子层            | Store                     | P0-1 已设计内容                                       | v0 待深化                                       |
| --------------- | ------------------------- | ----------------------------------------------------- | ----------------------------------------------- |
| 业务术语库      | `businessTermsStore`      | 6 条 builtin 术语(2 行业)+ CRUD + 同义词数组          | 同义词匹配算法 / 术语推荐 / 版本演进 / 冲突检测 |
| 业务表单 schema | `businessFormSchemaStore` | 2 条 builtin schema + 字段类型 + `evorulePath` 映射   | 字段联动 / 复合条件 / 动态 schema / 双层校验    |
| 业务预览        | (派生,无独立 store)       | `CloudLlmAssistant.explainRule(rule)` 调用 + 文本展示 | 结构化解释 / 对比 diff / 缓存 / LLM 不可用降级  |
| 业务元数据扩展  | `ruleBusinessMetaStore`   | `Map<ruleId, BusinessMeta>`                           | 与术语库联动(术语引用解析)/ 自动补全元数据      |

### 1.2 v0 阶段定位(战略层)

**战略文档 §5.8.1 + §20.2**:业务专家 5 分钟跑通建库向导 + 30 秒看懂一条规则。

P0-1 是"骨架可用"(LLM 出草案 → 校验 → 保存),v0 要解决 3 个真实使用障碍:

| 障碍                              | P0-1 状态                      | v0 目标                                     |
| --------------------------------- | ------------------------------ | ------------------------------------------- |
| 业务专家不懂 JSON,改不动 LLM 草案 | LLM 失败时只能放弃             | 业务表单完整可编辑,LLM 草案可反向解析回表单 |
| 业务预览只是一段文字,无法核对     | `explainRule` 返回纯文本       | 结构化"如果 X 则 Y"+ 术语高亮 + 对比 diff   |
| LLM 未配置 / 失败时业务专家没法用 | StepFirstRule 报错"LLM 未配置" | 业务表单模式独立可用 + 本地降级解释器       |

### 1.3 v0 不解决的问题(明确边界)

- ❌ 不实现 10 行业浅模板(P1,见战略 §20.5)
- ❌ 不实现多语言(中英文, P2)
- ❌ 不实现规则版本树 / 时间旅行编辑(P2)
- ❌ 不实现规则审批流(P2)
- ❌ 不实现规则复用 / 跨库共享(P3)
- ❌ 不实现业务术语的 NLP 自动提取(P3,需 LLM fine-tune)
- ❌ 不修改内核 `Rule` 类型 / `RuleValidator`(P0-1 §3.4 已定边界)

### 1.4 与 P0-1 的关系

| P0-1 章节                            | 本文档深化章节                            |
| ------------------------------------ | ----------------------------------------- |
| §3.3 业务语言层 = 3 子层 + 1 派生层  | §3 关键架构决策(v0 深化点)                |
| §4.3 BusinessTerm 类型               | §4.1 BusinessTerm v0 扩展字段             |
| §4.4 BusinessFormSchema 类型         | §4.2 BusinessFormSchema v0 扩展字段       |
| §4.5 RuleBusinessMeta 类型           | §4.3 RuleBusinessMeta v0 联动设计         |
| §6.2 BusinessRuleLibrary 组件树      | §6.1 BusinessRuleLibrary v0 组件树(增强)  |
| §6.4 StepFirstRule 组件树            | §6.2 StepFirstRule v0 组件树(双模式增强)  |
| §7.1 BUILTIN_BUSINESS_TERMS(6 条)    | §7.1 BUILTIN_BUSINESS_TERMS v0(12 条)     |
| §7.2 BUILTIN_FORM_SCHEMAS(2 条)      | §7.2 BUILTIN_FORM_SCHEMAS v0(4 条)        |
| §11.1 StepFirstRule 代码示例         | §9.1 StepFirstRule v0 代码(双模式 + 反向) |
| §11.3 formValuesToEvoruleJson 转换器 | §9.3 表单 ↔ JSON 双向转换器(含 branch)    |

### 1.5 内核已有能力(关键发现,P0-1 §1.3 复述)

```typescript
// 复用内核,不重新发明
import {
  rules, // Writable<Rule[]>
  selectedRuleId,
  selectedRule, // 派生选中规则
  addRule,
  updateRule,
  deleteRule,
  duplicateRule, // CRUD
  importRule,
  exportRule, // JSON 导入导出
  RuleValidator, // 7 门禁预校验
  type Rule,
  type ValidationResult,
  useAssistantOrNull, // 内核 LLM 扩展槽
  sessions,
  currentSessionId, // session store
  createSession,
  submitCommand, // 执行 API
} from "@evorule/console";
```

**v0 关键约束**:业务语言层是 console-cloud 层的概念,内核不感知。所有 v0 深化都在 `src/lib/` 下完成,不修改 `node_modules/@evorule/console`。

### 1.6 与战略文档 / HOME_DESIGN.md 的关系

| 战略文档 / HOME_DESIGN.md 章节            | 本文档对应章节                              |
| ----------------------------------------- | ------------------------------------------- |
| 战略 §5.8.3 状态 C 真实工作台(规则库区域) | §6.1 BusinessRuleLibrary v0 组件树          |
| 战略 §5.8.5 状态 B 建库向导 Step 3        | §6.2 StepFirstRule v0 组件树 + §9.1 代码    |
| HOME_DESIGN §5.3 OnboardingWizard Step 3  | §6.2 StepFirstRule v0(双模式 + 反向解析)    |
| HOME_DESIGN §5.3 OnboardingWizard Step 4  | §6.3 StepTrialRun v0(业务事件表单 → JSON)   |
| HOME_DESIGN §5.4 RealWorkbench 规则数卡   | §6.1 BusinessRuleLibrary v0(派生 ruleCount) |

### 1.7 与三层运行架构的关系(2026-08-06 同步)

`evorule-three-layer-architecture.md` 将状态 C(真实工作台)拆为 **L1 监控大屏**(Production Runtime,消费 SSE 实时 Fact 流)与 **L2 编辑台**(Workspace,规则编辑 / 沙盒入口)两个层视图(详见 HOME_DESIGN.md §3.1 层感知升级)。业务语言层在两层中的职责:

| 层视图                | 业务语言层职责                                                              | 本文档章节                      |
| --------------------- | --------------------------------------------------------------------------- | ------------------------------- |
| **L2 编辑台**(主)     | 业务术语库 + 业务表单 + 业务预览,支撑业务专家规则 CRUD + 试运行             | §4.1-§4.4 + §6.1-§6.5 + §9 全部 |
| **L1 监控大屏**(复用) | 用业务语言显示实时 Fact 流(业务术语高亮 + 触发规则的结构化预览),非 raw JSON | §4.5 + §6.6(本次同步新增)       |

**关键设计**:

- **L2 是业务语言层的主战场**:BusinessRuleLibrary / StepFirstRule / StepTrialRun / BusinessForm / BusinessTermManager 全部在 L2 编辑台渲染
- **L1 复用而非重写**:L1 监控大屏的 FactStreamView 复用 L2 的 `businessTermsStore`(术语高亮)与 `BusinessPreview`(结构化预览),不引入新的业务语言子层
- **层切换不丢上下文**:HOME_DESIGN.md §3.3 层视图切换矩阵保证 L1↔L2 切换时 SSE 后台保持订阅(L1→L2)或恢复订阅(L2→L1),业务语言层状态(store)跨层共享

---

## 2. 目标与非目标

### 2.1 目标

- ✅ 业务术语库 v0:12 条 builtin(2 行业 × 6 术语)+ 同义词匹配 + CRUD + 冲突检测
- ✅ 业务表单 v0:4 条 builtin schema(2 行业 × 2 场景)+ 字段联动 + 复合条件 + 动态 schema
- ✅ 业务预览 v0:结构化"如果 X 则 Y"+ 术语高亮 + LLM 缓存 + LLM 不可用降级
- ✅ 表单 ↔ JSON 双向转换器(含 branch / io_request / 多 condition)
- ✅ LLM 草案 → 业务表单反向解析(LLM 失败也能编辑)
- ✅ 双模式切换(LLM 辅助 / 业务表单)+ 模板预填
- ✅ **L1 监控大屏业务语言显示**(三层架构同步):FactBusinessDisplay + FactStreamView,用业务术语高亮 + 结构化预览展示实时 Fact 流(§4.5 + §6.6)
- ✅ 单元测试覆盖转换器 / 同义词匹配 / 字段联动 / 降级解释器(Vitest)
- ✅ E2E 测试覆盖业务专家 5 分钟建库向导(Playwright)
- ✅ 延续 SvelteKit + Svelte 5 runes + `provideXxx` 注入模式
- ✅ adapter-static 兼容(纯静态部署,无 SSR)

### 2.2 非目标

- ❌ 不实现后端 API(本文档只设计前端调用接口,后端 API 由 evorule-server 提供)
- ❌ 不修改内核 `Rule` 类型 / `RuleValidator` / 视图组件
- ❌ 不实现多语言 / i18n / a11y(P1/P2)
- ❌ 不实现规则版本树 / 时间旅行编辑(P2)
- ❌ 不实现规则审批流 / 复用 / 共享(P2/P3)
- ❌ 不引入新的状态管理库(延续 Svelte writable store)
- ❌ 不引入 JSON Schema 标准库(用自定义轻量 schema,见 §3.4 决策)
- ❌ 不实现 NLP 自动术语提取(P3)
- ❌ 不实现规则语义比对(P2,需内核支持)

---

## 3. 关键架构决策

### 3.1 决策 1:业务术语同义词匹配用"归一化 + 前缀索引",不引入全文检索

**决策**:同义词匹配用 `normalize(术语) → 前缀索引`,不引入 Fuse.js / FlexSearch 等全文检索库。

**实现**:

- `normalize(s)`:小写 + 去标点 + 全角半角统一 + 空格归一
- 启动时构建 `Map<normalizedSynonym, termId>` 索引
- 查询:`用户输入 → normalize → 前缀匹配索引 → 命中术语列表`
- 多个命中时按 `industry` 过滤(取当前库 `dbStore.industry` 优先)

**理由**:

1. builtin 术语 ≤ 100 条(P0 v0 阶段),全文检索是大材小用
2. Svelte store 启动时一次性构建索引,O(1) 查询
3. 无运行时依赖,adapter-static 部署友好
4. 中文场景下前缀匹配 + 同义词数组已足够(无词干问题)

**取舍**:

- ✅ 实现简单,无依赖
- ✅ 中文友好(中文无词干,前缀匹配自然)
- ❌ 拼写错误容忍差(P1 可加 Levenshtein 距离,P0 v0 不做)

### 3.2 决策 2:业务表单字段联动用 `visibleWhen / enabledWhen / requiredWhen`,不引入 JSON Schema 标准

**决策**:在 `BusinessFormField` 上加 `visibleWhen` / `enabledWhen` / `requiredWhen` 三个条件表达式字段,不引入 JSON Schema(`if/then/oneOf`)标准。

**实现**:

```typescript
interface FieldCondition {
  fieldId: string; // 依赖的字段
  operator: "eq" | "ne" | "gt" | "lt" | "in" | "exists";
  value?: string | number | boolean | string[];
}

interface BusinessFormField {
  // ... P0-1 已有字段
  visibleWhen?: FieldCondition[]; // AND 关系(全满足才显示)
  enabledWhen?: FieldCondition[];
  requiredWhen?: FieldCondition[];
}
```

**联动求值器**:

```typescript
function evalCondition(cond: FieldCondition, values: FormValues): boolean {
  const v = values[cond.fieldId];
  switch (cond.operator) {
    case "eq":
      return v === cond.value;
    case "ne":
      return v !== cond.value;
    case "gt":
      return Number(v) > Number(cond.value);
    case "lt":
      return Number(v) < Number(cond.value);
    case "in":
      return Array.isArray(cond.value) && cond.value.includes(String(v));
    case "exists":
      return v !== undefined && v !== "" && v !== null;
  }
}
```

**理由**:

1. JSON Schema 标准过重,业务专家读不懂
2. 自定义 6 操作符覆盖 v0 全部联动需求(eq/ne/gt/lt/in/exists)
3. 求值器 < 30 行,无依赖,易测试
4. 复杂联动(嵌套条件 / OR 关系)留 P1 扩展(用 `anyOf` 字段)

**取舍**:

- ✅ 简单直观,业务专家可读
- ✅ 求值器 < 30 行
- ❌ 不支持 OR 关系(P0 v0 用多条 schema 拆分替代,见 §7.2)
- ❌ 不支持嵌套条件(P1 加 `anyOf` / `allOf` 组合器)

### 3.3 决策 3:复合条件用 `ConditionGroup`,不引入 AST

**决策**:复合条件(AND / OR / NOT)用扁平的 `ConditionGroup` 结构,不引入 AST(抽象语法树)。

**实现**:

```typescript
interface ConditionGroup {
  combinator: "and" | "or" | "not";
  conditions: (FieldCondition | ConditionGroup)[];
}
```

业务表单渲染时,把 `ConditionGroup` 渲染成"组卡片"(AND / OR 徽标 + 内嵌字段),用户可视化编辑。

**理由**:

1. AST 对业务专家不友好(看不懂)
2. 扁平 `ConditionGroup` + combinator 字段足够 v0
3. P1 升级到 AST 不破坏数据模型(`ConditionGroup` 是 AST 的子集)

### 3.4 决策 4:业务表单 schema 自定义,不引入 JSON Schema / Formily 标准

**决策**:沿用 P0-1 自定义 `BusinessFormSchema`(不引入 AJV / Formily / React Schema Form 等标准)。

**理由**:

1. P0-1 §4.4 已定调,不重复决策
2. JSON Schema 标准过重(`$ref` / `oneOf` / `allOf` / `if-then-else`),业务专家读不懂
3. Formily 是 React 生态,与 Svelte 不兼容
4. 自定义 schema 直接对应 evorule JSON 字段路径(`evorulePath`),转换器简单
5. v0 内置 schema ≤ 10 条,标准化的收益低于学习成本

**取舍**:

- ✅ 内核 `RuleValidator` 仍是权威门禁,业务表单 schema 只是 UX
- ✅ 无依赖,adapter-static 部署友好
- ❌ 不能直接复用社区 schema 生态(P3 可加 JSON Schema 导入器)

### 3.5 决策 5:业务预览结构化为"如果 X 则 Y",不只用 LLM 自然语言

**决策**:业务预览有两层:

1. **结构化层**(本地计算,无需 LLM):根据 evorule JSON 的 `condition` + `action` 字段,模板化拼装"如果 [条件] 则 [动作]"
2. **自然语言层**(LLM 调用,可选):`CloudLlmAssistant.explainRule(rule)` 生成更自然的解释

**实现**:

```typescript
interface StructuredExplanation {
  ifPart: string; // "金额 > 10000 元"
  thenPart: string; // "通知 CFO 审批"
  elsePart?: string; // "直接通过"(若有 else 分支)
  terms: BusinessTerm[]; // 涉及的业务术语(用于高亮)
}

function explainStructured(
  ruleJson: object,
  terms: BusinessTerm[],
): StructuredExplanation {
  // 本地模板化拼装,无 LLM 调用
  // 详见 §9.4
}
```

**理由**:

1. 结构化层 100% 确定性(无 LLM 也能用)
2. 业务专家看"如果 X 则 Y"比看 LLM 一段话更易核对
3. 自然语言层是锦上添花(LLM 配置好时显示在结构化层下方)
4. LLM 不可用 / 失败时,结构化层独立可用(决策 §1.2 v0 目标)

### 3.6 决策 6:LLM 解释结果缓存到 localStorage,带 schema hash 失效

**决策**:LLM `explainRule` 结果缓存到 localStorage,key = `ruleId + contentHash`,规则 `content` 变化时自动失效。

**实现**:

```typescript
// 缓存 key 格式:evorule-console-cloud:rule-explain:${ruleId}:${sha256(content).slice(0,16)}
// 命中:直接返回缓存
// 未命中:调 LLM,成功后写缓存
// content 变化 → contentHash 变化 → 缓存自动失效(旧 key 留在 localStorage,P1 清理)
```

**理由**:

1. LLM 调用成本高(网络 + token),重复 explainRule 浪费
2. 业务专家反复看同一条规则时,缓存命中 100%
3. contentHash 失效简单可靠(规则改了缓存自然失效)
4. localStorage 容量足够(单条解释 ~1KB,1000 条 = 1MB,远低于 localStorage 5MB 上限)

**取舍**:

- ✅ 命中率 99%+,大幅降低 LLM 调用
- ❌ 旧 contentHash 的缓存条目不会自动清理(P1 加 LRU 清理,P0 v0 不做)

### 3.7 决策 7:LLM 草案 → 业务表单反向解析用"字段路径反向映射"

**决策**:LLM 生成的 evorule JSON 草案,用 `BusinessFormField.evorulePath` 反向映射回表单值,填入 BusinessForm。

**实现**:

```typescript
function evoruleJsonToFormValues(
  schema: BusinessFormSchema,
  ruleJson: object,
): FormValues {
  const values: FormValues = {};
  for (const field of schema.fields) {
    const v = getPath(ruleJson, field.evorulePath);
    if (v !== undefined) values[field.id] = v;
  }
  return values;
}
```

**理由**:

1. 业务专家看不懂 JSON,但能看懂表单
2. LLM 草案 confidence 低时,业务专家在表单里改一字段即可,不用碰 JSON
3. 反向解析器 < 30 行,与正向转换器对称(§9.3)

**取舍**:

- ✅ LLM 失败也能编辑(决策 §1.2 v0 目标)
- ✅ 与正向转换器对称,易测试
- ❌ LLM 草案若用了 schema 没定义的字段,反向解析会丢字段(降级为 raw JSON 编辑,提示用户)

### 3.8 决策 8:业务术语版本演进用 `status` 字段,不删术语

**决策**:术语版本演进(重命名 / 弃用)用 `status: 'draft' | 'active' | 'deprecated'` 字段,不物理删除。

**实现**:

- `draft`:草稿,UI 不显示在筛选栏(只有术语管理器可见)
- `active`:激活,UI 正常显示
- `deprecated`:弃用,UI 灰显 + 提示"已弃用,建议用 X"
- 已被规则引用的术语不能改 `key`(只能改 `label` / `synonyms`)

**理由**:

1. 术语被规则引用后,改 `key` 会破坏 `ruleBusinessMeta.businessTermIds` 关联
2. 弃用而非删除,保证历史规则的业务元数据可读
3. P1 升级到术语版本树(`term.versions[]`)时,`status` 是天然的状态字段

### 3.9 决策 9:业务预览对比 diff 用"结构化字段对比",不引入 deep-diff 库

**决策**:规则修改前后对比,逐字段对比 `StructuredExplanation` + `ruleJson` 关键字段,不引入 deep-diff 库。

**实现**:

```typescript
interface RuleDiff {
  changedFields: Array<{
    field: string; // "condition.value" / "action.params.role"
    oldValue: unknown;
    newValue: unknown;
    businessImpact: string; // "审批阈值从 10000 改为 20000"
  }>;
  addedFields: string[];
  removedFields: string[];
}
```

**理由**:

1. 规则字段是扁平的(`condition.value` / `action.params.role`),不需要 deep-diff
2. `businessImpact` 字段让业务专家看懂"改了什么影响"(用术语库翻译)
3. deep-diff 库 ~10KB,adapter-static 包体积敏感

### 3.10 决策 10:业务表单 schema 按 `businessObject` 动态选择

**决策**:建库向导 Step 3 / 工作台规则库,根据 Step 2 选的 `businessObject`(病人 / 案件 / 订单)动态筛选可用 schema。

**实现**:

```typescript
interface BusinessFormSchema {
  // ... P0-1 已有字段
  businessObjects?: string[]; // 适用的业务对象列表,空 = 全部适用
}

function getSchemasByBusinessObject(
  businessObject: string,
  industry: string,
): BusinessFormSchema[] {
  return get(businessFormSchemaStore).filter(
    (s) =>
      s.industry === industry &&
      (!s.businessObjects || s.businessObjects.includes(businessObject)),
  );
}
```

**理由**:

1. 同一行业不同业务对象(病人 vs 报销单)的 schema 差异大
2. 动态筛选让业务专家只看到与自己业务对象相关的 schema
3. `businessObjects` 可选(空 = 全部适用),兼容 P0-1 已有 schema

---

## 4. 数据模型(v0 扩展)

### 4.1 BusinessTerm v0 扩展(P0-1 §4.3 基础上)

```typescript
// src/lib/stores/business-terms.ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 业务术语库 store(v0)。
// P0-1 基础:6 条 builtin + CRUD + synonyms 数组
// v0 扩展:status / aliases / relatedTermIds / evorulePaths / deprecatedBy
//
// 持久化:localStorage(key: evorule-console-cloud:business-terms:user)
//   - builtin(代码内置,12 条起步)+ user(用户自定义)

import { writable, derived, get } from "svelte/store";
import { browser } from "$app/environment";
import { BUILTIN_BUSINESS_TERMS } from "$lib/data/business-terms-builtin";
import { dbStore } from "$lib/stores/db";

export type TermStatus = "draft" | "active" | "deprecated";

export interface BusinessTerm {
  /** 术语 ID,如 'finance.amount' */
  id: string;
  /** 行业:finance / compliance / medical / legal / ... */
  industry: string;
  /** 中文标签 */
  label: string;
  /** 英文 key(对应 evorule JSON 字段) */
  key: string;
  /** 主同义词数组(用于业务语言筛选 + 匹配) */
  synonyms: string[];
  /** 别名(更广的匹配范围,如缩写 / 旧名,P1 扩展用) */
  aliases?: string[];
  /** 业务解释(LLM 解释时用作上下文) */
  description: string;
  /** v0 新增:状态 */
  status: TermStatus;
  /** v0 新增:关联术语 ID(同义词跨行业时关联,如 finance.amount ↔ compliance.evidence_amount) */
  relatedTermIds?: string[];
  /** v0 新增:对应 evorule JSON 路径列表(一个术语可对应多个 path,如 condition.value / action.params.amount) */
  evorulePaths?: string[];
  /** v0 新增:弃用时指向替代术语 ID */
  deprecatedBy?: string;
  /** v0 新增:版本号(从 1 开始,改 key 时 +1,旧版本仍可查询) */
  version: number;
  /** v0 新增:创建时间(用户术语用) */
  createdAt?: string;
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

// 持久化(只存 user 术语,builtin 不存)
businessTermsStore.subscribe((terms) => {
  if (!browser) return;
  const userTerms = terms.filter(
    (t) => !BUILTIN_BUSINESS_TERMS.find((b) => b.id === t.id),
  );
  localStorage.setItem(STORAGE_KEY, JSON.stringify(userTerms));
});

// === v0 新增:派生 store ===

/** 当前行业激活术语(过滤 draft / deprecated) */
export const activeTermsByIndustry = derived(
  [businessTermsStore, dbStore],
  ([$terms, $db]) =>
    $terms.filter((t) => t.industry === $db.industry && t.status === "active"),
);

/** 同义词归一化索引(启动时构建) */
const normalize = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, "")
    .replace(/\s+/g, " ")
    .trim();

let synonymIndex: Map<string, string[]> = new Map(); // normalizedSynonym -> termId[]

function rebuildIndex(): void {
  synonymIndex = new Map();
  const all = get(businessTermsStore);
  for (const term of all) {
    if (term.status === "draft") continue;
    const candidates = [term.label, ...term.synonyms, ...(term.aliases ?? [])];
    for (const cand of candidates) {
      const norm = normalize(cand);
      if (!norm) continue;
      const existing = synonymIndex.get(norm) ?? [];
      // 前缀索引:存前 1/2/3/... 字符
      for (let i = 1; i <= norm.length; i++) {
        const prefix = norm.slice(0, i);
        const e = synonymIndex.get(prefix) ?? [];
        if (!e.includes(term.id)) e.push(term.id);
        synonymIndex.set(prefix, e);
      }
      if (!existing.includes(term.id)) existing.push(term.id);
      synonymIndex.set(norm, existing);
    }
  }
}

// 启动时构建
if (browser) rebuildIndex();

// === 便捷函数 ===

/** v0 新增:按行业查询激活术语 */
export function getActiveTermsByIndustry(industry: string): BusinessTerm[] {
  return get(businessTermsStore).filter(
    (t) => t.industry === industry && t.status === "active",
  );
}

/** v0 新增:同义词前缀匹配(返回 termId 列表,带行业优先级) */
export function matchTerms(
  query: string,
  industry?: string,
  limit = 10,
): BusinessTerm[] {
  if (!query.trim()) return [];
  const norm = normalize(query);
  const termIds = synonymIndex.get(norm) ?? [];
  const all = get(businessTermsStore);
  const terms = termIds
    .map((id) => all.find((t) => t.id === id))
    .filter((t): t is BusinessTerm => t !== undefined && t.status !== "draft");

  // 行业优先级:当前行业优先,其他行业靠后
  const targetIndustry = industry ?? get(dbStore).industry;
  const sorted = terms.sort((a, b) => {
    const aMatch = a.industry === targetIndustry ? 0 : 1;
    const bMatch = b.industry === targetIndustry ? 0 : 1;
    return aMatch - bMatch;
  });

  return sorted.slice(0, limit);
}

/** v0 新增:CRUD(扩展 P0-1) */
export function addBusinessTerm(
  term: Omit<BusinessTerm, "id" | "version">,
): string {
  // 校验:同 industry + 同 key 不能重复
  const existing = get(businessTermsStore).find(
    (t) => t.industry === term.industry && t.key === term.key,
  );
  if (existing) {
    throw new Error(`术语已存在: ${term.industry}.${term.key}`);
  }
  const id = `${term.industry}.${term.key}`;
  businessTermsStore.update((list) => [
    ...list,
    { ...term, id, version: 1, createdAt: new Date().toISOString() },
  ]);
  rebuildIndex();
  return id;
}

export function updateBusinessTerm(
  id: string,
  patch: Partial<BusinessTerm>,
): void {
  businessTermsStore.update((list) =>
    list.map((t) => {
      if (t.id !== id) return t;
      // key 不能改(被规则引用会破坏关联)
      if (patch.key && patch.key !== t.key) {
        throw new Error("术语 key 不能修改,请新建术语并弃用旧的");
      }
      return { ...t, ...patch, version: t.version + 1 };
    }),
  );
  rebuildIndex();
}

/** v0 新增:弃用术语(不删除,标记 status + deprecatedBy) */
export function deprecateBusinessTerm(id: string, deprecatedBy?: string): void {
  businessTermsStore.update((list) =>
    list.map((t) =>
      t.id === id
        ? { ...t, status: "deprecated", deprecatedBy, version: t.version + 1 }
        : t,
    ),
  );
  rebuildIndex();
}
```

### 4.2 BusinessFormSchema v0 扩展(P0-1 §4.4 基础上)

```typescript
// src/lib/stores/business-form-schema.ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 业务表单 schema store(v0)。
// P0-1 基础:2 条 builtin + 字段类型 + evorulePath 映射
// v0 扩展:visibleWhen / enabledWhen / requiredWhen / ConditionGroup / businessObjects / validators
//
// 持久化:localStorage(key: evorule-console-cloud:business-form-schema:user)

import { writable, get } from "svelte/store";
import { browser } from "$app/environment";
import { BUILTIN_FORM_SCHEMAS } from "$lib/data/business-form-schemas-builtin";

export type FormFieldType = "number" | "string" | "date" | "enum" | "boolean";

/** v0 新增:字段条件(决策 §3.2) */
export interface FieldCondition {
  /** 依赖的字段 ID */
  fieldId: string;
  /** 操作符 */
  operator: "eq" | "ne" | "gt" | "lt" | "in" | "exists";
  /** 比较值(eq/ne/gt/lt/in 用) */
  value?: string | number | boolean | string[];
}

/** v0 新增:复合条件组(决策 §3.3) */
export interface ConditionGroup {
  combinator: "and" | "or" | "not";
  conditions: (FieldCondition | ConditionGroup)[];
}

/** v0 新增:业务层校验规则(独立于内核 RuleValidator) */
export interface FieldValidator {
  type: "required" | "min" | "max" | "pattern" | "custom";
  /** min/max 用,pattern 用正则字符串 */
  param?: string | number;
  /** 失败提示 */
  message: string;
}

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
  /** v0 新增:可见条件(全满足才显示) */
  visibleWhen?: FieldCondition[];
  /** v0 新增:启用条件(全满足才可编辑) */
  enabledWhen?: FieldCondition[];
  /** v0 新增:必填条件(全满足才必填) */
  requiredWhen?: FieldCondition[];
  /** v0 新增:业务层校验规则 */
  validators?: FieldValidator[];
  /** v0 新增:关联术语 ID(用于业务预览术语高亮) */
  termId?: string;
  /** v0 新增:字段分组(用于 UI 折叠"条件组" / "动作组") */
  group?: "condition" | "action" | "metadata";
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
  /** v0 新增:适用的业务对象列表(空 = 全部适用,决策 §3.10) */
  businessObjects?: string[];
  /** v0 新增:复合条件组(用于 evorule JSON 的 branch 嵌套,见 §9.3) */
  conditionGroups?: ConditionGroup[];
  /** v0 新增:版本号 */
  version: number;
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

businessFormSchemaStore.subscribe((schemas) => {
  if (!browser) return;
  const userSchemas = schemas.filter(
    (s) => !BUILTIN_FORM_SCHEMAS.find((b) => b.id === s.id),
  );
  localStorage.setItem(STORAGE_KEY, JSON.stringify(userSchemas));
});

// === 便捷函数 ===

/** v0 新增:按行业 + 业务对象查询 schema(决策 §3.10) */
export function getSchemasByBusinessObject(
  businessObject: string,
  industry: string,
): BusinessFormSchema[] {
  return get(businessFormSchemaStore).filter(
    (s) =>
      s.industry === industry &&
      (!s.businessObjects || s.businessObjects.includes(businessObject)),
  );
}

/** v0 新增:按 schema ID 查询 */
export function getSchemaById(id: string): BusinessFormSchema | null {
  return get(businessFormSchemaStore).find((s) => s.id === id) ?? null;
}

/** v0 新增:CRUD(扩展 P0-1) */
export function addBusinessFormSchema(
  schema: Omit<BusinessFormSchema, "version">,
): string {
  businessFormSchemaStore.update((list) => [
    ...list,
    { ...schema, version: 1 },
  ]);
  return schema.id;
}

export function updateBusinessFormSchema(
  id: string,
  patch: Partial<BusinessFormSchema>,
): void {
  businessFormSchemaStore.update((list) =>
    list.map((s) =>
      s.id === id ? { ...s, ...patch, version: s.version + 1 } : s,
    ),
  );
}
```

### 4.3 RuleBusinessMeta v0 联动(P0-1 §4.5 基础上)

```typescript
// src/lib/stores/rule-business-meta.ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 规则业务元数据扩展表(v0)。
// P0-1 基础:Map<ruleId, BusinessMeta>
// v0 扩展:schemaId(关联业务表单 schema)/ 自动补全元数据
//
// 持久化:localStorage(key: evorule-console-cloud:rule-business-meta)

import { writable, get } from "svelte/store";
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
  /** v0 新增:关联的业务表单 schema ID */
  schemaId?: string;
  /** v0 新增:业务表单值(用于反向解析回表单,见 §9.3) */
  formValues?: Record<string, string | number | boolean>;
  /** v0 新增:创建时间(用于"最近活动"排序) */
  createdAt: string;
  /** v0 新增:最后更新时间 */
  updatedAt: string;
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

// === v0 新增:便捷函数 ===

export function getMeta(ruleId: string): RuleBusinessMeta | null {
  return get(ruleBusinessMetaStore)[ruleId] ?? null;
}

export function setMeta(meta: RuleBusinessMeta): void {
  const now = new Date().toISOString();
  ruleBusinessMetaStore.update((m) => ({
    ...m,
    [meta.ruleId]: { ...meta, updatedAt: now },
  }));
}

/** v0 新增:批量查询(用于规则库列表展示业务元数据) */
export function getMetaBulk(
  ruleIds: string[],
): Record<string, RuleBusinessMeta> {
  const m = get(ruleBusinessMetaStore);
  const result: Record<string, RuleBusinessMeta> = {};
  for (const id of ruleIds) {
    if (m[id]) result[id] = m[id];
  }
  return result;
}

/** v0 新增:自动补全元数据(根据 formValues 反查术语) */
export function autoFillTermIds(
  schemaId: string,
  formValues: Record<string, string | number | boolean>,
  existingTermIds: string[],
): string[] {
  // 根据 schema 字段的 termId 关联,自动补全 businessTermIds
  // 详见 §9.5
  return existingTermIds;
}

export function removeMeta(ruleId: string): void {
  ruleBusinessMetaStore.update((m) => {
    const next = { ...m };
    delete next[ruleId];
    return next;
  });
}
```

### 4.4 BusinessPreview 类型(v0 新增,业务预览结构化)

```typescript
// src/lib/stores/business-preview.ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 业务预览 store(v0 新增)。
// 设计:
//   - 结构化解释(本地计算,无需 LLM)
//   - LLM 自然语言解释(可选,带缓存)
//   - 缓存失效:ruleId + contentHash
//
// 持久化:localStorage(key: evorule-console-cloud:rule-explain:${ruleId}:${contentHash})

import { writable } from "svelte/store";
import { browser } from "$app/environment";

/** v0 新增:结构化解释(决策 §3.5) */
export interface StructuredExplanation {
  /** "如果"部分,如 "金额 > 10000 元" */
  ifPart: string;
  /** "则"部分,如 "通知 CFO 审批" */
  thenPart: string;
  /** "否则"部分(若有 else 分支) */
  elsePart?: string;
  /** 涉及的业务术语(用于高亮) */
  terms: Array<{
    termId: string;
    label: string;
    matchedText: string; // 在 ifPart/thenPart 中匹配到的原文
  }>;
  /** 使用的模板 ID(用于"为什么这么解释"追溯) */
  templateId: string;
}

/** v0 新增:规则 diff(决策 §3.9) */
export interface RuleDiff {
  changedFields: Array<{
    field: string; // "condition.value" / "action.params.role"
    oldValue: unknown;
    newValue: unknown;
    businessImpact: string; // "审批阈值从 10000 改为 20000"
  }>;
  addedFields: string[];
  removedFields: string[];
}

/** v0 新增:预览缓存条目 */
interface PreviewCacheEntry {
  ruleId: string;
  contentHash: string;
  structured: StructuredExplanation;
  llmExplanation?: string;
  cachedAt: string;
}

const CACHE_PREFIX = "evorule-console-cloud:rule-explain:";

function hashContent(content: string): string {
  // 简化 hash(避免引入 crypto.subtle,异步 + 兼容性问题)
  // FNV-1a 32-bit,截取前 16 字符
  let hash = 0x811c9dc5;
  for (let i = 0; i < content.length; i++) {
    hash ^= content.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** v0 新增:读缓存 */
export function getCachedExplanation(
  ruleId: string,
  content: string,
): PreviewCacheEntry | null {
  if (!browser) return null;
  const hash = hashContent(content);
  const key = `${CACHE_PREFIX}${ruleId}:${hash}`;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as PreviewCacheEntry) : null;
  } catch {
    return null;
  }
}

/** v0 新增:写缓存 */
export function setCachedExplanation(entry: PreviewCacheEntry): void {
  if (!browser) return;
  const key = `${CACHE_PREFIX}${entry.ruleId}:${entry.contentHash}`;
  try {
    localStorage.setItem(key, JSON.stringify(entry));
  } catch (e) {
    // localStorage 满(可能 5MB 用尽),静默失败
    console.warn("[business-preview] 缓存写入失败:", e);
  }
}

export { hashContent };
```

### 4.5 L1 监控大屏 Fact 业务化展示类型(v0 新增,三层架构同步)

> **2026-08-06 三层架构同步**(对应三层架构 §11.4 + HOME_DESIGN.md §3.1 L1 监控大屏)。
>
> L1 监控大屏消费 SSE 实时 Fact 流(`GET /api/sessions/{id}/events`),用业务语言展示而非 raw JSON。本节定义 Fact 业务化展示类型,复用 §4.1 业务术语库 + §4.4 业务预览,不引入新子层。

#### 4.5.1 FactBusinessDisplay 类型

```typescript
// src/lib/types/fact-business-display.ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// L1 监控大屏 Fact 业务化展示类型。
// 设计:
//   - 复用 businessTermsStore 做术语高亮(同 §4.1 归一化 + 前缀索引)
//   - 复用 BusinessPreview 做触发规则的结构化预览(同 §4.4)
//   - 不引入新 store,FactBusinessDisplay 由 FactStreamView 组件内 $state 派生计算

import type { BusinessPreview } from "./business-preview";

/**
 * 单条 Fact 的业务化展示(从 raw Fact 派生)。
 */
export interface FactBusinessDisplay {
  /** 原始 Fact id(来自内核 SSE 事件) */
  factId: string;
  /** 业务化时间戳(ISO,来自 Fact) */
  timestamp: string;
  /** 业务对象标识(如 "病人 P-1283" / "订单 O-8821",从 Fact payload 提取) */
  businessObjectLabel: string;
  /** 触发的规则业务名(来自 RuleBusinessMeta,见 P01 §4.5) */
  triggeredRuleLabel: string;
  /** 触发规则的结构化预览(复用 §4.4 BusinessPreview,"如果 X 则 Y") */
  rulePreview: BusinessPreview | null;
  /** Fact 处理结果(pass / block / anomaly) */
  outcome: "pass" | "block" | "anomaly";
  /** 业务术语高亮位(字段路径 → 命中术语 id 列表) */
  termHighlights: Record<string, string[]>;
  /** 原始 Fact(折叠展开时显示,开发者模式) */
  rawFact: unknown;
}

/**
 * 异常告警的业务化展示(L1 监控大屏红条)。
 */
export interface AnomalyBusinessDisplay {
  /** 异常 id */
  anomalyId: string;
  /** 业务化告警文案(如 "R-067 触发未授权变更") */
  message: string;
  /** 关联规则业务名 */
  ruleLabel: string;
  /** 严重级别 */
  severity: "warning" | "critical";
  /** 发生时间(ISO) */
  timestamp: string;
  /** 关联 Fact(可选,点击跳转 Fact 详情) */
  relatedFactId: string | null;
}
```

#### 4.5.2 Fact → FactBusinessDisplay 派生逻辑

```typescript
// src/lib/factories/fact-business-mapper.ts
// 从 raw Fact 派生 FactBusinessDisplay(纯函数,可单元测试)

import { get } from "svelte/store";
import {
  businessTermsStore,
  findTermsByPrefix,
} from "$lib/stores/business-terms";
import { getMeta } from "$lib/stores/rule-business-meta";
import { generateStructuredPreview } from "$lib/factories/business-preview";
import type { FactBusinessDisplay } from "$lib/types/fact-business-display";

/**
 * 从 raw SSE Fact 事件派生业务化展示。
 *
 * @param rawFact 内核 SSE `fact` 事件的 data(JSON.parse 后)
 * @param rulesById 规则 id → Rule 映射(用于查触发规则)
 */
export function toFactBusinessDisplay(
  rawFact: Record<string, unknown>,
  rulesById: Map<string, { id: string; description: string; content: string }>,
): FactBusinessDisplay {
  // 1. 提取业务对象标识(从 Fact payload,字段名依内核 schema)
  const payload = (rawFact.payload ?? {}) as Record<string, unknown>;
  const businessObjectLabel = extractBusinessObjectLabel(payload);

  // 2. 查触发规则 + 业务元数据
  const ruleId = String(rawFact.rule_id ?? rawFact.ruleId ?? "");
  const rule = rulesById.get(ruleId);
  const meta = rule ? getMeta(rule.id) : null;
  const triggeredRuleLabel =
    meta?.scenarioContext || rule?.description || ruleId;

  // 3. 生成规则结构化预览(复用 §4.4,LLM 缓存命中则秒回)
  const rulePreview = rule
    ? generateStructuredPreview(rule.content, rule.id)
    : null;

  // 4. 术语高亮:遍历 payload 字段,前缀匹配业务术语库
  const termHighlights: Record<string, string[]> = {};
  for (const [fieldPath, value] of Object.entries(payload)) {
    if (typeof value === "string") {
      const hits = findTermsByPrefix(value);
      if (hits.length > 0) termHighlights[fieldPath] = hits;
    }
  }

  // 5. 处理结果
  const outcome = String(
    rawFact.outcome ?? "pass",
  ) as FactBusinessDisplay["outcome"];

  return {
    factId: String(rawFact.id ?? rawFact.fact_id ?? ""),
    timestamp: String(rawFact.timestamp ?? new Date().toISOString()),
    businessObjectLabel,
    triggeredRuleLabel,
    rulePreview,
    outcome,
    termHighlights,
    rawFact,
  };
}

/** 从 payload 提取业务对象标识(如 "病人 P-1283") */
function extractBusinessObjectLabel(payload: Record<string, unknown>): string {
  // v0 简化:取第一个形如 P-xxx / O-xxx / case-xxx 的字段
  for (const value of Object.values(payload)) {
    if (typeof value === "string" && /^[A-Z]-\d+|case-/.test(value)) {
      return value;
    }
  }
  return JSON.stringify(payload).slice(0, 40);
}
```

> **设计取舍**:
>
> - **复用而非新建**:`generateStructuredPreview`(§4.4)与 `findTermsByPrefix`(§4.1)已在 L2 实现,L1 直接调用,零重复
> - **纯函数**:`toFactBusinessDisplay` 是纯函数(除 `getMeta` 读 store),易测试;术语高亮用 §4.1 已建的前缀索引,O(1)
> - **LLM 缓存复用**:L1 显示的规则预览与 L2 编辑时的预览共享同一 `localStorage` 缓存(§3.6 schema hash 失效),不重复调用 LLM

---

## 5. Store 设计总览(v0)

### 5.1 Store 一览(v0)

| Store                                                  | 文件                               | 职责                                 | 持久化                                                         | 来源    |
| ------------------------------------------------------ | ---------------------------------- | ------------------------------------ | -------------------------------------------------------------- | ------- |
| `rules` / `selectedRuleId` / `selectedRule`            | `@evorule/console`(内核)           | 规则 CRUD + 数组                     | localStorage `evorule-console:rules:user`                      | 复用    |
| `dbStore`                                              | `$lib/stores/db`                   | 库元数据(industry / businessObjects) | localStorage `evorule-console-cloud:db-meta`                   | P0-1    |
| `businessTermsStore`                                   | `$lib/stores/business-terms`       | 业务术语库                           | localStorage `evorule-console-cloud:business-terms:user`       | v0 扩展 |
| `activeTermsByIndustry`(派生)                          | `$lib/stores/business-terms`       | 当前行业激活术语                     | (派生)                                                         | v0 新增 |
| `businessFormSchemaStore`                              | `$lib/stores/business-form-schema` | 业务表单 schema                      | localStorage `evorule-console-cloud:business-form-schema:user` | v0 扩展 |
| `ruleBusinessMetaStore`                                | `$lib/stores/rule-business-meta`   | 规则业务元数据扩展表                 | localStorage `evorule-console-cloud:rule-business-meta`        | v0 扩展 |
| (函数) `getCachedExplanation` / `setCachedExplanation` | `$lib/stores/business-preview`     | 业务预览缓存                         | localStorage `evorule-console-cloud:rule-explain:*`            | v0 新增 |

> **L1 监控大屏复用**(2026-08-06 三层架构同步):上表所有 store 在 L1/L2 跨层共享。L1 监控大屏的 `FactStreamView`(§6.6)复用 `businessTermsStore`(术语高亮)+ `ruleBusinessMetaStore`(规则业务名)+ `business-preview` 缓存(结构化预览),**不引入 L1 专属 store**。Fact 业务化展示(`FactBusinessDisplay`,§4.5)是组件内 `$derived` 派生,不持久化。

### 5.2 与内核 rules store 的协作(P0-1 §5.2 复述)

```
内核 rules store(权威)            console-cloud 业务语言层(派生)
┌──────────────────────┐          ┌──────────────────────────────┐
│ rules: Writable<Rule[]>│         │ businessTermsStore           │
│  - Rule.id            │          │  - 静态行业词表              │
│  - Rule.description   │←─────────│  - 不依赖 rules              │
│  - Rule.content(JSON) │          │                              │
│  - Rule.source        │          │ businessFormSchemaStore      │
│  - Rule.createdAt     │          │  - 静态字段定义              │
│  - Rule.updatedAt     │          │  - 不依赖 rules              │
└──────────────────────┘          │                              │
                                   │ ruleBusinessMetaStore        │
                                   │  - Map<ruleId, BusinessMeta> │
                                   │  - ruleId = 内核 Rule.id      │
                                   │  - 业务层"扩展表"            │
                                   └──────────────────────────────┘
```

**关键约束**:

- 内核 `rules` store 是规则数据权威(含 `content` JSON)
- console-cloud 业务层只读内核 `rules`(派生展示),写时调 `addRule` / `updateRule` / `deleteRule`
- 业务元数据通过 `ruleBusinessMetaStore` 的 `ruleId` 关联,内核不感知

### 5.3 v0 Store 间数据流(规则编辑场景)

```
用户在 BusinessForm 编辑字段
  │
  ├─ 1. BusinessForm.svelte
  │     - 字段联动求值(evalCondition)
  │     - 业务层校验(FieldValidator)
  │     ↓
  ├─ 2. formValuesToEvoruleJson(schema, values) → evorule JSON object
  │     ↓
  ├─ 3. RuleValidator.validate(JSON.stringify(json)) → 内核校验(7 门禁)
  │     ↓
  ├─ 4. (校验通过)→ updateRule(ruleId, { content: JSON.stringify(json) })
  │     ↓
  ├─ 5. setMeta({ ruleId, formValues: values, schemaId }) → 更新业务元数据
  │     ↓
  ├─ 6. autoFillTermIds(schemaId, formValues, existingTermIds) → 自动补全术语关联
  │     ↓
  └─ 7. invalidatePreviewCache(ruleId) → 旧缓存失效(hash 变化)
        ↓
        BusinessPreview 重新生成结构化解释 + (可选)LLM explainRule
```

---

## 6. 组件树(v0)

### 6.1 BusinessRuleLibrary.svelte v0 组件树(P0-1 §6.2 增强)

```
BusinessRuleLibrary.svelte(v0)
├── 顶部
│   ├── 业务语言筛选栏
│   │   └── BusinessTermFilter.svelte(v0 增强)
│   │       ├── [全部分类 ▼]
│   │       ├── [财务术语 ▼]
│   │       ├── [合规术语 ▼]
│   │       ├── [搜索框](同义词前缀匹配,matchTerms)
│   │       └── [自动推荐](基于 dbStore.businessObject,展示相关术语 chip)
│   ├── SchemaSelector.svelte(v0 新增)
│   │   └── [选择业务场景 ▼](按 industry + businessObject 筛选,getSchemasByBusinessObject)
│   └── DeveloperModeToggle.svelte
│       └── [开发者模式:看 raw JSON](toggle)
├── 主体(左右两栏)
│   ├── 左侧:规则卡片列表
│   │   └── BusinessRuleCard.svelte(v0 增强)
│   │       ├── 业务标题(Rule.description)
│   │       ├── BusinessPreview.svelte(v0 结构化 + LLM)
│   │       │   ├── StructuredPreview.svelte(本地计算,"如果 X 则 Y")
│   │       │   │   ├── [如果: 金额 > 10000 元]
│   │       │   │   ├── [则: 通知 CFO 审批]
│   │       │   │   ├── [否则: 直接通过](可选)
│   │       │   │   └── 术语高亮(chip 显示,点击展开解释)
│   │       │   ├── LlmExplanation.svelte(LLM 自然语言,带缓存)
│   │       │   │   ├── [LLM 解释](按钮,调 explainRule)
│   │       │   │   └── [cached] 徽标(命中缓存时显示)
│   │       │   └── RuleDiff.svelte(修改前后 diff,决策 §3.9)
│   │       │       ├── [改动字段列表]
│   │       │       └── [业务影响说明]
│   │       ├── 业务元数据徽标(industry / businessObject / schemaId)
│   │       └── 操作按钮
│   │           ├── [编辑](→ BusinessForm)
│   │           ├── [复制](→ duplicateRule + 复制 meta)
│   │           ├── [导出](→ exportRule)
│   │           └── [删除](→ deleteRule + removeMeta)
│   └── 右侧:规则详情(选中后)
│       ├── BusinessForm.svelte(v0 增强,见 §6.4)
│       ├── BusinessPreview.svelte(v0 增强)
│       └── 业务元数据编辑
│           ├── industry 下拉(改行业会同步 dbStore.industry)
│           ├── businessObject 下拉
│           ├── schemaId 下拉(按 industry + businessObject 筛选)
│           └── scenarioContext 输入(供 LLM explainRule 上下文)
└── 底部
    ├── [+ 加规则](→ BusinessForm 新建模式)
    └── [管理术语](→ BusinessTermManager.svelte modal)
```

### 6.2 StepFirstRule.svelte v0 组件树(P0-1 §6.4 增强,双模式)

```
StepFirstRule.svelte(v0)
├── 模板预填(若 Step 1 选了 finance/compliance)
│   └── 显示"基于财务审批模板加规则"(预填 schemaId)
├── SchemaSelector.svelte(v0 新增,决策 §3.10)
│   └── [选择业务场景 ▼](按 industry + businessObject 筛选)
├── 输入模式切换
│   ├── [LLM 辅助](默认)
│   └── [业务表单](LLM 不可用时强制)
├── LLM 模式(v0 增强)
│   ├── LlmHelper.svelte
│   │   ├── 自然语言输入框
│   │   ├── [生成规则草案](→ CloudLlmAssistant.generateRuleDraft)
│   │   ├── 草案置信度可视化(v0 颜色编码 + 文字)
│   │   │   ├── confidence ≥ 0.7 → 🟢 高
│   │   │   ├── confidence 0.3-0.7 → 🟡 中
│   │   │   └── confidence < 0.3 → 🔴 低
│   │   └── [反向解析到表单](决策 §3.7,evoruleJsonToFormValues)
│   │       └── (解析成功)→ 自动切到"业务表单"模式填值
│   ├── 草案 raw JSON 预览(可折叠,开发者模式默认展开)
│   ├── RuleValidator 校验结果
│   │   ├── ✅ 校验通过(显示 7 门禁 G1-G7 状态)
│   │   └── ❌ 校验失败(显示错误列表,允许手动改 JSON 后重校验)
│   └── BusinessPreview.svelte(v0 结构化 + LLM)
├── 业务表单模式(v0 增强)
│   └── BusinessForm.svelte(v0,见 §6.4)
├── 预览区
│   └── BusinessPreview.svelte(v0 结构化 + LLM)
└── 操作按钮
    ├── [上一步](→ Step 2)
    ├── [保存草稿](→ addRule + setMeta,留在向导)
    └── [保存并下一步](→ addRule + setMeta + next Step 4)
```

### 6.3 StepTrialRun.svelte v0 组件树(P0-1 §6.5 增强)

```
StepTrialRun.svelte(v0)
├── 顶部
│   └── "试运行:用业务事件测试规则"
├── 事件输入模式切换(v0 新增)
│   ├── [业务事件表单](默认,用 BusinessForm 渲染)
│   └── [raw JSON](开发者模式)
├── 业务事件表单(v0)
│   ├── BusinessForm.svelte(用 Step 3 选的 schema 渲染事件字段)
│   │   ├── [业务对象:病人 ▼](只读,Step 2 已选)
│   │   ├── [病人 ID:P-001](自动生成,可改)
│   │   ├── [年龄:68](根据 schema 字段)
│   │   └── [发烧:是](根据 schema 字段)
│   └── [提交业务事件](→ createSession + submitCommand)
├── 执行结果预览(v0 增强)
│   ├── Session 状态(连接 / 已提交 / 已完成)
│   ├── 触发的 Fact 列表(从 sessionState 派生)
│   │   └── FactCard.svelte(v0 新增)
│   │       ├── Fact 名称(业务化,用术语库翻译)
│   │       ├── Fact 值
│   │       └── 触发该 Fact 的规则 ID(可点击跳转)
│   └── CausalChain.svelte(v0 简化版)
│       └── 事件 → 规则 → Fact 因果链(横向流图)
└── 操作按钮
    ├── [上一步](→ Step 3)
    └── [下一步](→ Step 5)
```

### 6.4 BusinessForm.svelte v0 组件树(新增,P0-1 §6.2 仅提及)

```
BusinessForm.svelte(v0)
├── SchemaHeader.svelte(顶部)
│   ├── 业务场景名(schema.scenario)
│   ├── 行业徽标(schema.industry)
│   └── [切换 schema ▼](同一 businessObject 多 schema 时)
├── FormBody.svelte(主体,按 group 分区)
│   ├── ConditionGroup.svelte(group="condition")
│   │   ├── 字段循环(可见字段,evalVisibleWhen)
│   │   │   └── FieldRenderer.svelte(根据 type 渲染)
│   │   │       ├── number → <input type="number">
│   │   │       ├── string → <input type="text">
│   │   │       ├── date → <input type="date">
│   │   │       ├── enum → <select>
│   │   │       └── boolean → <input type="checkbox">
│   │   └── 字段联动指示器(v0 新增)
│   │       └── "此字段在 X=Y 时显示"(鼠标 hover 显示 visibleWhen)
│   ├── ActionGroup.svelte(group="action")
│   │   └── 字段循环(同上)
│   └── MetadataGroup.svelte(group="metadata")
│       └── 字段循环(同上)
├── ValidationPanel.svelte(v0 新增)
│   ├── 业务层校验(FieldValidator)
│   │   ├── ✅ 必填校验通过
│   │   ├── ❌ 金额阈值不能 < 0
│   │   └── ❌ 日期格式不合法
│   └── 内核校验(RuleValidator,7 门禁)
│       ├── G1 JSON 格式 ✅
│       ├── G2 元指令类型 ✅
│       ├── G3 I/O 双路径 ✅
│       ├── G4 域类型 ✅
│       ├── G5 路径引用 ✅
│       ├── G6 兜底规则 ✅
│       └── G7 递归深度 ✅
├── JsonPreview.svelte(底部,可折叠)
│   ├── 实时 evorule JSON 预览(formValuesToEvoruleJson)
│   └── [复制 JSON] / [下载 JSON]
└── FormActions.svelte
    ├── [校验](手动触发双层校验)
    ├── [重置](恢复默认值)
    └── [保存](调用 onSave(ruleJson, description, formValues))
```

### 6.5 BusinessTermManager.svelte v0 组件树(新增,术语 CRUD)

```
BusinessTermManager.svelte(v0 新增,modal 形式)
├── TermList.svelte(左侧)
│   ├── 筛选
│   │   ├── [行业 ▼]
│   │   ├── [状态 ▼](draft / active / deprecated)
│   │   └── [搜索](同义词匹配)
│   └── 术语列表
│       └── TermCard.svelte
│           ├── label + 行业徽标
│           ├── 状态徽标(draft 灰 / active 绿 / deprecated 黄)
│           └── [编辑] [弃用]
├── TermEditor.svelte(右侧,选中术语后)
│   ├── label 输入框
│   ├── key 输入框(已被引用时禁用,提示)
│   ├── industry 下拉
│   ├── synonyms 编辑器(chip 输入)
│   ├── aliases 编辑器(chip 输入,v0 新增)
│   ├── description 文本框
│   ├── evorulePaths 编辑器(多选,关联 evorule JSON 路径)
│   ├── relatedTermIds 编辑器(多选,跨行业关联)
│   └── [保存] [弃用] [关闭]
└── 底部
    └── [+ 新建术语]
```

### 6.6 FactStreamView.svelte v0 组件树(L1 监控大屏,三层架构同步新增)

> **2026-08-06 三层架构同步**(对应 HOME_DESIGN.md §5.3 MonitorDashboard + 三层架构 §3.2 监控大屏)。
>
> L1 监控大屏的 Fact 流视图,消费 SSE 实时 Fact + 用业务语言展示(§4.5 FactBusinessDisplay)。本组件由 `MonitorDashboard.svelte`(HOME_DESIGN.md)渲染,是 L1 主屏的核心子组件。

```
FactStreamView.svelte(L1 监控大屏 Fact 流,消费 SSE)
├── 顶部
│   ├── [运行中 ●] ruleset v17(productionStateStore,HOME_DESIGN §6.5)
│   └── [筛选 ▼](outcome: 全部 / pass / block / anomaly)
├── Fact 流(虚拟列表,svelte-virtual-list,1000+/秒不卡)
│   └── FactCard.svelte(单条 Fact 业务化展示,§4.5 FactBusinessDisplay)
│       ├── 时间戳(14:32:01)
│       ├── 业务对象标识(businessObjectLabel,如 "病人 P-1283")
│       ├── 触发规则业务名(triggeredRuleLabel,来自 RuleBusinessMeta)
│       ├── 规则结构化预览(rulePreview,"如果 体温>39℃ 则 开具 CT")
│       │   └── 术语高亮(termHighlights,匹配 §4.1 业务术语库,绿色标记)
│       ├── 处理结果徽标(outcome: pass 绿 / block 红 / anomaly 橙)
│       └── [展开 raw Fact](开发者模式,折叠默认)
├── 异常告警面板(右侧,红条,AnomalyBusinessDisplay §4.5)
│   └── AnomalyCard.svelte
│       ├── ⚠ 业务化告警文案(message)
│       ├── 关联规则业务名(ruleLabel)
│       ├── 严重级别(severity: warning 黄 / critical 红)
│       └── [跳转关联 Fact](relatedFactId)
└── 底部
    ├── [暂停滚动] [清空]  (P0 只读滚动,P1 加干预)
    └── session_switched toast(U7 决策,规则集已更新到 vN)
```

**与 HOME_DESIGN.md MonitorDashboard 的关系**:

- `MonitorDashboard.svelte`(HOME_DESIGN §5.3)是 L1 监控大屏的壳,负责 SSE 订阅 + `session_switched` 事件处理(U7)
- `FactStreamView.svelte`(本节)是 MonitorDashboard 的子组件,负责 Fact 流的业务化渲染
- `FactCard.svelte` 调用 §4.5.2 `toFactBusinessDisplay()` 把 raw Fact 派生为业务化展示

**性能策略**(三层架构 §3.2 虚拟列表要求):

- Fact 流用 `svelte-virtual-list` 虚拟滚动,DOM 只渲染可见区(约 20 条),支持 1000+/秒
- `toFactBusinessDisplay()` 在 FactCard 内 `$derived` 计算,惰性求值(滚动到可见才算)
- LLM 预览(`rulePreview`)走 §3.6 缓存,同规则不重复调用 LLM

---

## 7. 内置数据(v0 扩展)

### 7.1 BUILTIN_BUSINESS_TERMS v0(P0-1 §7.1 12 条扩展)

```typescript
// src/lib/data/business-terms-builtin.ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 业务术语库内置数据(v0)。
// P0-1 起步:6 条(2 行业 × 3 术语)
// v0 扩展:12 条(2 行业 × 6 术语)+ evorulePaths + relatedTermIds

import type { BusinessTerm } from "$lib/stores/business-terms";

export const BUILTIN_BUSINESS_TERMS: BusinessTerm[] = [
  // === 财务审批(6 条) ===
  {
    id: "finance.amount",
    industry: "finance",
    label: "金额",
    key: "amount",
    synonyms: ["报销金额", "支出金额", "申请金额"],
    aliases: ["amt", "money"],
    description: "业务事件中的金额数值(单位:元)",
    status: "active",
    evorulePaths: ["condition.value", "action.params.amount"],
    relatedTermIds: ["finance.threshold"],
    version: 1,
  },
  {
    id: "finance.threshold",
    industry: "finance",
    label: "审批阈值",
    key: "threshold",
    synonyms: ["上限", "限额", "审批线"],
    aliases: ["limit"],
    description: "触发审批的金额阈值(超过此值需要上级批准)",
    status: "active",
    evorulePaths: ["condition.value"],
    relatedTermIds: ["finance.amount"],
    version: 1,
  },
  {
    id: "finance.approver",
    industry: "finance",
    label: "审批人",
    key: "approver",
    synonyms: ["批准人", "签字人"],
    description: "负责审批的角色(CFO / 财务主管 / 部门经理)",
    status: "active",
    evorulePaths: ["action.params.role"],
    relatedTermIds: [],
    version: 1,
  },
  {
    id: "finance.notify_channel",
    industry: "finance",
    label: "通知渠道",
    key: "notifyChannel",
    synonyms: ["通知方式", "渠道"],
    description: "审批通知的发送渠道(邮件 / 短信 / IM)",
    status: "active",
    evorulePaths: ["action.params.channel"],
    relatedTermIds: [],
    version: 1,
  },
  {
    id: "finance.expense_type",
    industry: "finance",
    label: "费用类型",
    key: "expenseType",
    synonyms: ["支出类型", "报销类别"],
    description: "费用的业务分类(差旅 / 办公 / 招待 / 福利)",
    status: "active",
    evorulePaths: ["condition.value"],
    relatedTermIds: [],
    version: 1,
  },
  {
    id: "finance.department",
    industry: "finance",
    label: "部门",
    key: "department",
    synonyms: ["申请部门", "归属部门"],
    description: "报销申请的归属部门",
    status: "active",
    evorulePaths: ["condition.value"],
    relatedTermIds: [],
    version: 1,
  },
  // === 合规审计(6 条) ===
  {
    id: "compliance.control_point",
    industry: "compliance",
    label: "控制点",
    key: "controlPoint",
    synonyms: ["SOX 控制点", "审计点", "合规检查项"],
    description: "合规审计的控制点编号(如 SOX-404)",
    status: "active",
    evorulePaths: ["condition.value"],
    relatedTermIds: ["compliance.evidence"],
    version: 1,
  },
  {
    id: "compliance.evidence",
    industry: "compliance",
    label: "审计证据",
    key: "evidence",
    synonyms: ["证据", "凭证", "审计材料"],
    description: "支持合规判断的证据(文档 / 日志 / 截图)",
    status: "active",
    evorulePaths: ["action.params.evidenceType"],
    relatedTermIds: ["compliance.control_point"],
    version: 1,
  },
  {
    id: "compliance.regulator",
    industry: "compliance",
    label: "监管机构",
    key: "regulator",
    synonyms: ["监管", "审计方"],
    description: "需要报送的监管机构(SOX / SEC / 银保监)",
    status: "active",
    evorulePaths: ["action.params.regulator"],
    relatedTermIds: [],
    version: 1,
  },
  {
    id: "compliance.risk_level",
    industry: "compliance",
    label: "风险等级",
    key: "riskLevel",
    synonyms: ["风险度", "合规风险"],
    description: "合规风险等级(高 / 中 / 低)",
    status: "active",
    evorulePaths: ["condition.value"],
    relatedTermIds: [],
    version: 1,
  },
  {
    id: "compliance.deadline",
    industry: "compliance",
    label: "合规期限",
    key: "deadline",
    synonyms: ["截止日期", "报送期限"],
    description: "合规报送的截止日期",
    status: "active",
    evorulePaths: ["condition.value"],
    relatedTermIds: [],
    version: 1,
  },
  {
    id: "compliance.report_format",
    industry: "compliance",
    label: "报送格式",
    key: "reportFormat",
    synonyms: ["报告格式", "报送模板"],
    description: "向监管机构报送的文件格式(XML / JSON / PDF)",
    status: "active",
    evorulePaths: ["action.params.format"],
    relatedTermIds: [],
    version: 1,
  },
];
```

### 7.2 BUILTIN_FORM_SCHEMAS v0(P0-1 §7.2 4 条扩展)

```typescript
// src/lib/data/business-form-schemas-builtin.ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 业务表单 schema 内置数据(v0)。
// P0-1 起步:2 条(财务报销上限 + 合规控制点检查)
// v0 扩展:4 条(每行业 2 场景)+ 字段联动(visibleWhen)+ 复合条件

import type { BusinessFormSchema } from "$lib/stores/business-form-schema";

export const BUILTIN_FORM_SCHEMAS: BusinessFormSchema[] = [
  // === 财务:报销上限规则(P0-1 §7.2 增强) ===
  {
    id: "finance.expense_limit",
    industry: "finance",
    scenario: "报销上限规则",
    businessObjects: ["报销单", "支出"],
    version: 1,
    fields: [
      {
        id: "finance.amount_threshold",
        label: "金额阈值(元)",
        type: "number",
        evorulePath: "condition.value",
        defaultValue: 10000,
        description: "超过此金额的报销需要 CFO 批准",
        group: "condition",
        termId: "finance.threshold",
        validators: [
          { type: "required", message: "金额阈值必填" },
          { type: "min", param: 0, message: "金额阈值不能为负" },
        ],
      },
      {
        id: "finance.expense_type",
        label: "费用类型",
        type: "enum",
        evorulePath: "condition.params.expenseType",
        options: ["差旅", "办公", "招待", "福利"],
        defaultValue: "差旅",
        description: "费用的业务分类",
        group: "condition",
        termId: "finance.expense_type",
      },
      {
        id: "finance.approver_role",
        label: "审批人角色",
        type: "enum",
        evorulePath: "action.params.role",
        options: ["CFO", "财务主管", "部门经理"],
        defaultValue: "CFO",
        description: "触发审批时通知的角色",
        group: "action",
        termId: "finance.approver",
        // v0 联动:招待类型强制 CFO 审批
        visibleWhen: [
          { fieldId: "finance.expense_type", operator: "ne", value: "福利" },
        ],
      },
      {
        id: "finance.notify_channel",
        label: "通知渠道",
        type: "enum",
        evorulePath: "action.params.channel",
        options: ["邮件", "短信", "IM"],
        defaultValue: "邮件",
        description: "审批通知的发送渠道",
        group: "action",
        termId: "finance.notify_channel",
        // v0 联动:CFO 审批强制 IM(避免漏看)
        requiredWhen: [
          { fieldId: "finance.approver_role", operator: "eq", value: "CFO" },
        ],
      },
    ],
  },
  // === 财务:部门预算规则(v0 新增) ===
  {
    id: "finance.department_budget",
    industry: "finance",
    scenario: "部门预算规则",
    businessObjects: ["部门", "预算"],
    version: 1,
    fields: [
      {
        id: "finance.department_name",
        label: "部门名称",
        type: "enum",
        evorulePath: "condition.value",
        options: ["研发", "销售", "市场", "运营"],
        defaultValue: "研发",
        description: "受预算控制的部门",
        group: "condition",
        termId: "finance.department",
        validators: [{ type: "required", message: "部门必选" }],
      },
      {
        id: "finance.budget_limit",
        label: "预算上限(元)",
        type: "number",
        evorulePath: "condition.params.limit",
        defaultValue: 100000,
        description: "部门月度预算上限",
        group: "condition",
        termId: "finance.threshold",
        validators: [
          { type: "required", message: "预算上限必填" },
          { type: "min", param: 0, message: "预算不能为负" },
        ],
      },
      {
        id: "finance.alert_threshold",
        label: "预警阈值(%)",
        type: "number",
        evorulePath: "action.params.alertThreshold",
        defaultValue: 80,
        description: "达到预算的多少百分比时预警",
        group: "action",
        validators: [
          { type: "min", param: 0, message: "阈值不能 < 0%" },
          { type: "max", param: 100, message: "阈值不能 > 100%" },
        ],
      },
    ],
  },
  // === 合规:控制点检查规则(P0-1 §7.2 增强) ===
  {
    id: "compliance.control_check",
    industry: "compliance",
    scenario: "控制点检查规则",
    businessObjects: ["案件", "控制点"],
    version: 1,
    fields: [
      {
        id: "compliance.control_point_id",
        label: "控制点编号",
        type: "string",
        evorulePath: "condition.value",
        defaultValue: "SOX-404",
        description: "合规控制点的标准编号",
        group: "condition",
        termId: "compliance.control_point",
        validators: [{ type: "required", message: "控制点编号必填" }],
      },
      {
        id: "compliance.required_evidence",
        label: "必需证据类型",
        type: "enum",
        evorulePath: "action.params.evidenceType",
        options: ["文档", "日志", "截图", "签字"],
        defaultValue: "文档",
        description: "合规审计要求的证据类型",
        group: "action",
        termId: "compliance.evidence",
      },
      {
        id: "compliance.regulatory_body",
        label: "监管机构",
        type: "enum",
        evorulePath: "action.params.regulator",
        options: ["SOX", "SEC", "银保监", "等保 2.0"],
        defaultValue: "SOX",
        description: "需要报送的监管机构",
        group: "action",
        termId: "compliance.regulator",
        // v0 联动:SOX 控制点强制 SEC 报送
        requiredWhen: [
          {
            fieldId: "compliance.control_point_id",
            operator: "in",
            value: ["SOX-404", "SOX-302"],
          },
        ],
      },
    ],
  },
  // === 合规:风险等级预警规则(v0 新增) ===
  {
    id: "compliance.risk_alert",
    industry: "compliance",
    scenario: "风险等级预警规则",
    businessObjects: ["案件", "风险"],
    version: 1,
    fields: [
      {
        id: "compliance.risk_level",
        label: "风险等级",
        type: "enum",
        evorulePath: "condition.value",
        options: ["高", "中", "低"],
        defaultValue: "中",
        description: "合规风险等级",
        group: "condition",
        termId: "compliance.risk_level",
        validators: [{ type: "required", message: "风险等级必选" }],
      },
      {
        id: "compliance.deadline_date",
        label: "合规期限",
        type: "date",
        evorulePath: "condition.params.deadline",
        description: "合规报送的截止日期",
        group: "condition",
        termId: "compliance.deadline",
      },
      {
        id: "compliance.report_format",
        label: "报送格式",
        type: "enum",
        evorulePath: "action.params.format",
        options: ["XML", "JSON", "PDF"],
        defaultValue: "XML",
        description: "向监管机构报送的文件格式",
        group: "action",
        termId: "compliance.report_format",
        // v0 联动:SEC 强制 XML
        visibleWhen: [
          { fieldId: "compliance.risk_level", operator: "eq", value: "高" },
        ],
      },
    ],
  },
];
```

---

## 8. 状态机(v0)

### 8.1 业务术语生命周期(决策 §3.8)

```
┌─────────┐  publish  ┌────────┐  deprecate  ┌─────────────┐
│  draft  │ ────────→ │ active │ ──────────→ │ deprecated  │
└─────────┘           └────────┘             └─────────────┘
                            ↑                      │
                            │ reactivate           │
                            └──────────────────────┘
```

| 当前状态   | 事件          | 下一状态   | 触发动作                                          |
| ---------- | ------------- | ---------- | ------------------------------------------------- |
| draft      | publish       | active     | `updateBusinessTerm(id, { status: 'active' })`    |
| active     | deprecate(by) | deprecated | `deprecateBusinessTerm(id, by)`                   |
| deprecated | reactivate    | active     | `updateBusinessTerm(id, { status: 'active' })`    |
| 任意       | 改 key        | (拒绝)     | 抛错"key 不能修改"(决策 §3.8)                     |
| 任意       | 改 label      | 同状态     | `updateBusinessTerm(id, { label })` + version+1   |
| 任意       | 改 synonyms   | 同状态     | `updateBusinessTerm(id, { synonyms })` + 重建索引 |

### 8.2 业务表单编辑状态机(v0 新增)

```
            ┌──────────┐
            │  empty   │ (初始,formValues = {})
            └────┬─────┘
                 │ 用户输入
                 ▼
            ┌──────────┐
            │  dirty   │ (有未保存改动)
            └────┬─────┘
                 │ [校验] 按钮
                 ▼
       ┌──────────────────┐
       │  validating      │ (双层校验中)
       └─────┬────────┬───┘
             │        │
        校验通过    校验失败
             │        │
             ▼        ▼
       ┌─────────┐ ┌─────────┐
       │  valid  │ │ invalid │ (显示错误,可改)
       └────┬────┘ └────┬────┘
            │           │
            │ [保存]    │ 改值
            │           │
            ▼           ▼
       ┌──────────┐  ┌──────────┐
       │  saved   │  │  dirty   │
       └──────────┘  └──────────┘
```

### 8.3 业务预览生成状态机(v0 新增)

```
            ┌──────────┐
            │  idle    │ (无规则选中)
            └────┬─────┘
                 │ 选中规则
                 ▼
       ┌──────────────────┐
       │  cached?         │
       └─────┬────────┬───┘
             │        │
           是        否
             │        │
             ▼        ▼
       ┌──────────┐ ┌──────────────┐
       │ showing  │ │ generating  │ (调 LLM)
       │ cached   │ └─────┬───────┘
       └──────────┘       │
                          ├─ LLM 成功 → showing(llm + structured)
                          ├─ LLM 失败 → showing(structured only,降级)
                          └─ LLM 不可用 → showing(structured only)
```

---

## 9. 关键代码示例

### 9.1 StepFirstRule.svelte v0 代码(P0-1 §11.1 增强,双模式 + 反向解析)

```svelte
<!-- src/lib/views/Build/WizardSteps/StepFirstRule.svelte -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责(v0):建库向导步骤 3 — 加第一条规则
    v0 增强(相对 P0-1):
    - SchemaSelector 按 industry + businessObject 动态选 schema
    - LLM 草案 → 业务表单反向解析(决策 §3.7)
    - 置信度可视化(三档颜色)
    - 双模式自由切换(LLM 不可用时强制表单)
    - 业务预览结构化 + LLM 双层
-->

<script lang="ts">
  import { addRule, RuleValidator, useAssistantOrNull } from "@evorule/console";
  import { dbStore } from "$lib/stores/db";
  import { setMeta } from "$lib/stores/rule-business-meta";
  import { businessFormSchemaStore, getSchemaById, getSchemasByBusinessObject } from "$lib/stores/business-form-schema";
  import { activeTermsByIndustry } from "$lib/stores/business-terms";
  import { getCachedExplanation, setCachedExplanation, hashContent } from "$lib/stores/business-preview";
  import { formValuesToEvoruleJson, evoruleJsonToFormValues } from "$lib/views/Rules/business-form-to-json";
  import { explainStructured } from "$lib/views/Rules/business-preview-explainer";
  import BusinessForm from "$lib/views/Rules/BusinessForm.svelte";
  import BusinessPreview from "$lib/views/Rules/BusinessPreview.svelte";
  import SchemaSelector from "$lib/views/Rules/SchemaSelector.svelte";

  let {
    template,
    businessObjects,
    onCreated,
    onBack,
  } = $props<{
    template: "blank" | "finance" | "compliance" | null;
    businessObjects: string[];
    onCreated: (ruleId: string) => void;
    onBack: () => void;
  }>();

  const assistant = useAssistantOrNull();

  // === schema 选择(v0 新增,决策 §3.10) ===
  let selectedSchemaId = $state<string | null>(null);
  const availableSchemas = $derived(
    getSchemasByBusinessObject(businessObjects[0] ?? "", $dbStore.industry)
  );

  // 模板预填:选 finance → 默认选 finance.expense_limit
  $effect(() => {
    if (template === "finance" && !selectedSchemaId) {
      selectedSchemaId = "finance.expense_limit";
    } else if (template === "compliance" && !selectedSchemaId) {
      selectedSchemaId = "compliance.control_check";
    }
  });

  // === 输入模式 ===
  let inputMode = $state<"llm" | "form">("llm");
  // LLM 不可用时强制表单模式
  $effect(() => {
    if (!assistant && inputMode === "llm") {
      inputMode = "form";
    }
  });

  // === LLM 模式状态 ===
  let naturalLanguage = $state("");
  let generatedRule = $state<object | null>(null);
  let confidence = $state<number>(0);
  let validation = $state<{ valid: boolean; errors: string[] } | null>(null);
  let isGenerating = $state(false);
  let llmError = $state<string | null>(null);

  // === 业务表单模式状态(v0) ===
  let formValues = $state<Record<string, string | number | boolean>>({});

  // === 业务预览(v0) ===
  let structuredPreview = $state<StructuredExplanation | null>(null);
  let llmExplanation = $state<string>("");
  let isExplaining = $state(false);
  let previewFromCache = $state(false);

  // === LLM 生成规则草案 ===
  async function handleGenerate(): Promise<void> {
    if (!assistant) {
      llmError = "LLM 未配置,请切换到业务表单模式或前往设置配置 LLM";
      return;
    }
    if (!naturalLanguage.trim()) {
      llmError = "请输入规则描述";
      return;
    }

    isGenerating = true;
    llmError = null;
    try {
      const result = await assistant.generateRuleDraft(naturalLanguage);
      generatedRule = result.rule;
      confidence = result.confidence;

      // v0 新增:反向解析到表单(决策 §3.7)
      if (selectedSchemaId) {
        const schema = getSchemaById(selectedSchemaId);
        if (schema) {
          formValues = evoruleJsonToFormValues(schema, result.rule);
        }
      }

      // 校验
      const jsonStr = JSON.stringify(result.rule, null, 2);
      const v = RuleValidator.validate(jsonStr);
      validation = { valid: v.valid, errors: v.errors.map((e) => e.message) };

      // 业务预览(结构化层本地计算,LLM 层异步)
      generateStructuredPreview(result.rule);

      // LLM 解释(异步,带缓存)
      if (v.valid) {
        await generateLlmExplanation(result.rule);
      }
    } catch (e) {
      llmError = (e as Error).message;
    } finally {
      isGenerating = false;
    }
  }

  // v0 新增:结构化预览(本地计算,无 LLM)
  function generateStructuredPreview(ruleJson: object): void {
    const terms = $activeTermsByIndustry;
    structuredPreview = explainStructured(ruleJson, terms);
  }

  // v0 新增:LLM 解释(带缓存,决策 §3.6)
  async function generateLlmExplanation(ruleJson: object): Promise<void> {
    const content = JSON.stringify(ruleJson);
    const hash = hashContent(content);

    // 命中缓存(假 ruleId,Step 3 还没保存,用临时 id)
    const tempRuleId = `__temp__:${hash}`;
    const cached = getCachedExplanation(tempRuleId, content);
    if (cached?.llmExplanation) {
      llmExplanation = cached.llmExplanation;
      previewFromCache = true;
      return;
    }

    // 调 LLM
    isExplaining = true;
    previewFromCache = false;
    try {
      llmExplanation = await assistant!.explainRule(ruleJson);
      setCachedExplanation({
        ruleId: tempRuleId,
        contentHash: hash,
        structured: structuredPreview!,
        llmExplanation,
        cachedAt: new Date().toISOString(),
      });
    } catch {
      llmExplanation = "(LLM 解释失败,仅显示结构化预览)";
    } finally {
      isExplaining = false;
    }
  }

  // v0 新增:业务表单保存回调
  function handleFormSave(
    ruleJson: object,
    description: string,
    values: Record<string, string | number | boolean>
  ): void {
    generatedRule = ruleJson;
    naturalLanguage = description;
    formValues = values;
    const v = RuleValidator.validate(JSON.stringify(ruleJson));
    validation = { valid: v.valid, errors: v.errors.map((e) => e.message) };
    if (v.valid) {
      generateStructuredPreview(ruleJson);
      handleSave();
    }
  }

  // === 保存规则 ===
  function handleSave(): void {
    if (!generatedRule || !validation?.valid) {
      llmError = "规则未校验通过,无法保存";
      return;
    }

    const db = $dbStore;
    const ruleId = addRule({
      id: `user.${Date.now()}`,
      version: 1,
      description: naturalLanguage,
      content: JSON.stringify(generatedRule, null, 2),
    });

    // v0 新增:关联业务元数据(含 schemaId + formValues)
    setMeta({
      ruleId,
      industry: db.industry,
      businessObject: db.businessObjects[0] ?? "未指定",
      businessTermIds: [],
      scenarioContext: naturalLanguage,
      schemaId: selectedSchemaId ?? undefined,
      formValues,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    onCreated(ruleId);
  }
</script>

<div class="step-first-rule">
  <h2>步骤 3:加第一条规则</h2>

  <!-- v0:SchemaSelector -->
  <SchemaSelector
    schemas={availableSchemas}
    bind:selectedId={selectedSchemaId}
  />

  <!-- 输入模式切换 -->
  <div class="mode-tabs">
    <button
      class:active={inputMode === "llm"}
      onclick={() => (inputMode = "llm")}
      disabled={!assistant}
      title={assistant ? "LLM 辅助模式" : "LLM 未配置"}
    >
      LLM 辅助 {!assistant && "(未配置)"}
    </button>
    <button
      class:active={inputMode === "form"}
      onclick={() => (inputMode = "form")}
    >
      业务表单
    </button>
  </div>

  {#if inputMode === "llm"}
    <!-- LLM 模式 -->
    <div class="llm-section">
      <label>用自然语言描述规则:</label>
      <textarea
        bind:value={naturalLanguage}
        placeholder="例如:65 岁以上发烧必须先 CT"
        rows="3"
      ></textarea>

      <button onclick={handleGenerate} disabled={isGenerating}>
        {isGenerating ? "生成中..." : "生成规则草案"}
      </button>

      {#if llmError}
        <div class="error">{llmError}</div>
      {/if}

      {#if generatedRule}
        <div class="generated-rule">
          <h3>生成的规则</h3>
          <pre>{JSON.stringify(generatedRule, null, 2)}</pre>

          <!-- v0:置信度可视化(三档颜色) -->
          <div
            class="confidence"
            data-level={confidence >= 0.7 ? "high" : confidence >= 0.3 ? "mid" : "low"}
          >
            置信度: {confidence.toFixed(2)}
            {#if confidence >= 0.7}
              🟢 高(可直接保存)
            {:else if confidence >= 0.3}
              🟡 中(建议在业务表单模式核对)
            {:else}
              🔴 低(建议切换到业务表单模式重填)
            {/if}
          </div>

          {#if validation}
            <div class="validation" class:valid={validation.valid} class:invalid={!validation.valid}>
              {#if validation.valid}
                ✅ 校验通过(7 门禁全过)
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

          <!-- v0:反向解析到表单提示 -->
          {#if confidence < 0.7 && Object.keys(formValues).length > 0}
            <div class="reverse-parse-hint">
              💡 已将 LLM 草案解析到业务表单,
              <button onclick={() => (inputMode = "form")}>
                切换到业务表单核对 →
              </button>
            </div>
          {/if}
        </div>
      {/if}
    </div>
  {:else}
    <!-- 业务表单模式(v0) -->
    <BusinessForm
      schema={selectedSchemaId ? getSchemaById(selectedSchemaId) : null}
      values={formValues}
      onSave={handleFormSave}
    />
  {/if}

  <!-- v0:业务预览(结构化 + LLM) -->
  {#if structuredPreview}
    <BusinessPreview
      structured={structuredPreview}
      llmExplanation={llmExplanation}
      isExplaining={isExplaining}
      fromCache={previewFromCache}
    />
  {/if}

  <!-- 操作按钮 -->
  <div class="actions">
    <button onclick={onBack}>上一步</button>
    <button
      onclick={handleSave}
      disabled={!generatedRule || !validation?.valid}
    >
      保存并下一步
    </button>
  </div>
</div>

<style>
  .confidence[data-level="high"] { color: var(--color-success); }
  .confidence[data-level="mid"] { color: var(--color-warning); }
  .confidence[data-level="low"] { color: var(--color-error); }
  .reverse-parse-hint {
    background: var(--color-info-bg);
    padding: var(--spacing-sm);
    border-radius: var(--radius-md);
    margin-top: var(--spacing-sm);
  }
</style>
```

### 9.2 BusinessForm.svelte v0 代码(新增,字段联动 + 双层校验)

```svelte
<!-- src/lib/views/Rules/BusinessForm.svelte -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责(v0):业务表单组件
    - 根据 BusinessFormSchema 渲染字段(分 condition / action / metadata 三组)
    - 字段联动(visibleWhen / enabledWhen / requiredWhen,决策 §3.2)
    - 业务层校验(FieldValidator)
    - 实时 evorule JSON 预览(formValuesToEvoruleJson)
    - 保存:onSave(ruleJson, description, formValues)
-->

<script lang="ts">
  import { RuleValidator } from "@evorule/console";
  import type {
    BusinessFormSchema,
    BusinessFormField,
    FieldCondition,
    FieldValidator,
  } from "$lib/stores/business-form-schema";
  import { formValuesToEvoruleJson } from "./business-form-to-json";

  let {
    schema,
    values = {},
    onSave,
  } = $props<{
    schema: BusinessFormSchema | null;
    values?: Record<string, string | number | boolean>;
    onSave: (
      ruleJson: object,
      description: string,
      formValues: Record<string, string | number | boolean>
    ) => void;
  }>();

  // 表单值(本地状态)
  let formValues = $state<Record<string, string | number | boolean>>({ ...values });

  // schema 变化时重置表单值(用 defaultValue)
  $effect(() => {
    if (!schema) {
      formValues = {};
      return;
    }
    const next: Record<string, string | number | boolean> = {};
    for (const field of schema.fields) {
      if (field.defaultValue !== undefined) {
        next[field.id] = field.defaultValue;
      }
    }
    // 保留传入的 values(schema 不变时)
    for (const k of Object.keys(values)) {
      if (schema.fields.find((f) => f.id === k)) {
        next[k] = values[k];
      }
    }
    formValues = next;
  });

  // === 字段联动求值器(决策 §3.2) ===
  function evalCondition(cond: FieldCondition): boolean {
    const v = formValues[cond.fieldId];
    switch (cond.operator) {
      case "eq": return v === cond.value;
      case "ne": return v !== cond.value;
      case "gt": return Number(v) > Number(cond.value);
      case "lt": return Number(v) < Number(cond.value);
      case "in":
        return Array.isArray(cond.value) && cond.value.includes(String(v));
      case "exists":
        return v !== undefined && v !== "" && v !== null;
      default: return false;
    }
  }

  function evalConditions(conds?: FieldCondition[]): boolean {
    if (!conds || conds.length === 0) return true;
    return conds.every(evalCondition); // AND 关系
  }

  function isFieldVisible(field: BusinessFormField): boolean {
    return evalConditions(field.visibleWhen);
  }

  function isFieldEnabled(field: BusinessFormField): boolean {
    return evalConditions(field.enabledWhen);
  }

  function isFieldRequired(field: BusinessFormField): boolean {
    const baseRequired = field.validators?.some((v) => v.type === "required") ?? false;
    return baseRequired || evalConditions(field.requiredWhen);
  }

  // === 业务层校验 ===
  function validateField(field: BusinessFormField): string[] {
    const errors: string[] = [];
    const v = formValues[field.id];
    const required = isFieldRequired(field);

    if (required && (v === undefined || v === "" || v === null)) {
      errors.push(`${field.label} 必填`);
      return errors;
    }
    if (v === undefined || v === "") return errors;

    for (const validator of field.validators ?? []) {
      const err = runValidator(validator, v, field);
      if (err) errors.push(err);
    }
    return errors;
  }

  function runValidator(
    v: FieldValidator,
    value: string | number | boolean,
    field: BusinessFormField
  ): string | null {
    switch (v.type) {
      case "min":
        return Number(value) < Number(v.param) ? v.message : null;
      case "max":
        return Number(value) > Number(v.param) ? v.message : null;
      case "pattern":
        return new RegExp(v.param as string).test(String(value)) ? null : v.message;
      case "required":
        return null; // 已在 validateField 入口处理
      case "custom":
        return v.message; // 占位,v0 不实现 custom 逻辑
      default:
        return null;
    }
  }

  // === 全局校验状态 ===
  let businessErrors = $state<Record<string, string[]>>({});
  let kernelValidation = $state<{ valid: boolean; errors: string[] } | null>(null);
  let formStatus = $state<"empty" | "dirty" | "validating" | "valid" | "invalid">("empty");

  function runValidation(): void {
    if (!schema) return;
    formStatus = "validating";

    // 1. 业务层校验
    const errors: Record<string, string[]> = {};
    for (const field of schema.fields) {
      if (!isFieldVisible(field)) continue;
      const e = validateField(field);
      if (e.length > 0) errors[field.id] = e;
    }
    businessErrors = errors;

    // 2. 内核校验
    const ruleJson = formValuesToEvoruleJson(schema, formValues);
    const v = RuleValidator.validate(JSON.stringify(ruleJson));
    kernelValidation = {
      valid: v.valid,
      errors: v.errors.map((e) => e.message),
    };

    formStatus =
      Object.keys(errors).length === 0 && v.valid ? "valid" : "invalid";
  }

  // === 实时 JSON 预览 ===
  const ruleJson = $derived(
    schema ? formValuesToEvoruleJson(schema, formValues) : {}
  );

  // === 保存 ===
  function handleSave(): void {
    runValidation();
    if (formStatus !== "valid") return;
    const description = schema?.scenario ?? "未命名规则";
    onSave(ruleJson, description, formValues);
  }

  // 字段变化时自动校验(debounce 200ms)
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  $effect(() => {
    // 依赖 formValues
    formValues;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (schema) runValidation();
    }, 200);
  });
</script>

{#if !schema}
  <div class="no-schema">
    <p>请先选择业务场景(schema)</p>
  </div>
{:else}
  <div class="business-form">
    <div class="form-header">
      <h3>{schema.scenario}</h3>
      <span class="industry-badge">{schema.industry}</span>
    </div>

    <!-- 主体:按 group 分区 -->
    <div class="form-body">
      {#each ["condition", "action", "metadata"] as group}
        {#if schema.fields.filter((f) => (f.group ?? "condition") === group).length > 0}
          <fieldset class="field-group">
            <legend>
              {group === "condition" ? "条件" : group === "action" ? "动作" : "元数据"}
            </legend>
            {#each schema.fields.filter((f) => (f.group ?? "condition") === group) as field (field.id)}
              {#if isFieldVisible(field)}
                <div class="field" data-required={isFieldRequired(field)}>
                  <label for={field.id}>
                    {field.label}
                    {#if isFieldRequired(field)}<span class="required">*</span>{/if}
                  </label>

                  <!-- 字段渲染器 -->
                  {#if field.type === "number"}
                    <input
                      id={field.id}
                      type="number"
                      bind:value={formValues[field.id]}
                      disabled={!isFieldEnabled(field)}
                    />
                  {:else if field.type === "string"}
                    <input
                      id={field.id}
                      type="text"
                      bind:value={formValues[field.id]}
                      disabled={!isFieldEnabled(field)}
                    />
                  {:else if field.type === "date"}
                    <input
                      id={field.id}
                      type="date"
                      bind:value={formValues[field.id]}
                      disabled={!isFieldEnabled(field)}
                    />
                  {:else if field.type === "enum"}
                    <select
                      id={field.id}
                      bind:value={formValues[field.id]}
                      disabled={!isFieldEnabled(field)}
                    >
                      {#each field.options ?? [] as opt}
                        <option value={opt}>{opt}</option>
                      {/each}
                    </select>
                  {:else if field.type === "boolean"}
                    <input
                      id={field.id}
                      type="checkbox"
                      bind:checked={formValues[field.id]}
                      disabled={!isFieldEnabled(field)}
                    />
                  {/if}

                  <!-- 字段说明 -->
                  {#if field.description}
                    <small class="field-desc">{field.description}</small>
                  {/if}

                  <!-- 业务层校验错误 -->
                  {#if businessErrors[field.id]}
                    <div class="field-errors">
                      {#each businessErrors[field.id] as err}
                        <span class="error">❌ {err}</span>
                      {/each}
                    </div>
                  {/if}
                </div>
              {/if}
            {/each}
          </fieldset>
        {/if}
      {/each}
    </div>

    <!-- v0:校验面板 -->
    <div class="validation-panel">
      <h4>校验</h4>
      <div class="validation-status" data-status={formStatus}>
        {formStatus === "empty" && "待填写"}
        {formStatus === "dirty" && "有改动未校验"}
        {formStatus === "validating" && "校验中..."}
        {formStatus === "valid" && "✅ 全部通过"}
        {formStatus === "invalid" && "❌ 有错误"}
      </div>

      {#if kernelValidation && !kernelValidation.valid}
        <div class="kernel-errors">
          <strong>内核校验(7 门禁):</strong>
          <ul>
            {#each kernelValidation.errors as err}
              <li>{err}</li>
            {/each}
          </ul>
        </div>
      {/if}
    </div>

    <!-- v0:JSON 预览 -->
    <details class="json-preview">
      <summary>evorule JSON 预览(实时)</summary>
      <pre>{JSON.stringify(ruleJson, null, 2)}</pre>
    </details>

    <!-- 操作按钮 -->
    <div class="form-actions">
      <button onclick={() => runValidation()}>校验</button>
      <button
        onclick={handleSave}
        disabled={formStatus !== "valid"}
      >
        保存
      </button>
    </div>
  </div>
{/if}
```

### 9.3 表单 ↔ JSON 双向转换器 v0(P0-1 §11.3 增强,含 branch)

```typescript
// src/lib/views/Rules/business-form-to-json.ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 业务表单值 ↔ evorule JSON 双向转换(v0)。
// P0-1 基础:formValuesToEvoruleJson(单向,schema → JSON)
// v0 扩展:
//   - evoruleJsonToFormValues(反向,LLM 草案 → 表单,决策 §3.7)
//   - 支持 branch / io_request 等 evorule 复杂结构
//   - setPath / getPath 对称实现
//
// 与内核边界:
//   - 内核 RuleValidator 是 JSON 合法性的最终权威
//   - 本转换器只做"表单值 ↔ JSON 字段"映射,不校验

import type {
  BusinessFormField,
  BusinessFormSchema,
} from "$lib/stores/business-form-schema";

export interface FormValues {
  [fieldId: string]: string | number | boolean;
}

/**
 * 把业务表单值转换为 evorule JSON 对象(正向)。
 *
 * v0 增强:支持点分路径 + 数组索引(如 "branch[0].condition.value")
 */
export function formValuesToEvoruleJson(
  schema: BusinessFormSchema,
  values: FormValues,
): object {
  const result: Record<string, unknown> = {};

  for (const field of schema.fields) {
    const value = values[field.id];
    if (value === undefined || value === "") continue;

    const converted = convertValue(value, field);
    setPath(result, field.evorulePath, converted);
  }

  return result;
}

/**
 * v0 新增:把 evorule JSON 反向解析为业务表单值。
 *
 * 用法:LLM 草案生成后,反向填入表单让业务专家编辑(决策 §3.7)。
 *
 * 注意:
 *   - 只解析 schema 中定义的字段(未定义的字段丢失,提示用户切到 raw JSON)
 *   - 类型反向转换:number → string(若 field.type='string')等
 */
export function evoruleJsonToFormValues(
  schema: BusinessFormSchema,
  ruleJson: object,
): FormValues {
  const values: FormValues = {};

  for (const field of schema.fields) {
    const v = getPath(ruleJson, field.evorulePath);
    if (v === undefined) continue;

    values[field.id] = reverseConvertValue(v, field);
  }

  return values;
}

// === 类型转换 ===

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

function reverseConvertValue(
  value: unknown,
  field: BusinessFormField,
): string | number | boolean {
  switch (field.type) {
    case "number":
      return typeof value === "number" ? value : Number(value);
    case "boolean":
      return typeof value === "boolean" ? value : value === "true";
    case "enum":
    case "string":
    case "date":
    default:
      return String(value);
  }
}

/**
 * v0 增强:setPath 支持点分 + 数组索引。
 *
 * 示例:
 *   setPath(result, "branch[0].condition.value", 10000)
 *   → result.branch[0].condition.value = 10000
 */
function setPath(
  obj: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  // 解析 path:点分 + [index]
  // "branch[0].condition.value" → ["branch", 0, "condition", "value"]
  const parts: Array<string | number> = [];
  const segments = path.split(".");
  for (const seg of segments) {
    const match = seg.match(/^([a-zA-Z_$][\w$]*)(\[\d+\])*$/);
    if (match) {
      parts.push(match[1]);
      const indexMatches = seg.match(/\[(\d+)\]/g);
      if (indexMatches) {
        for (const im of indexMatches) {
          parts.push(Number(im.match(/\d+/)![0]));
        }
      }
    } else {
      parts.push(seg);
    }
  }

  let current: unknown = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    const nextK = parts[i + 1];
    if (typeof current !== "object" || current === null) return;

    if (typeof k === "number") {
      const arr = current as unknown[];
      if (arr[k] === undefined || typeof arr[k] !== "object") {
        arr[k] = typeof nextK === "number" ? [] : {};
      }
      current = arr[k];
    } else {
      const record = current as Record<string, unknown>;
      if (record[k] === undefined || typeof record[k] !== "object") {
        record[k] = typeof nextK === "number" ? [] : {};
      }
      current = record[k];
    }
  }

  const lastK = parts[parts.length - 1];
  if (typeof current !== "object" || current === null) return;
  if (typeof lastK === "number") {
    (current as unknown[])[lastK] = value;
  } else {
    (current as Record<string, unknown>)[lastK] = value;
  }
}

/**
 * v0 新增:getPath(对称 setPath,支持点分 + 数组索引)。
 */
function getPath(obj: object, path: string): unknown {
  const parts: Array<string | number> = [];
  const segments = path.split(".");
  for (const seg of segments) {
    const match = seg.match(/^([a-zA-Z_$][\w$]*)(\[\d+\])*$/);
    if (match) {
      parts.push(match[1]);
      const indexMatches = seg.match(/\[(\d+)\]/g);
      if (indexMatches) {
        for (const im of indexMatches) {
          parts.push(Number(im.match(/\d+/)![0]));
        }
      }
    } else {
      parts.push(seg);
    }
  }

  let current: unknown = obj;
  for (const k of parts) {
    if (current === undefined || current === null) return undefined;
    if (typeof k === "number") {
      current = (current as unknown[])[k];
    } else {
      current = (current as Record<string, unknown>)[k];
    }
  }
  return current;
}
```

### 9.4 业务预览结构化解释器 v0(新增,决策 §3.5)

```typescript
// src/lib/views/Rules/business-preview-explainer.ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 业务预览结构化解释器(v0 新增,决策 §3.5)。
//
// 设计:
//   - 本地计算(无 LLM),100% 确定性
//   - 根据 evorule JSON 的 condition + action 字段拼装"如果 X 则 Y"
//   - 术语高亮:匹配 ifPart/thenPart 中的术语 label / synonyms
//
// 与 LLM 自然语言层的关系:
//   - 结构化层是基础,LLM 层是锦上添花
//   - LLM 不可用时,只显示结构化层
//   - LLM 可用时,结构化层 + LLM 自然语言层并列显示

import type { BusinessTerm } from "$lib/stores/business-terms";
import type { StructuredExplanation } from "$lib/stores/business-preview";

/**
 * 生成结构化解释。
 *
 * @param ruleJson evorule JSON 对象
 * @param terms 当前行业激活术语列表(用于高亮)
 * @returns 结构化解释 { ifPart, thenPart, elsePart?, terms }
 */
export function explainStructured(
  ruleJson: object,
  terms: BusinessTerm[],
): StructuredExplanation {
  const rule = ruleJson as Record<string, unknown>;
  const condition = rule.condition as Record<string, unknown> | undefined;
  const action = rule.action as Record<string, unknown> | undefined;
  const branch = rule.branch as Array<Record<string, unknown>> | undefined;

  // 优先用 branch(多分支规则)
  if (branch && branch.length > 0) {
    return explainBranch(branch, terms);
  }

  // 单条件 + 单动作
  const ifPart = condition ? explainCondition(condition, terms) : "(无条件)";
  const thenPart = action ? explainAction(action, terms) : "(无动作)";

  return {
    ifPart,
    thenPart,
    terms: collectTerms(`${ifPart} ${thenPart}`, terms),
    templateId: "single-condition-action",
  };
}

function explainBranch(
  branch: Array<Record<string, unknown>>,
  terms: BusinessTerm[],
): StructuredExplanation {
  // 简化版:取第一个分支作为 ifPart,最后一个分支(all[])作为兜底 elsePart
  const first = branch[0];
  const last = branch[branch.length - 1];

  const condition = first.condition as Record<string, unknown> | undefined;
  const action = first.action as Record<string, unknown> | undefined;

  const ifPart = condition ? explainCondition(condition, terms) : "(默认)";
  const thenPart = action ? explainAction(action, terms) : "(无动作)";

  // 检查 last 是否为兜底(all[])
  const lastCondition = last.condition as Record<string, unknown> | undefined;
  const lastDomain = lastCondition?.domain as string | undefined;
  const elsePart =
    lastDomain === "all" && (lastCondition?.params as unknown[])?.length === 0
      ? explainAction(last.action as Record<string, unknown>, terms)
      : undefined;

  return {
    ifPart,
    thenPart,
    elsePart,
    terms: collectTerms(`${ifPart} ${thenPart} ${elsePart ?? ""}`, terms),
    templateId: "branch-with-fallback",
  };
}

function explainCondition(
  condition: Record<string, unknown>,
  terms: BusinessTerm[],
): string {
  const domain = condition.domain as string;
  const params = condition.params as Record<string, unknown> | undefined;
  const value = condition.value as unknown;

  switch (domain) {
    case "eq":
      return `等于 ${String(value)}`;
    case "lt":
      return `小于 ${value}`;
    case "gt":
      return `大于 ${value}`;
    case "exists":
      return `存在 ${String(value)}`;
    case "instruction":
      return `执行指令 ${String(value)}`;
    case "all":
      return `所有条件满足`;
    default:
      return `(未知条件类型: ${domain})`;
  }
}

function explainAction(
  action: Record<string, unknown>,
  terms: BusinessTerm[],
): string {
  const meta = action.meta as string | undefined;
  const params = action.params as Record<string, unknown> | undefined;

  // meta 指令:set / push / branch / io_request
  if (meta === "set") {
    const key = params?.key as string;
    const value = params?.value as unknown;
    return `设置 ${key} = ${String(value)}`;
  }
  if (meta === "push") {
    const key = params?.key as string;
    return `追加到 ${key}`;
  }
  if (meta === "branch") {
    return `(分支,详见结构化展示)`;
  }
  if (meta === "io_request") {
    const url = params?.url as string;
    return `调用外部接口 ${url}`;
  }

  // 动作描述(用术语翻译)
  const role = params?.role as string;
  const channel = params?.channel as string;
  if (role) {
    const channelText = channel ? `(通过 ${channel})` : "";
    return `通知 ${role} ${channelText}`;
  }

  return `执行动作(${meta ?? "未知"})`;
}

/**
 * 在解释文本中匹配术语,返回命中的术语列表(用于 UI 高亮)。
 */
function collectTerms(
  text: string,
  terms: BusinessTerm[],
): Array<{ termId: string; label: string; matchedText: string }> {
  const result: Array<{ termId: string; label: string; matchedText: string }> =
    [];

  for (const term of terms) {
    const candidates = [term.label, ...term.synonyms];
    for (const cand of candidates) {
      if (text.includes(cand)) {
        result.push({
          termId: term.id,
          label: term.label,
          matchedText: cand,
        });
        break; // 每个术语只匹配一次
      }
    }
  }

  return result;
}
```

### 9.5 自动补全业务术语关联(新增)

```typescript
// src/lib/views/Rules/auto-fill-terms.ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 自动补全规则的业务术语关联(v0 新增)。
// 用法:BusinessForm 保存时,根据 schema 字段的 termId 自动补全 ruleBusinessMeta.businessTermIds
//
// 设计:
//   - 扫描 schema.fields 的 termId(每个字段关联一个术语)
//   - 扫描 formValues 中非空的字段(用户填了值 = 该术语被使用)
//   - 与 existingTermIds 合并去重

import type { BusinessFormSchema } from "$lib/stores/business-form-schema";
import type { FormValues } from "./business-form-to-json";

export function autoFillTermIds(
  schema: BusinessFormSchema,
  formValues: FormValues,
  existingTermIds: string[],
): string[] {
  const usedTermIds = new Set<string>(existingTermIds);

  for (const field of schema.fields) {
    if (!field.termId) continue;
    const v = formValues[field.id];
    if (v === undefined || v === "" || v === null) continue;
    usedTermIds.add(field.termId);
  }

  return Array.from(usedTermIds);
}
```

---

## 10. 数据流(v0)

### 10.1 建库向导 Step 3 完整数据流(v0)

```
用户进入 Step 3
  │
  ├── 1. SchemaSelector 加载 availableSchemas
  │     └─ getSchemasByBusinessObject(businessObjects[0], dbStore.industry)
  │     └─ 用户选 schema → selectedSchemaId
  │
  ├── 2a. (LLM 模式)用户输入自然语言
  │     ├── [生成规则草案] → assistant.generateRuleDraft()
  │     │   ├── generatedRule = result.rule
  │     │   ├── confidence = result.confidence
  │     │   └── 反向解析 formValues = evoruleJsonToFormValues(schema, rule)
  │     ├── RuleValidator.validate(JSON) → 内核 7 门禁
  │     ├── explainStructured(rule, terms) → 结构化预览(本地)
  │     ├── getCachedExplanation(tempRuleId, content) → 命中缓存?
  │     │   ├── 命中 → llmExplanation = cached.llmExplanation
  │     │   └── 未命中 → assistant.explainRule(rule) → setCachedExplanation
  │     └── (低置信度)提示切换到业务表单模式
  │
  ├── 2b. (业务表单模式)用户填字段
  │     ├── 字段联动求值(visibleWhen / enabledWhen / requiredWhen)
  │     ├── 业务层校验(FieldValidator)
  │     ├── 实时 evorule JSON 预览(formValuesToEvoruleJson)
  │     └── (debounce 200ms)runValidation() → 业务 + 内核双层
  │
  ├── 3. [保存] → handleSave()
  │     ├── addRule({ id, version, description, content: JSON.stringify(ruleJson) })
  │     │   └── 内核 rules store 更新 + localStorage 持久化
  │     │   └── 派生 isEmptyDb = false → HomeRouter 选 C
  │     ├── autoFillTermIds(schema, formValues, []) → businessTermIds
  │     └── setMeta({ ruleId, industry, businessObject, schemaId, formValues, businessTermIds, ... })
  │
  └── 4. onCreated(ruleId) → 跳 Step 4(试运行)
```

### 10.2 工作台规则库编辑数据流(v0)

```
用户在工作台点击规则卡片
  │
  ├── 1. BusinessRuleCard 加载规则 + 业务元数据
  │     ├── rules store 取 Rule
  │     └── ruleBusinessMetaStore 取 RuleBusinessMeta
  │         ├── industry / businessObject / schemaId
  │         └── formValues(反向填入表单)
  │
  ├── 2. BusinessForm 渲染(用 schemaId 取 schema)
  │     ├── 字段联动 + 默认值 + formValues 预填
  │     └── 实时校验 + JSON 预览
  │
  ├── 3. 用户改字段
  │     ├── 字段联动重新求值
  │     ├── 业务层校验
  │     └── JSON 预览实时更新
  │
  ├── 4. [保存] → handleSave()
  │     ├── updateRule(ruleId, { content: JSON.stringify(newJson) })
  │     │   └── 内核 rules store 更新 + 派生 selectedRule 变化
  │     ├── setMeta({ ruleId, formValues, updatedAt })
  │     └── BusinessPreview 重新生成
  │         ├── 旧缓存失效(contentHash 变化)
  │         └── (LLM 可用时)重新调 explainRule + 写缓存
  │
  └── 5. BusinessPreview 显示对比 diff(决策 §3.9)
        ├── RuleDiff 列出 changedFields
        └── businessImpact 翻译(用术语库)
```

### 10.3 业务预览缓存命中流程(v0)

```
用户选中规则 R
  │
  ├── 1. BusinessPreview.svelte 接收 ruleId + content
  │
  ├── 2. hashContent(content) → contentHash(8 字符)
  │
  ├── 3. getCachedExplanation(ruleId, content)
  │     └─ localStorage.getItem(`${CACHE_PREFIX}${ruleId}:${contentHash}`)
  │
  ├── 4. 命中?
  │     ├── 是 → 直接用 cached.structured + cached.llmExplanation
  │     │        └─ 显示 [cached] 徽标
  │     └── 否 → 4a. explainStructured(rule, terms) → 结构化层(本地)
  │              4b. assistant?.explainRule(rule)
  │                  ├── 成功 → setCachedExplanation({...})
  │                  └── 失败/未配置 → 只显示结构化层(降级)
  │
  └── 5. 规则 content 变化 → contentHash 变化 → 旧 key 留在 localStorage(P1 清理)
                                          └─ 新 key 未命中 → 重新生成
```

---

## 11. 测试策略

### 11.1 单元测试(Vitest)

| 模块                             | 测试文件                             | 覆盖点                                                                |
| -------------------------------- | ------------------------------------ | --------------------------------------------------------------------- |
| `business-terms.ts`              | `business-terms.test.ts`             | CRUD + 同义词匹配 + 行业过滤 + status 流转 + 索引重建                 |
| `business-form-schema.ts`        | `business-form-schema.test.ts`       | CRUD + 按 industry/businessObject 筛选 + version 自增                 |
| `rule-business-meta.ts`          | `rule-business-meta.test.ts`         | setMeta / getMeta / getMetaBulk / removeMeta + localStorage 持久化    |
| `business-preview.ts`            | `business-preview.test.ts`           | hashContent 稳定性 + 缓存命中/失效 + localStorage 容量上限处理        |
| `business-form-to-json.ts`       | `business-form-to-json.test.ts`      | 正向转换(单字段 / branch[0] / io_request) + 反向解析 + 类型转换       |
| `business-preview-explainer.ts`  | `business-preview-explainer.test.ts` | 单条件规则 / branch 规则 / 兜底规则 / 术语高亮匹配                    |
| `auto-fill-terms.ts`             | `auto-fill-terms.test.ts`            | 字段 termId 补全 + 去重 + 空值过滤                                    |
| `evalCondition`(BusinessForm 内) | `business-form-eval.test.ts`         | 6 操作符(eq/ne/gt/lt/in/exists)+ visibleWhen/enabledWhen/requiredWhen |

**关键测试用例(示例)**:

```typescript
// business-form-to-json.test.ts
describe("formValuesToEvoruleJson", () => {
  it("支持点分路径 + 数组索引(branch[0])", () => {
    const schema: BusinessFormSchema = {
      id: "test",
      industry: "finance",
      scenario: "测试",
      version: 1,
      fields: [
        {
          id: "threshold",
          label: "阈值",
          type: "number",
          evorulePath: "branch[0].condition.value",
          description: "",
        },
      ],
    };
    const values = { threshold: 10000 };
    const json = formValuesToEvoruleJson(schema, values);
    expect(json).toEqual({
      branch: [{ condition: { value: 10000 } }],
    });
  });

  it("反向解析 LLM 草案回表单", () => {
    const schema: BusinessFormSchema = {
      /* ... */
    };
    const llmJson = {
      condition: { value: 10000 },
      action: { params: { role: "CFO" } },
    };
    const values = evoruleJsonToFormValues(schema, llmJson);
    expect(values.threshold).toBe(10000);
    expect(values.approver_role).toBe("CFO");
  });
});

// business-preview-explainer.test.ts
describe("explainStructured", () => {
  it("单条件 + 单动作规则", () => {
    const ruleJson = {
      condition: { domain: "gt", value: 10000 },
      action: { meta: "set", params: { key: "approver", value: "CFO" } },
    };
    const result = explainStructured(ruleJson, []);
    expect(result.ifPart).toContain("大于 10000");
    expect(result.thenPart).toContain("设置 approver = CFO");
  });

  it("术语高亮:在解释中匹配术语 label/synonyms", () => {
    const ruleJson = { condition: { domain: "gt", value: 10000 } };
    const terms: BusinessTerm[] = [
      {
        id: "finance.threshold",
        industry: "finance",
        label: "审批阈值",
        key: "threshold",
        synonyms: ["上限"],
        description: "",
        status: "active",
        version: 1,
      },
    ];
    const result = explainStructured(
      { ...ruleJson, _testLabel: "审批阈值" }, // 假设解释中包含"审批阈值"
      terms,
    );
    expect(
      result.terms.find((t) => t.termId === "finance.threshold"),
    ).toBeTruthy();
  });
});

// business-terms.test.ts
describe("matchTerms", () => {
  it("同义词前缀匹配 + 行业优先级", () => {
    const result = matchTerms("上限", "finance");
    expect(result.find((t) => t.id === "finance.threshold")).toBeTruthy();
    expect(result[0].industry).toBe("finance");
  });

  it("status=draft 的术语不出现在匹配结果", () => {
    // 假设有 draft 术语
    const result = matchTerms("draft术语label");
    expect(result.find((t) => t.status === "draft")).toBeFalsy();
  });
});
```

### 11.2 E2E 测试(Playwright)

| 场景                                  | 步骤                                                                                         |
| ------------------------------------- | -------------------------------------------------------------------------------------------- |
| 业务专家 5 分钟建库向导(业务表单模式) | Step 1 选模板 → Step 2 命名 → Step 3 选 schema + 填字段 + 保存 → Step 4 试运行 → Step 5 完成 |
| LLM 辅助建库(LLM 配置好)              | Step 3 LLM 模式 → 输入自然语言 → 生成草案 → 反向解析到表单 → 保存                            |
| LLM 不可用降级                        | LLM 未配置 → Step 3 自动切到表单模式 → 填字段 → 保存                                         |
| 规则编辑 + 业务预览                   | 工作台 → 选规则 → 改字段 → 业务预览实时更新 → 保存                                           |
| 业务预览缓存命中                      | 选中规则 → 显示 [cached] → 改规则 → 缓存失效 → 重新生成                                      |
| 术语管理(新建 + 弃用)                 | 工作台 → 术语管理器 → 新建术语 → 弃用术语 → 规则库筛选不再显示该术语                         |

### 11.3 测试覆盖率目标

| 模块                            | 行覆盖率 | 分支覆盖率 | 关键路径                          |
| ------------------------------- | -------- | ---------- | --------------------------------- |
| `business-form-to-json.ts`      | ≥ 95%    | ≥ 90%      | 正向 + 反向 + 数组索引 + 类型转换 |
| `business-preview-explainer.ts` | ≥ 90%    | ≥ 85%      | 单条件 / branch / 兜底 / 术语高亮 |
| `business-terms.ts`             | ≥ 90%    | ≥ 85%      | CRUD + matchTerms + status 流转   |
| `business-form-schema.ts`       | ≥ 90%    | ≥ 80%      | CRUD + 筛选                       |
| `rule-business-meta.ts`         | ≥ 90%    | ≥ 80%      | setMeta / getMetaBulk             |
| `business-preview.ts`(缓存)     | ≥ 85%    | ≥ 75%      | hashContent 稳定性 + 命中/失效    |

---

## 12. 与 P0-1 的一致性更新

### 12.1 P0-1 需要同步修改的章节(实施时执行)

| P0-1 章节                       | 修改内容                                                                                                             | 触发本文档章节 |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------- |
| §4.3 BusinessTerm 类型          | 加 `status` / `aliases` / `relatedTermIds` / `evorulePaths` / `deprecatedBy` / `version`                             | §4.1           |
| §4.4 BusinessFormSchema 类型    | 加 `visibleWhen` / `enabledWhen` / `requiredWhen` / `validators` / `businessObjects` / `conditionGroups` / `version` | §4.2           |
| §4.5 RuleBusinessMeta 类型      | 加 `schemaId` / `formValues` / `createdAt` / `updatedAt`                                                             | §4.3           |
| §7.1 BUILTIN_BUSINESS_TERMS     | 从 6 条扩到 12 条(2 行业 × 6 术语)                                                                                   | §7.1           |
| §7.2 BUILTIN_FORM_SCHEMAS       | 从 2 条扩到 4 条(2 行业 × 2 场景)+ 字段联动 + group                                                                  | §7.2           |
| §6.2 BusinessRuleLibrary 组件树 | 加 SchemaSelector / StructuredPreview / LlmExplanation / RuleDiff                                                    | §6.1           |
| §6.4 StepFirstRule 组件树       | 加 SchemaSelector + 反向解析 + 置信度可视化                                                                          | §6.2           |
| §11.1 StepFirstRule 代码示例    | 加 v0 双模式 + 反向解析 + 缓存                                                                                       | §9.1           |
| §11.3 formValuesToEvoruleJson   | 加 evoruleJsonToFormValues(反向) + 数组索引支持                                                                      | §9.3           |

### 12.2 实施顺序(建议)

```
P0-2 v0 实施分 5 步:
  │
  ├── 步骤 1:数据模型扩展(§4)
  │   ├── business-terms.ts v0 扩展
  │   ├── business-form-schema.ts v0 扩展
  │   ├── rule-business-meta.ts v0 扩展
  │   └── business-preview.ts 新增
  │
  ├── 步骤 2:内置数据扩展(§7)
  │   ├── business-terms-builtin.ts 12 条
  │   └── business-form-schemas-builtin.ts 4 条
  │
  ├── 步骤 3:核心算法(§9.3 / §9.4 / §9.5)
  │   ├── business-form-to-json.ts 双向 + 数组索引
  │   ├── business-preview-explainer.ts 结构化解释
  │   └── auto-fill-terms.ts 自动补全
  │
  ├── 步骤 4:组件实现(§6)
  │   ├── BusinessForm.svelte(字段联动 + 双层校验)
  │   ├── BusinessPreview.svelte(结构化 + LLM + 缓存)
  │   ├── SchemaSelector.svelte
  │   ├── BusinessTermFilter.svelte 增强
  │   ├── BusinessTermManager.svelte
  │   └── StepFirstRule.svelte v0(双模式 + 反向解析)
  │
  └── 步骤 5:测试(§11)
      ├── 单元测试(8 个测试文件)
      └── E2E 测试(6 个场景)
```

### 12.3 与 HOME_DESIGN.md 的一致性

| HOME_DESIGN.md 章节                    | 与本文档关系                                    |
| -------------------------------------- | ----------------------------------------------- |
| §5.3 OnboardingWizard Step 3           | 实现细节引用本文档 §6.2 / §9.1                  |
| §5.3 OnboardingWizard Step 4           | 实现细节引用本文档 §6.3                         |
| §5.4 RealWorkbench BusinessRuleLibrary | 实现细节引用本文档 §6.1                         |
| §6.2 dbStore                           | 不变(本文档不修改 dbStore)                      |
| §7.x 数据流                            | Step 3 / 规则编辑数据流引用本文档 §10.1 / §10.2 |

---

## 13. 长期演进路径

### 13.1 v0(P0-2,本文档)

- 业务术语库:12 条 builtin(2 行业 × 6 术语)+ CRUD + 同义词匹配
- 业务表单:4 条 builtin schema(2 行业 × 2 场景)+ 字段联动 + 双层校验
- 业务预览:结构化 + LLM + 缓存 + LLM 不可用降级
- 表单 ↔ JSON 双向转换(含 branch[0] / io_request)
- **L1 监控大屏业务语言显示**(2026-08-06 三层架构同步):FactBusinessDisplay + FactStreamView,复用 L2 术语高亮 + 业务预览展示实时 Fact 流(§4.5 + §6.6)
- **层归属明确**:业务语言层主战场在 L2 编辑台,L1 监控大屏复用(§1.7)

### 13.2 v1(P1)

- 10 行业浅模板(战略 §20.5),每行业 6-10 条 builtin 术语 + 2-3 条 schema
- 字段联动支持 OR 关系(`anyOf` 组合器)
- 复合条件 AST(从 `ConditionGroup` 升级)
- 术语版本树(`term.versions[]`,旧版本仍可查询)
- 业务预览对比 diff 增强(支持规则语义 diff,需内核支持)
- LLM 解释缓存 LRU 清理(避免 localStorage 撑爆)

### 13.3 v2(P2)

- 多语言(中英文,LLM 自动翻译术语)
- 规则版本树 / 时间旅行编辑
- 规则审批流(草稿 → 提交 → 审批 → 发布)
- 规则复用 / 跨库共享
- JSON Schema 标准导入器(社区 schema 兼容)

### 13.4 v3(P3+)

- NLP 自动术语提取(从业务文档提取术语建库)
- 业务术语多语言对齐(跨语言同义词)
- 业务规则推荐(基于业务对象 / 行为自动推荐规则)

### 13.5 兼容性保证

| 版本    | 数据模型兼容性                                                 | 内核 API 兼容性       |
| ------- | -------------------------------------------------------------- | --------------------- |
| v0 → v1 | BusinessTerm / BusinessFormSchema 字段只加不删,v1 兼容 v0 数据 | 不变(内核 API 已稳定) |
| v1 → v2 | 多语言字段加 `labels: { zh, en }`(原 `label` 保留为中文别名)   | 不变                  |
| v2 → v3 | NLP 提取的术语加 `source: 'nlp'`                               | 不变                  |

---

## 14. 待办

### 14.1 立即可做(P0-2 实施前)

- [ ] 确认内核 `useAssistantOrNull` 在 StepFirstRule 中的可用性(已在 `cloud-llm-assistant.ts` 验证)
- [ ] 确认 `dbStore.industry` 字段已落地(P0-1 §4.2)
- [ ] 确认 `dbStore.businessObjects` 在 Step 2 已选好

### 14.2 P0-2 实施时

- [ ] 步骤 1-5(见 §12.2)
- [ ] 每步骤完成后跑测试(单元 + E2E)

### 14.3 与内核 / 后端协调

- [ ] 内核 `RuleValidator` 是否需要暴露 7 门禁的逐项结果(目前 `ValidationResult.errors` 已含 gate 字段,v0 直接用)
- [ ] 后端 evorule-server 是否需要持久化 `ruleBusinessMeta`(P0 v0 不需要,localStorage 够用;P1 多租户时需要)

### 14.4 与战略文档 / HOME_DESIGN.md / 三层架构同步

- [ ] 实施完成后,在 HOME_DESIGN.md §5.3 Step 3 / §5.4 RealWorkbench 加 v0 实现细节引用
- [ ] 战略文档 §5.8 + §20.x 加 P0-2 v0 完成状态标记
- [x] 三层架构同步:业务语言层 L2 归属 + L1 监控大屏 Fact 业务化展示(§1.7 + §4.5 + §6.6)— 2026-08-06 已完成
- [x] 与 HOME_DESIGN.md §5.3 MonitorDashboard 对齐:FactStreamView 作为 MonitorDashboard 子组件(§6.6)— 2026-08-06 已完成

---

## 15. 与战略文档 / HOME_DESIGN.md / P01 的引用关系

| 战略文档章节                  | 本文档章节                   |
| ----------------------------- | ---------------------------- |
| §5.8.1 真实 ≠ 展示            | §1.2 v0 阶段定位             |
| §5.8.3 状态 C 真实工作台      | §6.1 BusinessRuleLibrary v0  |
| §5.8.5 状态 B 建库向导 Step 3 | §6.2 StepFirstRule v0 / §9.1 |
| §20.2 业务专家 5 分钟跑通     | §10.1 建库向导完整数据流     |
| §20.5 10 行业浅模板           | §13.2 v1 演进                |

| HOME_DESIGN.md 章节                    | 本文档章节                   |
| -------------------------------------- | ---------------------------- |
| §1.3 关联设计文档                      | (HOME_DESIGN 引用本文档)     |
| §5.3 OnboardingWizard Step 3           | §6.2 StepFirstRule v0 / §9.1 |
| §5.3 OnboardingWizard Step 4           | §6.3 StepTrialRun v0         |
| §5.4 RealWorkbench BusinessRuleLibrary | §6.1 BusinessRuleLibrary v0  |
| §5.3 MonitorDashboard(L1 监控大屏)     | §6.6 FactStreamView v0       |
| §3.1 层感知升级(L1/L2)                 | §1.7 与三层架构关系          |

| 三层架构章节                    | 本文档章节                                     |
| ------------------------------- | ---------------------------------------------- |
| §3.2 监控大屏设计(Fact 流)      | §4.5 FactBusinessDisplay + §6.6 FactStreamView |
| §11.4 P02 同步点                | §1.7 + §4.5 + §6.6(2026-08-06 已同步)          |
| §12.4 U7 决策(session_switched) | §6.6 FactStreamView 底部 toast                 |

| P01 章节                            | 本文档章节(深化)                   |
| ----------------------------------- | ---------------------------------- |
| §3.3 业务语言层 = 3 子层 + 1 派生层 | §3 关键架构决策                    |
| §4.3 BusinessTerm 类型              | §4.1 BusinessTerm v0 扩展          |
| §4.4 BusinessFormSchema 类型        | §4.2 BusinessFormSchema v0 扩展    |
| §4.5 RuleBusinessMeta 类型          | §4.3 RuleBusinessMeta v0 联动      |
| §6.2 BusinessRuleLibrary 组件树     | §6.1 BusinessRuleLibrary v0 组件树 |
| §6.4 StepFirstRule 组件树           | §6.2 StepFirstRule v0 组件树       |
| §7.1 BUILTIN_BUSINESS_TERMS         | §7.1 BUILTIN_BUSINESS_TERMS v0     |
| §7.2 BUILTIN_FORM_SCHEMAS           | §7.2 BUILTIN_FORM_SCHEMAS v0       |
| §11.1 StepFirstRule 代码示例        | §9.1 StepFirstRule v0 代码         |
| §11.3 formValuesToEvoruleJson       | §9.3 表单 ↔ JSON 双向转换器        |

---

## 16. 附录

### 16.1 术语表

| 术语             | 定义                                                                   |
| ---------------- | ---------------------------------------------------------------------- |
| 业务术语         | 行业词表中的一个词(如"金额"/"控制点"),用于业务语言筛选 + 高亮          |
| 业务表单 schema  | 一组业务字段的定义(如"报销上限规则"含金额阈值 + 审批人 + 通知渠道)     |
| 业务预览         | 把规则 JSON 翻译成"如果 X 则 Y"的业务可读形式                          |
| 结构化解释       | 本地计算的预览(无 LLM),格式为 `{ ifPart, thenPart, elsePart?, terms }` |
| 反向解析         | 把 LLM 生成的 JSON 草案反向填回业务表单(决策 §3.7)                     |
| 字段联动         | 字段的可见/启用/必填依赖其他字段的值(visibleWhen 等)                   |
| 业务元数据扩展表 | console-cloud 层的 `ruleBusinessMetaStore`,关联规则与业务元数据        |

### 16.2 文件清单(v0 实施)

```
src/lib/stores/
├── business-terms.ts              (v0 扩展,§4.1)
├── business-form-schema.ts        (v0 扩展,§4.2)
├── rule-business-meta.ts          (v0 扩展,§4.3)
└── business-preview.ts            (v0 新增,§4.4)

src/lib/data/
├── business-terms-builtin.ts      (v0 扩展 12 条,§7.1)
└── business-form-schemas-builtin.ts (v0 扩展 4 条,§7.2)

src/lib/views/Rules/
├── BusinessForm.svelte            (v0 新增,§9.2)
├── BusinessForm.test.ts           (v0 新增)
├── BusinessPreview.svelte         (v0 新增)
├── BusinessPreview.test.ts        (v0 新增)
├── business-form-to-json.ts       (v0 双向 + 数组索引,§9.3)
├── business-form-to-json.test.ts  (v0 新增)
├── business-preview-explainer.ts  (v0 新增,§9.4)
├── business-preview-explainer.test.ts (v0 新增)
├── auto-fill-terms.ts             (v0 新增,§9.5)
├── auto-fill-terms.test.ts         (v0 新增)
├── BusinessTermFilter.svelte      (v0 增强,同义词匹配)
├── BusinessTermManager.svelte     (v0 新增,术语 CRUD)
├── SchemaSelector.svelte          (v0 新增,§6.1)
├── RuleDiff.svelte                (v0 新增,§3.9)
├── StructuredPreview.svelte       (v0 新增,§9.4)
└── LlmExplanation.svelte          (v0 新增,带缓存徽标)

src/lib/views/Build/WizardSteps/
└── StepFirstRule.svelte           (v0 增强,双模式 + 反向解析,§9.1)

src/lib/types/
├── fact-business-display.ts       (v0 新增,L1 Fact 业务化展示类型,§4.5.1)
└── (business-preview.ts 等 v0 类型见 §4.4)

src/lib/factories/
├── fact-business-mapper.ts        (v0 新增,Fact → FactBusinessDisplay 派生,§4.5.2)
└── fact-business-mapper.test.ts   (v0 新增)

src/lib/views/Home/Monitor/        (L1 监控大屏,三层架构同步新增)
├── FactStreamView.svelte          (v0 新增,L1 Fact 流业务化展示,§6.6)
├── FactCard.svelte                (v0 新增,单条 Fact 业务化卡片,§6.6)
└── AnomalyCard.svelte             (v0 新增,异常告警业务化卡片,§6.6)

src/routes/
└── (无需修改,HOME_DESIGN §4 已定路由表,/runtime 由 MonitorDashboard 渲染)
```

### 16.3 决策追溯表

| 决策                                           | 出处  | 理由摘要                                    |
| ---------------------------------------------- | ----- | ------------------------------------------- |
| 同义词归一化 + 前缀索引,不引全文检索           | §3.1  | ≤ 100 条术语,前缀匹配 + 行业过滤已足够      |
| 字段联动 visibleWhen 等,不引 JSON Schema       | §3.2  | 6 操作符覆盖 v0,业务专家可读                |
| 复合条件用 ConditionGroup,不引 AST             | §3.3  | 扁平 + combinator 是 AST 子集,P1 可平滑升级 |
| 沿用自定义 BusinessFormSchema,不引 AJV/Formily | §3.4  | Svelte 不兼容 Formily,evorulePath 直接映射  |
| 业务预览双层(结构化 + LLM)                     | §3.5  | 结构化 100% 确定性,LLM 锦上添花,降级可用    |
| LLM 解释缓存到 localStorage + contentHash 失效 | §3.6  | 99%+ 命中率,避免重复 LLM 调用               |
| LLM 草案 → 表单反向解析                        | §3.7  | LLM 失败也能编辑,业务专家不碰 JSON          |
| 术语版本演进用 status,不删术语                 | §3.8  | 弃用保历史规则元数据可读,P1 升级版本树      |
| 规则 diff 用结构化字段对比,不引 deep-diff      | §3.9  | 字段扁平,businessImpact 用术语库翻译        |
| schema 按 businessObject 动态筛选              | §3.10 | 同行业不同业务对象 schema 差异大,精准匹配   |

---

## 17. 结尾

本设计文档定位为 P0-2 v0 阶段(可发布给业务专家试用)的业务语言层深化方案,在 P0-1 §3.3 "3 子层 + 1 派生层" 基础上:

- ✅ 业务术语库:12 条 builtin + 同义词前缀匹配 + status 版本演进 + CRUD + 冲突检测
- ✅ 业务表单:4 条 builtin schema + 字段联动(visibleWhen/enabledWhen/requiredWhen)+ 双层校验(业务 + 内核 7 门禁)+ 动态 schema(businessObject 筛选)
- ✅ 业务预览:结构化"如果 X 则 Y"(本地计算)+ LLM 自然语言(带 contentHash 缓存)+ LLM 不可用降级 + 对比 diff
- ✅ 表单 ↔ JSON 双向转换器(含 branch[0] / io_request / 数组索引)
- ✅ LLM 草案 → 业务表单反向解析(决策 §3.7)
- ✅ 双模式自由切换(LLM 辅助 / 业务表单)

实施分 5 步(§12.2):数据模型 → 内置数据 → 核心算法 → 组件 → 测试。每步完成后跑测试,5 步完成即达 v0 发布状态。

与 P01 / HOME_DESIGN.md 的同步清单见 §12.1,实施时按表执行。

长期演进 v1(P1) → v2(P2) → v3(P3+) 见 §13,数据模型兼容性保证见 §13.5。
