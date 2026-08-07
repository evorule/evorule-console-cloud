> **状态**:设计文档,2026-08-06 定稿。本文档是 evorule-doc-center `b2b2c-strategy.md §20.2 P0-9` 的可实施落地。
>
> **定位**:P0-9 各种导入导出(基础设施,横向贯穿)— 把 P07 的"结果导出"扩展为"全对象导入导出 + 模板市场 + 通用格式转换",横向贯穿步骤 1-11 全部功能流。是"配置即数据"哲学的交付层。
>
> **关联**:
>
> - 战略依据:`b2b2c-strategy.md §20.2 P0-9`(步骤 1-11 全部 + 横向 — 模板市场导入 + 数据集导入 + 结果导出 + 审计导出,通用格式)
> - 三层架构:`evorule-three-layer-architecture.md §3.7.2`(审计导出 API)
> - 首页设计:`HOME_DESIGN.md §5.x`(顶部导航"导入导出"入口)
> - 前置设计:`P01_BUILD_SCHEMA_DESIGN.md`(规则单条导入导出已有)+ `P03_DATASET_DESIGN.md`(数据集管理)+ `P07_RESULT_EXPORT_DESIGN.md`(结果导出引擎,4 渲染器)
> - 横向关联:`P08_COLLAB_WORKFLOW_DESIGN.md`(模板市场权限)
> - 后端 API:`evorule-server`(规则 / 数据集 / 模板市场 API)
> - 内核导出:`@evorule/console`(`exportRule`、`importRule`)

---

## 1. 背景与动机

### 1.1 战略意图(来自 §20.2 P0-9)

> P0-9 各种导入导出(基础设施,横向贯穿)— 步骤 1-11 全部 + 横向 — 模板市场导入 + 数据集导入 + 结果导出 + 审计导出(通用格式)

**P0-9 在 11 步功能流中的位置**(横向贯穿):

```
步骤 1 创建库    → 库 schema 模板导入(行业 starter)
步骤 2 加规则    → 规则批量导入 / 模板市场
步骤 3 组合数据集 → 数据集导入(CSV/JSON 合成数据)
步骤 4-9 运行/审计 → 结果导出(P07)/ 审计导出(P07)
步骤 10 导出结果 → P07 通用结果导出
横向             → 模板市场(规则/数据集/表单模板分享)
```

**P0-9 的横向定位**:

- 不是单一功能,而是"贯穿所有 P0 的导入导出能力"
- 提取 P07 的渲染器为通用格式转换层
- 新增模板市场(在线分享规则/数据集/表单模板)
- 新增数据集导入方向(P03 只有创建,P09 加导入)
- 新增规则批量导入导出(P01 只有单条,P09 加批量)

### 1.2 现有能力盘点

| 能力            | 来源                           | 状态          | P0-9 复用方式          |
| --------------- | ------------------------------ | ------------- | ---------------------- |
| 规则单条导出    | 内核 `exportRule(id)`          | ✅ 已实现     | 扩展为批量             |
| 规则单条导入    | 内核 `importRule(jsonContent)` | ✅ 已实现     | 扩展为批量 + 模板市场  |
| 审计链导出      | `GET /audit/export`            | ✅ 已实现     | P07 已集成,P09 不重复  |
| 结果导出引擎    | P07 4 个渲染器                 | 📐 P07 已设计 | 抽取为通用格式转换层   |
| 数据集管理      | P03 `datasetStore`             | 📐 P03 已设计 | P09 加导入方向         |
| 业务表单 schema | P02 `formSchema`               | 📐 P02 已设计 | P09 加表单模板导入导出 |
| 用户身份 + 权限 | P08 `authStore` + 权限矩阵     | 📐 P08 已设计 | 模板市场权限基础       |

**结论**:P0-9 不重新实现导出引擎,而是:

1. 抽取 P07 渲染器为通用格式转换层(`format-converter.ts`)
2. 新增模板市场(在线分享)
3. 新增数据集 / 表单 / 库 schema 模板的导入导出
4. 扩展规则为批量导入导出

### 1.3 现有"导入导出"能力的缺失

| 现状                 | 不足                                                 |
| -------------------- | ---------------------------------------------------- |
| 规则只能单条导入导出 | 业务专家有几十条规则,逐条操作繁琐                    |
| 无模板市场           | 用户无法分享优质规则/数据集给他人                    |
| 无数据集导入         | P03 数据集只能手工创建,无法批量导入合成数据          |
| 无表单模板导入导出   | P02 业务表单 schema 无法跨实例复用                   |
| 无库 schema 模板     | 新建库时无行业 starter(医院/财务/合规 starter)       |
| 格式转换分散         | P07 渲染器只为结果导出,规则/数据集导出需各自实现     |
| 无版本化导入         | 导入的规则无版本追溯,无法回滚到导入前                |
| 无冲突处理           | 批量导入时同 ID 规则如何处理(覆盖/跳过/重命名)未定义 |

### 1.4 改造目标

```
P07 结果导出(垂直场景) + P01/P03 单条导入导出(分散)
  ↓ P0-9 抽取 + 扩展
导入导出基础设施(横向贯穿)
  ├── 通用格式转换层:JSON / YAML / TOML / CSV / XML 互转
  ├── 4 类对象导入导出:规则 / 数据集 / 表单 / 库 schema
  ├── 模板市场:在线分享 + 搜索 + 下载 + 上传
  ├── 批量操作:批量导出 / 批量导入 + 冲突处理
  ├── 版本化导入:导入前快照,可回滚
  └── 集成入口:统一 /import-export 路由 + 各 P0 入口
```

### 1.5 与其他 P0 的关系

| 前置设计       | P0-9 关系                                      |
| -------------- | ---------------------------------------------- |
| P01 建库向导   | 库 schema 模板(行业 starter)来自 P0-9 模板市场 |
| P02 业务语言层 | 表单模板导入导出(跨实例复用)                   |
| P03 数据集     | 数据集导入方向(CSV/JSON 合成数据)              |
| P07 结果导出   | P0-9 抽取 P07 渲染器为通用格式转换层           |
| P08 协作工作流 | 模板市场权限(上传/下载/审核)                   |

### 1.6 P0-9 vs P07 边界(再次明确)

| 维度   | P07 结果导出                       | P0-9 导入导出基础设施            |
| ------ | ---------------------------------- | -------------------------------- |
| 方向   | 只导出                             | 导入 + 导出                      |
| 对象   | 运行结果(Fact/决策/审计/状态/因果) | 规则 + 数据集 + 表单 + 库 schema |
| 格式   | JSON/CSV/PDF/XML                   | + YAML/TOML                      |
| 模板   | 导出模板(配置)                     | 模板市场(分享)                   |
| 渲染器 | P07 拥有                           | P0-9 抽取为通用层,P07 调用       |

**结论**:P07 是"结果导出"垂直场景,P0-9 是"全对象导入导出 + 模板市场"横向基础设施。P0-9 抽取 P07 的 4 个渲染器为通用格式转换层,两者共享渲染器但对象和方向不同。

---

## 2. 目标与非目标

### 2.1 目标(P0 范围)

1. **通用格式转换层**:抽取 P07 的 4 个渲染器 + 新增 YAML/TOML,共 6 种格式互转
2. **4 类对象导入导出**:
   - 规则(批量 + 单条,扩展 P01)
   - 数据集(导入方向,扩展 P03)
   - 表单 schema(跨实例复用,扩展 P02)
   - 库 schema(行业 starter,扩展 P01)
3. **模板市场**:上传 / 下载 / 搜索 / 分类 / 版本化
4. **批量操作**:批量导出 ZIP 包 + 批量导入 + 冲突处理策略
5. **版本化导入**:导入前自动快照,可回滚到导入前状态
6. **统一入口**:`/import-export` 路由 + 各 P0 集成入口
7. **6 种格式**:JSON / YAML / TOML / CSV / XML / ZIP(批量用)
8. **官方规则集标准格式(§3.8)**:定义 `ruleset.json` 标准格式(§4.6 RulesetPackage),等保门禁规则集发布到独立公开仓库 `evorule-rules/djbh-2.0-level3`,任何 evorule 生态应用可下载使用

### 2.2 非目标(明确不做)

| 不做项           | 原因                      | 归属               |
| ---------------- | ------------------------- | ------------------ |
| 模板市场在线编辑 | 模板市场是分享,编辑在本地 | P1 模板市场编辑器  |
| 模板审核工作流   | P0 简单上传下载,无审核    | P1 模板审核        |
| 模板评分 / 评论  | P0 无社区功能             | P1 模板社区        |
| 跨实例模板同步   | 需要 federation 协议      | P2 模板 federation |
| 加密模板         | 需要密钥分发              | P1 加密模板        |
| 增量导入导出     | 需要差分算法              | P1 增量同步        |
| 实时双向同步     | 需要 CRDT                 | P2 实时同步        |
| 外部市场集成     | GitHub Marketplace / npm  | P2 外部市场        |

### 2.3 设计原则

1. **渲染器共享**:P0-9 的通用格式转换层 = P07 的 4 渲染器 + YAML/TOML,不重复实现
2. **对象分离**:4 类对象(规则/数据集/表单/库 schema)各自的导入导出逻辑独立,共享格式转换层
3. **模板即数据**:模板市场内容是 JSON/YAML 文件,不是代码
4. **冲突显式**:批量导入时同 ID 对象必须明确处理策略(覆盖/跳过/重命名/合并),不静默
5. **版本化**:导入前自动快照,可回滚
6. **ZIP 打包**:批量导出用 ZIP(含 manifest.json),不用 tar(Windows 兼容性差)

---

## 3. 关键设计决策

### 3.1 决策 1:抽取 P07 渲染器为通用格式转换层

**决策**:把 P07 的 4 个渲染器(JsonRenderer/CsvRenderer/PdfRenderer/XmlRenderer)抽取到 `format-converter.ts`,新增 YamlRenderer/TomlRenderer,共 6 种格式。

```typescript
// src/lib/stores/format-converter.ts

import { JsonRenderer, CsvRenderer, PdfRenderer, XmlRenderer } from './export-renderers';

/** 通用格式(6 种) */
export type UniversalFormat = 'json' | 'yaml' | 'toml' | 'csv' | 'xml' | 'pdf';

/** 通用格式转换器接口 */
export interface UniversalConverter {
  format: UniversalFormat;
  /** 序列化:对象 → 字符串/Blob */
  serialize(data: unknown, options?: SerializeOptions): Promise<Blob>;
  /** 反序列化:字符串 → 对象(仅结构化格式支持) */
  deserialize?(input: string | Blob, options?: DeserializeOptions): Promise<unknown>;
}

// 6 个实现
export class JsonConverter implements UniversalConverter { ... }    // 复用 P07 JsonRenderer
export class YamlConverter implements UniversalConverter { ... }    // 新增(yaml 库)
export class TomlConverter implements UniversalConverter { ... }    // 新增(toml 库)
export class CsvConverter implements UniversalConverter { ... }     // 复用 P07 CsvRenderer
export class XmlConverter implements UniversalConverter { ... }     // 复用 P07 XmlRenderer
export class PdfConverter implements UniversalConverter { ... }     // 复用 P07 PdfRenderer(只序列化)
```

**理由**:

1. P07 已实现 4 个渲染器,P0-9 不重复造轮子
2. 抽取后 P07 和 P0-9 共享,避免代码分叉
3. 新增 YAML/TOML 满足配置文件场景(规则/库 schema 常用 YAML)
4. PDF 只序列化(无法反序列化),其他 5 种双向

**YAML/TOML 库选择**:

- YAML: `yaml`(npm,17KB,支持 YAML 1.2)
- TOML: `smol-toml`(npm,12KB,支持 TOML 1.0)
- 两者体积可控,符合"性能优先 + 非性能关键用接口引用"原则

### 3.2 决策 2:4 类对象,各自导入导出

**决策**:支持 4 类对象的导入导出,各自独立逻辑,共享格式转换层。

| 对象        | 导出           | 导入           | 格式           | 来源     |
| ----------- | -------------- | -------------- | -------------- | -------- |
| 规则        | ✅ 批量 + 单条 | ✅ 批量 + 单条 | JSON/YAML/TOML | 扩展 P01 |
| 数据集      | ✅ 批量        | ✅ 批量        | JSON/CSV       | 扩展 P03 |
| 表单 schema | ✅             | ✅             | JSON/YAML      | 扩展 P02 |
| 库 schema   | ✅             | ✅(新建库时)   | JSON/YAML      | 扩展 P01 |

**理由**:

1. 4 类对象 schema 差异大,合一会变上帝对象
2. 共享格式转换层,避免重复实现序列化
3. 各对象导入逻辑独立,易于扩展新对象类型

### 3.3 决策 3:模板市场 = 在线分享 + 搜索,不做编辑

**决策**:P0 模板市场只做上传/下载/搜索/分类,不做在线编辑(编辑在本地)。

**模板市场结构**:

```
模板市场(/marketplace)
├── 规则模板
│   ├── 内置(医院 starter / 财务 starter / 合规 starter)
│   └── 用户上传(需登录)
├── 数据集模板
│   ├── 内置(合成数据样例)
│   └── 用户上传
├── 表单模板
│   └── 内置(病人就诊 / 药品开具 / 发票审批)
└── 库 schema 模板
    └── 内置(医院 / 财务 / 合规)
```

**模板元数据**:

```typescript
interface MarketTemplate {
  id: string;
  type: "rule" | "dataset" | "form" | "library_schema";
  name: string;
  description: string;
  category: string; // 'medical' / 'finance' / 'compliance' / 'general'
  industry?: string; // 'hospital' / 'bank' / ...
  tags: string[];
  author: { id: string; displayName: string };
  version: string; // semver
  format: UniversalFormat;
  contentHash: string; // BLAKE3
  downloadUrl: string;
  downloadCount: number;
  createdAt: string;
  updatedAt: string;
}
```

**理由**:

1. P0 简单分享,满足"模板复用"核心需求
2. 在线编辑需前端编辑器 + 后端协同,复杂度高
3. 用户本地编辑 → 上传 → 他人下载,流程清晰
4. P1 可加在线编辑 + 评分 + 评论

### 3.4 决策 4:批量操作用 ZIP + manifest.json

**决策**:批量导出打包为 ZIP(含 `manifest.json`),批量导入从 ZIP 解包。

**ZIP 结构**:

```
evorule-export-20260806.zip
├── manifest.json            (清单:类型/数量/格式/版本/导出时间)
├── rules/
│   ├── rule-1.json
│   ├── rule-2.json
│   └── rule-3.yaml
├── datasets/
│   ├── dataset-1.json
│   └── dataset-2.csv
├── forms/
│   └── patient-visit.json
└── library-schema/
    └── hospital-starter.yaml
```

**manifest.json 示例**:

```json
{
  "manifest_version": "1.0",
  "exported_at": "2026-08-06T15:00:00Z",
  "exported_by": { "id": "u1", "displayName": "张工", "role": "it" },
  "source_instance": "evorule-console-cloud v0.1.1",
  "contents": [
    {
      "type": "rule",
      "count": 3,
      "format": "mixed(json/yaml)",
      "dir": "rules/"
    },
    {
      "type": "dataset",
      "count": 2,
      "format": "mixed(json/csv)",
      "dir": "datasets/"
    },
    { "type": "form", "count": 1, "format": "json", "dir": "forms/" }
  ],
  "total_count": 6,
  "content_hash": "abc123...(BLAKE3 of all files)"
}
```

**理由**:

1. ZIP 是跨平台标准(Windows/macOS/Linux 原生支持)
2. manifest.json 让导入端能预览内容,无需解包全部
3. tar 在 Windows 上需额外工具,兼容性差
4. 与 P07 后台任务的 ZIP 下载一致(P09 复用)

**ZIP 库选择**:`jszip`(npm,90KB,纯 JS,无原生依赖)。

### 3.5 决策 5:冲突处理 4 策略,默认"重命名"

**决策**:批量导入时同 ID 对象冲突,4 种处理策略,默认"重命名"。

| 策略        | 行为                                  | 适用场景       |
| ----------- | ------------------------------------- | -------------- |
| `skip`      | 跳过已存在的,保留原对象               | 不覆盖现有数据 |
| `overwrite` | 覆盖已存在的                          | 确定要更新     |
| `rename`    | 重命名导入的(加后缀 `-imported-{ts}`) | 默认,最安全    |
| `merge`     | 合并字段(对象级 deep merge)           | 增量更新       |

**冲突检测**:

```typescript
async function detectConflicts(
  imports: ImportItem[],
  existing: { id: string }[],
): Promise<ConflictReport[]> {
  const existingIds = new Set(existing.map((e) => e.id));
  return imports
    .filter((item) => existingIds.has(item.id))
    .map((item) => ({
      id: item.id,
      type: item.type,
      existingVersion: ...,
      importVersion: item.version,
    }));
}
```

**冲突 UI**:

```
检测到 3 个冲突:
- rule "fever.ct_required" (本地 v2 vs 导入 v3) [跳过/覆盖/重命名/合并]
- rule "drug.dose_check" (本地 v1 vs 导入 v1) [跳过/覆盖/重命名/合并]
- dataset "fever-cases" (本地存在) [跳过/覆盖/重命名/合并]

[全部跳过] [全部覆盖] [全部重命名(默认)] [全部合并] [逐个选择]
```

**理由**:

1. 默认"重命名"最安全(不破坏现有数据)
2. 4 种策略覆盖主要场景
3. 显式冲突 UI 避免静默覆盖

### 3.6 决策 6:版本化导入,可回滚

**决策**:导入前自动创建快照(版本号),导入后可回滚到导入前状态。

**快照机制**:

```typescript
// 导入前
async function createImportSnapshot(userId: string): Promise<string> {
  const snapshotId = `snap-${Date.now()}`;
  // 1. 导出当前所有规则/数据集/表单为 ZIP
  const zip = await exportAllAsZip();
  // 2. 存储到快照表
  await fetch("/api/snapshots", {
    method: "POST",
    body: JSON.stringify({
      id: snapshotId,
      user_id: userId,
      content: await zip.arrayBuffer(),
      created_at: new Date().toISOString(),
    }),
  });
  return snapshotId;
}

// 导入后
// 用户可在版本历史看到"导入前快照",点[回滚]恢复
```

**快照表**:

```
import_snapshots
├── id
├── user_id
├── content         (ZIP blob,Base64)
├── size_bytes
├── created_at
├── expires_at      (默认 30 天后过期)
└── label           (用户可加标签,如"导入前")
```

**理由**:

1. 导入可能误操作,需要回滚
2. 快照是"安全网",不强制用户每次都用
3. 30 天过期避免存储膨胀
4. 与 P08 production_audit 不同(后者管规则集版本,快照管导入操作)

### 3.7 决策 7:统一 /import-export 路由 + 各 P0 集成入口

**决策**:P0-9 提供 `/import-export` 统一路由 + 各 P0 文档的集成入口按钮。

| 入口                  | 位置                                   | preset                                              |
| --------------------- | -------------------------------------- | --------------------------------------------------- |
| `/import-export` 路由 | 顶部导航"导入导出"                     | 全空,用户自选                                       |
| P01 规则库            | [📥 导入规则] / [📤 导出规则] 按钮     | `{ type: 'rule' }`                                  |
| P03 数据集            | [📥 导入数据集] / [📤 导出数据集] 按钮 | `{ type: 'dataset' }`                               |
| P02 业务语言          | [📥 导入表单] / [📤 导出表单] 按钮     | `{ type: 'form' }`                                  |
| P01 建库向导          | "从模板创建"按钮                       | `{ type: 'library_schema', source: 'marketplace' }` |

**理由**:

1. 统一路由满足"主动导入导出"场景
2. 各 P0 集成入口降低业务专家使用门槛
3. preset 预填类型,减少选择

### 3.8 决策 8:官方规则集仓库 + ruleset.json 标准格式(生态级共享)

**决策**:等保门禁规则集等高价值合规规则包,发布为**独立公开仓库**(Gitee 主仓 + GitHub 镜像),采用 `ruleset.json` 标准格式,任何 evorule 生态应用(evorule-server / evorule-application / 第三方 Agent)均可直接下载使用,不依赖 console-cloud 前端代码。

**背景问题**:

当前等保规则集(5 条 P0)以 `BUILTIN_COMPLIANCE_GATE_RULES` 硬编码在 console-cloud 前端代码中,存在 4 个缺口:

| 缺口                             | 影响                                               |
| -------------------------------- | -------------------------------------------------- |
| evorule-server 无法直接使用      | 不依赖 console-cloud 前端,但需要规则集做服务端门禁 |
| evorule-application 无法正式引用 | 私有仓 demo 目录,非正式发布                        |
| 第三方 Agent 应用无法获取        | 没有公开下载入口                                   |
| 版本管理缺失                     | 等保标准更新时无法 semver 发版                     |

**官方规则集仓库结构**:

```
evorule-rules/djbh-2.0-level3/          (Gitee 主仓 + GitHub 镜像)
├── ruleset.json                        (规则集元数据 + 规则索引 + BLAKE3 哈希)
├── rules/
│   ├── djbh.identity.mfa_required.json         (§8.1.4.1.d 双因子认证)
│   ├── djbh.confidentiality.storage_encryption.json  (§8.1.4.7.b 存储加密)
│   ├── djbh.pi.mask_on_display.json            (脱敏显示)
│   ├── djbh.intrusion.no_high_risk_ports.json  (高危端口)
│   └── djbh.data.flow_audit.json               (数据溯源)
├── README.md                            (条款映射表 + 使用说明 + 导入示例)
├── CHANGELOG.md                         (semver 版本变更)
└── LICENSE                              (AGPL-3.0-or-later)
```

**ruleset.json 标准格式**(见 §4.6 类型定义):

```json
{
  "ruleset_version": "1.0.0",
  "name": "等保 2.0 三级 AI Agent 门禁规则集",
  "standard": "GB/T 22239-2019",
  "level": 3,
  "description": "...",
  "author": "evorule-project",
  "license": "AGPL-3.0-or-later",
  "rules": [
    /* 规则数组,每条含 id/version/description/content/compliance 元数据 */
  ],
  "content_hash": "blake3:...",
  "created_at": "2026-08-06T00:00:00Z",
  "updated_at": "2026-08-06T00:00:00Z"
}
```

**生态应用接入方式**:

| 应用                  | 接入方式                                                    | 示例                                                    |
| --------------------- | ----------------------------------------------------------- | ------------------------------------------------------- |
| evorule-console-cloud | P09 模板市场"导入官方规则集"按钮(P0 内置副本 → P1 在线下载) | `importRulesetFromGit('evorule-rules/djbh-2.0-level3')` |
| evorule-server        | Git submodule 或构建时 copy                                 | `cargo build` 时将 rules/ 打包进二进制                  |
| evorule-application   | Git clone + `importRule(jsonContent)` 逐条导入              | demo 场景直接引用                                       |
| 第三方 Agent          | 下载 ZIP + 批量导入(P09 §3.4 manifest.json)                 | `git clone` + 解析 ruleset.json                         |

**MarketTemplate.source 扩展**:

```typescript
// §4.3 MarketTemplate.source 从 2 值扩展为 3 值
source: "builtin" | "user" | "official";
//                                      ↑ 新增:官方规则集仓库同步的规则包
```

**与 BUILTIN_COMPLIANCE_GATE_RULES 的关系**:

| 阶段 | 规则集位置                                                            | console-cloud 角色                            |
| ---- | --------------------------------------------------------------------- | --------------------------------------------- |
| P0   | 独立仓库 `evorule-rules/djbh-2.0-level3` + console-cloud 内置只读副本 | 副本供 demo + 快速建库,无需网络               |
| P1   | 独立仓库 + 在线规则市场 API                                           | console-cloud 从在线市场下载,不再依赖内置副本 |
| P2   | 社区贡献 + 评分 + 审核                                                | 规则市场成为生态入口                          |

**理由**:

1. 等保规则集是 evorule "合规审计层"定位的核心共享资产,不应绑定单一产品
2. 协议层共享原则:规则 JSON 格式是 evorule 生态的共享协议,规则集是协议层的资产
3. 独立仓库支持 semver 发版,等保标准更新时可独立发布新版本
4. 开源展示轨卖点:公开规则集仓库是最直观的合规差异化展示
5. `ruleset.json` 标准格式让任何应用能统一解析,降低生态接入成本

---

## 4. 数据模型

### 4.1 UniversalExportPackage(通用导出包)

```typescript
// src/lib/stores/import-export-types.ts

import type { UniversalFormat } from "./format-converter";

/** 通用导出包(单对象) */
export interface UniversalExportPackage {
  /** 包元数据 */
  meta: PackageMeta;
  /** 对象类型 */
  objectType: ObjectType;
  /** 对象数据(已业务化,可选 raw) */
  data: unknown;
  /** raw 数据(可选,供开发者) */
  rawData?: unknown;
  /** 字段 schema(供 CSV/XML 表头) */
  fieldSchema?: FieldSchema[];
}

/** 对象类型 */
export type ObjectType = "rule" | "dataset" | "form" | "library_schema";

/** 包元数据 */
export interface PackageMeta {
  manifest_version: "1.0";
  package_id: string; // UUID
  exported_at: string;
  exported_by: { id: string; displayName: string; role: string };
  source_instance: string; // 'evorule-console-cloud v0.1.1'
  source_session_id?: number;
  object_type: ObjectType;
  object_count: number; // 1 = 单对象,>1 = 批量
  format: UniversalFormat;
  content_hash: string; // BLAKE3
  integrity?: {
    algorithm: "BLAKE3";
    contentHash: string;
    verified: boolean;
  };
}
```

### 4.2 BatchExportPackage(批量导出包,ZIP)

```typescript
/** 批量导出包(ZIP) */
export interface BatchExportPackage {
  manifest: BatchManifest;
  files: BatchFile[];
}

/** 批量清单 */
export interface BatchManifest {
  manifest_version: "1.0";
  exported_at: string;
  exported_by: { id: string; displayName: string; role: string };
  source_instance: string;
  contents: BatchContentEntry[];
  total_count: number;
  content_hash: string; // BLAKE3 of all files
}

/** 清单条目 */
export interface BatchContentEntry {
  type: ObjectType;
  count: number;
  format: UniversalFormat | "mixed";
  dir: string; // 'rules/' / 'datasets/' / ...
}

/** 批量文件 */
export interface BatchFile {
  path: string; // 'rules/rule-1.json'
  content: Blob;
  objectType: ObjectType;
  objectId: string;
  format: UniversalFormat;
}
```

### 4.3 MarketTemplate(模板市场条目)

```typescript
/** 模板市场条目 */
export interface MarketTemplate {
  id: string;
  type: ObjectType;
  name: string;
  description: string;
  category: TemplateCategory;
  industry?: string;
  tags: string[];
  author: { id: string; displayName: string };
  version: string; // semver,如 '1.0.0'
  format: UniversalFormat;
  content_hash: string; // BLAKE3
  download_url: string;
  download_count: number;
  created_at: string;
  updated_at: string;
  /** 内置 / 用户上传 / 官方规则集仓库(见 §3.8) */
  source: "builtin" | "user" | "official";
}

export type TemplateCategory =
  | "medical"
  | "finance"
  | "compliance"
  | "general"
  | "education"
  | "retail";
```

### 4.4 ImportConflict(导入冲突)

```typescript
/** 导入冲突报告 */
export interface ImportConflict {
  objectType: ObjectType;
  objectId: string;
  existingVersion: number;
  importVersion: number;
  resolution?: ConflictResolution;
}

export type ConflictResolution = "skip" | "overwrite" | "rename" | "merge";
```

### 4.5 ImportSnapshot(导入前快照)

```typescript
/** 导入前快照 */
export interface ImportSnapshot {
  id: string;
  userId: string;
  label?: string; // 用户标签,如"导入前"
  sizeBytes: number;
  createdAt: string;
  expiresAt: string; // 默认 30 天后
  /** 快照内容(ZIP,Base64 编码存数据库) */
  contentRef: string; // 存储引用(文件路径或 blob ID)
}
```

### 4.6 RulesetPackage(官方规则集标准格式,对应 §3.8)

```typescript
// src/lib/stores/ruleset-types.ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// ruleset.json 标准格式:evorule 生态规则包的统一标准。
// 任何 evorule 生态应用(console-cloud / server / application / 第三方 Agent)
// 均可解析此格式,实现规则集跨产品共享。
//
// P0:类型定义在 console-cloud,P1 迁移到 @evorule/console 内核(协议层共享)。

/**
 * 规则集包(ruleset.json 的根类型)
 *
 * 一个 RulesetPackage = 元数据 + 规则数组 + BLAKE3 完整性哈希。
 * 对应独立仓库 evorule-rules/<ruleset-id>/ruleset.json 文件。
 */
export interface RulesetPackage {
  /** 规则集元数据 */
  meta: RulesetMeta;
  /** 规则数组(有序,按条款号排列) */
  rules: RulesetRule[];
  /** 条款映射表(可选,供 README / 审计报告引用) */
  complianceMapping?: ComplianceMapping[];
  /** 所有规则内容的 BLAKE3 哈希(完整性验证) */
  contentHash: string;
}

/**
 * 规则集元数据
 */
export interface RulesetMeta {
  /** ruleset.json 格式版本(当前 "1.0") */
  schemaVersion: "1.0";
  /** 规则集 semver 版本,如 "1.0.0" */
  rulesetVersion: string;
  /** 规则集 ID(kebab-case,如 "djbh-2.0-level3") */
  rulesetId: string;
  /** 规则集名称(中文) */
  name: string;
  /** 规则集描述 */
  description: string;
  /** 合规标准号,如 "GB/T 22239-2019" */
  standard: string;
  /** 合规级别(等保 1-5,或其他标准的级别) */
  level: number;
  /** 作者 / 维护方 */
  author: string;
  /** 许可证(SPDX 标识符) */
  license: string;
  /** 仓库地址(Gitee / GitHub) */
  repository: string;
  /** 创建时间(ISO) */
  createdAt: string;
  /** 最后更新时间(ISO) */
  updatedAt: string;
  /** 标签(供市场搜索) */
  tags: string[];
}

/**
 * 规则集中的单条规则
 *
 * 兼容内核 @evorule/console 的 Rule 类型(id/version/description/content),
 * 扩展 compliance 合规元数据(对应 P01 §4.5.1 RuleComplianceMeta)。
 */
export interface RulesetRule {
  /** 规则 ID(如 "djbh.identity.mfa_required") */
  id: string;
  /** 规则版本(从 1 开始) */
  version: number;
  /** 业务专家可读的描述 */
  description: string;
  /** 原始 JSON 文本(evorule 标准 rule.json 格式) */
  content: string;
  /** 合规元数据(等保门禁规则必填,普通规则可省略) */
  compliance?: RulesetComplianceMeta;
}

/**
 * 合规元数据(与 P01 RuleComplianceMeta 字段一致,跨产品共享)
 */
export interface RulesetComplianceMeta {
  /** 标准号,如 "GB/T 22239-2019" */
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

/**
 * 条款映射表(可选,供 README / 审计报告展示)
 */
export interface ComplianceMapping {
  /** 条款号 */
  clause: string;
  /** 条款标题 */
  clauseTitle: string;
  /** 对应的规则 ID 列表(1 个条款可对应多条规则) */
  ruleIds: string[];
  /** 条款要求摘要 */
  requirement: string;
}
```

**ruleset.json 实例(等保 2.0 三级门禁规则集)**:

```json
{
  "meta": {
    "schemaVersion": "1.0",
    "rulesetVersion": "1.0.0",
    "rulesetId": "djbh-2.0-level3",
    "name": "等保 2.0 三级 AI Agent 门禁规则集",
    "description": "将等保 2.0 三级条款转化为 AI Agent 工具调用前的 Pre-execution Gate",
    "standard": "GB/T 22239-2019",
    "level": 3,
    "author": "evorule-project",
    "license": "AGPL-3.0-or-later",
    "repository": "https://gitee.com/evorule-rules/djbh-2.0-level3",
    "createdAt": "2026-08-06T00:00:00Z",
    "updatedAt": "2026-08-06T00:00:00Z",
    "tags": ["等保", "合规", "门禁", "AI-Agent", "三级"]
  },
  "rules": [
    {
      "id": "djbh.identity.mfa_required",
      "version": 1,
      "description": "管理类工具调用前必须验证双因子认证(MFA)",
      "content": "{\"trigger\":{...},\"condition\":{...},\"action\":[...]}",
      "compliance": {
        "standard": "GB/T 22239-2019",
        "level": 3,
        "clause": "8.1.4.1.d",
        "clauseTitle": "身份鉴别 - 双因子认证",
        "riskLevel": "high",
        "remediation": "在调用管理类工具前,要求用户完成密码 + 一次性令牌中的至少两种认证"
      }
    }
    // ... 其余 4 条规则
  ],
  "complianceMapping": [
    {
      "clause": "8.1.4.1.d",
      "clauseTitle": "身份鉴别 - 双因子认证",
      "ruleIds": ["djbh.identity.mfa_required"],
      "requirement": "应采用口令、密码技术、生物技术等两种或两种以上组合的鉴别技术对用户进行身份鉴别"
    }
    // ... 其余条款映射
  ],
  "contentHash": "blake3:a1b2c3d4..."
}
```

**解析与导入函数**:

```typescript
// src/lib/stores/ruleset-import.ts

import type { RulesetPackage, RulesetRule } from "./ruleset-types";
import { importRule } from "@evorule/console";

/**
 * 从 ruleset.json 解析并批量导入规则到内核 rules store。
 *
 * 1. 解析 ruleset.json(字符串 → RulesetPackage)
 * 2. 验证 contentHash(BLAKE3 完整性)
 * 3. 逐条 importRule(content) 导入内核
 * 4. 返回导入结果(成功数 / 跳过数 / 冲突列表)
 */
export async function importRuleset(
  rulesetJson: string,
  options?: { conflictResolution?: "skip" | "overwrite" | "rename" },
): Promise<RulesetImportResult> {
  const pkg: RulesetPackage = JSON.parse(rulesetJson);

  // 1. 验证 BLAKE3 完整性
  const computedHash = await computeBlake3(
    pkg.rules.map((r) => r.content).join("\n"),
  );
  if (computedHash !== pkg.contentHash) {
    throw new Error("ruleset.json contentHash 验证失败,文件可能被篡改");
  }

  // 2. 逐条导入
  const results: RulesetImportResult = {
    imported: 0,
    skipped: 0,
    conflicts: [],
  };
  for (const rule of pkg.rules) {
    try {
      importRule(rule.content);
      results.imported++;
    } catch (e) {
      if (e.message.includes("already exists")) {
        results.conflicts.push(rule.id);
        if (options?.conflictResolution !== "skip") {
          // rename 或 overwrite 逻辑(复用 P09 §3.5 冲突处理)
        }
      }
      results.skipped++;
    }
  }
  return results;
}

export interface RulesetImportResult {
  imported: number;
  skipped: number;
  conflicts: string[];
}
```

---

## 5. 通用格式转换层详设

### 5.1 6 个转换器实现

```typescript
// src/lib/stores/format-converter.ts

import type { UniversalFormat } from "./format-converter";

/** 通用转换器接口 */
export interface UniversalConverter {
  format: UniversalFormat;
  serialize(data: unknown, options?: SerializeOptions): Promise<Blob>;
  deserialize?(
    input: string | Blob,
    options?: DeserializeOptions,
  ): Promise<unknown>;
}

export interface SerializeOptions {
  prettyPrint?: boolean;
  encoding?: "utf-8" | "gbk";
}

export interface DeserializeOptions {
  encoding?: "utf-8" | "gbk";
}

// ============================================================================
// 1. JSON 转换器(复用 P07 JsonRenderer 逻辑)
// ============================================================================

export class JsonConverter implements UniversalConverter {
  format = "json" as const;

  async serialize(data: unknown, options?: SerializeOptions): Promise<Blob> {
    const json = options?.prettyPrint
      ? JSON.stringify(data, null, 2)
      : JSON.stringify(data);
    return new Blob([json], { type: "application/json;charset=utf-8" });
  }

  async deserialize(input: string | Blob): Promise<unknown> {
    const text = typeof input === "string" ? input : await input.text();
    return JSON.parse(text);
  }
}

// ============================================================================
// 2. YAML 转换器(新增)
// ============================================================================

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

export class YamlConverter implements UniversalConverter {
  format = "yaml" as const;

  async serialize(data: unknown, options?: SerializeOptions): Promise<Blob> {
    const yaml = stringifyYaml(data, {
      indent: 2,
      lineWidth: 120,
      noRefs: true,
    });
    return new Blob([yaml], { type: "application/x-yaml;charset=utf-8" });
  }

  async deserialize(input: string | Blob): Promise<unknown> {
    const text = typeof input === "string" ? input : await input.text();
    return parseYaml(text);
  }
}

// ============================================================================
// 3. TOML 转换器(新增)
// ============================================================================

import { parse as parseToml, stringify as stringifyToml } from "smol-toml";

export class TomlConverter implements UniversalConverter {
  format = "toml" as const;

  async serialize(data: unknown): Promise<Blob> {
    // TOML 不支持顶层数组,需包装
    const wrapped = Array.isArray(data) ? { items: data } : data;
    const toml = stringifyToml(wrapped as Record<string, unknown>);
    return new Blob([toml], { type: "application/toml;charset=utf-8" });
  }

  async deserialize(input: string | Blob): Promise<unknown> {
    const text = typeof input === "string" ? input : await input.text();
    const parsed = parseToml(text);
    // 解包 items
    if (parsed && typeof parsed === "object" && "items" in parsed) {
      return (parsed as { items: unknown }).items;
    }
    return parsed;
  }
}

// ============================================================================
// 4. CSV 转换器(复用 P07 CsvRenderer 逻辑)
// ============================================================================

export class CsvConverter implements UniversalConverter {
  format = "csv" as const;

  async serialize(data: unknown, options?: SerializeOptions): Promise<Blob> {
    // 复用 P07 CsvRenderer 的 toRows + escapeCsvValue 逻辑
    const rows = this.toRows(data);
    const lines = rows.map((row) =>
      Object.values(row)
        .map((v) => this.escapeCsvValue(v))
        .join(","),
    );
    if (rows.length > 0) {
      lines.unshift(Object.keys(rows[0]).join(","));
    }
    return new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  }

  async deserialize(input: string | Blob): Promise<unknown> {
    const text = typeof input === "string" ? input : await input.text();
    return this.parseCsv(text);
  }

  private toRows(data: unknown): Record<string, unknown>[] {
    if (!Array.isArray(data)) return [data as Record<string, unknown>];
    return data as Record<string, unknown>[];
  }

  private escapeCsvValue(value: unknown): string {
    if (value === null || value === undefined) return "";
    const str = String(value);
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  private parseCsv(text: string): Record<string, unknown>[] {
    // 简化 CSV 解析(实际可用 papaparse)
    const lines = text.split("\n").filter((l) => l.trim());
    if (lines.length === 0) return [];
    const headers = this.parseCsvLine(lines[0]);
    return lines.slice(1).map((line) => {
      const values = this.parseCsvLine(line);
      const row: Record<string, unknown> = {};
      headers.forEach((h, i) => {
        row[h] = values[i];
      });
      return row;
    });
  }

  private parseCsvLine(line: string): string[] {
    // 处理引号包裹的字段
    const result: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"') {
          if (line[i + 1] === '"') {
            current += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          current += ch;
        }
      } else {
        if (ch === '"') inQuotes = true;
        else if (ch === ",") {
          result.push(current);
          current = "";
        } else current += ch;
      }
    }
    result.push(current);
    return result;
  }
}

// ============================================================================
// 5. XML 转换器(复用 P07 XmlRenderer 逻辑)
// ============================================================================

export class XmlConverter implements UniversalConverter {
  format = "xml" as const;

  async serialize(data: unknown): Promise<Blob> {
    const xml = this.buildXml(data, "evorule_object");
    return new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n${xml}`], {
      type: "application/xml;charset=utf-8",
    });
  }

  async deserialize(input: string | Blob): Promise<unknown> {
    const text = typeof input === "string" ? input : await input.text();
    return this.parseXml(text);
  }

  private buildXml(data: unknown, rootTag: string, indent = ""): string {
    // 复用 P07 XmlRenderer 的 buildDataXml 逻辑
    return `${indent}<${rootTag}>...</${rootTag}>`;
  }

  private parseXml(text: string): unknown {
    // 简化 XML 解析(用 DOMParser)
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, "application/xml");
    return this.domToObject(doc.documentElement);
  }

  private domToObject(el: Element): unknown {
    // 递归将 DOM 转为对象
    const obj: Record<string, unknown> = {};
    for (const child of Array.from(el.children)) {
      const value =
        child.children.length > 0 ? this.domToObject(child) : child.textContent;
      if (child.tagName in obj) {
        if (!Array.isArray(obj[child.tagName])) {
          obj[child.tagName] = [obj[child.tagName]];
        }
        (obj[child.tagName] as unknown[]).push(value);
      } else {
        obj[child.tagName] = value;
      }
    }
    return obj;
  }
}

// ============================================================================
// 6. PDF 转换器(复用 P07 PdfRenderer,只序列化)
// ============================================================================

export class PdfConverter implements UniversalConverter {
  format = "pdf" as const;

  async serialize(data: unknown): Promise<Blob> {
    // 复用 P07 PdfRenderer,调服务端 /api/export/pdf
    const html = this.buildHtml(data);
    const response = await fetch("/api/export/pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ html, page_size: "A4", orientation: "portrait" }),
    });
    return response.blob();
  }

  // deserialize 不支持(PDF 不可反序列化)

  private buildHtml(data: unknown): string {
    return `<!DOCTYPE html><html><body><pre>${JSON.stringify(data, null, 2)}</pre></body></html>`;
  }
}

// ============================================================================
// 转换器注册表
// ============================================================================

export const CONVERTERS: Record<UniversalFormat, UniversalConverter> = {
  json: new JsonConverter(),
  yaml: new YamlConverter(),
  toml: new TomlConverter(),
  csv: new CsvConverter(),
  xml: new XmlConverter(),
  pdf: new PdfConverter(),
};

/** 格式转换(任意格式 → 任意格式) */
export async function convertFormat(
  data: unknown,
  fromFormat: UniversalFormat,
  toFormat: UniversalFormat,
): Promise<Blob> {
  if (fromFormat === toFormat) {
    return CONVERTERS[fromFormat].serialize(data);
  }
  // 大多数情况直接序列化(data 已经是对象)
  return CONVERTERS[toFormat].serialize(data);
}
```

### 5.2 格式选择建议(按对象类型)

| 对象类型    | 推荐格式          | 原因                             |
| ----------- | ----------------- | -------------------------------- |
| 规则        | YAML / JSON       | 规则可读性,YAML 注释友好         |
| 数据集      | JSON / CSV        | 数据集含 cases 数组,CSV 适合表格 |
| 表单 schema | JSON              | schema 严格,JSON 类型清晰        |
| 库 schema   | YAML              | 配置文件,YAML 注释 + 多行字符串  |
| 批量        | ZIP(内含混合格式) | 打包传输                         |

---

## 6. 4 类对象导入导出详设

### 6.1 规则导入导出(扩展 P01)

```typescript
// src/lib/stores/rule-import-export.ts

import { CONVERTERS } from "./format-converter";
import type { UniversalFormat } from "./format-converter";
import {
  rules,
  addRule,
  updateRule,
  getAllRules,
  exportRule,
} from "@evorule/console";
import { get } from "svelte/store";

/** 单条规则导出 */
export async function exportRuleUniversal(
  ruleId: string,
  format: UniversalFormat,
): Promise<Blob> {
  const rule = get(rules).find((r) => r.id === ruleId);
  if (!rule) throw new Error(`规则 ${ruleId} 不存在`);

  const data = {
    id: rule.id,
    version: rule.version,
    description: rule.description,
    content: JSON.parse(rule.content),
    source: rule.source,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
  };
  return CONVERTERS[format].serialize(data);
}

/** 批量规则导出(打包 ZIP) */
export async function exportRulesBatch(
  ruleIds: string[],
  format: UniversalFormat = "yaml",
): Promise<Blob> {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();

  const manifest = {
    manifest_version: "1.0",
    exported_at: new Date().toISOString(),
    contents: [{ type: "rule", count: ruleIds.length, format, dir: "rules/" }],
    total_count: ruleIds.length,
  };

  for (const id of ruleIds) {
    const blob = await exportRuleUniversal(id, format);
    const content = await blob.text();
    const ext =
      format === "yaml" ? "yaml" : format === "toml" ? "toml" : "json";
    const safeFileName = id.replace(/[^a-zA-Z0-9_-]/g, "_");
    zip.file(`rules/${safeFileName}.${ext}`, content);
  }

  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  return zip.generateAsync({ type: "blob" });
}

/** 单条规则导入 */
export async function importRuleUniversal(
  input: string | Blob,
  format: UniversalFormat,
  conflictResolution: "skip" | "overwrite" | "rename" = "rename",
): Promise<{
  imported: string;
  action: "created" | "updated" | "renamed" | "skipped";
}> {
  const data = (await CONVERTERS[format].deserialize(input)) as {
    id: string;
    version: number;
    description: string;
    content: unknown;
  };

  const existing = get(rules).find((r) => r.id === data.id);
  if (existing) {
    switch (conflictResolution) {
      case "skip":
        return { imported: data.id, action: "skipped" };
      case "overwrite":
        updateRule(data.id, {
          version: data.version,
          description: data.description,
          content: JSON.stringify(data.content, null, 2),
        });
        return { imported: data.id, action: "updated" };
      case "rename":
        const newId = `${data.id}-imported-${Date.now()}`;
        addRule({
          id: newId,
          version: data.version,
          description: `${data.description} (导入)`,
          content: JSON.stringify(data.content, null, 2),
        });
        return { imported: newId, action: "renamed" };
    }
  }

  // 新规则
  const id = data.id.startsWith("user.") ? data.id : `user.${data.id}`;
  addRule({
    id,
    version: data.version,
    description: data.description,
    content: JSON.stringify(data.content, null, 2),
  });
  return { imported: id, action: "created" };
}

/** 批量规则导入(从 ZIP) */
export async function importRulesBatch(
  zipBlob: Blob,
  conflictResolution: "skip" | "overwrite" | "rename" | "merge" = "rename",
): Promise<ImportResult> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(zipBlob);

  const manifestFile = zip.file("manifest.json");
  if (!manifestFile) throw new Error("ZIP 中未找到 manifest.json");
  const manifest = JSON.parse(await manifestFile.async("string"));

  const results: ImportItemResult[] = [];
  const ruleFiles = zip.folder("rules")?.file(/.+\.(json|yaml|toml)$/i) ?? [];

  for (const file of ruleFiles) {
    const ext = file.name.split(".").pop()?.toLowerCase() as UniversalFormat;
    const content = await file.async("string");
    try {
      const result = await importRuleUniversal(
        content,
        ext,
        conflictResolution,
      );
      results.push({
        objectId: result.imported,
        action: result.action,
        status: "success",
      });
    } catch (e) {
      results.push({
        objectId: file.name,
        action: "failed",
        status: "error",
        error: (e as Error).message,
      });
    }
  }

  return {
    objectType: "rule",
    totalCount: manifest.total_count,
    results,
    successCount: results.filter((r) => r.status === "success").length,
    failureCount: results.filter((r) => r.status === "error").length,
  };
}

export interface ImportResult {
  objectType: ObjectType;
  totalCount: number;
  results: ImportItemResult[];
  successCount: number;
  failureCount: number;
}

export interface ImportItemResult {
  objectId: string;
  action: "created" | "updated" | "renamed" | "skipped" | "failed";
  status: "success" | "error";
  error?: string;
}
```

### 6.2 数据集导入导出(扩展 P03)

```typescript
// src/lib/stores/dataset-import-export.ts

import { CONVERTERS } from "./format-converter";
import type { UniversalFormat } from "./format-converter";
import { datasetStore, createDataset } from "./dataset"; // P03
import { get } from "svelte/store";

/** 数据集导出 */
export async function exportDataset(
  datasetId: string,
  format: UniversalFormat,
): Promise<Blob> {
  const datasets = get(datasetStore);
  const dataset = datasets.find((d) => d.id === datasetId);
  if (!dataset) throw new Error(`数据集 ${datasetId} 不存在`);

  // 数据集含 cases 数组,CSV 时扁平化
  if (format === "csv") {
    return CONVERTERS.csv.serialize(dataset.cases);
  }
  return CONVERTERS[format].serialize(dataset);
}

/** 数据集导入 */
export async function importDataset(
  input: string | Blob,
  format: UniversalFormat,
  name: string,
  description: string,
): Promise<string> {
  let cases: unknown[];
  if (format === "csv") {
    cases = (await CONVERTERS.csv.deserialize(input)) as unknown[];
  } else {
    const data = (await CONVERTERS[format].deserialize(input)) as {
      cases?: unknown[];
      name?: string;
      description?: string;
    };
    cases = data.cases ?? (Array.isArray(data) ? data : []);
  }

  // 创建新数据集(导入总是新建,不覆盖)
  const datasetName =
    name || `导入的数据集 ${new Date().toLocaleString("zh-CN")}`;
  const datasetId = createDataset(datasetName, description, [], []);
  return datasetId;
}
```

### 6.3 表单 schema 导入导出(扩展 P02)

```typescript
// src/lib/stores/form-import-export.ts

import { CONVERTERS } from "./format-converter";
import type { UniversalFormat } from "./format-converter";
import { businessFormStore, saveFormSchema } from "./business-terms"; // P02
import { get } from "svelte/store";

/** 表单 schema 导出 */
export async function exportFormSchema(
  formId: string,
  format: UniversalFormat = "json",
): Promise<Blob> {
  const forms = get(businessFormStore);
  const form = forms.find((f) => f.id === formId);
  if (!form) throw new Error(`表单 ${formId} 不存在`);
  return CONVERTERS[format].serialize(form);
}

/** 表单 schema 导入 */
export async function importFormSchema(
  input: string | Blob,
  format: UniversalFormat,
): Promise<string> {
  const form = (await CONVERTERS[format].deserialize(input)) as {
    id: string;
    name: string;
    formSchema: unknown[];
  };
  // 导入总是新建(加后缀)
  const newId = `${form.id}-imported-${Date.now()}`;
  saveFormSchema({
    ...form,
    id: newId,
    name: `${form.name} (导入)`,
  });
  return newId;
}
```

### 6.4 库 schema 模板(扩展 P01)

```typescript
// src/lib/stores/library-schema-import.ts

import { CONVERTERS } from "./format-converter";
import type { UniversalFormat } from "./format-converter";

/** 库 schema 模板(行业 starter) */
export interface LibrarySchemaTemplate {
  id: string;
  name: string; // '医院 starter'
  description: string;
  industry: string; // 'hospital' / 'finance' / 'compliance'
  /** 初始规则(可空) */
  initialRules: unknown[];
  /** 初始业务术语库 */
  initialTerms: unknown[];
  /** 初始业务表单 */
  initialForms: unknown[];
  /** 初始数据集 */
  initialDatasets: unknown[];
}

/** 3 个内置库 schema 模板 */
export const BUILTIN_LIBRARY_TEMPLATES: LibrarySchemaTemplate[] = [
  {
    id: "builtin.hospital_starter",
    name: "医院 starter",
    description:
      "医院场景初始库:含病人就诊/药品开具/发票审批 3 个示例规则 + 医疗术语库 + 表单",
    industry: "hospital",
    initialRules: [
      /* ... */
    ],
    initialTerms: [
      /* ... */
    ],
    initialForms: [
      /* ... */
    ],
    initialDatasets: [
      /* ... */
    ],
  },
  {
    id: "builtin.finance_starter",
    name: "财务 starter",
    description: "财务场景初始库:含发票审批/预算校验/费用报销 3 个示例规则",
    industry: "finance",
    initialRules: [
      /* ... */
    ],
    initialTerms: [
      /* ... */
    ],
    initialForms: [
      /* ... */
    ],
    initialDatasets: [
      /* ... */
    ],
  },
  {
    id: "builtin.compliance_starter",
    name: "合规 starter",
    description:
      "合规场景初始库:含等保 2.0 三级条款映射的 AI Agent 门禁规则(5 条 P0 规则)",
    industry: "compliance",
    initialRules: BUILTIN_COMPLIANCE_GATE_RULES,
    initialTerms: [
      /* 见 §4.3.1 合规术语 */
    ],
    initialForms: [
      /* 见 §4.3.2 合规表单 */
    ],
    initialDatasets: [
      /* 见 §4.3.3 合规测试数据集 */
    ],
  },
];

/**
 * 4.3 内置等保门禁规则模板(5 条 P0,对应 COMPLIANCE_GATE_DESIGN.md §4.1-§4.5)
 *
 * 权威来源:独立公开仓库 evorule-rules/djbh-2.0-level3(Gitee 主仓 + GitHub 镜像)
 *          采用 ruleset.json 标准格式(见 §4.6 RulesetPackage)
 * 定位:AI Agent 工具调用前的 Pre-execution Gate(执行链路前置门禁)
 * 规则 JSON 格式:复用 evorule 标准 rule.json + compliance 元数据扩展字段
 *
 * 生态共享(见 §3.8 决策 8):
 * - 权威源:evorule-rules/djbh-2.0-level3 仓库(semver 发版,任何 evorule 生态应用可下载)
 * - console-cloud:本文件内置 5 条 P0 规则的只读副本(供 demo + 快速建库,无需网络)
 * - evorule-server:Git submodule 或构建时 copy rules/ 目录
 * - 第三方 Agent:git clone + importRuleset(ruleset.json)(见 §4.6 importRuleset 函数)
 * - 用户可从模板市场导入到自己的库,然后在 P01 业务规则库中编辑
 */
export const BUILTIN_COMPLIANCE_GATE_RULES = [
  // 规则 1:§8.1.4.1.d 双因子认证(MFA)— 管理类工具调用前必须验证
  {
    id: "djbh.identity.mfa_required",
    version: 1,
    description: "管理类工具调用前必须验证双因子认证(MFA)",
    content: JSON.stringify({
      compliance: {
        standard: "GB/T 22239-2019",
        level: 3,
        clause: "8.1.4.1.d",
        clauseTitle: "身份鉴别 - 双因子认证",
        riskLevel: "high",
        remediation:
          "在调用管理类工具前,要求用户完成密码 + 一次性令牌(TOTP)/短信验证码/生物特征 中的至少两种认证",
      },
      trigger: { type: "event", event: "agent.tool_call" },
      condition: {
        all: [
          {
            path: "tool.category",
            op: "in",
            value: ["admin", "finance", "data_export"],
          },
          { path: "user.auth_factors.count", op: "<", value: 2 },
        ],
      },
      action: [
        { type: "block", reason: "等保 §8.1.4.1.d: 管理类操作必须双因子认证" },
        { type: "audit", level: "warning", alert: "mfa_required_but_missing" },
      ],
    }),
  },

  // 规则 2:§8.1.4.7.b 数据保密性 - 存储加密
  {
    id: "djbh.confidentiality.storage_encryption",
    version: 1,
    description: "敏感数据写入存储前必须加密(国密 SM4 优先)",
    content: JSON.stringify({
      compliance: {
        standard: "GB/T 22239-2019",
        level: 3,
        clause: "8.1.4.7.b",
        clauseTitle: "数据保密性 - 存储过程加密",
        riskLevel: "critical",
        remediation:
          "对鉴别数据/重要业务数据/敏感个人信息采用 SM4-GCM 或 AES-256-GCM 加密后存储",
      },
      trigger: { type: "event", event: "agent.tool_call" },
      condition: {
        all: [
          { path: "tool.name", op: "==", value: "db_write" },
          { path: "params.encryption", op: "==", value: "none" },
        ],
      },
      action: [
        { type: "block", reason: "等保 §8.1.4.7.b: 敏感数据存储必须加密" },
        {
          type: "audit",
          level: "critical",
          alert: "sensitive_data_unencrypted_storage",
        },
      ],
    }),
  },

  // 规则 3:§8.1.4.10.b 个人信息脱敏展示
  {
    id: "djbh.pi.mask_on_display",
    version: 1,
    description: "AI Agent 响应输出含个人信息时,必须脱敏后再返回用户",
    content: JSON.stringify({
      compliance: {
        standard: "GB/T 22239-2019",
        level: 3,
        clause: "8.1.4.10.b",
        clauseTitle: "个人信息保护 - 脱敏展示",
        riskLevel: "high",
        remediation:
          "对响应内容中的身份证号/手机号/银行卡号进行掩码处理(保留前 3 后 4)",
      },
      trigger: { type: "event", event: "agent.response_output" },
      condition: {
        any: [
          {
            path: "response.content",
            op: "matches_regex",
            value: "\\b\\d{17}[\\dXx]\\b",
          },
          {
            path: "response.content",
            op: "matches_regex",
            value: "\\b1[3-9]\\d{9}\\b",
          },
        ],
      },
      action: [
        {
          type: "io_request",
          io_type: "mask_pii",
          params: { strategy: "preserve_head_tail", head: 3, tail: 4 },
        },
        { type: "audit", level: "warning", alert: "pii_detected_in_response" },
      ],
    }),
  },

  // 规则 4:§8.1.4.4.b 关闭高危端口
  {
    id: "djbh.intrusion.no_high_risk_ports",
    version: 1,
    description: "AI Agent 执行系统命令时禁止开放高危端口或停用防火墙",
    content: JSON.stringify({
      compliance: {
        standard: "GB/T 22239-2019",
        level: 3,
        clause: "8.1.4.4.b",
        clauseTitle: "入侵防范 - 关闭高危端口/默认共享",
        riskLevel: "critical",
        remediation:
          "禁止通过 AI Agent 开放 22/3389/445/135 等高危端口或停用主机防火墙",
      },
      trigger: { type: "event", event: "agent.tool_call" },
      condition: {
        all: [
          { path: "tool.name", op: "==", value: "execute_command" },
          {
            any: [
              {
                path: "params.command",
                op: "matches_regex",
                value: "(?i)firewall.*(off|disable|stop)",
              },
              {
                path: "params.command",
                op: "matches_regex",
                value: "(?i)iptables.*--dport.*(22|3389|445|135)",
              },
            ],
          },
        ],
      },
      action: [
        {
          type: "block",
          reason: "等保 §8.1.4.4.b: 禁止开放高危端口或停用防火墙",
        },
        {
          type: "audit",
          level: "critical",
          alert: "high_risk_port_operation_attempted",
        },
      ],
    }),
  },

  // 规则 5:GA/T 2380-2026 数据溯源
  {
    id: "djbh.data.flow_audit",
    version: 1,
    description: "数据导出/共享操作必须留下完整流转记录(BLAKE3 哈希链留痕)",
    content: JSON.stringify({
      compliance: {
        standard: "GA/T 2380-2026",
        level: 3,
        clause: "数据溯源",
        clauseTitle: "数据全流程访问/导出/共享行为记录",
        riskLevel: "high",
        remediation:
          "记录数据流向:操作者/数据标识/目的/接收方/时间戳,并写入 BLAKE3 哈希链保证不可篡改",
      },
      trigger: { type: "event", event: "agent.data_export" },
      condition: {
        all: [
          { path: "user.id", op: "exists" },
          { path: "data.identifier", op: "exists" },
          { path: "data.purpose", op: "exists" },
        ],
      },
      action: [
        {
          type: "io_request",
          io_type: "audit_log",
          params: {
            event: "data_flow",
            retention_days: 1095,
            hash_chain: "blake3",
          },
        },
        { type: "audit", level: "info", alert: "data_flow_recorded" },
      ],
    }),
  },
];

/** 从模板创建新库(P01 建库向导调用) */
export async function createLibraryFromTemplate(
  templateId: string,
  libraryName: string,
): Promise<void> {
  const template = BUILTIN_LIBRARY_TEMPLATES.find((t) => t.id === templateId);
  if (!template) throw new Error(`模板 ${templateId} 不存在`);

  // 批量初始化(调用 P01/P02/P03 的创建函数)
  for (const rule of template.initialRules) {
    // addRule(rule);
  }
  for (const term of template.initialTerms) {
    // addBusinessTerm(term);
  }
  for (const form of template.initialForms) {
    // saveFormSchema(form);
  }
  for (const dataset of template.initialDatasets) {
    // createDataset(dataset);
  }
}

/** 库 schema 导出(整个库的快照) */
export async function exportLibrarySchema(
  format: UniversalFormat = "yaml",
): Promise<Blob> {
  const snapshot = {
    libraryName: "当前库",
    exportedAt: new Date().toISOString(),
    rules: /* getAllRules() */ [],
    terms: /* get(businessTermsStore) */ [],
    forms: /* get(businessFormStore) */ [],
    datasets: /* get(datasetStore) */ [],
  };
  return CONVERTERS[format].serialize(snapshot);
}
```

---

## 7. 模板市场详设

### 7.1 marketplaceStore

```typescript
// src/lib/stores/marketplace.ts

import { writable, derived } from "svelte/store";
import type {
  MarketTemplate,
  ObjectType,
  TemplateCategory,
} from "./import-export-types";

export const marketplaceTemplates = writable<MarketTemplate[]>([]);
export const marketplaceLoading = writable(false);
export const marketplaceError = writable<string | null>(null);

/** 搜索 + 筛选 */
export const searchQuery = writable("");
export const filterType = writable<ObjectType | "all">("all");
export const filterCategory = writable<TemplateCategory | "all">("all");

/** 筛选后的模板 */
export const filteredTemplates = derived(
  [marketplaceTemplates, searchQuery, filterType, filterCategory],
  ([$templates, $query, $type, $category]) => {
    return $templates.filter((t) => {
      if ($type !== "all" && t.type !== $type) return false;
      if ($category !== "all" && t.category !== $category) return false;
      if ($query) {
        const q = $query.toLowerCase();
        return (
          t.name.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q) ||
          t.tags.some((tag) => tag.toLowerCase().includes(q))
        );
      }
      return true;
    });
  },
);

/** 加载模板市场 */
export async function loadMarketplace(): Promise<void> {
  marketplaceLoading.set(true);
  try {
    const response = await fetch("/api/marketplace/templates");
    if (!response.ok) throw new Error(`加载市场失败: ${response.status}`);
    const data = await response.json();
    marketplaceTemplates.set(data.templates);
  } catch (e) {
    marketplaceError.set((e as Error).message);
  } finally {
    marketplaceLoading.set(false);
  }
}

/** 上传模板到市场 */
export async function uploadTemplate(
  template: Omit<
    MarketTemplate,
    "id" | "download_count" | "created_at" | "updated_at" | "source"
  >,
  content: Blob,
): Promise<{ success: boolean; error?: string }> {
  const formData = new FormData();
  formData.append("meta", JSON.stringify(template));
  formData.append("content", content);

  const response = await fetch("/api/marketplace/templates", {
    method: "POST",
    body: formData,
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    return { success: false, error: err.message ?? "上传失败" };
  }
  await loadMarketplace();
  return { success: true };
}

/** 下载模板 */
export async function downloadTemplate(templateId: string): Promise<Blob> {
  const response = await fetch(
    `/api/marketplace/templates/${templateId}/download`,
  );
  if (!response.ok) throw new Error(`下载失败: ${response.status}`);
  return response.blob();
}

/** 删除自己的模板 */
export async function deleteTemplate(templateId: string): Promise<void> {
  await fetch(`/api/marketplace/templates/${templateId}`, { method: "DELETE" });
  await loadMarketplace();
}
```

### 7.2 模板市场 UI

```svelte
<!-- src/lib/views/Marketplace/MarketplacePage.svelte -->
<script lang="ts">
  import {
    filteredTemplates,
    searchQuery,
    filterType,
    filterCategory,
    loadMarketplace,
    downloadTemplate,
  } from '$lib/stores/marketplace';
  import { onMount } from 'svelte';
  import { currentUser, can } from '$lib/stores/auth';

  onMount(() => loadMarketplace());

  async function handleDownload(templateId: string, format: string): Promise<void> {
    const blob = await downloadTemplate(templateId);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `template-${templateId}.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  }
</script>

<div class="marketplace-page">
  <header>
    <h1>模板市场</h1>
    <p>分享和下载规则、数据集、表单和库 schema 模板</p>
  </header>

  <div class="filters">
    <input type="text" placeholder="搜索模板..." bind:value={searchQuery} />
    <select bind:value={filterType}>
      <option value="all">全部类型</option>
      <option value="rule">规则</option>
      <option value="dataset">数据集</option>
      <option value="form">表单</option>
      <option value="library_schema">库 schema</option>
    </select>
    <select bind:value={filterCategory}>
      <option value="all">全部分类</option>
      <option value="medical">医疗</option>
      <option value="finance">财务</option>
      <option value="compliance">合规</option>
      <option value="general">通用</option>
    </select>
  </div>

  <div class="template-grid">
    {#each $filteredTemplates as t}
      <div class="template-card">
        <header>
          <span class="type-badge {t.type}">{t.type}</span>
          <span class="category">{t.category}</span>
        </header>
        <h3>{t.name}</h3>
        <p class="description">{t.description}</p>
        <div class="tags">
          {#each t.tags as tag}
            <span class="tag">#{tag}</span>
          {/each}
        </div>
        <div class="meta">
          <span>作者: {t.author.displayName}</span>
          <span>v{t.version}</span>
          <span>下载: {t.download_count}</span>
        </div>
        <div class="actions">
          <button on:click={() => handleDownload(t.id, t.format)}>📥 下载</button>
          {#if t.author.id === $currentUser?.id}
            <button class="delete" on:click={() => deleteTemplate(t.id)}>删除</button>
          {/if}
        </div>
      </div>
    {/each}
  </div>
</div>

<style>
  .marketplace-page { padding: 20px; max-width: 1200px; margin: 0 auto; }
  h1 { color: #1a365d; }
  .filters { display: flex; gap: 12px; margin: 20px 0; }
  .filters input, .filters select { padding: 8px; border: 1px solid #cbd5e0; border-radius: 4px; }
  .filters input { flex: 1; }
  .template-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
  .template-card { background: white; border: 1px solid #e2e8f0; border-radius: 6px; padding: 16px; display: flex; flex-direction: column; }
  header { display: flex; justify-content: space-between; margin-bottom: 8px; }
  .type-badge { font-size: 11px; padding: 2px 8px; border-radius: 12px; background: #edf2f7; color: #4a5568; }
  .type-badge.rule { background: #bee3f8; color: #2a4365; }
  .type-badge.dataset { background: #c6f6d5; color: #22543d; }
  .type-badge.form { background: #fefcbf; color: #744210; }
  .type-badge.library_schema { background: #e9d8fd; color: #44337a; }
  h3 { margin: 0 0 4px; font-size: 15px; color: #2d3748; }
  .description { font-size: 12px; color: #718096; flex: 1; margin: 0 0 8px; }
  .tags { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; }
  .tag { font-size: 11px; color: #3182ce; }
  .meta { font-size: 11px; color: #a0aec0; display: flex; flex-direction: column; gap: 2px; margin-bottom: 12px; }
  .actions { display: flex; gap: 8px; }
  .actions button { padding: 4px 10px; background: #3182ce; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; }
  .actions .delete { background: #e53e3e; }
</style>
```

---

## 8. 后端 API 设计

### 8.1 模板市场 API

| API                                       | 方法   | 功能                | 权限   |
| ----------------------------------------- | ------ | ------------------- | ------ |
| `/api/marketplace/templates`              | GET    | 模板列表(支持筛选)  | 已登录 |
| `/api/marketplace/templates`              | POST   | 上传模板(multipart) | 已登录 |
| `/api/marketplace/templates/:id`          | GET    | 模板详情            | 已登录 |
| `/api/marketplace/templates/:id`          | DELETE | 删除模板(仅作者)    | 作者   |
| `/api/marketplace/templates/:id/download` | GET    | 下载模板内容        | 已登录 |
| `/api/marketplace/templates/:id/download` | POST   | 增加下载计数        | 已登录 |
| `/api/marketplace/categories`             | GET    | 分类列表            | 已登录 |

### 8.2 导入快照 API

| API                                 | 方法   | 功能                   | 权限         |
| ----------------------------------- | ------ | ---------------------- | ------------ |
| `/api/import-snapshots`             | POST   | 创建快照(导入前自动调) | 已登录       |
| `/api/import-snapshots`             | GET    | 快照列表               | 已登录(本人) |
| `/api/import-snapshots/:id`         | GET    | 快照详情               | 已登录(本人) |
| `/api/import-snapshots/:id/restore` | POST   | 回滚到快照             | 已登录(本人) |
| `/api/import-snapshots/:id`         | DELETE | 删除快照               | 已登录(本人) |

### 8.3 批量操作 API(可选,前端也可直接处理)

| API                         | 方法 | 功能                  | 权限   |
| --------------------------- | ---- | --------------------- | ------ |
| `/api/batch/export`         | POST | 批量导出(返回 ZIP)    | 已登录 |
| `/api/batch/import`         | POST | 批量导入(上传 ZIP)    | 已登录 |
| `/api/batch/import-preview` | POST | 预览 ZIP 内容(不解包) | 已登录 |

> **注**:P0 倾向前端直接处理(JSZip),后端只提供模板市场和快照 API。批量 API 是 P1 演进(支持服务端大文件处理)。

---

## 9. 前端组件设计

### 9.1 组件树

```
/import-export 路由
├── ImportExportPage.svelte          (主页)
│   ├── Tabs:导入 / 导出 / 模板市场
│   ├── ImportTab.svelte
│   │   ├── ObjectTypeSelector.svelte (4 类对象)
│   │   ├── FileUploader.svelte       (拖拽上传)
│   │   ├── FormatDetector.svelte     (自动检测格式)
│   │   ├── ConflictResolver.svelte   (冲突处理 UI)
│   │   └── ImportPreview.svelte      (预览导入内容)
│   ├── ExportTab.svelte
│   │   ├── ObjectTypeSelector.svelte
│   │   ├── ObjectPicker.svelte       (选择导出对象)
│   │   ├── FormatSelector.svelte     (6 种格式)
│   │   ├── BatchOptions.svelte       (批量 ZIP 选项)
│   │   └── ExportButton.svelte
│   └── MarketplaceTab.svelte
│       ├── MarketplacePage.svelte    (见 §7.2)
│       └── UploadTemplateDialog.svelte

各 P0 集成入口
├── P01 规则库:[📥 导入规则] [📤 导出规则] 按钮
├── P03 数据集:[📥 导入数据集] [📤 导出数据集] 按钮
├── P02 业务语言:[📥 导入表单] [📤 导出表单] 按钮
└── P01 建库向导:[从模板创建] 按钮
```

### 9.2 ConflictResolver.svelte(冲突处理 UI)

```svelte
<!-- src/lib/views/ImportExport/ConflictResolver.svelte -->
<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { ImportConflict, ConflictResolution } from '$lib/stores/import-export-types';

  export let conflicts: ImportConflict[];
  export let defaultResolution: ConflictResolution = 'rename';

  const dispatch = createEventDispatcher<{ resolve: ConflictResolution[] }>();

  let resolutions: Record<string, ConflictResolution> = {};
  for (const c of conflicts) {
    resolutions[`${c.objectType}:${c.objectId}`] = defaultResolution;
  }

  function setAll(resolution: ConflictResolution): void {
    for (const c of conflicts) {
      resolutions[`${c.objectType}:${c.objectId}`] = resolution;
    }
    resolutions = { ...resolutions };
  }

  function handleResolve(): void {
    const result = conflicts.map(
      (c) => resolutions[`${c.objectType}:${c.objectId}`],
    );
    dispatch('resolve', result);
  }
</script>

<div class="conflict-resolver">
  <h3>检测到 {conflicts.length} 个冲突</h3>

  <div class="bulk-actions">
    <button on:click={() => setAll('skip')}>全部跳过</button>
    <button on:click={() => setAll('overwrite')}>全部覆盖</button>
    <button on:click={() => setAll('rename')}>全部重命名(默认)</button>
    <button on:click={() => setAll('merge')}>全部合并</button>
  </div>

  <table>
    <thead>
      <tr><th>对象</th><th>本地版本</th><th>导入版本</th><th>处理方式</th></tr>
    </thead>
    <tbody>
      {#each conflicts as c}
        <tr>
          <td>{c.objectType}: {c.objectId}</td>
          <td>v{c.existingVersion}</td>
          <td>v{c.importVersion}</td>
          <td>
            <select bind:value={resolutions[`${c.objectType}:${c.objectId}`]}>
              <option value="skip">跳过</option>
              <option value="overwrite">覆盖</option>
              <option value="rename">重命名</option>
              <option value="merge">合并</option>
            </select>
          </td>
        </tr>
      {/each}
    </tbody>
  </table>

  <button class="resolve-btn" on:click={handleResolve}>确认导入</button>
</div>

<style>
  .conflict-resolver { padding: 16px; background: #fffaf0; border: 1px solid #ed8936; border-radius: 6px; }
  h3 { margin: 0 0 12px; color: #7c2d12; }
  .bulk-actions { display: flex; gap: 8px; margin-bottom: 12px; }
  .bulk-actions button { padding: 4px 10px; background: white; border: 1px solid #cbd5e0; border-radius: 4px; cursor: pointer; font-size: 12px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
  th, td { padding: 6px 8px; text-align: left; border-bottom: 1px solid #e2e8f0; font-size: 13px; }
  th { background: #edf2f7; }
  select { padding: 2px 4px; }
  .resolve-btn { padding: 8px 16px; background: #3182ce; color: white; border: none; border-radius: 4px; cursor: pointer; }
</style>
```

---

## 10. 与现有文档/代码的集成

### 10.1 P01 规则库集成

**修改文件**:[P01_BUILD_SCHEMA_DESIGN.md](file:///d:/evorule-console-cloud/docs/P01_BUILD_SCHEMA_DESIGN.md)

P01 规则库视图增加批量导入导出按钮:

```svelte
<!-- P01 RuleLibraryView 修改 -->
<aside class="rule-library-actions">
  <button on:click={() => goto('/import-export?type=rule&direction=import')}>
    📥 导入规则
  </button>
  <button on:click={() => goto('/import-export?type=rule&direction=export')}>
    📤 导出规则
  </button>
</aside>
```

### 10.2 P01 建库向导集成

**修改文件**:[P01_BUILD_SCHEMA_DESIGN.md](file:///d:/evorule-console-cloud/docs/P01_BUILD_SCHEMA_DESIGN.md)

P01 建库向导第一步增加"从模板创建"选项:

```svelte
<!-- P01 OnboardingWizard 第一步 -->
<div class="step-1">
  <h2>选择创建方式</h2>
  <div class="options">
    <button on:click={() => selectMode('blank')}>空白库</button>
    <button on:click={() => selectMode('template')}>从模板创建</button>
  </div>

  {#if mode === 'template'}
    <div class="template-list">
      {#each BUILTIN_LIBRARY_TEMPLATES as t}
        <button on:click={() => createLibraryFromTemplate(t.id, libraryName)}>
          {t.name} - {t.description}
        </button>
      {/each}
      <a href="/marketplace?type=library_schema">从市场下载更多模板</a>
    </div>
  {/if}
</div>
```

### 10.3 P03 数据集集成

**修改文件**:[P03_DATASET_DESIGN.md](file:///d:/evorule-console-cloud/docs/P03_DATASET_DESIGN.md)

P03 数据集视图增加导入导出按钮:

```svelte
<!-- P03 DatasetView 修改 -->
<aside class="dataset-actions">
  <button on:click={() => goto('/import-export?type=dataset&direction=import')}>
    📥 导入数据集
  </button>
  <button on:click={() => goto('/import-export?type=dataset&direction=export')}>
    📤 导出数据集
  </button>
</aside>
```

### 10.4 P07 渲染器抽取

**修改文件**:[P07_RESULT_EXPORT_DESIGN.md](file:///d:/evorule-console-cloud/docs/P07_RESULT_EXPORT_DESIGN.md)

P07 的 `export-renderers.ts` 重构为 `format-converter.ts` 的子集:

```typescript
// P07 export-store.ts 修改
import { CONVERTERS, type UniversalFormat } from "./format-converter";

// P07 的 renderExport 改为调用通用转换器
export async function renderExport(
  content: ExportContent,
  format: UniversalFormat, // 改为 UniversalFormat
  options: ExportRenderOptions,
  embedIntegrity: boolean,
): Promise<Blob> {
  // PDF 特殊处理(含 HTML 模板)
  if (format === "pdf") {
    return renderPdfWithTemplate(content, options);
  }
  // 其他格式用通用转换器
  return CONVERTERS[format].serialize(content.businessData ?? content.rawData);
}
```

### 10.5 HOME_DESIGN 顶部导航

**修改文件**:[HOME_DESIGN.md](file:///d:/evorule-console-cloud/docs/HOME_DESIGN.md)

顶部导航增加"导入导出"入口:

```svelte
<!-- 顶部导航 -->
<nav class="main-nav">
  <a href="/">首页</a>
  <a href="/rules">规则库</a>
  <a href="/datasets">数据集</a>
  <a href="/import-export">导入导出</a>
  <a href="/marketplace">模板市场</a>
</nav>
```

---

## 11. 测试用例

### 11.1 单元测试(格式转换器)

| 测试               | 输入                | 期望                |
| ------------------ | ------------------- | ------------------- |
| JSON 序列化        | `{a:1}`             | `'{"a":1}'`         |
| JSON 反序列化      | `'{"a":1}'`         | `{a:1}`             |
| YAML 序列化        | `{a:1}`             | `'a: 1\n'`          |
| YAML 反序列化      | `'a: 1'`            | `{a:1}`             |
| TOML 序列化(数组)  | `[{a:1}]`           | `items = [{a = 1}]` |
| TOML 反序列化      | `items = [{a = 1}]` | `[{a:1}]`           |
| CSV 序列化         | `[{a:1,b:2}]`       | `'a,b\n1,2'`        |
| CSV 反序列化       | `'a,b\n1,2'`        | `[{a:'1',b:'2'}]`   |
| CSV 特殊字符       | `{a:'hello,world'}` | `'"hello,world"'`   |
| XML 序列化         | `{a:1}`             | `<a>1</a>`          |
| XML 反序列化       | `<a>1</a>`          | `{a:'1'}`           |
| 格式转换 JSON→YAML | `{a:1}`, json→yaml  | `'a: 1\n'`          |

### 11.2 集成测试

| 测试               | 步骤                  | 期望                                  |
| ------------------ | --------------------- | ------------------------------------- |
| 单条规则导出 YAML  | 选规则 + YAML         | 下载 .yaml 文件,内容正确              |
| 批量规则导出 ZIP   | 选 3 条规则 + ZIP     | 下载 ZIP,含 manifest + 3 个文件       |
| 单条规则导入       | 上传 YAML → 选 rename | 规则列表新增,带 `-imported-{ts}` 后缀 |
| 批量规则导入       | 上传 ZIP → 选 skip    | 跳过已存在的,新增不存在的             |
| 冲突处理 UI        | 导入同 ID 规则        | 显示冲突表,可选处理方式               |
| 数据集导入 CSV     | 上传 CSV              | 创建新数据集,含 cases 数组            |
| 表单 schema 导入   | 上传 JSON             | 表单列表新增                          |
| 库 schema 模板创建 | 选 hospital starter   | 库初始化含 3 规则 + 术语 + 表单       |
| 模板市场上传       | 选规则 + 上传         | 市场列表新增,可被他人下载             |
| 模板市场下载       | 下载规则模板          | 文件下载成功                          |
| 导入前快照         | 导入前                | 自动创建快照,可在版本历史回滚         |
| 快照回滚           | 导入后回滚            | 恢复到导入前状态                      |

### 11.3 E2E 测试

| 测试             | 步骤                                       | 期望                        |
| ---------------- | ------------------------------------------ | --------------------------- |
| 跨实例规则迁移   | 实例 A 导出规则 → 实例 B 导入              | 实例 B 规则列表含导入的规则 |
| 模板市场分享     | 用户 A 上传 → 用户 B 下载 → 导入           | 用户 B 库含模板内容         |
| 库 schema 跨实例 | 实例 A 导出库 schema → 实例 B 新建库从模板 | 实例 B 新库含 A 的全部内容  |
| 批量导入回滚     | 导入 10 条规则 → 回滚到导入前              | 规则列表恢复到导入前        |

---

## 12. 实施路径

### 12.1 实施步骤(5 步)

| 步骤 | 内容                                                       | 文件                                | 依赖     |
| ---- | ---------------------------------------------------------- | ----------------------------------- | -------- |
| 1    | 抽取 P07 渲染器为 format-converter + 新增 YAML/TOML        | `format-converter.ts`               | P07 完成 |
| 2    | 实现 4 类对象导入导出(规则/数据集/表单/库 schema)          | `rule-import-export.ts` 等          | 步骤 1   |
| 3    | 后端模板市场 API + 快照 API                                | evorule-server `api/marketplace.rs` | 步骤 2   |
| 4    | 前端 ImportExportPage + MarketplacePage + ConflictResolver | `views/ImportExport/*.svelte`       | 步骤 2-3 |
| 5    | 集成 P01/P02/P03/P07 + HOME_DESIGN                         | 修改各 P0 文档                      | 步骤 4   |

### 12.2 与其他 P0 的实施顺序

```
P01 → P02 → P03 → P04 → P05 → P06 → P07 → P08 → P09(本文档,最后做)
                                                    ↓
                                                  P09 完成 = P0 全部完成
```

P09 是 P0 最后一个,因为它依赖 P01(规则)/P02(表单)/P03(数据集)/P07(渲染器)/P08(权限)。

---

## 13. 长期演进路径

### 13.1 P0 → P1

| P0                                | P1+                                      |
| --------------------------------- | ---------------------------------------- |
| 本地批量导入导出                  | 服务端大文件处理 + 流式                  |
| 简单模板市场(上传/下载)           | + 评分 / 评论 / 在线编辑                 |
| 6 种格式                          | + Excel xlsx / Parquet / Markdown        |
| 30 天快照过期                     | 长期归档(对接 P2 数据仓库)               |
| 同实例分享                        | 跨实例 federation                        |
| 冲突 4 策略                       | + 智能合并(语义级)                       |
| 官方规则集:内置副本               | 在线规则市场 API 下载(见 §3.8)           |
| ruleset.json 类型在 console-cloud | 迁移到 @evorule/console 内核(协议层共享) |

### 13.2 P1

- 模板市场在线编辑器( Monaco + 预览)
- 模板审核工作流(管理员审核后才能上架)
- 增量导入导出(差分同步)
- Excel xlsx 格式(支持多 sheet)
- 监管报送 XSD schema 校验
- 官方规则集仓库 evorule-rules/djbh-2.0-level3 上线(Gitee + GitHub,semver 发版)
- 在线规则市场 API(`/api/marketplace/rulesets/:id/download`)
- ruleset.json 标准格式迁移到 @evorule/console 内核

### 13.3 P2

- 模板市场 federation(跨实例分享)
- 模板社区(评分 / 评论 / 收藏)
- 数据仓库归档(Parquet + Arrow)
- 实时双向同步(CRDT)
- 社区规则集贡献(用户发布自定义 ruleset.json 到市场)
- 多标准规则集(等保 + GDPR + HIPAA + ISO 27001)

---

## 14. 代码变更列表

### 14.1 新增文件(前端)

| 文件                                                     | 类型      | 说明                                    |
| -------------------------------------------------------- | --------- | --------------------------------------- |
| `src/lib/stores/format-converter.ts`                     | Converter | 6 种格式转换器(共享 P07)                |
| `src/lib/stores/import-export-types.ts`                  | Types     | 导入导出类型定义                        |
| `src/lib/stores/rule-import-export.ts`                   | Store     | 规则导入导出(扩展 P01)                  |
| `src/lib/stores/dataset-import-export.ts`                | Store     | 数据集导入导出(扩展 P03)                |
| `src/lib/stores/form-import-export.ts`                   | Store     | 表单 schema 导入导出(扩展 P02)          |
| `src/lib/stores/library-schema-import.ts`                | Store     | 库 schema 模板(扩展 P01)                |
| `src/lib/stores/marketplace.ts`                          | Store     | 模板市场                                |
| `src/lib/stores/ruleset-types.ts`                        | Types     | ruleset.json 标准格式类型(§4.6,见 §3.8) |
| `src/lib/stores/ruleset-import.ts`                       | Store     | importRuleset() 官方规则集导入(§4.6)    |
| `src/lib/stores/import-snapshot.ts`                      | Store     | 导入前快照                              |
| `src/lib/views/ImportExport/ImportExportPage.svelte`     | Component | 主页                                    |
| `src/lib/views/ImportExport/ImportTab.svelte`            | Component | 导入标签页                              |
| `src/lib/views/ImportExport/ExportTab.svelte`            | Component | 导出标签页                              |
| `src/lib/views/ImportExport/MarketplaceTab.svelte`       | Component | 模板市场标签页                          |
| `src/lib/views/ImportExport/FileUploader.svelte`         | Component | 文件上传(拖拽)                          |
| `src/lib/views/ImportExport/ConflictResolver.svelte`     | Component | 冲突处理 UI                             |
| `src/lib/views/ImportExport/ImportPreview.svelte`        | Component | 导入预览                                |
| `src/lib/views/ImportExport/UploadTemplateDialog.svelte` | Component | 上传模板弹窗                            |
| `src/lib/views/Marketplace/MarketplacePage.svelte`       | Component | 模板市场页                              |
| `src/routes/import-export/+page.svelte`                  | Route     | 导入导出路由                            |
| `src/routes/marketplace/+page.svelte`                    | Route     | 模板市场路由                            |

### 14.2 新增文件(后端 evorule-server)

| 文件                                  | 类型   | 说明                     |
| ------------------------------------- | ------ | ------------------------ |
| `src/marketplace/mod.rs`              | Module | 模板市场模块             |
| `src/marketplace/storage.rs`          | Module | 模板存储(文件系统)       |
| `src/import_snapshot/mod.rs`          | Module | 导入快照模块             |
| `migrations/003_marketplace.sql`      | SQL    | marketplace_templates 表 |
| `migrations/004_import_snapshots.sql` | SQL    | import_snapshots 表      |

### 14.3 修改文件

| 文件                              | 修改                                                      |
| --------------------------------- | --------------------------------------------------------- |
| P01 `RuleLibraryView.svelte`      | 加 [📥 导入] [📤 导出] 按钮                               |
| P01 `OnboardingWizard.svelte`     | 加"从模板创建"选项                                        |
| P03 `DatasetView.svelte`          | 加 [📥 导入] [📤 导出] 按钮                               |
| P02 `BusinessLanguageView.svelte` | 加 [📥 导入表单] [📤 导出表单] 按钮                       |
| P07 `export-store.ts`             | 渲染器抽取为 format-converter,P07 调用                    |
| HOME_DESIGN 顶部导航              | 加"导入导出" + "模板市场"入口                             |
| evorule-server `api/server.rs`    | 注册 `/api/marketplace/*`、`/api/import-snapshots/*` 路由 |
| evorule-server `Cargo.toml`       | 加 `zip`(Rust ZIP 库)依赖                                 |

---

## 15. 待办

- [ ] 抽取 P07 渲染器为 format-converter(步骤 1)
- [ ] 新增 YAML/TOML 转换器(步骤 1)
- [ ] 实现 4 类对象导入导出(步骤 2)
- [ ] 后端模板市场 API(步骤 3)
- [ ] 后端导入快照 API(步骤 3)
- [ ] 前端 ImportExportPage + MarketplacePage(步骤 4)
- [ ] 集成 P01/P02/P03/P07/HOME_DESIGN(步骤 5)
- [ ] 3 个内置库 schema 模板填充(医院/财务/合规 starter)
- [ ] 模板市场在线编辑器(P1)
- [ ] 增量导入导出(P1)
- [ ] Excel xlsx 格式(P1)
- [ ] 模板市场 federation(P2)

---

> 设计文档 — 2026-08-06 定稿
