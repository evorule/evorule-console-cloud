// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// P07 通用结果导出 store — 导出引擎 + 模板管理 + 后台任务。
// P07_RESULT_EXPORT_DESIGN.md §3 + §5 设计。
//
// 职责:
//   - 从 evorule-server 拉取数据(facts / audit / replay / causal / state)
//   - 应用 ExportFilters 筛选
//   - 业务化转换(复用 P02 businessTermsStore)
//   - 调渲染器生成 Blob
//   - 触发浏览器下载(同步模式)
//   - 大文件后台任务模式(P0 简化:仍走同步,标记为 "未来支持后台任务")
//   - 模板 CRUD(builtin + user 持久化到 localStorage)

import { writable, get } from "svelte/store";
import { browser } from "$app/environment";
import type {
  ExecutionBackend,
  SessionId,
} from "@evorule/console";
import { CONSOLE_VERSION } from "@evorule/console";
import { businessTermsStore } from "./business-terms";
import { sessionStore } from "./session";
import { productionStateStore } from "./production-state";
import {
  createBuiltinTemplates,
  type ExportContent,
  type ExportContentType,
  type ExportFilters,
  type ExportFormat,
  type ExportJob,
  type ExportMeta,
  type ExportRenderOptions,
  type ExportTemplate,
  type TimeRange,
} from "./export-types";
import { getRenderer } from "./export-renderers";
import { toastInfo, toastSuccess, toastError } from "./toast";

// ============================================================================
// 常量
// ============================================================================

const TEMPLATE_STORAGE_KEY = "evorule-console-cloud:export-templates:user";

/** 后台任务阈值(P07 §3.5) */
const BACKGROUND_THRESHOLD_FACTS = 5000;
const BACKGROUND_THRESHOLD_BYTES = 10 * 1024 * 1024; // 10MB

// ============================================================================
// Stores
// ============================================================================

/** 导出执行状态 */
export interface ExportExecutionState {
  /** 是否正在导出 */
  exporting: boolean;
  /** 进度(0-100,仅后台任务有) */
  progress: number;
  /** 状态消息 */
  message: string;
  /** 上次导出的文件名 */
  lastFilename: string | null;
  /** 上次导出错误 */
  error: string | null;
}

export const exportExecutionStore = writable<ExportExecutionState>({
  exporting: false,
  progress: 0,
  message: "",
  lastFilename: null,
  error: null,
});

/** 后台导出任务列表(状态) */
export const exportJobsStore = writable<ExportJob[]>([]);

/** 模板列表(builtin + user) */
export const exportTemplatesStore = writable<ExportTemplate[]>(loadTemplates());

// 持久化 user 模板到 localStorage
exportTemplatesStore.subscribe((templates) => {
  if (!browser) return;
  const userTemplates = templates.filter((t) => t.source === "user");
  try {
    localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(userTemplates));
  } catch {
    // localStorage 满或被禁,静默降级
  }
});

function loadTemplates(): ExportTemplate[] {
  const builtin = createBuiltinTemplates();
  if (!browser) return builtin;
  try {
    const raw = localStorage.getItem(TEMPLATE_STORAGE_KEY);
    if (!raw) return builtin;
    const userTemplates = JSON.parse(raw) as ExportTemplate[];
    return [...builtin, ...userTemplates];
  } catch {
    return builtin;
  }
}

// ============================================================================
// 数据获取(从 evorule-server 拉取)
// ============================================================================

/**
 * 根据内容类型从后端拉取 raw 数据。
 * 复用内核 ExecutionBackend 已有方法,不引入新端点(PDF 除外)。
 */
async function fetchRawData(
  backend: ExecutionBackend,
  sessionId: SessionId,
  contentType: ExportContentType,
  filters: ExportFilters,
): Promise<{ raw: unknown; factCount: number }> {
  switch (contentType) {
    case "fact_stream":
    case "decision_log": {
      const fromVersion = filters.versionRange?.from;
      const toVersion = filters.versionRange?.to;
      const facts = await backend.getReplay(sessionId, fromVersion, toVersion ?? null);
      // decision_log 进一步过滤 rule_triggered 类型
      const filtered =
        contentType === "decision_log"
          ? facts.filter((f) => f.type === "rule_triggered")
          : facts;
      // factTypes 筛选
      const typeFiltered = filters.factTypes?.length
        ? filtered.filter((f) => filters.factTypes!.includes(f.type))
        : filtered;
      return { raw: typeFiltered, factCount: typeFiltered.length };
    }

    case "audit_chain": {
      const audit = await backend.getAudit(sessionId);
      return { raw: audit, factCount: audit.fact_count ?? 0 };
    }

    case "state_snapshot": {
      const state = await backend.getSessionState(sessionId);
      return { raw: state, factCount: 1 };
    }

    case "causal_chain": {
      // causal 需要 fact_id,默认取审计链第一条
      const audit = await backend.getAudit(sessionId);
      const firstFactId = (audit.entries as Array<{ fact_id?: number }>)[0]?.fact_id;
      if (!firstFactId) {
        return { raw: { chain: [] }, factCount: 0 };
      }
      const causal = await backend.getCausalChain(sessionId, firstFactId);
      return { raw: causal, factCount: causal.chain.length };
    }

    case "comprehensive": {
      // 聚合多种数据
      const [audit, state, replay] = await Promise.all([
        backend.getAudit(sessionId),
        backend.getSessionState(sessionId).catch(() => null),
        backend.getReplay(sessionId).catch(() => []),
      ]);
      const factCount = audit.fact_count ?? replay.length;
      return {
        raw: {
          audit_chain: audit,
          state_snapshot: state,
          fact_stream: replay,
        },
        factCount,
      };
    }

    default:
      return { raw: null, factCount: 0 };
  }
}

// ============================================================================
// 业务化转换
// ============================================================================

/**
 * 把 raw 数据通过 businessTermsStore 转换为业务化版本。
 * P0 简化:对 Fact 数组的 payload 做 key → 业务术语 label 映射。
 */
function toBusinessData(
  raw: unknown,
  terms: { key: string; label: string }[],
): unknown {
  if (Array.isArray(raw)) {
    return raw.map((item) => toBusinessData(item, terms));
  }
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      const term = terms.find((t) => t.key === k);
      const businessKey = term?.label ?? k;
      result[businessKey] =
        v !== null && typeof v === "object" ? toBusinessData(v, terms) : v;
    }
    return result;
  }
  return raw;
}

// ============================================================================
// 完整性构建
// ============================================================================

/**
 * 构造 BLAKE3 完整性段(仅 audit_chain / comprehensive 类型)。
 * 注:前端不重算哈希,直接从 backend.verifyAudit 取链根 + verified。
 */
async function buildIntegrity(
  backend: ExecutionBackend,
  sessionId: SessionId,
  factCount: number,
): Promise<ExportContent["integrity"]> {
  try {
    const verify = await backend.verifyAudit(sessionId);
    const audit = await backend.getAudit(sessionId);
    return {
      algorithm: "BLAKE3",
      contentHash: audit.last_hash ?? "",
      chainRoot: audit.last_hash ?? null,
      factCount,
      verified: verify.verified,
      verificationNote:
        "运行 evorule verify-audit-export <file> 验证;或访问 https://evorule.dev/verify 上传验证",
    };
  } catch {
    // verifyAudit 失败时仍可导出,完整性段标记未验证
    return {
      algorithm: "BLAKE3",
      contentHash: "",
      chainRoot: null,
      factCount,
      verified: false,
      verificationNote: "验证失败,链完整性未知",
    };
  }
}

// ============================================================================
// 时间范围计算
// ============================================================================

function timeRangeToVersions(
  timeRange: TimeRange | undefined,
  currentVersion: number,
): { fromVersion?: number; toVersion?: number; fromTime?: string; toTime?: string } {
  if (!timeRange) return {};
  switch (timeRange.kind) {
    case "all":
      return {};
    case "visible":
      // 当前视图可见范围(P0 简化:近 100 版本)
      return {
        fromVersion: Math.max(0, currentVersion - 100),
        toVersion: currentVersion,
      };
    case "last": {
      const now = Date.now();
      const unitMs = {
        minutes: 60_000,
        hours: 3_600_000,
        days: 86_400_000,
      }[timeRange.unit];
      const fromMs = now - timeRange.value * unitMs;
      return {
        fromTime: new Date(fromMs).toISOString(),
        toTime: new Date(now).toISOString(),
      };
    }
    case "absolute":
      return { fromTime: timeRange.from, toTime: timeRange.to };
  }
}

function describeRange(filters: ExportFilters): string {
  const tr = filters.timeRange;
  if (!tr) return "全部范围";
  switch (tr.kind) {
    case "all":
      return "全部范围";
    case "visible":
      return "当前视图可见范围";
    case "last":
      return `最近 ${tr.value} ${tr.unit === "minutes" ? "分钟" : tr.unit === "hours" ? "小时" : "天"}`;
    case "absolute":
      return `${tr.from} 至 ${tr.to}`;
  }
}

// ============================================================================
// 主导出函数
// ============================================================================

/**
 * 执行导出(P07 §5 主流程)。
 *
 * @param backend     ExecutionBackend(组件层注入)
 * @param sessionId   session id
 * @param contentType 导出内容类型
 * @param format      导出格式
 * @param filters     筛选条件
 * @param options     渲染选项
 * @param templateId  使用的模板 ID(写入元数据)
 * @param serverBaseUrl 服务端基地址(PDF 渲染用)
 */
export async function executeExport(
  backend: ExecutionBackend,
  sessionId: SessionId,
  contentType: ExportContentType,
  format: ExportFormat,
  filters: ExportFilters,
  options?: ExportRenderOptions,
  templateId?: string,
  serverBaseUrl?: string,
): Promise<{ blob: Blob; filename: string } | null> {
  exportExecutionStore.update((s) => ({
    ...s,
    exporting: true,
    progress: 10,
    message: "正在拉取数据…",
    error: null,
  }));

  try {
    // 1. 拉 raw 数据
    const { raw, factCount } = await fetchRawData(
      backend,
      sessionId,
      contentType,
      filters,
    );

    exportExecutionStore.update((s) => ({
      ...s,
      progress: 40,
      message: `已拉取 ${factCount} 条数据,正在业务化转换…`,
    }));

    // 2. 业务化转换
    const terms = get(businessTermsStore).map((t) => ({
      key: t.key,
      label: t.label,
    }));
    const businessData = toBusinessData(raw, terms);

    // 3. 当前 ruleset 版本
    const productionState = get(productionStateStore);
    const rulesetVersion = productionState.rulesetVersion;

    // 4. 时间范围计算
    const range = timeRangeToVersions(filters.timeRange, rulesetVersion);

    exportExecutionStore.update((s) => ({
      ...s,
      progress: 60,
      message: "正在构造完整性段…",
    }));

    // 5. BLAKE3 完整性段(仅 audit_chain / comprehensive)
    const integrity =
      contentType === "audit_chain" || contentType === "comprehensive"
        ? await buildIntegrity(backend, sessionId, factCount)
        : undefined;

    // 6. 构造 ExportContent
    const content: ExportContent = {
      type: contentType,
      sessionId,
      rulesetVersion,
      range,
      rawData: raw,
      businessData,
      integrity,
    };

    // 7. 构造 ExportMeta
    const session = get(sessionStore);
    const meta: ExportMeta = {
      operator: session.username || "anonymous",
      exportedAt: new Date().toISOString(),
      sessionId,
      rulesetVersion,
      rangeDescription: describeRange(filters),
      templateId,
      consoleVersion: CONSOLE_VERSION,
    };

    exportExecutionStore.update((s) => ({
      ...s,
      progress: 80,
      message: `正在渲染为 ${format.toUpperCase()}…`,
    }));

    // 8. 调渲染器
    const renderer = getRenderer(format, serverBaseUrl);
    const blob = await renderer.render(content, meta, options ?? {});

    // 9. 生成文件名
    const ts = new Date()
      .toISOString()
      .replace(/[:T]/g, "-")
      .replace(/\..+/, "");
    const ext = format === "pdf" && blob.type === "text/html" ? "html" : format;
    const filename = `evorule-${contentType}-${ts}.${ext}`;

    exportExecutionStore.update((s) => ({
      ...s,
      progress: 100,
      message: "导出完成",
      lastFilename: filename,
    }));

    return { blob, filename };
  } catch (e) {
    const msg = `导出失败: ${(e as Error).message || "未知错误"}`;
    exportExecutionStore.update((s) => ({
      ...s,
      error: msg,
      message: msg,
    }));
    toastError(msg);
    return null;
  } finally {
    exportExecutionStore.update((s) => ({ ...s, exporting: false }));
  }
}

/**
 * 执行导出 + 触发浏览器下载。
 */
export async function executeExportAndDownload(
  backend: ExecutionBackend,
  sessionId: SessionId,
  contentType: ExportContentType,
  format: ExportFormat,
  filters: ExportFilters,
  options?: ExportRenderOptions,
  templateId?: string,
  serverBaseUrl?: string,
): Promise<void> {
  const result = await executeExport(
    backend,
    sessionId,
    contentType,
    format,
    filters,
    options,
    templateId,
    serverBaseUrl,
  );
  if (!result) return;

  downloadBlob(result.blob, result.filename);

  // PDF 降级提示:HTML blob 提示用户用浏览器另存为 PDF
  if (format === "pdf" && result.blob.type === "text/html") {
    toastInfo(
      "服务端不支持 PDF 渲染,已生成可打印 HTML。在打开的窗口中按 Ctrl+P / Cmd+P,选择「另存为 PDF」。",
    );
    // 同时打开 HTML 让用户打印
    openHtmlInNewWindow(result.blob, result.filename);
  } else {
    toastSuccess(`已导出: ${result.filename}`);
  }
}

/**
 * 应用模板执行导出。
 */
export async function executeTemplateExport(
  backend: ExecutionBackend,
  sessionId: SessionId,
  template: ExportTemplate,
  serverBaseUrl?: string,
): Promise<void> {
  // 模板可能含多种 contents,comprehensive 类型聚合多内容
  // P0 简化:取第一个 content 类型导出(comprehensive 模板直接用 comprehensive 类型)
  const contents = template.content.contents;
  const primaryContent: ExportContentType =
    contents.includes("comprehensive")
      ? "comprehensive"
      : contents[0];

  await executeExportAndDownload(
    backend,
    sessionId,
    primaryContent,
    template.format,
    template.content.filters,
    template.renderOptions,
    template.id,
    serverBaseUrl,
  );
}

// ============================================================================
// 模板 CRUD
// ============================================================================

/** 添加自定义模板 */
export function addUserTemplate(
  template: Omit<ExportTemplate, "id" | "source" | "createdAt" | "updatedAt">,
): string {
  const id = `user.${Date.now().toString(36)}`;
  const now = new Date().toISOString();
  const full: ExportTemplate = {
    ...template,
    id,
    source: "user",
    createdAt: now,
    updatedAt: now,
  };
  exportTemplatesStore.update((list) => [...list, full]);
  return id;
}

/** 更新模板(仅 user 模板可改) */
export function updateUserTemplate(
  id: string,
  patch: Partial<ExportTemplate>,
): void {
  exportTemplatesStore.update((list) =>
    list.map((t) => {
      if (t.id !== id) return t;
      if (t.source === "builtin") {
        throw new Error("内置模板不可修改");
      }
      return { ...t, ...patch, updatedAt: new Date().toISOString() };
    }),
  );
}

/** 删除模板(仅 user 模板可删) */
export function deleteUserTemplate(id: string): void {
  exportTemplatesStore.update((list) => {
    const t = list.find((x) => x.id === id);
    if (t?.source === "builtin") {
      throw new Error("内置模板不可删除");
    }
    return list.filter((x) => x.id !== id);
  });
}

/** 按 ID 取模板 */
export function getTemplateById(id: string): ExportTemplate | undefined {
  return get(exportTemplatesStore).find((t) => t.id === id);
}

// ============================================================================
// 后台任务(P0 简化:仅状态记录,实际仍走同步)
// ============================================================================

/**
 * 创建后台导出任务(P0:仅创建状态记录,实际执行调 executeExport)。
 *
 * P07 §3.5 设计:数据量超阈值时走后台任务 + SSE 进度。
 * P0 简化:所有导出仍走同步,但记录到 exportJobsStore 供 UI 查询历史。
 */
export function createExportJob(
  contentType: ExportContentType,
  format: ExportFormat,
): string {
  const jobId = `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const job: ExportJob = {
    jobId,
    status: "queued",
    progress: 0,
    message: "排队中",
    contentType,
    format,
    createdAt: new Date().toISOString(),
  };
  exportJobsStore.update((jobs) => [...jobs, job]);
  return jobId;
}

/** 更新后台任务状态 */
export function updateExportJob(
  jobId: string,
  patch: Partial<ExportJob>,
): void {
  exportJobsStore.update((jobs) =>
    jobs.map((j) => (j.jobId === jobId ? { ...j, ...patch } : j)),
  );
}

/** 判断是否应走后台任务(超阈值) */
export function shouldUseBackgroundJob(
  factCount: number,
  estimatedBytes: number,
): boolean {
  return (
    factCount >= BACKGROUND_THRESHOLD_FACTS ||
    estimatedBytes >= BACKGROUND_THRESHOLD_BYTES
  );
}

// ============================================================================
// 工具
// ============================================================================

/** 触发浏览器文件下载(Blob) */
export function downloadBlob(blob: Blob, filename: string): void {
  if (!browser) return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 在新窗口打开 HTML(打印用) */
function openHtmlInNewWindow(blob: Blob, _filename: string): void {
  if (!browser) return;
  const url = URL.createObjectURL(blob);
  const w = window.open(url, "_blank");
  if (!w) {
    // 弹窗被拦截,提示用户
    toastInfo("浏览器拦截了新窗口,请允许弹窗或直接下载 HTML 文件");
  }
  // 30 秒后释放 URL(给浏览器时间加载)
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** 重置导出状态 */
export function resetExportState(): void {
  exportExecutionStore.set({
    exporting: false,
    progress: 0,
    message: "",
    lastFilename: null,
    error: null,
  });
}
