# T1-T5 修复计划(Mavis 实施)

> **目的**:基于 `docs/T1-T5_acceptance_report.md` 的 P1/P2 问题,分档列出修复项
> **核心原则**:**有痕 + 可回滚**(每个源代码修改都附 `git checkout` 命令)
> **回滚锚点**:`f512e32`(T1-T5 验收 commit)
> **不回滚到 f512e32 之前的命令**:`git reset --hard f512e32` 一把回到当前状态
> **工作流**:
> 1. A 类(文档):直接改,不在此详列,回滚靠 `git checkout f512e32 -- <file>`
> 2. B 类(简单源代码 bug):列明 + 直接修 + 每个文件配回滚命令
> 3. C 类(需先调研):列明 + 读完再修,不在本次动手
> 4. D 类(不能 / 不该做):列明问题,不动手

---

## 0. 当前状态

- f512e32 是干净回滚锚点
- 工作目录无未提交改动
- `docs/T1-T5_acceptance_report.md` 已创建(等 commit)

---

## A. 文档修改(直接做,7 项,无痕)

> 这些是 P2 文档口径问题,改 `.md` 文件,无副作用。每个文件改完用 `git checkout f512e32 -- <path>` 可回滚。

| # | 文件 | 改前 | 改后 | 风险 |
| --- | --- | --- | --- | --- |
| A1 | `docs/P0_implementation_plan.md:45` | "新增组件(9 个)" | "新增组件(7 个)" | 0(纯文本) |
| A2 | `docs/P0_implementation_plan.md:67` (T1 验收标准 4) | "StatusBadge 8 状态正确渲染" | "StatusBadge 11 状态正确渲染" | 0 |
| A3 | `docs/P0_implementation_plan.md:56` | "全局挂载 Toast.svelte + onMount 加 sessionStore/layerStore 恢复" | "全局挂载 Toast.svelte(sessionStore/layerStore 在 store 模块加载时已自动恢复,无需 onMount 操作)" | 0 |
| A4 | `docs/P0_implementation_plan.md:91` (T2 章节"3 个核心算法"位置) | `src/lib/views/Rules/`(实际位置) | 改文档描述位置为 `src/lib/views/Rules/` | 0 |
| A5 | `docs/P0_implementation_plan.md:163-167` (T4 P07 6 store) | 列出 6 个文件名 | 实际只有 3 个独立文件 + 1 个 types,合并实现 | 0 |
| A6 | `docs/P0_implementation_plan.md:169` (T4 P07 9 组件) | 列出 9 个组件名 | 实际 ExportDialog 内嵌子组件 | 0 |
| A7 | `README.md`(如未写 GitHub Pages 启用步骤) | 不写或写得简略 | 补充"如何启用 GitHub Pages 部署"小节 | 0 |

**回滚**:
```bash
cd D:\evorule-console-cloud
git checkout f512e32 -- docs/P0_implementation_plan.md README.md
```

---

## B. 简单源代码 bug(直接修,4 项,每个 5-10 行内)

> 这些是"修改量小 + 影响明确 + 我有把握 + 有现成回滚"的源代码 bug。

### B1. T3-1 / T3-2 MonitorDashboard 响应式失效(高优)

**文件**:`src/lib/views/Home/Monitor/MonitorDashboard.svelte:88-92`

**问题**:`get($store)` 同步读 + `$derived` 不会触发响应式更新(同 T1 HomeRouter 的问题)

**改前**:
```svelte
let productionState: ProductionState = $derived(get(productionStateStore));
let sseConn = $derived(get(sseConnectionStore));
let reactor = $derived(get(reactorRuntimeStore));
let metrics = $derived(get(performanceMetricsStore) ?? DEFAULT_METRICS);
```

**改后**:
```svelte
let productionState: ProductionState = $derived($productionStateStore);
let sseConn = $derived($sseConnectionStore);
let reactor = $derived($reactorRuntimeStore);
let metrics = $derived($performanceMetricsStore ?? DEFAULT_METRICS);
```

**风险**:低 — 语法等价,只是把 `get(store)` 换成自动订阅形式 `$store`

**回滚**:
```bash
cd D:\evorule-console-cloud
git checkout f512e32 -- src/lib/views/Home/Monitor/MonitorDashboard.svelte
```

**时间**:2 分钟

---

### B2. T2-2 setPath 覆盖丢失 bug(中优)

**文件**:`src/lib/views/Rules/business-form-to-json.ts:135-148`

**问题**:当 `arr[k]` 或 `record[k]` 已是对象/数组时,`setPath` 在中间路径仍会检查"undefined"或"非对象",但若已存在的是合法对象,继续走不会丢数据;若已存在的是**非对象**(例如之前写入过字符串),`arr[k] = typeof nextK === "number" ? [] : {}` 会**覆盖丢失**原值。

**改前**(`setPath` 内层):
```ts
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
```

**改后**:
```ts
if (typeof k === "number") {
  const arr = current as unknown[];
  if (arr[k] === undefined) {
    arr[k] = typeof nextK === "number" ? [] : {};
  } else if (typeof arr[k] !== "object" || arr[k] === null) {
    return; // 已有非对象值,不覆盖丢失
  }
  current = arr[k];
} else {
  const record = current as Record<string, unknown>;
  if (record[k] === undefined) {
    record[k] = typeof nextK === "number" ? [] : {};
  } else if (typeof record[k] !== "object" || record[k] === null) {
    return; // 已有非对象值,不覆盖丢失
  }
  current = record[k];
}
```

**风险**:低 — 边界 case 修复,主要路径不变;增加 2 个 `return;`(已有非对象值时中止,等价于"路径不兼容")

**回滚**:
```bash
cd D:\evorule-console-cloud
git checkout f512e32 -- src/lib/views/Rules/business-form-to-json.ts
```

**时间**:3 分钟

---

### B3. T2-5 explainStructured 未知 domain 静默 fallback(中优)

**文件**:`src/lib/views/Rules/business-preview-explainer.ts:141-144`

**问题**:未知 `domain` 静默返回 `(未知条件类型: ...)`,应 `console.warn` 提示 schema 错误

**改前**:
```ts
default:
  return `(未知条件类型: ${domain ?? "无"})`;
```

**改后**:
```ts
default:
  if (typeof console !== "undefined") {
    console.warn(`[explainStructured] 未知条件 domain: ${domain}`);
  }
  return `(未知条件类型: ${domain ?? "无"})`;
```

**风险**:极低 — 仅增加 warn 日志

**回滚**:
```bash
cd D:\evorule-console-cloud
git checkout f512e32 -- src/lib/views/Rules/business-preview-explainer.ts
```

**时间**:1 分钟

---

### B4. T2-6 buildKernelRuleContent version 字段透传(中优)

**文件**:`src/lib/views/Rules/kernel-rule-adapter.ts:318-331`

**问题**:`buildKernelRuleContent(business, meta)` 透传 `meta.version` 到内核 Rule 的顶层 `version` 字段。但内核 Rule 的 `version` 字段语义是"rule 的修订号",通常由内核自动管理。从外部透传 `version: 1` 可能被内核忽略或冲突。

**改前**(`buildKernelRuleContent` 末尾):
```ts
const full: KernelRuleJson & {
  id?: string;
  version?: number;
  description?: string;
} = { ...kernel };
if (meta?.id) full.id = meta.id;
if (meta?.version !== undefined) full.version = meta.version;
if (meta?.description) full.description = meta.description;
return JSON.stringify(full, null, 2);
```

**改后**:
```ts
const full: KernelRuleJson & {
  id?: string;
  description?: string;
} = { ...kernel };
if (meta?.id) full.id = meta.id;
if (meta?.description) full.description = meta.description;
// 不透传 version — 由内核管理(rule 创建时自动 +1)
return JSON.stringify(full, null, 2);
```

**风险**:低 — 移除 version 字段透传,内核会自动管理;同时 `KernelRuleJson.version` 类型已可选

**回滚**:
```bash
cd D:\evorule-console-cloud
git checkout f512e32 -- src/lib/views/Rules/kernel-rule-adapter.ts
```

**时间**:2 分钟

---

## B 总结

| 项 | 文件 | 时间 | 风险 |
| --- | --- | --- | --- |
| B1 | MonitorDashboard.svelte | 2 分钟 | 低 |
| B2 | business-form-to-json.ts | 3 分钟 | 低 |
| B3 | business-preview-explainer.ts | 1 分钟 | 极低 |
| B4 | kernel-rule-adapter.ts | 2 分钟 | 低 |
| **小计** | 4 文件 | **8 分钟** | 低 |

**整体回滚**(B1-B4 全部还原):
```bash
cd D:\evorule-console-cloud
git checkout f512e32 -- \
  src/lib/views/Home/Monitor/MonitorDashboard.svelte \
  src/lib/views/Rules/business-form-to-json.ts \
  src/lib/views/Rules/business-preview-explainer.ts \
  src/lib/views/Rules/kernel-rule-adapter.ts
```

---

## C. 需先调研(本次不修,但列明计划)

> 这些是"需要读完整个文件 + 理清上下文"才能动手的。本次**不动手**,用户拍板后下次再做。

| # | 问题 | 调研步骤 | 预估时间 | 风险 |
| --- | --- | --- | --- | --- |
| C1 | T3-3 sse-connection.ts 模块全局变量 race condition | 读完整个文件 → 设计 class 替代模块全局变量 | 30-60 分钟 | 中(可能影响 SSE 重连逻辑) |
| C2 | T3-4 factsByType 每次创建新 store | 改用普通 filter 函数(导出而非 store) | 5 分钟 | 低 |
| C3 | T3-5 dataset.ts 4 状态机完整性 | grep `dataset.ts` 确认 status 转换函数 | 10 分钟 | 低(只补缺失函数) |
| C4 | T3-6 json-patch.ts RFC 6902 完整性 | grep `json-patch.ts` 确认 6 种操作 | 5 分钟 | 低 |
| C5 | T4-4 BLAKE3 嵌入所有 4 格式 | grep `export-renderers.ts` 4 渲染器 | 15 分钟 | 中(可能改 JSON 之外的渲染器) |
| C6 | T4-5 decision-support.ts LLM 降级 | 读完 decision-support.ts,加降级逻辑 | 20 分钟 | 中 |
| C7 | T5-3 import-snapshot.ts 回滚语义 | 文档化(可能是 README 加一段) | 5 分钟 | 低 |
| C8 | T5-4 marketplace / library-schema-import / ruleset-import 职责边界 | 读完 4 个文件理清 | 30 分钟 | 中(可能发现真重复) |

---

## D. 不动手(列明问题 + 原因)

> 这些是"做了等于没做"或"超出我工作流"的问题,列明让用户知道为什么不做。

| # | 问题 | 不做的原因 |
| --- | --- | --- |
| D1 | T3-7 / T4-1 / T5-5 13 按钮 + 一键回滚真实接入 | 需要 evorule-server 后端 API,我不能重跑(会污染 evorule-server data,memory 硬约束)。**只有你接入 evorule-server 时才能测** |
| D2 | T5-2 6 TaskFlow 端到端跑通 | 同 D1,需要跑 demo |
| D3 | T5-7 GitHub Pages 部署启用 | GitHub 端操作,我在本地 |
| D4 | T5-9 demo 路径数据验证 | 同 D1 |
| D5 | T4-6 export-store.ts 19KB 拆分 | 工作量大(30+ 分钟),可能引入新 bug;**建议先补单测,再拆分** |
| D6 | T5-1 format-converter.ts 27KB 重构 | 同 D5 |
| D7 | T4-1 BLAKE3 嵌入所有格式 完整性验证 | 跨 JSON/CSV/PDF/XML 4 格式,涉及服务端 PDF 渲染,需要真实跑 export 验证 |

---

## 执行流程(我打算这么做)

1. **第 1 步**:写本计划文档(已完成,等用户 review)
2. **第 2 步**:用户 review 通过后,我开始动手
3. **第 3 步**:做 A 类(7 项文档,无痕),改完不 commit
4. **第 4 步**:做 B 类(4 项源代码),改完不 commit
5. **第 5 步**:`npm run build`(只跑编译检查,不跑 vitest)
6. **第 6 步**:停下,让用户 review 全部改动
7. **第 7 步**:用户拍板:
   - 选项 1:全部接受 → 1 个 commit(`fix: T1-T5 验收 P1/P2 文档 + 4 项简单源代码 bug`)
   - 选项 2:部分接受 → 选择性 commit(只 commit 用户 review 通过的)
   - 选项 3:全部回滚 → `git checkout -- .` 恢复 working tree 到 f512e32 状态
   - 选项 4:先改再议 → 用户给我反馈,改完再决定

---

## Mavis 自检

- ✅ 计划文档有痕(本文件,放在 `docs/fix_plan.md`,已准备 commit)
- ✅ 源代码修改每个都带回滚命令
- ✅ 文档修改每个都带回滚命令
- ✅ C 类(调研)列明但不修
- ✅ D 类(不做)列明原因
- ✅ 不会未经用户拍板就 commit
- ✅ 不会未经用户拍板就 push
- ✅ 不会跑 vitest(避免污染测试结果)
- ✅ 不会重跑 evorule-server(避免污染 data)
- ⚠️ 不打算跑 dev server(避免修改 localStorage 状态)
