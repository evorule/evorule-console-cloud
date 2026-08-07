// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// P07 通用结果导出 — 类型定义。
// P07_RESULT_EXPORT_DESIGN.md §4 定义。
//
// 6 种导出内容 × 4 种格式,共享 ExportContent 中间态。

// ============================================================================
// 1. 内容类型 + 格式
// ============================================================================

/** 导出内容类型(P07 §4.1) */
export type ExportContentType =
  | "fact_stream" // Fact 流
  | "decision_log" // 决策日志(规则触发)
  | "audit_chain" // 审计链(BLAKE3)
  | "state_snapshot" // 状态快照
  | "causal_chain" // 因果链
  | "comprehensive"; // 综合报告(多内容聚合)

/** 导出格式(P07 §4.1) */
export type ExportFormat = "json" | "csv" | "pdf" | "xml";

/** 内容类型业务化标签 */
export const CONTENT_TYPE_LABELS: Record<ExportContentType, string> = {
  fact_stream: "Fact 流(业务事件)",
  decision_log: "决策日志(规则触发)",
  audit_chain: "审计链(BLAKE3)",
  state_snapshot: "状态快照",
  causal_chain: "因果链",
  comprehensive: "综合报告(多内容聚合)",
};

/** 格式业务化标签 */
export const FORMAT_LABELS: Record<ExportFormat, string> = {
  json: "JSON(开发者)",
  csv: "CSV(Excel 分析)",
  pdf: "PDF(合规归档)",
  xml: "XML(系统对接)",
};

// ============================================================================
// 2. ExportContent(中间态,渲染器输入)
// ============================================================================

/** 字段 schema(描述业务化字段) */
export interface FieldSchema {
  /** raw 字段 key(如 'patient_id') */
  key: string;
  /** 业务化标签(如 '病人 ID') */
  label: string;
  /** 字段类型 */
  type: "string" | "number" | "datetime" | "enum" | "boolean" | "json";
  /** 枚举值映射(如 { fever: '发热' }) */
  enumValues?: Record<string, string>;
  /** 是否必填(模板用) */
  required?: boolean;
}

/** BLAKE3 完整性信息 */
export interface ExportIntegrity {
  algorithm: "BLAKE3";
  contentHash: string;
  chainRoot: string | null;
  factCount: number;
  verified: boolean;
  /** 验证说明(嵌入到导出文件) */
  verificationNote: string;
}

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
    fromTime?: string; // ISO 8601
    toTime?: string;
  };
  /** raw 数据(从 API 获取,未业务化) */
  rawData: unknown;
  /** 业务化数据(经 businessTermsStore 映射后) */
  businessData?: unknown;
  /** BLAKE3 完整性信息(仅 audit_chain 类型有) */
  integrity?: ExportIntegrity;
  /** 字段映射元数据(用于 CSV/XML 表头) */
  fieldSchema?: FieldSchema[];
}

// ============================================================================
// 3. ExportFilters(导出选择器)
// ============================================================================

/** 时间范围筛选 */
export type TimeRange =
  | { kind: "last"; value: number; unit: "minutes" | "hours" | "days" }
  | { kind: "absolute"; from: string; to: string }
  | { kind: "visible" } // 当前视图可见范围
  | { kind: "all" }; // 全部(慎用,大文件)

/** 导出筛选条件(P07 §4.2) */
export interface ExportFilters {
  /** 时间范围 */
  timeRange?: TimeRange;
  /** Fact 类型筛选 */
  factTypes?: string[];
  /** 业务对象筛选(来自 P02 formSchema) */
  businessObjects?: string[];
  /** 规则触发筛选 */
  ruleIds?: string[];
  /** 版本范围 */
  versionRange?: { from: number; to: number };
  /** 决策结果筛选 */
  decisionResults?: ("allowed" | "blocked" | "warning")[];
}

// ============================================================================
// 4. ExportTemplate(导出模板)
// ============================================================================

/** 内容选择规格 */
export interface ExportContentSpec {
  /** 导出哪些内容 */
  contents: ExportContentType[];
  /** 筛选条件 */
  filters: ExportFilters;
  /** 聚合粒度(comprehensive 用) */
  aggregation?: "none" | "daily" | "weekly" | "monthly";
}

/** 字段映射(覆盖默认业务化) */
export interface FieldMapping {
  sourcePath: string; // 'payload.patient_id'
  businessLabel: string; // '病人 ID'
  valueTransform?: "enum" | "datetime" | "duration" | "none";
  enumMap?: Record<string, string>; // { fever: '发热' }
}

/** 渲染选项(格式特定) */
export interface ExportRenderOptions {
  /** 是否包含 raw 字段(JSON 默认 true,CSV/PDF/XML 默认 false) */
  includeRaw?: boolean;
  /** 是否包含业务化字段(默认 true) */
  includeBusiness?: boolean;
  /** 是否嵌入 BLAKE3 完整性段(默认 true) */
  includeIntegrity?: boolean;
  /** 是否包含导出元数据(默认 true) */
  includeMeta?: boolean;
  /** CSV 分隔符(默认 ',') */
  csvDelimiter?: string;
  /** PDF 标题 */
  pdfTitle?: string;
  /** PDF 公司名称 */
  pdfOrganization?: string;
}

/** 导出模板(P07 §4.3) */
export interface ExportTemplate {
  /** 模板 ID(如 'builtin.compliance_report' 或 'user.xxx') */
  id: string;
  /** 名称 */
  name: string;
  /** 描述 */
  description: string;
  /** 来源:builtin(预置)/ user(用户自定义) */
  source: "builtin" | "user";
  /** 内容选择 */
  content: ExportContentSpec;
  /** 格式 */
  format: ExportFormat;
  /** 字段映射(覆盖默认) */
  fieldMapping?: FieldMapping[];
  /** 渲染选项 */
  renderOptions?: ExportRenderOptions;
  /** 创建时间(ISO) */
  createdAt: string;
  /** 更新时间(ISO) */
  updatedAt: string;
}

// ============================================================================
// 5. ExportJob(后台任务)
// ============================================================================

/** 后台导出任务状态 */
export type ExportJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

/** 后台导出任务(P07 §3.5) */
export interface ExportJob {
  /** 任务 ID */
  jobId: string;
  /** 状态 */
  status: ExportJobStatus;
  /** 进度(0-100) */
  progress: number;
  /** 状态消息 */
  message: string;
  /** 内容类型 */
  contentType: ExportContentType;
  /** 格式 */
  format: ExportFormat;
  /** 创建时间 */
  createdAt: string;
  /** 完成时间 */
  completedAt?: string;
  /** 下载 URL(完成后) */
  downloadUrl?: string;
  /** 文件名 */
  filename?: string;
  /** 文件大小(字节) */
  fileSize?: number;
  /** 错误信息(失败时) */
  error?: string;
}

// ============================================================================
// 6. ExportMeta(导出元数据)
// ============================================================================

/** 导出元数据(嵌入到导出文件) */
export interface ExportMeta {
  /** 操作人(从 sessionStore 取 username) */
  operator: string;
  /** 导出时间(ISO) */
  exportedAt: string;
  /** session 标识 */
  sessionId: number;
  /** ruleset 版本 */
  rulesetVersion: number;
  /** 导出范围描述 */
  rangeDescription: string;
  /** 使用的模板 ID(若有) */
  templateId?: string;
  /** evorule-console 版本 */
  consoleVersion: string;
}

// ============================================================================
// 7. 渲染器接口
// ============================================================================

/** 渲染器接口(P07 §3.2) */
export interface ExportRenderer {
  /** 格式标识 */
  format: ExportFormat;
  /** 渲染:ExportContent → Blob */
  render(
    content: ExportContent,
    meta: ExportMeta,
    options: ExportRenderOptions,
  ): Promise<Blob>;
}

// ============================================================================
// 8. 预置模板(P07 §3.3)
// ============================================================================

/** 3 个预置模板的工厂函数(createdAt 在调用时生成) */
export function createBuiltinTemplates(): ExportTemplate[] {
  const now = new Date().toISOString();
  return [
    {
      id: "builtin.compliance_report",
      name: "合规报告(月度)",
      description: "审计链 + 决策日志 + 综合报告(PDF),EU AI Act Article 12 合规证据",
      source: "builtin",
      content: {
        contents: ["audit_chain", "decision_log", "comprehensive"],
        filters: {
          timeRange: { kind: "last", value: 30, unit: "days" },
        },
        aggregation: "monthly",
      },
      format: "pdf",
      renderOptions: {
        includeRaw: false,
        includeBusiness: true,
        includeIntegrity: true,
        includeMeta: true,
        pdfTitle: "evorule 月度合规报告",
        pdfOrganization: "",
      },
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "builtin.business_summary",
      name: "业务汇总(日报)",
      description: "Fact 流 + 决策日志(CSV),业务专家 Excel 趋势分析",
      source: "builtin",
      content: {
        contents: ["fact_stream", "decision_log"],
        filters: {
          timeRange: { kind: "last", value: 24, unit: "hours" },
        },
        aggregation: "daily",
      },
      format: "csv",
      renderOptions: {
        includeRaw: false,
        includeBusiness: true,
        includeIntegrity: false,
        includeMeta: true,
      },
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "builtin.regulatory_submission",
      name: "监管报送",
      description: "审计链 + 状态快照(XML),对接 HIMSS/监管系统",
      source: "builtin",
      content: {
        contents: ["audit_chain", "state_snapshot"],
        filters: {
          timeRange: { kind: "all" },
        },
      },
      format: "xml",
      renderOptions: {
        includeRaw: true,
        includeBusiness: false,
        includeIntegrity: true,
        includeMeta: true,
      },
      createdAt: now,
      updatedAt: now,
    },
  ];
}
