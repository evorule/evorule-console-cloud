> **状态**:设计文档,2026-08-06 定稿。本文档是 evorule-doc-center `b2b2c-strategy.md §20.2 P0-7` 的可实施落地。
>
> **定位**:P0-7 通用结果导出 — 把跑出来的 Fact / 决策 / 审计链 / 状态快照 / 因果链,以 JSON / CSV / PDF / XML 四种格式导出,支持导出模板复用、合规报告生成、BLAKE3 完整性嵌入。是 evorule 相对 LangSmith/Langfuse 的核心差异化能力的"交付出口"(竞品无不可篡改审计链导出)。
>
> **关联**:
>
> - 战略依据:`b2b2c-strategy.md §20.2 P0-7`(步骤 10 导出结果 — 跑出来的 fact / 决策导出)
> - 三层架构:`evorule-three-layer-architecture.md §3.7.2`(审计导出/导入 API,已实现)
> - 首页设计:`HOME_DESIGN.md §5.4`(InterventionBar [📥 导出审计] 按钮)
> - 前置设计:`P05_MONITOR_DASHBOARD_DESIGN.md`(L1 监控大屏 InterventionBar,导出审计入口)
> - 前置设计:`P06_BUSINESS_AUDIT_TT_DESIGN.md`(业务审计视图,导出业务化审计入口)
> - 横向关联:`P09_IMPORT_EXPORT_INFRA_DESIGN.md`(导入导出基础设施,P0-7 是其中"结果导出"子集)
> - 后端 API:`evorule-server` `audit/export`、`audit/export/compressed`、`facts`、`history`、`replay`、`causal`、`state`
> - 内核导出:`@evorule/console`(`exportRule`、`audit` store、`causal` store)

---

## 1. 背景与动机

### 1.1 战略意图(来自 §20.2 P0-7)

> P0-7 通用结果导出(JSON / CSV / PDF / XML)— 步骤 10 导出结果 — 跑出来的 fact / 决策导出

**P0-7 在 11 步功能流中的位置**(步骤 10):

```
... → 步骤 9 查看运行结果(P0-6 业务审计/时间旅行)
    → 步骤 10 导出结果(P0-7 通用结果导出) ← 本文档
    → 步骤 11 回放 + 审计(P0-6 业务时间旅行)
```

**步骤 10 的业务场景**:
- 业务专家把过去 24 小时的病人就诊 Fact 流导出为 CSV,用 Excel 做趋势分析
- 合规官把一个月的审计链导出为 PDF,作为 EU AI Act Article 12 合规证据归档
- 信息科把决策日志导出为 XML,对接医院 HIMSS 系统
- 开发者把 Fact 流导出为 JSON,用于离线 replay 调试

### 1.2 现有能力盘点(避免重复造轮子)

| 能力 | 来源 | 状态 | P0-7 复用方式 |
| --- | --- | --- | --- |
| 审计链导出(JSON) | `GET /api/sessions/{id}/audit/export` | ✅ evorule-server 已实现 | 直接调用,作为"审计链内容"的 JSON 格式数据源 |
| 审计链导出(压缩) | `GET /api/sessions/{id}/audit/export/compressed` | ✅ 已实现 | 大链传输用,后台流式导出 |
| Fact 记录 | `GET /api/sessions/{id}/facts?prefix=...` | ✅ 已实现 | 作为"Fact 流内容"的数据源 |
| 历史回放 | `GET /api/sessions/{id}/replay?from=&to=` | ✅ 已实现 | 作为"指定版本范围 Fact 流"的数据源 |
| 因果链 | `GET /api/sessions/{id}/causal?fact_id=X` | ✅ 已实现 | 作为"因果链内容"的数据源 |
| 状态快照 | `GET /api/sessions/{id}/state` 和 `getStateAtVersion` | ✅ 已实现 | 作为"状态快照内容"的数据源 |
| 规则导出 | 内核 `exportRule(id)` | ✅ 已实现 | 作为"规则内容"的数据源(规则库导出归 P09) |
| 业务化审计条目 | P06 `business-audit.ts`(设计稿) | 📐 P06 已设计 | 复用 `toBusinessAuditEntry` 转换函数 |
| 业务术语库 | P02 `businessTermsStore` | 📐 P02 已设计 | CSV/PDF/XML 业务化字段映射 |
| 业务表单 schema | P02 `formSchema` | 📐 P02 已设计 | 业务对象筛选维度来源 |

**结论**:数据源 API 全部就绪,P0-7 只做"导出引擎 + 多格式渲染 + 模板管理 + 导出 UI",不重新实现数据获取。

### 1.3 现有"导出审计"按钮的不足

P05 InterventionBar 已有 [📥 导出审计] 按钮,但能力有限:

| 现状(P05) | 不足 |
| --- | --- |
| 只导出审计链 JSON | 业务专家需要 CSV/PDF/XML,JSON 看不懂 |
| 文件名 `audit-session-{id}.json` | 无业务语义,无法识别"哪段时间的什么业务" |
| 无内容选择 | 无法只导出"过去 24h 高危急诊 Fact" |
| 无模板 | 每次导出都要重新选,合规官每月导出报告重复劳动 |
| 无 BLAKE3 校验嵌入 | 导出文件脱离系统后无法自证完整 |
| 无业务化字段 | Fact JSON 里的 `patient_id` 不被映射为"病人 ID" |
| 无导出元数据 | 不知道谁在什么时候导出、基于哪个 ruleset 版本 |

### 1.4 改造目标

```
P05 InterventionBar [📥 导出审计](单一 JSON 下载)
  ↓ 升级为 P0-7 通用导出引擎
P07 ExportDialog(多内容 + 多格式 + 模板 + 合规特性)
  ├── 6 种导出内容:Fact 流 / 决策 / 审计链 / 状态快照 / 因果链 / 综合报告
  ├── 4 种导出格式:JSON / CSV / PDF / XML
  ├── 导出模板:预置(合规/汇总/监管)+ 自定义保存复用
  ├── 业务化字段:复用 P02 businessTermsStore 做术语映射
  ├── BLAKE3 完整性:导出文件含哈希校验段,可离线验证
  └── 导出元数据:操作人/时间/session_id/ruleset_version/导出范围
```

### 1.5 与其他 P0 的关系

| 前置设计 | P0-7 关系 |
| --- | --- |
| P02 业务语言层 | 复用 `businessTermsStore`(字段业务化)+ `formSchema`(筛选维度) |
| P05 监控大屏 | InterventionBar [📥 导出审计] 升级为调用 P07 ExportDialog(预选审计链) |
| P06 业务审计 | BusinessAuditView 增加 [📤 导出] 按钮 → P07 ExportDialog(预选业务化审计);复用 `toBusinessAuditEntry` |
| 三层架构 §3.7.2 | 审计导出 API 已就绪,P0-7 做多格式包装 + UI |
| P09 导入导出基础设施 | P0-7 是 P09"结果导出"子集;P09 还含模板市场/数据集导入/规则导入 |

### 1.6 P0-7 vs P0-9 边界(避免重叠)

| 维度 | P0-7 通用结果导出 | P0-9 各种导入导出(基础设施) |
| --- | --- | --- |
| 方向 | 只导出 | 导入 + 导出 |
| 对象 | 运行结果(Fact/决策/审计/状态/因果) | 规则 + 数据集 + 模板 + 结果(横向) |
| 格式 | JSON/CSV/PDF/XML | 通用格式转换层 + 模板市场 |
| 复用关系 | P0-7 是 P09 的"结果导出"实例 | P0-9 提供基础设施,P0-7 调用 |

**结论**:P0-7 专注"结果导出"垂直场景,P0-9 提供横向基础设施(格式转换器、模板市场)。P0-7 的导出引擎会抽取为 P09 可复用的 `export-engine.ts`,但 P0-7 文档先落地垂直能力。

---

## 2. 目标与非目标

### 2.1 目标(P0 范围)

1. **6 种导出内容**:Fact 流、决策日志、审计链、状态快照、因果链、综合报告
2. **4 种导出格式**:JSON、CSV、PDF、XML,每种格式有明确的渲染规则
3. **导出模板**:3 个预置模板(合规报告/业务汇总/监管报送)+ 用户自定义模板保存/加载
4. **导出选择器**:时间范围、Fact 类型、业务对象、规则触发、版本范围 5 个维度
5. **业务化字段**:CSV/PDF/XML 字段名和值经 `businessTermsStore` 映射
6. **BLAKE3 完整性嵌入**:导出文件含 `integrity` 段(hash + 算法 + 可验证说明)
7. **导出元数据**:`export_meta`(操作人/时间/session_id/ruleset_version/导出范围/模板)
8. **大文件流式导出**:调用 `audit/export/compressed`,后台任务 + 进度条
9. **3 个集成入口**:P05 InterventionBar、P06 BusinessAuditView、独立 /export 路由

### 2.2 非目标(明确不做)

| 不做项 | 原因 | 归属 |
| --- | --- | --- |
| 监管报送自动定时推送 | 需要调度器 + 报送通道,P0 手动导出 | P1-9 合规时间旅行 + 监管报送 |
| 数字签名(RSA/PKCS) | 需要密钥管理基础设施 | P1-11 不可篡改复用 |
| 导出审批工作流 | 需 P0-8 协作工作流先落地 | P2 审计审批工作流 |
| 导出数据仓库(长期归档) | 需独立存储层 | P2 审计数据仓库 |
| BI 工具直连(BI Connector) | 需 JDBC/ODBC 驱动 | P2 BI 集成 |
| 实时流式导出(Kafka) | 需消息中间件 | P2 实时数据流 |
| 跨 session 合并导出 | 多 session 数据 schema 不一致 | P1 多 session 审计对比 |
| 加密导出(文件级加密) | 需密钥分发机制 | P1 加密归档 |

### 2.3 设计原则

1. **数据源单一**:所有导出内容来自 evorule-server 已有 API,不引入新后端端点(P0 范围)
2. **格式分离**:数据获取与格式渲染解耦,`ExportContent` 中间态,各格式渲染器独立
3. **模板即配置**:模板是 JSON 配置(内容选择 + 格式 + 字段映射),不是代码
4. **业务化优先**:CSV/PDF/XML 默认业务化字段,JSON 保留 raw(开发者用)
5. **完整性自证**:导出文件含 BLAKE3 哈希段,脱离系统后可独立验证
6. **不阻塞 UI**:大文件导出走后台任务,SSE/轮询通知完成

---

## 3. 关键设计决策

### 3.1 决策 1:6 种导出内容,不合并

**决策**:支持 6 种独立导出内容,不合并为"通用导出"。

**6 种内容**:

| 内容 | 数据源 API | 用途 |
| --- | --- | --- |
| Fact 流 | `GET /facts` 或 `GET /replay?from=&to=` | 业务事件流分析 |
| 决策日志 | `GET /facts` 过滤 rule_triggered 类型 | 决策追溯 |
| 审计链 | `GET /audit/export` | 合规审计、监管 |
| 状态快照 | `GET /state` 或 `getStateAtVersion` | 状态归档 |
| 因果链 | `GET /causal?fact_id=X` | 决策解释 |
| 综合报告 | 多 API 聚合 | 合规报告、月度汇总 |

**理由**:
1. 6 种内容用途差异大(分析 vs 合规 vs 调试),合并会让选择器爆炸
2. 各内容数据源 API 不同,独立实现更清晰
3. "综合报告"承担多内容组合需求,避免用户多次导出后手工拼接

**替代方案(否决)**:单一"通用导出" + 复杂选择器 — 选择器维度过多,业务专家用不来。

### 3.2 决策 2:4 种格式,渲染器分离

**决策**:JSON/CSV/PDF/XML 4 种格式,每种格式独立渲染器,共享 `ExportContent` 中间态。

```typescript
// 渲染器接口
interface ExportRenderer {
  format: ExportFormat;
  render(content: ExportContent, options: ExportRenderOptions): Promise<Blob>;
}

// 4 个实现
class JsonRenderer implements ExportRenderer { ... }   // 直接序列化
class CsvRenderer implements ExportRenderer { ... }    // 字段扁平化 + 业务化
class PdfRenderer implements ExportRenderer { ... }    // 服务端渲染(避免前端库体积)
class XmlRenderer implements ExportRenderer { ... }    // JSON → XML 转换 + schema
```

**理由**:
1. 4 种格式渲染逻辑差异大(JSON 序列化 vs PDF 排版),合一会变上帝对象
2. 渲染器分离后,P0-9 可复用渲染器做"规则导出"等场景
3. 新增格式(如 Excel xlsx)只需加渲染器,不改数据获取逻辑

**PDF 渲染策略**(关键子决策):

| 方案 | 体积 | 体验 | 决策 |
| --- | --- | --- | --- |
| 前端 jsPDF | +300KB | 简单 | ❌ 体积超标 |
| 前端 pdf-lib | +250KB | 中等 | ❌ 体积超标 |
| 服务端渲染(HTML→PDF) | 0 | 排版精美 | ✅ P0 选用 |
| 浏览器 print | 0 | 排版受限 | P1 备选 |

**PDF 服务端渲染**:`POST /api/export/pdf`(evorule-server 新增端点,P0 范围内),接收 HTML 模板 + 数据,返回 PDF blob。模板引擎用 handlebars,PDF 引擎用 printpdf(Rust crate,与 evorule-server 同语言)。

> **注**:此为 P0-7 唯一新增的后端端点,其他数据源全部复用已有 API。三层架构 §3.7.2 已说明审计导出 API 就绪,PDF 渲染属于"格式渲染层",不破坏数据源单一原则。

### 3.3 决策 3:导出模板 = JSON 配置,不是代码

**决策**:导出模板是 JSON 配置文件,定义"内容选择 + 格式 + 字段映射 + 渲染选项",不是代码。

```typescript
// 模板 schema
interface ExportTemplate {
  id: string;                    // "builtin.compliance_report" 或 "user.xxx"
  name: string;                  // "合规报告模板"
  description: string;
  source: 'builtin' | 'user';
  content: ExportContentSpec;    // 导出哪些内容
  format: ExportFormat;          // JSON/CSV/PDF/XML
  fieldMapping: FieldMapping[];  // 字段业务化映射(覆盖默认)
  renderOptions: ExportRenderOptions; // 格式特定选项
  createdAt: string;
  updatedAt: string;
}

// 内容选择规格
interface ExportContentSpec {
  contents: ExportContentType[];  // ['fact_stream', 'audit_chain', ...]
  filters: ExportFilters;         // 时间/类型/对象/规则/版本
  aggregation?: 'none' | 'daily' | 'weekly' | 'monthly'; // 聚合粒度
}
```

**理由**:
1. 业务专家可读模板配置,可手工编辑调整
2. 模板可导入导出(P0-9 模板市场基础)
3. 不需要重新部署代码就能新增模板
4. 与 P01 业务规则库"配置即数据"哲学一致

**3 个预置模板**:

| 模板 ID | 名称 | 内容 | 格式 | 用途 |
| --- | --- | --- | --- | --- |
| `builtin.compliance_report` | 合规报告(月度) | 审计链 + 决策日志 + 综合报告 | PDF | EU AI Act Article 12 合规证据 |
| `builtin.business_summary` | 业务汇总(日报) | Fact 流 + 决策日志 | CSV | 业务专家 Excel 趋势分析 |
| `builtin.regulatory_submission` | 监管报送 | 审计链 + 状态快照 | XML | 对接 HIMSS/监管系统 |

### 3.4 决策 4:BLAKE3 完整性嵌入,可离线验证

**决策**:所有导出文件(无论格式)含 `integrity` 段,嵌入 BLAKE3 哈希 + 算法标识 + 验证说明。

**JSON 格式的 integrity 段**:
```json
{
  "export_meta": { ... },
  "integrity": {
    "algorithm": "BLAKE3",
    "content_hash": "3a7f...",
    "audit_chain_root": "b2c9...",
    "audit_chain_fact_count": 1247,
    "audit_chain_verified": true,
    "verification_note": "运行 evorule verify-audit-export <file> 验证;或访问 https://evorule.dev/verify 上传验证"
  },
  "data": { ... }
}
```

**CSV 格式**:首行注释 `# integrity: BLAKE3 content_hash=3a7f... chain_root=b2c9... verified=true`
**PDF 格式**:首页底部"完整性证明"小节 + 末页二维码(含 hash)
**XML 格式**:`<integrity algorithm="BLAKE3" contentHash="3a7f..." chainRoot="b2c9..." verified="true"/>`

**理由**:
1. 满足 EU AI Act Article 12 "可追溯性 + 完整性"要求
2. 导出文件脱离系统后仍可自证未被篡改
3. 与三层架构 §3.7.2 "BLAKE3 审计链可导出为独立文件"一致
4. 是 evorule 相对 LangSmith/Langfuse 的核心差异化(竞品无不可篡改审计链)

**离线验证工具**:`evorule verify-audit-export <file>` CLI(归 P09,但 P0-7 文档定义格式契约)。

### 3.5 决策 5:大文件流式导出,后台任务

**决策**:导出数据量 > 阈值(默认 5000 条 Fact 或 10MB)时,自动切换为后台任务模式。

**两种模式**:

| 模式 | 触发条件 | 流程 |
| --- | --- | --- |
| 同步导出 | < 5000 条 且 < 10MB | 前端直接获取数据 → 渲染 → 下载 |
| 后台任务 | ≥ 5000 条 或 ≥ 10MB | 创建任务 → 服务端流式渲染 → SSE 通知完成 → 下载 |

**后台任务流程**:
```
1. 前端 POST /api/export/jobs { content, format, filters }
   → 返回 { job_id, status: 'queued' }
2. 前端订阅 SSE /api/export/jobs/{job_id}/events
   → progress / completed / failed 事件
3. 服务端:调 audit/export/compressed 流式获取 → 渲染 → 写临时文件
4. 完成后:SSE 推送 completed { download_url }
5. 前端:GET download_url → 下载 → 删除临时文件
```

**理由**:
1. 避免前端 OOM(审计链可能数十万条)
2. 避免浏览器超时(大 PDF 渲染耗时)
3. 复用 evorule-server 已有 SSE 基础设施(P05 已用)

### 3.6 决策 6:3 个集成入口,统一弹窗

**决策**:3 个入口都调用同一个 `ExportDialog` 组件,通过 `preset` 参数预填内容。

| 入口 | 位置 | preset |
| --- | --- | --- |
| P05 InterventionBar [📥 导出审计] | L1 监控大屏 | `{ contents: ['audit_chain'] }` |
| P06 BusinessAuditView [📤 导出] | 业务审计视图 | `{ contents: ['audit_chain', 'causal_chain'], filters: { timeRange: 'visible' } }` |
| 独立 /export 路由 | 顶部导航"导出" | `{}` 全空,用户自选 |

**理由**:
1. 统一交互(避免 3 套导出 UI 维护成本)
2. 预设降低业务专家选择成本
3. 独立路由满足"主动导出"场景(不依赖进入特定视图)

### 3.7 决策 7:业务化字段映射,复用 P02 businessTermsStore

**决策**:CSV/PDF/XML 默认业务化字段名和值,通过 `businessTermsStore` 映射;JSON 保留 raw 字段。

```typescript
// 字段映射示例
// raw Fact: { fact_type: 'patient_visit', payload: { patient_id: 'P-1283', temp: 39.2 } }
// ↓ businessTermsStore 映射
// business: { 事件类型: '病人就诊', 病人 ID: 'P-1283', 体温(°C): 39.2 }

interface FieldMapping {
  sourcePath: string;        // 'payload.patient_id'
  businessLabel: string;     // '病人 ID'
  valueTransform?: 'enum' | 'datetime' | 'duration' | 'none';
  enumMap?: Record<string, string>; // { fever: '发热', cough: '咳嗽' }
}
```

**理由**:
1. 业务专家看不懂 `fact_type`/`payload`,需要业务术语
2. 复用 P02 businessTermsStore,不重复维护术语库
3. JSON 保留 raw 供开发者/系统对接用

**模板可覆盖默认映射**:`template.fieldMapping` 覆盖默认映射,允许用户自定义字段名。

---

## 4. 数据模型

### 4.1 ExportContent(中间态,渲染器输入)

```typescript
// src/lib/stores/export-types.ts

/** 导出内容类型 */
export type ExportContentType =
  | 'fact_stream'        // Fact 流
  | 'decision_log'       // 决策日志(规则触发)
  | 'audit_chain'        // 审计链(BLAKE3)
  | 'state_snapshot'     // 状态快照
  | 'causal_chain'       // 因果链
  | 'comprehensive';     // 综合报告(多内容聚合)

/** 导出格式 */
export type ExportFormat = 'json' | 'csv' | 'pdf' | 'xml';

/** 导出内容中间态(渲染器输入) */
export interface ExportContent {
  /** 内容类型 */
  type: ExportContentType;
  /** session 标识 */
  sessionId: number;
  /** ruleset 版本(导出时 production 的版本) */
  rulesetVersion: number;
  /** 导出范围(时间/版本) */
  range: {
    fromVersion?: number;
    toVersion?: number;
    fromTime?: string;       // ISO 8601
    toTime?: string;
  };
  /** raw 数据(从 API 获取,未业务化) */
  rawData: unknown;
  /** 业务化数据(经 businessTermsStore 映射后) */
  businessData?: unknown;
  /** BLAKE3 完整性信息(仅 audit_chain 类型有) */
  integrity?: {
    algorithm: 'BLAKE3';
    contentHash: string;
    chainRoot: string;
    factCount: number;
    verified: boolean;
  };
  /** 字段映射元数据(用于 CSV/XML 表头) */
  fieldSchema?: FieldSchema[];
}

/** 字段 schema(描述业务化字段) */
export interface FieldSchema {
  key: string;              // 'patient_id'
  label: string;            // '病人 ID'
  type: 'string' | 'number' | 'datetime' | 'enum' | 'boolean' | 'json';
  enumValues?: Record<string, string>; // { fever: '发热' }
  required?: boolean;
}
```

### 4.2 ExportFilters(导出选择器)

```typescript
// src/lib/stores/export-types.ts

/** 导出筛选条件 */
export interface ExportFilters {
  /** 时间范围 */
  timeRange?:
    | { kind: 'last'; value: number; unit: 'minutes' | 'hours' | 'days' }
    | { kind: 'absolute'; from: string; to: string }
    | { kind: 'visible' }   // 当前视图可见范围
    | { kind: 'all' };      // 全部(慎用,大文件)
  /** Fact 类型筛选 */
  factTypes?: string[];     // ['patient_visit', 'drug_prescribe']
  /** 业务对象筛选(来自 P02 formSchema) */
  businessObjects?: string[]; // ['patient', 'drug']
  /** 规则触发筛选 */
  ruleIds?: string[];       // 只导出这些规则触发的决策
  /** 版本范围 */
  versionRange?: { from: number; to: number };
  /** 决策结果筛选 */
  decisionResults?: ('allowed' | 'blocked' | 'warning')[];
}
```

### 4.3 ExportTemplate(导出模板)

```typescript
// src/lib/stores/export-types.ts

/** 导出模板 */
export interface ExportTemplate {
  id: string;                       // 'builtin.compliance_report' 或 'user.xxx'
  name: string;                     // '合规报告模板'
  description: string;
  source: 'builtin' | 'user';
  /** 内容规格 */
  content: ExportContentSpec;
  /** 默认格式 */
  format: ExportFormat;
  /** 字段映射覆盖(覆盖默认 businessTermsStore 映射) */
  fieldMapping?: FieldMapping[];
  /** 渲染选项 */
  renderOptions: ExportRenderOptions;
  /** 完整性嵌入 */
  embedIntegrity: boolean;
  createdAt: string;
  updatedAt: string;
}

/** 内容规格 */
export interface ExportContentSpec {
  contents: ExportContentType[];
  filters: ExportFilters;
  aggregation?: 'none' | 'daily' | 'weekly' | 'monthly';
}

/** 字段映射 */
export interface FieldMapping {
  sourcePath: string;           // 'payload.patient_id'
  businessLabel: string;        // '病人 ID'
  valueTransform?: 'enum' | 'datetime' | 'duration' | 'none';
  enumMap?: Record<string, string>;
}

/** 渲染选项(格式特定) */
export interface ExportRenderOptions {
  /** CSV 选项 */
  csv?: {
    delimiter: ',' | ';' | '\t';
    encoding: 'utf-8' | 'gbk';
    includeHeader: boolean;
    flattenPayload: boolean;     // 是否扁平化 payload
  };
  /** PDF 选项 */
  pdf?: {
    pageSize: 'A4' | 'Letter';
    orientation: 'portrait' | 'landscape';
    title: string;
    includeCoverPage: boolean;
    includeTableOfContents: boolean;
    groupBy: 'day' | 'fact_type' | 'rule_id' | 'none';
  };
  /** XML 选项 */
  xml?: {
    rootElement: string;         // 'evorule_export'
    namespace?: string;
    prettyPrint: boolean;
    schemaLocation?: string;     // XSD 引用(监管报送用)
  };
  /** JSON 选项 */
  json?: {
    prettyPrint: boolean;
    includeRaw: boolean;         // 是否含 raw 字段
    includeBusiness: boolean;    // 是否含业务化字段
  };
}
```

### 4.4 ExportJob(后台任务)

```typescript
// src/lib/stores/export-types.ts

/** 后台导出任务 */
export interface ExportJob {
  id: string;                       // 'job-20260806-001'
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  content: ExportContentSpec;
  format: ExportFormat;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  progress: number;                 // 0-100
  progressMessage?: string;
  downloadUrl?: string;             // 完成后的下载 URL
  downloadExpiresAt?: string;       // 下载链接过期时间(默认 24h)
  error?: string;
  resultSize?: number;              // 字节
}
```

### 4.5 ExportMeta(导出元数据,嵌入文件)

```typescript
// src/lib/stores/export-types.ts

/** 导出元数据(嵌入所有导出文件) */
export interface ExportMeta {
  /** evorule 版本 */
  evoruleVersion: string;           // '0.1.1'
  /** 导出工具 */
  exportedBy: 'evorule-console-cloud';
  /** 导出时间 */
  exportedAt: string;               // ISO 8601
  /** 操作人 */
  operator: {
    userId: string;
    username: string;
    role: string;                   // 'admin' / 'auditor' / 'developer'
  };
  /** 来源 session */
  sessionId: number;
  /** ruleset 版本 */
  rulesetVersion: number;
  /** 导出范围摘要 */
  rangeSummary: {
    fromTime?: string;
    toTime?: string;
    factCount?: number;
    decisionCount?: number;
  };
  /** 使用的模板 */
  templateId?: string;
  /** 导出格式 */
  format: ExportFormat;
}
```

---

## 5. Store 设计

### 5.1 exportStore(导出主 store)

```typescript
// src/lib/stores/export-store.ts

import { writable, derived, get } from 'svelte/store';
import { browser } from '$app/environment';
import type {
  ExportContent,
  ExportContentType,
  ExportFormat,
  ExportFilters,
  ExportTemplate,
  ExportJob,
  ExportRenderOptions,
  FieldMapping,
} from './export-types';
import { businessTermsStore } from './business-terms'; // P02
import { useBackendOrNull } from '@evorule/console';

// ============================================================================
// 1. 模板 store
// ============================================================================

const TEMPLATE_STORAGE_KEY = 'evorule-console-cloud:export-templates:user';

/** 3 个预置模板 */
export const BUILTIN_TEMPLATES: ExportTemplate[] = [
  {
    id: 'builtin.compliance_report',
    name: '合规报告(月度)',
    description: '审计链 + 决策日志 + 综合报告,PDF 格式,含 BLAKE3 完整性证明。用于 EU AI Act Article 12 合规证据归档。',
    source: 'builtin',
    content: {
      contents: ['audit_chain', 'decision_log', 'comprehensive'],
      filters: {
        timeRange: { kind: 'last', value: 30, unit: 'days' },
      },
      aggregation: 'monthly',
    },
    format: 'pdf',
    renderOptions: {
      pdf: {
        pageSize: 'A4',
        orientation: 'portrait',
        title: 'evorule 合规报告',
        includeCoverPage: true,
        includeTableOfContents: true,
        groupBy: 'day',
      },
    },
    embedIntegrity: true,
    createdAt: '2026-08-06T00:00:00Z',
    updatedAt: '2026-08-06T00:00:00Z',
  },
  {
    id: 'builtin.business_summary',
    name: '业务汇总(日报)',
    description: 'Fact 流 + 决策日志,CSV 格式,业务化字段。用于业务专家 Excel 趋势分析。',
    source: 'builtin',
    content: {
      contents: ['fact_stream', 'decision_log'],
      filters: {
        timeRange: { kind: 'last', value: 24, unit: 'hours' },
      },
      aggregation: 'none',
    },
    format: 'csv',
    renderOptions: {
      csv: {
        delimiter: ',',
        encoding: 'utf-8',
        includeHeader: true,
        flattenPayload: true,
      },
    },
    embedIntegrity: true,
    createdAt: '2026-08-06T00:00:00Z',
    updatedAt: '2026-08-06T00:00:00Z',
  },
  {
    id: 'builtin.regulatory_submission',
    name: '监管报送',
    description: '审计链 + 状态快照,XML 格式,含 XSD schema 引用。对接 HIMSS/监管系统。',
    source: 'builtin',
    content: {
      contents: ['audit_chain', 'state_snapshot'],
      filters: {
        timeRange: { kind: 'last', value: 90, unit: 'days' },
      },
      aggregation: 'none',
    },
    format: 'xml',
    renderOptions: {
      xml: {
        rootElement: 'evorule_export',
        namespace: 'https://evorule.dev/schema/export/v1',
        prettyPrint: true,
        schemaLocation: 'https://evorule.dev/schema/export/v1/export.xsd',
      },
    },
    embedIntegrity: true,
    createdAt: '2026-08-06T00:00:00Z',
    updatedAt: '2026-08-06T00:00:00Z',
  },
];

function loadAllTemplates(): ExportTemplate[] {
  if (!browser) return BUILTIN_TEMPLATES;
  const stored = localStorage.getItem(TEMPLATE_STORAGE_KEY);
  if (!stored) return BUILTIN_TEMPLATES;
  try {
    const userTemplates = JSON.parse(stored) as ExportTemplate[];
    return [...BUILTIN_TEMPLATES, ...userTemplates];
  } catch {
    return BUILTIN_TEMPLATES;
  }
}

function persistUserTemplates(templates: ExportTemplate[]): void {
  if (!browser) return;
  const userTemplates = templates.filter((t) => t.source === 'user');
  localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(userTemplates));
}

export const exportTemplates = writable<ExportTemplate[]>(loadAllTemplates());

/** 新建自定义模板 */
export function saveTemplate(
  template: Omit<ExportTemplate, 'id' | 'source' | 'createdAt' | 'updatedAt'>,
): string {
  const now = new Date().toISOString();
  const id = `user.${Date.now()}`;
  const newTemplate: ExportTemplate = {
    ...template,
    id,
    source: 'user',
    createdAt: now,
    updatedAt: now,
  };
  exportTemplates.update((all) => {
    const next = [...all, newTemplate];
    persistUserTemplates(next);
    return next;
  });
  return id;
}

/** 更新模板(只能更新 user 模板) */
export function updateTemplate(
  id: string,
  patch: Partial<ExportTemplate>,
): void {
  exportTemplates.update((all) => {
    const next = all.map((t) => {
      if (t.id !== id) return t;
      if (t.source === 'builtin') {
        throw new Error(`updateTemplate: builtin 模板 "${id}" 不可修改,请先另存为`);
      }
      return { ...t, ...patch, updatedAt: new Date().toISOString() };
    });
    persistUserTemplates(next);
    return next;
  });
}

/** 删除模板(只能删 user 模板) */
export function deleteTemplate(id: string): void {
  exportTemplates.update((all) => {
    const target = all.find((t) => t.id === id);
    if (!target) return all;
    if (target.source === 'builtin') {
      throw new Error(`deleteTemplate: builtin 模板 "${id}" 不可删除`);
    }
    const next = all.filter((t) => t.id !== id);
    persistUserTemplates(next);
    return next;
  });
}

/** 复制 builtin 模板为 user 副本 */
export function duplicateTemplate(sourceId: string): string {
  const all = get(exportTemplates);
  const source = all.find((t) => t.id === sourceId);
  if (!source) throw new Error(`duplicateTemplate: 源模板 "${sourceId}" 不存在`);
  const now = new Date().toISOString();
  const newId = `user.${source.id.replace(/^(builtin|user)\./, '')}.${Date.now()}`;
  const newTemplate: ExportTemplate = {
    ...source,
    id: newId,
    name: `${source.name} (副本)`,
    source: 'user',
    createdAt: now,
    updatedAt: now,
  };
  exportTemplates.update((list) => {
    const next = [...list, newTemplate];
    persistUserTemplates(next);
    return next;
  });
  return newId;
}

// ============================================================================
// 2. 导出任务 store
// ============================================================================

export const exportJobs = writable<ExportJob[]>([]);
export const currentExportJob = derived(exportJobs, ($jobs) => {
  if ($jobs.length === 0) return null;
  return $jobs[$jobs.length - 1];
});

// ============================================================================
// 3. 数据获取(从 evorule-server API)
// ============================================================================

/**
 * 获取导出内容 raw 数据。
 * 根据 contentType 调用不同 API。
 */
export async function fetchExportContent(
  sessionId: number,
  contentType: ExportContentType,
  filters: ExportFilters,
  backend: ReturnType<typeof useBackendOrNull>,
): Promise<unknown> {
  if (!backend) throw new Error('fetchExportContent: backend 未注入');

  switch (contentType) {
    case 'fact_stream': {
      // GET /api/sessions/{id}/replay?from=&to=
      const from = filters.versionRange?.from;
      const to = filters.versionRange?.to;
      return backend.getReplay(sessionId, from, to ?? null);
    }
    case 'decision_log': {
      // Fact 流过滤 rule_triggered 类型
      const facts = (await backend.getReplay(sessionId)) as Array<{
        type: string;
        [k: string]: unknown;
      }>;
      return facts.filter(
        (f) => f.type === 'rule_triggered' || f.type === 'decision',
      );
    }
    case 'audit_chain': {
      // GET /api/sessions/{id}/audit/export
      return backend.getAudit(sessionId);
    }
    case 'state_snapshot': {
      // GET /api/sessions/{id}/state(当前)或 getStateAtVersion(历史)
      if (filters.versionRange?.to) {
        return backend.getStateAtVersion(sessionId, filters.versionRange.to);
      }
      return backend.getSessionState(sessionId);
    }
    case 'causal_chain': {
      // GET /api/sessions/{id}/causal?fact_id=X
      // 需要指定 factId(filters 中或当前选中)
      // P0-7 简化:导出所有 fact 的因果链(分批调用)
      // 实际实现见 fetchCausalChainBatch
      throw new Error('causal_chain 需要 factId,使用 fetchCausalChainBatch');
    }
    case 'comprehensive': {
      // 聚合多内容
      const [audit, facts, state] = await Promise.all([
        backend.getAudit(sessionId),
        backend.getReplay(sessionId),
        backend.getSessionState(sessionId),
      ]);
      return { audit, facts, state };
    }
    default:
      throw new Error(`fetchExportContent: 未知内容类型 ${contentType}`);
  }
}

/**
 * 业务化字段映射。
 * 复用 P02 businessTermsStore。
 */
export function applyBusinessMapping(
  rawData: unknown,
  contentType: ExportContentType,
  fieldMapping?: FieldMapping[],
): unknown {
  const terms = get(businessTermsStore);
  // 简化实现:遍历 rawData,对 payload 字段应用术语映射
  // 详细实现见 BusinessDataTransformer
  if (contentType === 'fact_stream') {
    return transformFactStream(rawData, terms, fieldMapping);
  }
  if (contentType === 'audit_chain') {
    return transformAuditChain(rawData, terms, fieldMapping);
  }
  // ... 其他类型
  return rawData;
}

/**
 * 转换 Fact 流为业务化数据。
 */
function transformFactStream(
  rawData: unknown,
  terms: BusinessTerm[],
  fieldMapping?: FieldMapping[],
): unknown[] {
  const facts = rawData as Fact[];
  return facts.map((fact) => {
    const business: Record<string, unknown> = {};
    // 应用默认术语映射
    business['事件类型'] = terms.find((t) => t.key === fact.type)?.label ?? fact.type;
    business['Fact ID'] = fact.id;
    business['逻辑时间'] = (fact as { logical_time?: number }).logical_time;
    // 应用 payload 字段映射
    const payload = (fact as { payload?: Record<string, unknown> }).payload ?? {};
    for (const [key, value] of Object.entries(payload)) {
      const mapping = fieldMapping?.find((m) => m.sourcePath === `payload.${key}`);
      const term = terms.find((t) => t.key === key);
      const label = mapping?.businessLabel ?? term?.label ?? key;
      business[label] = transformValue(value, mapping);
    }
    return business;
  });
}

function transformValue(value: unknown, mapping?: FieldMapping): unknown {
  if (!mapping || mapping.valueTransform === 'none' || !mapping.valueTransform) {
    return value;
  }
  if (mapping.valueTransform === 'enum' && mapping.enumMap) {
    return mapping.enumMap[String(value)] ?? value;
  }
  if (mapping.valueTransform === 'datetime' && typeof value === 'string') {
    return new Date(value).toLocaleString('zh-CN');
  }
  return value;
}

// ============================================================================
// 4. 渲染器分发
// ============================================================================

/**
 * 渲染导出内容为指定格式的 Blob。
 */
export async function renderExport(
  content: ExportContent,
  format: ExportFormat,
  options: ExportRenderOptions,
  embedIntegrity: boolean,
): Promise<Blob> {
  const renderer = createRenderer(format);
  return renderer.render(content, options, embedIntegrity);
}

function createRenderer(format: ExportFormat): ExportRenderer {
  switch (format) {
    case 'json':
      return new JsonRenderer();
    case 'csv':
      return new CsvRenderer();
    case 'pdf':
      return new PdfRenderer();
    case 'xml':
      return new XmlRenderer();
    default:
      throw new Error(`createRenderer: 未知格式 ${format}`);
  }
}
```

### 5.2 ExportRenderer 接口与 4 个实现

```typescript
// src/lib/stores/export-renderers.ts

import type {
  ExportContent,
  ExportFormat,
  ExportRenderOptions,
  ExportMeta,
} from './export-types';

/** 渲染器接口 */
export interface ExportRenderer {
  format: ExportFormat;
  render(
    content: ExportContent,
    options: ExportRenderOptions,
    embedIntegrity: boolean,
  ): Promise<Blob>;
}

// ============================================================================
// 1. JSON 渲染器
// ============================================================================

export class JsonRenderer implements ExportRenderer {
  format = 'json' as const;

  async render(
    content: ExportContent,
    options: ExportRenderOptions,
    embedIntegrity: boolean,
  ): Promise<Blob> {
    const payload = {
      export_meta: this.buildMeta(content),
      integrity: embedIntegrity ? content.integrity : undefined,
      data: options.json?.includeRaw ? content.rawData : content.businessData,
      raw: options.json?.includeRaw ? content.rawData : undefined,
      business: options.json?.includeBusiness
        ? content.businessData
        : undefined,
      field_schema: content.fieldSchema,
    };
    const json = options.json?.prettyPrint
      ? JSON.stringify(payload, null, 2)
      : JSON.stringify(payload);
    return new Blob([json], { type: 'application/json;charset=utf-8' });
  }

  private buildMeta(content: ExportContent): ExportMeta {
    // 见 §4.5
    return { /* ... */ } as ExportMeta;
  }
}

// ============================================================================
// 2. CSV 渲染器
// ============================================================================

export class CsvRenderer implements ExportRenderer {
  format = 'csv' as const;

  async render(
    content: ExportContent,
    options: ExportRenderOptions,
    embedIntegrity: boolean,
  ): Promise<Blob> {
    const csvOpt = options.csv ?? {
      delimiter: ',' as const,
      encoding: 'utf-8' as const,
      includeHeader: true,
      flattenPayload: true,
    };

    const rows = this.toRows(content);
    const lines: string[] = [];

    // integrity 注释(首行)
    if (embedIntegrity && content.integrity) {
      lines.push(
        `# integrity: ${content.integrity.algorithm} content_hash=${content.integrity.contentHash} chain_root=${content.integrity.chainRoot} verified=${content.integrity.verified}`,
      );
      lines.push(`# exported_at: ${new Date().toISOString()}`);
      lines.push(`# session: ${content.sessionId} ruleset_version: ${content.rulesetVersion}`);
    }

    // 表头
    if (csvOpt.includeHeader && rows.length > 0) {
      lines.push(Object.keys(rows[0]).join(csvOpt.delimiter));
    }

    // 数据行
    for (const row of rows) {
      lines.push(
        Object.values(row)
          .map((v) => this.escapeCsvValue(v, csvOpt.delimiter))
          .join(csvOpt.delimiter),
      );
    }

    const csv = lines.join('\n');
    const encoder = csvOpt.encoding === 'gbk' ? new GbkEncoder() : new TextEncoder();
    return new Blob([encoder.encode(csv)], { type: 'text/csv;charset=utf-8' });
  }

  /** 扁平化为行(每行一个 Fact 或决策) */
  private toRows(content: ExportContent): Record<string, unknown>[] {
    const data = content.businessData ?? content.rawData;
    if (!Array.isArray(data)) return [];
    return data.map((item) => this.flatten(item));
  }

  /** 扁平化嵌套对象 */
  private flatten(obj: unknown, prefix = ''): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    if (typeof obj !== 'object' || obj === null) {
      result[prefix || 'value'] = obj;
      return result;
    }
    for (const [key, value] of Object.entries(obj)) {
      const newKey = prefix ? `${prefix}.${key}` : key;
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        Object.assign(result, this.flatten(value, newKey));
      } else {
        result[newKey] = Array.isArray(value) ? JSON.stringify(value) : value;
      }
    }
    return result;
  }

  private escapeCsvValue(value: unknown, delimiter: string): string {
    if (value === null || value === undefined) return '';
    const str = String(value);
    if (str.includes(delimiter) || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }
}

// ============================================================================
// 3. PDF 渲染器(服务端渲染)
// ============================================================================

export class PdfRenderer implements ExportRenderer {
  format = 'pdf' as const;

  async render(
    content: ExportContent,
    options: ExportRenderOptions,
    embedIntegrity: boolean,
  ): Promise<Blob> {
    const pdfOpt = options.pdf ?? {
      pageSize: 'A4' as const,
      orientation: 'portrait' as const,
      title: 'evorule 导出报告',
      includeCoverPage: true,
      includeTableOfContents: false,
      groupBy: 'none' as const,
    };

    // 构造 HTML 模板
    const html = this.buildHtml(content, pdfOpt, embedIntegrity);

    // 调用服务端渲染(POST /api/export/pdf)
    const response = await fetch('/api/export/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        html,
        page_size: pdfOpt.pageSize,
        orientation: pdfOpt.orientation,
      }),
    });
    if (!response.ok) {
      throw new Error(`PdfRenderer: 服务端渲染失败 ${response.status} ${response.statusText}`);
    }
    return response.blob();
  }

  /** 构建 HTML(服务端 printpdf 渲染输入) */
  private buildHtml(
    content: ExportContent,
    pdfOpt: NonNullable<ExportRenderOptions['pdf']>,
    embedIntegrity: boolean,
  ): string {
    const data = content.businessData ?? content.rawData;
    const sections: string[] = [];

    // 封面
    if (pdfOpt.includeCoverPage) {
      sections.push(`
        <section class="cover">
          <h1>${pdfOpt.title}</h1>
          <p>evorule 导出报告</p>
          <p>Session: ${content.sessionId} | Ruleset 版本: ${content.rulesetVersion}</p>
          <p>导出时间: ${new Date().toLocaleString('zh-CN')}</p>
        </section>
      `);
    }

    // 目录
    if (pdfOpt.includeTableOfContents) {
      sections.push(`
        <section class="toc">
          <h2>目录</h2>
          <ol>
            <li>导出概要</li>
            <li>完整性证明</li>
            <li>数据详情</li>
          </ol>
        </section>
      `);
    }

    // 导出概要
    sections.push(`
      <section class="summary">
        <h2>导出概要</h2>
        <table>
          <tr><td>内容类型</td><td>${content.type}</td></tr>
          <tr><td>时间范围</td><td>${content.range.fromTime ?? '-'} 至 ${content.range.toTime ?? '-'}</td></tr>
          <tr><td>记录数</td><td>${Array.isArray(data) ? data.length : 1}</td></tr>
        </table>
      </section>
    `);

    // 完整性证明
    if (embedIntegrity && content.integrity) {
      sections.push(`
        <section class="integrity">
          <h2>完整性证明</h2>
          <p>本报告采用 BLAKE3 哈希算法保证不可篡改。</p>
          <table>
            <tr><td>算法</td><td>${content.integrity.algorithm}</td></tr>
            <tr><td>内容哈希</td><td><code>${content.integrity.contentHash}</code></td></tr>
            <tr><td>审计链根哈希</td><td><code>${content.integrity.chainRoot}</code></td></tr>
            <tr><td>Fact 总数</td><td>${content.integrity.factCount}</td></tr>
            <tr><td>链验证</td><td>${content.integrity.verified ? '✅ 通过' : '❌ 失败'}</td></tr>
          </table>
          <p>验证方式:运行 <code>evorule verify-audit-export &lt;file&gt;</code></p>
        </section>
      `);
    }

    // 数据详情(按 groupBy 分组)
    sections.push(this.buildDataSection(data, pdfOpt.groupBy));

    return `
      <!DOCTYPE html>
      <html lang="zh-CN">
      <head><meta charset="utf-8"><title>${pdfOpt.title}</title>
      <style>
        body { font-family: 'Noto Sans CJK SC', sans-serif; font-size: 11pt; }
        h1 { font-size: 22pt; color: #1a365d; }
        h2 { font-size: 16pt; border-bottom: 2px solid #1a365d; padding-bottom: 4px; }
        table { border-collapse: collapse; width: 100%; margin: 8px 0; }
        td, th { border: 1px solid #ccc; padding: 4px 8px; text-align: left; }
        th { background: #edf2f7; }
        .cover { text-align: center; page-break-after: always; padding-top: 30%; }
        .toc { page-break-after: always; }
        .integrity { background: #f0fff4; padding: 12px; border-left: 4px solid #38a169; }
        code { background: #f7fafc; padding: 2px 4px; font-family: monospace; word-break: break-all; }
        section { page-break-after: always; }
        section:last-child { page-break-after: auto; }
      </style></head>
      <body>${sections.join('\n')}</body>
      </html>
    `;
  }

  private buildDataSection(
    data: unknown,
    groupBy: 'day' | 'fact_type' | 'rule_id' | 'none',
  ): string {
    if (!Array.isArray(data) || data.length === 0) {
      return '<section><h2>数据详情</h2><p>(无数据)</p></section>';
    }
    // 简化:按 groupBy 分组渲染表格
    const groups = this.groupBy(data, groupBy);
    const sections = Object.entries(groups).map(([key, items]) => `
      <section class="data">
        <h3>${groupBy === 'none' ? '数据详情' : `${groupBy}: ${key}`}</h3>
        ${this.renderTable(items)}
      </section>
    `);
    return sections.join('\n');
  }

  private groupBy(
    data: Record<string, unknown>[],
    key: 'day' | 'fact_type' | 'rule_id' | 'none',
  ): Record<string, Record<string, unknown>[]> {
    if (key === 'none') return { all: data };
    return data.reduce((acc, item) => {
      const groupKey = String(item[key] ?? 'unknown');
      if (!acc[groupKey]) acc[groupKey] = [];
      acc[groupKey].push(item);
      return acc;
    }, {} as Record<string, Record<string, unknown>[]>);
  }

  private renderTable(items: Record<string, unknown>[]): string {
    if (items.length === 0) return '';
    const headers = Object.keys(items[0]);
    const headerRow = `<tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr>`;
    const dataRows = items
      .map(
        (item) =>
          `<tr>${headers.map((h) => `<td>${item[h] ?? ''}</td>`).join('')}</tr>`,
      )
      .join('');
    return `<table>${headerRow}${dataRows}</table>`;
  }
}

// ============================================================================
// 4. XML 渲染器
// ============================================================================

export class XmlRenderer implements ExportRenderer {
  format = 'xml' as const;

  async render(
    content: ExportContent,
    options: ExportRenderOptions,
    embedIntegrity: boolean,
  ): Promise<Blob> {
    const xmlOpt = options.xml ?? {
      rootElement: 'evorule_export',
      prettyPrint: true,
    };

    const doc = this.buildXml(content, xmlOpt, embedIntegrity);
    const xml = xmlOpt.prettyPrint ? this.prettyPrint(doc) : doc;
    return new Blob([xml], { type: 'application/xml;charset=utf-8' });
  }

  private buildXml(
    content: ExportContent,
    xmlOpt: NonNullable<ExportRenderOptions['xml']>,
    embedIntegrity: boolean,
  ): string {
    const ns = xmlOpt.namespace ? ` xmlns="${xmlOpt.namespace}"` : '';
    const schemaLoc = xmlOpt.schemaLocation
      ? ` xsi:schemaLocation="${xmlOpt.namespace} ${xmlOpt.schemaLocation}"`
      : '';
    const data = content.businessData ?? content.rawData;

    const sections: string[] = [];
    sections.push(this.buildMetaXml(content));
    if (embedIntegrity && content.integrity) {
      sections.push(this.buildIntegrityXml(content.integrity));
    }
    sections.push(this.buildDataXml(data));

    return `<?xml version="1.0" encoding="UTF-8"?>\n<${xmlOpt.rootElement}${ns}${schemaLoc}>\n${sections.join('\n')}\n</${xmlOpt.rootElement}>`;
  }

  private buildMetaXml(content: ExportContent): string {
    return `  <export_meta>
    <evorule_version>0.1.1</evorule_version>
    <exported_at>${new Date().toISOString()}</exported_at>
    <session_id>${content.sessionId}</session_id>
    <ruleset_version>${content.rulesetVersion}</ruleset_version>
    <content_type>${content.type}</content_type>
  </export_meta>`;
  }

  private buildIntegrityXml(i: NonNullable<ExportContent['integrity']>): string {
    return `  <integrity algorithm="${i.algorithm}" contentHash="${i.contentHash}" chainRoot="${i.chainRoot}" factCount="${i.factCount}" verified="${i.verified}"/>`;
  }

  private buildDataXml(data: unknown, indent = '  '): string {
    if (data === null || data === undefined) return `${indent}<null/>`;
    if (typeof data !== 'object') return `${indent}<value>${this.escapeXml(String(data))}</value>`;
    if (Array.isArray(data)) {
      return data
        .map((item) => `${indent}<item>\n${this.buildDataXml(item, indent + '  ')}\n${indent}</item>`)
        .join('\n');
    }
    const obj = data as Record<string, unknown>;
    return Object.entries(obj)
      .map(([key, value]) => {
        const safeKey = this.escapeTagName(key);
        if (typeof value === 'object' && value !== null) {
          return `${indent}<${safeKey}>\n${this.buildDataXml(value, indent + '  ')}\n${indent}</${safeKey}>`;
        }
        return `${indent}<${safeKey}>${this.escapeXml(String(value ?? ''))}</${safeKey}>`;
      })
      .join('\n');
  }

  private escapeXml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  private escapeTagName(s: string): string {
    // XML 标签名不能以数字开头,不能含空格
    let safe = s.replace(/[^a-zA-Z0-9_-]/g, '_');
    if (/^[0-9]/.test(safe)) safe = `_${safe}`;
    return safe || '_';
  }

  private prettyPrint(xml: string): string {
    // 简化的 pretty print(实际可用 xml-formatter 库)
    return xml;
  }
}
```

### 5.3 ExportJobStore(后台任务)

```typescript
// src/lib/stores/export-job-store.ts

import { writable } from 'svelte/store';
import type { ExportJob, ExportContentSpec, ExportFormat } from './export-types';

export const exportJobs = writable<ExportJob[]>([]);
export const activeJobCount = writable(0);

/**
 * 创建后台导出任务。
 * 大文件(≥5000 条 或 ≥10MB)自动走此路径。
 */
export async function createExportJob(
  sessionId: number,
  content: ExportContentSpec,
  format: ExportFormat,
): Promise<string> {
  const response = await fetch('/api/export/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: sessionId,
      content,
      format,
    }),
  });
  if (!response.ok) {
    throw new Error(`createExportJob: ${response.status} ${response.statusText}`);
  }
  const { job_id } = await response.json();

  const job: ExportJob = {
    id: job_id,
    status: 'queued',
    content,
    format,
    createdAt: new Date().toISOString(),
    progress: 0,
  };
  exportJobs.update((jobs) => [...jobs, job]);
  activeJobCount.update((n) => n + 1);

  // 订阅进度(复用 P05 SSE 基础设施)
  subscribeJobProgress(job_id);

  return job_id;
}

/** SSE 订阅任务进度 */
function subscribeJobProgress(jobId: string): void {
  const eventSource = new EventSource(`/api/export/jobs/${jobId}/events`);
  eventSource.addEventListener('progress', (e) => {
    const data = JSON.parse((e as MessageEvent).data);
    updateJob(jobId, {
      status: 'running',
      progress: data.progress,
      progressMessage: data.message,
      startedAt: data.started_at,
    });
  });
  eventSource.addEventListener('completed', (e) => {
    const data = JSON.parse((e as MessageEvent).data);
    updateJob(jobId, {
      status: 'completed',
      progress: 100,
      completedAt: new Date().toISOString(),
      downloadUrl: data.download_url,
      downloadExpiresAt: data.download_expires_at,
      resultSize: data.result_size,
    });
    activeJobCount.update((n) => Math.max(0, n - 1));
    eventSource.close();
  });
  eventSource.addEventListener('failed', (e) => {
    const data = JSON.parse((e as MessageEvent).data);
    updateJob(jobId, {
      status: 'failed',
      error: data.error,
      completedAt: new Date().toISOString(),
    });
    activeJobCount.update((n) => Math.max(0, n - 1));
    eventSource.close();
  });
}

function updateJob(jobId: string, patch: Partial<ExportJob>): void {
  exportJobs.update((jobs) =>
    jobs.map((j) => (j.id === jobId ? { ...j, ...patch } : j)),
  );
}

/** 取消任务 */
export async function cancelExportJob(jobId: string): Promise<void> {
  await fetch(`/api/export/jobs/${jobId}/cancel`, { method: 'POST' });
  updateJob(jobId, { status: 'cancelled', completedAt: new Date().toISOString() });
  activeJobCount.update((n) => Math.max(0, n - 1));
}

/** 清理已完成任务(保留最近 10 个) */
export function cleanupJobs(): void {
  exportJobs.update((jobs) => {
    const completed = jobs.filter((j) =>
      ['completed', 'failed', 'cancelled'].includes(j.status),
    );
    const active = jobs.filter((j) =>
      ['queued', 'running'].includes(j.status),
    );
    return [...active, ...completed.slice(-10)];
  });
}
```

---

## 6. 前端组件设计

### 6.1 组件树

```
ExportDialog.svelte (主弹窗)
├── ExportContentSelector.svelte     (内容选择:6 种内容多选)
├── ExportFilterPanel.svelte         (筛选器:时间/类型/对象/规则/版本)
│   ├── TimeRangePicker.svelte       (时间范围:近 N / 绝对 / 可见 / 全部)
│   ├── FactTypeSelector.svelte      (Fact 类型多选,来自 P02 formSchema)
│   └── VersionRangePicker.svelte    (版本范围)
├── ExportFormatSelector.svelte      (格式选择:JSON/CSV/PDF/XML)
├── ExportFormatOptions.svelte       (格式特定选项:CSV 分隔符/PDF 页面/XML namespace)
├── ExportTemplatePanel.svelte       (模板:选择/保存/另存为/删除)
│   ├── TemplateList.svelte          (模板列表)
│   └── TemplateSaveDialog.svelte    (保存模板弹窗)
├── ExportIntegrityToggle.svelte     (BLAKE3 完整性嵌入开关)
├── ExportPreview.svelte             (预览:前 10 条数据)
└── ExportProgressBar.svelte         (后台任务进度)

ExportButton.svelte (入口按钮,3 处复用)
ExportJobBadge.svelte (顶部导航栏,显示活跃任务数)
ExportJobDropdown.svelte (任务列表下拉)
```

### 6.2 ExportDialog.svelte(主弹窗)

```svelte
<!-- src/lib/views/Export/ExportDialog.svelte -->
<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { writable, get } from 'svelte/store';
  import {
    exportTemplates,
    saveTemplate,
    fetchExportContent,
    applyBusinessMapping,
    renderExport,
    createExportJob,
  } from '$lib/stores/export-store';
  import { useBackendOrNull } from '@evorule/console';
  import type {
    ExportContentType,
    ExportFormat,
    ExportFilters,
    ExportRenderOptions,
  } from '$lib/stores/export-types';
  import ExportContentSelector from './ExportContentSelector.svelte';
  import ExportFilterPanel from './ExportFilterPanel.svelte';
  import ExportFormatSelector from './ExportFormatSelector.svelte';
  import ExportFormatOptions from './ExportFormatOptions.svelte';
  import ExportTemplatePanel from './ExportTemplatePanel.svelte';
  import ExportIntegrityToggle from './ExportIntegrityToggle.svelte';
  import ExportPreview from './ExportPreview.svelte';
  import ExportProgressBar from './ExportProgressBar.svelte';

  /** Props */
  export let sessionId: number;
  export let rulesetVersion: number;
  /** 预设(来自 3 个入口) */
  export let preset: {
    contents?: ExportContentType[];
    filters?: Partial<ExportFilters>;
    format?: ExportFormat;
  } = {};

  const dispatch = createEventDispatcher<{
    close: void;
    exported: { fileName: string; format: ExportFormat };
  }>();

  const backend = useBackendOrNull();

  // 本地状态
  const selectedContents = writable<ExportContentType[]>(
    preset.contents ?? ['fact_stream'],
  );
  const filters = writable<ExportFilters>({
    timeRange: { kind: 'last', value: 24, unit: 'hours' },
    ...preset.filters,
  });
  const format = writable<ExportFormat>(preset.format ?? 'json');
  const renderOptions = writable<ExportRenderOptions>({
    csv: { delimiter: ',', encoding: 'utf-8', includeHeader: true, flattenPayload: true },
    pdf: {
      pageSize: 'A4',
      orientation: 'portrait',
      title: 'evorule 导出报告',
      includeCoverPage: true,
      includeTableOfContents: false,
      groupBy: 'none',
    },
    xml: { rootElement: 'evorule_export', prettyPrint: true },
    json: { prettyPrint: true, includeRaw: true, includeBusiness: true },
  });
  const embedIntegrity = writable(true);
  const selectedTemplateId = writable<string | null>(null);
  const isExporting = writable(false);
  const exportError = writable<string | null>(null);
  const activeJobId = writable<string | null>(null);

  /** 应用模板 */
  function applyTemplate(templateId: string): void {
    const all = get(exportTemplates);
    const t = all.find((x) => x.id === templateId);
    if (!t) return;
    selectedContents.set([...t.content.contents]);
    filters.set({ ...t.content.filters });
    format.set(t.format);
    renderOptions.set({ ...t.renderOptions });
    embedIntegrity.set(t.embedIntegrity);
    selectedTemplateId.set(templateId);
  }

  /** 估算记录数(决定同步/后台) */
  async function estimateCount(): Promise<number> {
    // 简化:调 /api/sessions/{id}/facts?count_only=1
    // 实际实现可缓存
    return 1000; // placeholder
  }

  /** 执行导出 */
  async function doExport(): Promise<void> {
    if (!backend) {
      exportError.set('后端未连接,无法导出');
      return;
    }
    isExporting.set(true);
    exportError.set(null);

    try {
      const contents = get(selectedContents);
      const filterVals = get(filters);
      const fmt = get(format);
      const opts = get(renderOptions);
      const integrity = get(embedIntegrity);

      const estimated = await estimateCount();
      const isLarge = estimated >= 5000;

      if (isLarge) {
        // 后台任务
        const jobId = await createExportJob(sessionId, {
          contents,
          filters: filterVals,
        }, fmt);
        activeJobId.set(jobId);
        // 进度由 ExportProgressBar 监听
      } else {
        // 同步导出
        const contents_data = await Promise.all(
          contents.map(async (ct) => {
            const raw = await fetchExportContent(sessionId, ct, filterVals, backend);
            const business = applyBusinessMapping(raw, ct);
            return { type: ct, rawData: raw, businessData: business };
          }),
        );

        // 渲染(取第一个内容,P0 简化:综合报告含多内容)
        const primary = contents_data[0];
        const contentObj = {
          type: primary.type,
          sessionId,
          rulesetVersion,
          range: {
            fromTime: filterVals.timeRange?.kind === 'absolute'
              ? filterVals.timeRange.from : undefined,
            toTime: filterVals.timeRange?.kind === 'absolute'
              ? filterVals.timeRange.to : undefined,
          },
          rawData: primary.rawData,
          businessData: primary.businessData,
          integrity: primary.type === 'audit_chain'
            ? (primary.rawData as { integrity?: unknown }).integrity as any
            : undefined,
        };

        const blob = await renderExport(contentObj, fmt, opts, integrity);
        const fileName = buildFileName(contents, fmt, sessionId);
        downloadBlob(blob, fileName);

        dispatch('exported', { fileName, format: fmt });
        dispatch('close');
      }
    } catch (e) {
      exportError.set((e as Error).message);
    } finally {
      isExporting.set(false);
    }
  }

  function buildFileName(
    contents: ExportContentType[],
    fmt: ExportFormat,
    sid: number,
  ): string {
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const contentTag = contents.length === 1 ? contents[0] : 'comprehensive';
    return `evorule-${contentTag}-s${sid}-${ts}.${fmt}`;
  }

  function downloadBlob(blob: Blob, fileName: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
</script>

<div class="export-dialog-overlay" on:click={() => dispatch('close')}>
  <div class="export-dialog" on:click|stopPropagation>
    <header class="dialog-header">
      <h2>📤 导出结果</h2>
      <button class="close-btn" on:click={() => dispatch('close')}>✕</button>
    </header>

    <div class="dialog-body">
      <!-- 1. 模板 -->
      <ExportTemplatePanel
        bind:selectedTemplateId
        on:apply={(e) => applyTemplate(e.detail.templateId)}
      />

      <!-- 2. 内容选择 -->
      <ExportContentSelector bind:selectedContents />

      <!-- 3. 筛选器 -->
      <ExportFilterPanel {sessionId} bind:filters />

      <!-- 4. 格式选择 -->
      <ExportFormatSelector bind:format />

      <!-- 5. 格式选项 -->
      <ExportFormatOptions bind:format bind:renderOptions />

      <!-- 6. 完整性 -->
      <ExportIntegrityToggle bind:embedIntegrity />

      <!-- 7. 预览 -->
      <ExportPreview
        {sessionId}
        contents={$selectedContents}
        filters={$filters}
      />

      <!-- 8. 后台任务进度 -->
      {#if $activeJobId}
        <ExportProgressBar jobId={$activeJobId} on:close={() => dispatch('close')} />
      {/if}

      {#if $exportError}
        <div class="error-banner">❌ {$exportError}</div>
      {/if}
    </div>

    <footer class="dialog-footer">
      <button class="secondary" on:click={() => dispatch('close')}>取消</button>
      <button class="primary" on:click={doExport} disabled={$isExporting || $activeJobId}>
        {#if $isExporting}
          导出中...
        {:else if $activeJobId}
          后台任务进行中
        {:else}
          📥 导出
        {/if}
      </button>
    </footer>
  </div>
</div>

<style>
  .export-dialog-overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,0.5);
    display: flex; align-items: center; justify-content: center;
    z-index: 1000;
  }
  .export-dialog {
    background: white; border-radius: 8px; max-width: 720px; width: 90vw;
    max-height: 90vh; display: flex; flex-direction: column;
  }
  .dialog-header {
    padding: 16px 20px; border-bottom: 1px solid #e2e8f0;
    display: flex; justify-content: space-between; align-items: center;
  }
  .dialog-header h2 { margin: 0; font-size: 18px; color: #1a365d; }
  .close-btn { background: none; border: none; font-size: 18px; cursor: pointer; }
  .dialog-body { padding: 20px; overflow-y: auto; flex: 1; }
  .dialog-footer {
    padding: 12px 20px; border-top: 1px solid #e2e8f0;
    display: flex; justify-content: flex-end; gap: 8px;
  }
  .primary { background: #3182ce; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; }
  .primary:disabled { background: #a0aec0; cursor: not-allowed; }
  .secondary { background: white; color: #4a5568; border: 1px solid #cbd5e0; padding: 8px 16px; border-radius: 4px; cursor: pointer; }
  .error-banner { background: #fed7d7; color: #742a2a; padding: 8px 12px; border-radius: 4px; margin-top: 12px; }
</style>
```

### 6.3 ExportContentSelector.svelte(6 种内容多选)

```svelte
<!-- src/lib/views/Export/ExportContentSelector.svelte -->
<script lang="ts">
  import type { ExportContentType } from '$lib/stores/export-types';

  export let selectedContents: ExportContentType[];

  const CONTENT_OPTIONS: Array<{ value: ExportContentType; label: string; description: string }> = [
    { value: 'fact_stream', label: 'Fact 流', description: '业务事件流(全部 Fact)' },
    { value: 'decision_log', label: '决策日志', description: '规则触发的决策记录' },
    { value: 'audit_chain', label: '审计链', description: 'BLAKE3 不可篡改审计链' },
    { value: 'state_snapshot', label: '状态快照', description: '当前或历史 payload 快照' },
    { value: 'causal_chain', label: '因果链', description: '指定 Fact 的因果追溯' },
    { value: 'comprehensive', label: '综合报告', description: '多内容聚合(合规报告用)' },
  ];

  function toggle(c: ExportContentType): void {
    if (selectedContents.includes(c)) {
      selectedContents = selectedContents.filter((x) => x !== c);
    } else {
      selectedContents = [...selectedContents, c];
    }
  }
</script>

<div class="content-selector">
  <label class="section-label">导出内容(可多选)</label>
  <div class="content-grid">
    {#each CONTENT_OPTIONS as opt}
      <label class="content-card" class:selected={selectedContents.includes(opt.value)}>
        <input
          type="checkbox"
          checked={selectedContents.includes(opt.value)}
          on:change={() => toggle(opt.value)}
        />
        <div class="content-info">
          <div class="content-label">{opt.label}</div>
          <div class="content-desc">{opt.description}</div>
        </div>
      </label>
    {/each}
  </div>
</div>

<style>
  .section-label { display: block; font-weight: 600; margin-bottom: 8px; color: #2d3748; }
  .content-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .content-card { display: flex; align-items: flex-start; gap: 8px; padding: 10px; border: 1px solid #e2e8f0; border-radius: 4px; cursor: pointer; }
  .content-card.selected { border-color: #3182ce; background: #ebf8ff; }
  .content-label { font-weight: 500; font-size: 13px; }
  .content-desc { font-size: 11px; color: #718096; margin-top: 2px; }
</style>
```

### 6.4 ExportButton.svelte(入口按钮,3 处复用)

```svelte
<!-- src/lib/views/Export/ExportButton.svelte -->
<script lang="ts">
  import ExportDialog from './ExportDialog.svelte';
  import type { ExportContentType, ExportFormat, ExportFilters } from '$lib/stores/export-types';

  /** 当前 session */
  export let sessionId: number;
  export let rulesetVersion: number;
  /** 预设(决定从哪个入口进来) */
  export let preset: {
    contents?: ExportContentType[];
    filters?: Partial<ExportFilters>;
    format?: ExportFormat;
  } = {};
  /** 按钮文本 */
  export let label = '📤 导出';
  /** 按钮样式 */
  export let variant: 'primary' | 'secondary' | 'icon' = 'secondary';

  let showDialog = false;
</script>

<button class="export-btn {variant}" on:click={() => (showDialog = true)}>
  {label}
</button>

{#if showDialog}
  <ExportDialog
    {sessionId}
    {rulesetVersion}
    {preset}
    on:close={() => (showDialog = false)}
  />
{/if}

<style>
  .export-btn { cursor: pointer; }
  .export-btn.primary { background: #3182ce; color: white; border: none; padding: 6px 12px; border-radius: 4px; }
  .export-btn.secondary { background: white; color: #4a5568; border: 1px solid #cbd5e0; padding: 6px 12px; border-radius: 4px; }
  .export-btn.icon { background: none; border: none; font-size: 16px; padding: 4px; }
</style>
```

### 6.5 ExportJobBadge.svelte(顶部导航栏任务指示)

```svelte
<!-- src/lib/views/Export/ExportJobBadge.svelte -->
<script lang="ts">
  import { activeJobCount, exportJobs } from '$lib/stores/export-job-store';
  import ExportJobDropdown from './ExportJobDropdown.svelte';

  let showDropdown = false;
</script>

{#if $activeJobCount > 0 || $exportJobs.some((j) => j.status === 'completed' && Date.now() - new Date(j.completedAt!).getTime() < 60000)}
  <div class="job-badge" on:click={() => (showDropdown = !showDropdown)}>
    <span class="icon">⏳</span>
    <span class="count">{$activeJobCount}</span>
    {#if showDropdown}
      <ExportJobDropdown on:close={() => (showDropdown = false)} />
    {/if}
  </div>
{/if}

<style>
  .job-badge {
    position: relative; display: inline-flex; align-items: center; gap: 4px;
    padding: 4px 8px; background: #ebf8ff; border-radius: 12px;
    cursor: pointer; font-size: 12px; color: #2c5282;
  }
  .count { font-weight: 600; }
</style>
```

---

## 7. 与现有文档/代码的集成

### 7.1 P05 InterventionBar 升级

**修改文件**:[P05_MONITOR_DASHBOARD_DESIGN.md](file:///d:/evorule-console-cloud/docs/P05_MONITOR_DASHBOARD_DESIGN.md)

P05 InterventionBar 原 [📥 导出审计] 按钮从"直接下载 JSON"升级为"打开 ExportDialog 预选审计链":

```svelte
<!-- P05 InterventionBar 修改 -->
<!-- 旧 -->
<button onclick={doExportAudit}>📥 导出审计</button>

<!-- 新(P0-7 集成) -->
<ExportButton
  sessionId={sessionId}
  rulesetVersion={rulesetVersion}
  preset={{ contents: ['audit_chain'] }}
  label="📥 导出审计"
  variant="secondary"
/>
```

**理由**:统一交互(用户从 InterventionBar 进入 ExportDialog,可改格式为 PDF/CSV,而不仅是 JSON)。

### 7.2 P06 BusinessAuditView 增加导出按钮

**修改文件**:[P06_BUSINESS_AUDIT_TT_DESIGN.md](file:///d:/evorule-console-cloud/docs/P06_BUSINESS_AUDIT_TT_DESIGN.md)

P06 BusinessAuditView 头部增加 [📤 导出] 按钮:

```svelte
<!-- P06 BusinessAuditView 修改 -->
<header class="audit-header">
  <h2>业务审计</h2>
  <div class="actions">
    <ExportButton
      sessionId={sessionId}
      rulesetVersion={rulesetVersion}
      preset={{
        contents: ['audit_chain', 'causal_chain'],
        filters: { timeRange: { kind: 'visible' } },
      }}
      label="📤 导出审计"
      variant="primary"
    />
  </div>
</header>
```

### 7.3 独立 /export 路由

**新增路由**:`src/routes/export/+page.svelte`

```svelte
<!-- src/routes/export/+page.svelte -->
<script lang="ts">
  import ExportDialog from '$lib/views/Export/ExportDialog.svelte';
  import { currentSessionId } from '$lib/stores/session-store';
  import { productionState } from '$lib/stores/production-state';

  let showDialog = true;
</script>

<svelte:head><title>导出结果 - evorule</title></svelte:head>

<div class="export-page">
  <h1>📤 通用结果导出</h1>
  <p>选择导出内容、格式和模板,生成包含 BLAKE3 完整性证明的导出文件。</p>

  {#if $currentSessionId && $productionState}
    <button class="start-btn" on:click={() => (showDialog = true)}>
      开始导出
    </button>
    {#if showDialog}
      <ExportDialog
        sessionId={$currentSessionId}
        rulesetVersion={$productionState.rulesetVersion}
        on:close={() => (showDialog = false)}
      />
    {/if}
  {:else}
    <div class="empty-state">
      <p>无活跃 production session,无法导出。</p>
      <p>请先在 L1 监控大屏连接一个 session。</p>
    </div>
  {/if}
</div>
```

**HOME_DESIGN 顶部导航**增加"导出"入口(归 HOME_DESIGN 同步任务,不在本文档)。

### 7.4 与 P09 的接口契约

P0-7 抽取以下基础设施供 P09 复用:

| 抽取项 | 文件 | P09 用途 |
| --- | --- | --- |
| `ExportRenderer` 接口 | `export-renderers.ts` | P09 规则导出、数据集导出复用 |
| `JsonRenderer/CsvRenderer/PdfRenderer/XmlRenderer` | `export-renderers.ts` | P09 通用格式转换 |
| `ExportTemplate` schema | `export-types.ts` | P09 模板市场(模板导入导出) |
| `ExportMeta` schema | `export-types.ts` | P09 所有导出统一元数据 |

P09 在此基础上增加:
- 规则导入(`importRule` 已有,P09 扩展为批量 + 模板市场)
- 数据集导入(P03 数据集的导入方向)
- 模板市场(模板的导入导出 + 在线分享)
- 通用格式转换器(JSON ↔ YAML ↔ TOML 等)

---

## 8. 后端新增端点(P0 范围内仅 2 个)

### 8.1 POST /api/export/pdf(PDF 服务端渲染)

**请求**:
```json
{
  "html": "<!DOCTYPE html>...",
  "page_size": "A4",
  "orientation": "portrait"
}
```

**响应**:`application/pdf` blob

**实现**:evorule-server 用 `printpdf` Rust crate 渲染。HTML 解析用 `scraper`(轻量,不用完整的浏览器内核)。

**为什么服务端渲染**:
1. 前端 PDF 库(jsPDF/pdf-lib)体积 250-300KB,超标
2. 服务端渲染排版精美(支持 CSS、中文字体)
3. evorule-server 已是 Rust,加 printpdf 无语言切换成本
4. 浏览器 print() 排版受限(无法自动分页、封面、目录)

### 8.2 POST /api/export/jobs + SSE(后台任务)

**创建任务**:`POST /api/export/jobs`
```json
// 请求
{
  "session_id": 1,
  "content": {
    "contents": ["audit_chain"],
    "filters": { "timeRange": { "kind": "last", "value": 30, "unit": "days" } }
  },
  "format": "pdf"
}
// 响应
{ "job_id": "job-20260806-001", "status": "queued" }
```

**订阅进度**:`GET /api/export/jobs/{job_id}/events`(SSE)
```
event: progress
data: {"progress": 35, "message": "已获取 4350/12450 条审计条目", "started_at": "..."}

event: completed
data: {"download_url": "/api/export/jobs/job-20260806-001/download", "download_expires_at": "...", "result_size": 12345678}
```

**下载结果**:`GET /api/export/jobs/{job_id}/download` → 文件 blob

**取消任务**:`POST /api/export/jobs/{job_id}/cancel`

**实现**:evorule-server 已有 SSE 基础设施(P05 实时事件流用同一套),复用即可。任务调度用 tokio task,临时文件存 `/tmp/evorule-export/`。

> **注**:其他数据获取全部复用已有 API(audit/export、facts、replay、causal、state),不新增端点。

---

## 9. 业务化字段映射详设

### 9.1 默认字段映射(基于 P02 businessTermsStore)

```typescript
// src/lib/stores/export-field-mapping.ts

import { get } from 'svelte/store';
import { businessTermsStore, type BusinessTerm } from './business-terms';

/**
 * 默认字段映射规则。
 * 对每个 ExportContentType,定义 raw → business 的映射。
 */
export const DEFAULT_FIELD_MAPPING: Record<
  ExportContentType,
  (terms: BusinessTerm[]) => FieldMapping[]
> = {
  fact_stream: (terms) => [
    { sourcePath: 'type', businessLabel: '事件类型', valueTransform: 'enum',
      enumMap: terms.reduce((acc, t) => ({ ...acc, [t.key]: t.label }), {}) },
    { sourcePath: 'id', businessLabel: 'Fact ID' },
    { sourcePath: 'logical_time', businessLabel: '逻辑时间' },
    { sourcePath: 'timestamp', businessLabel: '时间', valueTransform: 'datetime' },
    // payload 字段动态映射(见 transformFactStream)
  ],
  decision_log: (terms) => [
    { sourcePath: 'rule_id', businessLabel: '触发规则', valueTransform: 'enum',
      enumMap: terms.reduce((acc, t) => ({ ...acc, [t.key]: t.label }), {}) },
    { sourcePath: 'decision', businessLabel: '决策结果', valueTransform: 'enum',
      enumMap: { allowed: '允许', blocked: '阻断', warning: '警告' } },
    { sourcePath: 'reason', businessLabel: '决策依据' },
    { sourcePath: 'timestamp', businessLabel: '决策时间', valueTransform: 'datetime' },
  ],
  audit_chain: () => [
    { sourcePath: 'fact_id', businessLabel: 'Fact ID' },
    { sourcePath: 'fact_type', businessLabel: 'Fact 类型' },
    { sourcePath: 'logical_time', businessLabel: '逻辑时间' },
    { sourcePath: 'content_hash', businessLabel: '内容哈希(BLAKE3)' },
    { sourcePath: 'prev_hash', businessLabel: '前序哈希' },
    { sourcePath: 'cause', businessLabel: '因果来源 Fact ID' },
  ],
  state_snapshot: () => [
    { sourcePath: 'version', businessLabel: '版本号' },
    { sourcePath: 'payload', businessLabel: '业务状态(JSON)' },
  ],
  causal_chain: () => [
    { sourcePath: 'fact_id', businessLabel: 'Fact ID' },
    { sourcePath: 'fact_type', businessLabel: 'Fact 类型' },
    { sourcePath: 'logical_time', businessLabel: '逻辑时间' },
    { sourcePath: 'cause', businessLabel: '因果来源' },
    { sourcePath: 'content_hash', businessLabel: '内容哈希' },
  ],
  comprehensive: () => [
    // 综合报告字段映射按子内容动态生成
  ],
};
```

### 9.2 字段映射示例(医院场景)

**raw Fact**:
```json
{
  "type": "patient_visit",
  "id": 42,
  "logical_time": 7,
  "timestamp": "2026-08-06T14:32:00Z",
  "payload": {
    "patient_id": "P-1283",
    "temperature": 39.2,
    "symptom": "fever",
    "age": 65
  }
}
```

**业务化(医院术语库)**:
| 字段(raw) | 字段(business) | 值(raw) | 值(business) |
| --- | --- | --- | --- |
| type | 事件类型 | patient_visit | 病人就诊 |
| id | Fact ID | 42 | 42 |
| logical_time | 逻辑时间 | 7 | 7 |
| timestamp | 时间 | 2026-08-06T14:32:00Z | 2026/8/6 22:32:00 |
| payload.patient_id | 病人 ID | P-1283 | P-1283 |
| payload.temperature | 体温(°C) | 39.2 | 39.2 |
| payload.symptom | 症状 | fever | 发热 |
| payload.age | 年龄 | 65 | 65 |

**CSV 输出**:
```csv
# integrity: BLAKE3 content_hash=3a7f... chain_root=b2c9... verified=true
# exported_at: 2026-08-06T15:00:00Z
# session: 1 ruleset_version: 5
事件类型,Fact ID,逻辑时间,时间,病人 ID,体温(°C),症状,年龄
病人就诊,42,7,2026/8/6 22:32:00,P-1283,39.2,发热,65
```

---

## 10. 测试用例

### 10.1 单元测试(渲染器)

| 测试 | 输入 | 期望 |
| --- | --- | --- |
| JsonRenderer 基本导出 | 1 条 Fact,JSON 格式 | blob 含 `export_meta` + `data` + `integrity` |
| CsvRenderer 表头 | 5 条 Fact,CSV | 首行含业务化表头 |
| CsvRenderer payload 扁平化 | 嵌套 payload | 字段名 `payload.patient_id` 扁平为 `病人 ID` |
| CsvRenderer 特殊字符 | value 含逗号/引号 | 正确转义(双引号包裹) |
| PdfRenderer 服务端渲染 | HTML 模板 | 返回 application/pdf blob |
| XmlRenderer 标签转义 | 字段名含数字/空格 | 转为合法 XML 标签名 |
| XmlRenderer 值转义 | value 含 `&<>` | 转为 `&amp;` 等 |

### 10.2 集成测试

| 测试 | 步骤 | 期望 |
| --- | --- | --- |
| 同步导出 Fact 流 CSV | 选 fact_stream + CSV → 导出 | 文件下载,文件名 `evorule-fact_stream-s1-*.csv` |
| 后台任务导出审计链 PDF | 选 audit_chain + PDF,模拟 5000+ 条 | 创建 job → SSE progress → completed → 下载 |
| 模板应用 | 选 `builtin.compliance_report` → 字段自动填充 | contents/format/options 全部按模板设置 |
| 模板保存 | 自定义配置 → 另存为模板 | 出现在模板列表,刷新后仍在 |
| BLAKE3 完整性嵌入 | 导出 audit_chain + embedIntegrity=true | JSON 含 `integrity` 段,hash 非空 |
| 业务化字段映射 | 医院术语库 + patient_visit Fact | CSV 表头为"病人 ID/体温/症状" |
| 3 个入口跳转 | InterventionBar / BusinessAuditView / 独立路由 | 都打开 ExportDialog,preset 正确预填 |
| 取消后台任务 | 创建 job → cancel | status 变 cancelled,临时文件清理 |
| 大文件下载链接过期 | job 完成后等 24h | downloadUrl 失效,提示重新导出 |

### 10.3 E2E 测试(医院场景)

| 测试 | 步骤 | 期望 |
| --- | --- | --- |
| 合规官月度报告 | 选 `builtin.compliance_report` → 导出 | 生成 PDF,含封面/目录/完整性证明/数据详情 |
| 业务专家日报 | 选 `builtin.business_summary` → 导出 | 生成 CSV,Excel 可打开,字段业务化 |
| 监管报送 | 选 `builtin.regulatory_submission` → 导出 | 生成 XML,符合 XSD schema |
| 自定义模板 | 配置 fact_stream + PDF + 按日分组 → 另存为 | 模板保存,下次可复用 |

---

## 11. 实施路径

### 11.1 实施步骤(5 步)

| 步骤 | 内容 | 文件 | 依赖 |
| --- | --- | --- | --- |
| 1 | 定义类型 + 模板 store | `export-types.ts`、`export-store.ts`(模板部分) | 无 |
| 2 | 实现 4 个渲染器 | `export-renderers.ts`、`export-field-mapping.ts` | 步骤 1 |
| 3 | 后端 PDF 渲染端点 + 后台任务端点 | evorule-server `api/export.rs` | 步骤 2 |
| 4 | 前端 ExportDialog + 子组件 | `views/Export/*.svelte` | 步骤 1-3 |
| 5 | 3 个入口集成 + HOME_DESIGN 导航 | P05/P06 修改、`routes/export/+page.svelte` | 步骤 4 |

### 11.2 与其他 P0 的实施顺序

```
P01 → P02 → P03 → P04 → P05 → P06 → P07(本文档)
                                        ↓
                                       P08(协作,可与 P07 并行)
                                        ↓
                                       P09(导入导出基础设施,依赖 P07)
```

P07 依赖 P06(业务审计视图的导出入口)和 P02(业务术语库)。

---

## 12. 长期演进路径

### 12.1 P0 → P1

| P0 | P1+ |
| --- | --- |
| 手动触发导出 | 定时自动导出(调度器) |
| BLAKE3 哈希嵌入 | 数字签名(RSA/PKCS) |
| 3 个预置模板 | 模板市场(在线分享) |
| 单 session 导出 | 跨 session 合并导出 |
| 同步 + 后台任务 | 流式导出(Kafka) |
| 4 种格式 | Excel xlsx + Markdown 报告 |

### 12.2 P1

- P1-9 监管报送接口:自动定时导出 + 推送(HTTPS 上报)
- P1-11 不可篡改复用:数字签名 + 完整性证明强化
- 审计审批工作流:导出需审计员审批(P0-8 协作基础)

### 12.3 P2

- 审计数据仓库:长期归档 + 趋势分析
- BI 集成:JDBC/ODBC 连接器
- 导出数据湖:Parquet/Arrow 格式

---

## 13. 代码变更列表

### 13.1 新增文件(前端)

| 文件 | 类型 | 说明 |
| --- | --- | --- |
| `src/lib/stores/export-types.ts` | Types | 导出相关类型定义 |
| `src/lib/stores/export-store.ts` | Store | 模板管理 + 数据获取 + 渲染分发 |
| `src/lib/stores/export-renderers.ts` | Renderers | 4 个格式渲染器(Json/Csv/Pdf/Xml) |
| `src/lib/stores/export-field-mapping.ts` | Mapping | 业务化字段映射 |
| `src/lib/stores/export-job-store.ts` | Store | 后台任务管理 |
| `src/lib/views/Export/ExportDialog.svelte` | Component | 主弹窗 |
| `src/lib/views/Export/ExportContentSelector.svelte` | Component | 6 种内容多选 |
| `src/lib/views/Export/ExportFilterPanel.svelte` | Component | 筛选器面板 |
| `src/lib/views/Export/ExportFormatSelector.svelte` | Component | 格式选择器 |
| `src/lib/views/Export/ExportFormatOptions.svelte` | Component | 格式特定选项 |
| `src/lib/views/Export/ExportTemplatePanel.svelte` | Component | 模板面板 |
| `src/lib/views/Export/ExportIntegrityToggle.svelte` | Component | 完整性开关 |
| `src/lib/views/Export/ExportPreview.svelte` | Component | 预览(前 10 条) |
| `src/lib/views/Export/ExportProgressBar.svelte` | Component | 后台任务进度 |
| `src/lib/views/Export/ExportButton.svelte` | Component | 入口按钮(3 处复用) |
| `src/lib/views/Export/ExportJobBadge.svelte` | Component | 顶部导航任务指示 |
| `src/lib/views/Export/ExportJobDropdown.svelte` | Component | 任务列表下拉 |
| `src/routes/export/+page.svelte` | Route | 独立 /export 路由 |

### 13.2 新增文件(后端 evorule-server)

| 文件 | 类型 | 说明 |
| --- | --- | --- |
| `src/api/export.rs` | API | PDF 渲染端点 + 后台任务端点 |
| `src/export/pdf_renderer.rs` | Module | printpdf 渲染 |
| `src/export/job_manager.rs` | Module | 后台任务管理(SSE 通知) |

### 13.3 修改文件

| 文件 | 修改 |
| --- | --- |
| P05 `InterventionBar.svelte` | [📥 导出审计] 按钮替换为 `<ExportButton>` 组件 |
| P06 `BusinessAuditView.svelte` | 头部增加 [📤 导出] 按钮 |
| HOME_DESIGN 顶部导航 | 增加"导出"入口 |
| evorule-server `api/server.rs` | 注册 `/api/export/*` 路由 |
| evorule-server `Cargo.toml` | 加 `printpdf`、`scraper`、`handlebars` 依赖 |

---

## 14. 待办

- [ ] 实现 4 个渲染器(步骤 2)
- [ ] 后端 PDF 渲染端点(步骤 3)
- [ ] 后台任务 + SSE 进度(步骤 3)
- [ ] ExportDialog + 子组件(步骤 4)
- [ ] 3 个入口集成(步骤 5)
- [ ] 离线验证 CLI(P1,`evorule verify-audit-export`)
- [ ] 监管报送 XSD schema 定义(P1)
- [ ] 数字签名(P1)
- [ ] 模板市场(P1,归 P09)

---

> 设计文档 — 2026-08-06 定稿
