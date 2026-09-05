// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// P07 渲染器实现 — 4 种格式(JSON/CSV/PDF/XML)。
// P07_RESULT_EXPORT_DESIGN.md §3.2 定义。
//
// 设计:
//   - 每个渲染器实现 ExportRenderer 接口
//   - 共享 ExportContent + ExportMeta 中间态
//   - JSON/CSV/XML:纯前端渲染
//   - PDF:优先调服务端 POST /api/export/pdf;失败时降级为打印 HTML(浏览器 Save as PDF)
//   - BLAKE3 完整性嵌入到所有格式

import type {
  ExportRenderer,
  ExportContent,
  ExportMeta,
  ExportRenderOptions,
  ExportIntegrity,
} from "./export-types";

// ============================================================================
// 共享:完整性段构建
// ============================================================================

function buildIntegritySegment(
  integrity: ExportIntegrity | undefined,
): { hasIntegrity: boolean; integrity: ExportIntegrity | null } {
  if (!integrity) return { hasIntegrity: false, integrity: null };
  return { hasIntegrity: true, integrity };
}

/** 默认渲染选项 */
const DEFAULT_OPTIONS: ExportRenderOptions = {
  includeRaw: true,
  includeBusiness: true,
  includeIntegrity: true,
  includeMeta: true,
  csvDelimiter: ",",
  pdfTitle: "evorule 导出报告",
  pdfOrganization: "",
};

function mergeOptions(
  opts: ExportRenderOptions | undefined,
): ExportRenderOptions {
  return { ...DEFAULT_OPTIONS, ...opts };
}

// ============================================================================
// 1. JsonRenderer
// ============================================================================

export class JsonRenderer implements ExportRenderer {
  format = "json" as const;

  async render(
    content: ExportContent,
    meta: ExportMeta,
    options?: ExportRenderOptions,
  ): Promise<Blob> {
    const opts = mergeOptions(options);
    const { hasIntegrity, integrity } = buildIntegritySegment(
      opts.includeIntegrity ? content.integrity : undefined,
    );

    // JSON 顶层结构:export_meta + integrity + data
    const result: Record<string, unknown> = {};

    if (opts.includeMeta) {
      result.export_meta = meta;
    }

    if (hasIntegrity && integrity) {
      result.integrity = {
        algorithm: integrity.algorithm,
        content_hash: integrity.contentHash,
        audit_chain_root: integrity.chainRoot,
        audit_chain_fact_count: integrity.factCount,
        audit_chain_verified: integrity.verified,
        verification_note: integrity.verificationNote,
      };
    }

    // data 段:raw + business(可分别开关)
    const data: Record<string, unknown> = {};
    if (opts.includeRaw) data.raw = content.rawData;
    if (opts.includeBusiness && content.businessData !== undefined) {
      data.business = content.businessData;
    }
    result.data = data;

    const jsonStr = JSON.stringify(result, null, 2);
    return new Blob([jsonStr], { type: "application/json" });
  }
}

// ============================================================================
// 2. CsvRenderer
// ============================================================================

export class CsvRenderer implements ExportRenderer {
  format = "csv" as const;

  async render(
    content: ExportContent,
    meta: ExportMeta,
    options?: ExportRenderOptions,
  ): Promise<Blob> {
    const opts = mergeOptions(options);
    const delimiter = opts.csvDelimiter ?? ",";
    const lines: string[] = [];

    // CSV 首行:integrity 注释(若启用)
    if (opts.includeIntegrity && content.integrity) {
      const i = content.integrity;
      lines.push(
        `# integrity: algorithm=${i.algorithm} content_hash=${i.contentHash} chain_root=${i.chainRoot ?? "null"} fact_count=${i.factCount} verified=${i.verified}`,
      );
    }

    // CSV 次行:export_meta 注释
    if (opts.includeMeta) {
      lines.push(
        `# meta: operator=${meta.operator} exported_at=${meta.exportedAt} session_id=${meta.sessionId} ruleset_version=${meta.rulesetVersion} template=${meta.templateId ?? "none"}`,
      );
    }

    // 数据行:从 rawData 或 businessData 提取扁平行
    const dataSource = opts.includeBusiness && content.businessData !== undefined
      ? content.businessData
      : content.rawData;

    const rows = flattenToRows(dataSource, content.fieldSchema);
    if (rows.length === 0) {
      lines.push("# 无数据");
    } else {
      // 表头
      const headers = Object.keys(rows[0]);
      lines.push(headers.map((h) => csvEscape(h, delimiter)).join(delimiter));
      // 数据行
      for (const row of rows) {
        lines.push(
          headers
            .map((h) => csvEscape(String(row[h] ?? ""), delimiter))
            .join(delimiter),
        );
      }
    }

    const csvStr = lines.join("\n");
    // UTF-8 BOM(Excel 中文兼容)
    const bom = "\uFEFF";
    return new Blob([bom + csvStr], { type: "text/csv;charset=utf-8" });
  }
}

/** CSV 字段转义(含逗号/引号/换行需双引号包裹) */
function csvEscape(value: string, delimiter: string): string {
  if (!value) return "";
  if (
    value.includes(delimiter) ||
    value.includes('"') ||
    value.includes("\n") ||
    value.includes("\r")
  ) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** 把对象/数组扁平化为 CSV 行数组(每行一个 key-value 字典) */
function flattenToRows(
  data: unknown,
  fieldSchema?: { key: string; label: string }[],
): Record<string, unknown>[] {
  if (Array.isArray(data)) {
    return data.map((item) => flattenObject(item, fieldSchema));
  }
  if (data && typeof data === "object") {
    // 单对象:可能含 entries 数组
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.entries)) {
      return obj.entries.map((item: unknown) =>
        flattenObject(item, fieldSchema),
      );
    }
    return [flattenObject(data, fieldSchema)];
  }
  return [];
}

/** 单对象扁平化(嵌套用 . 分隔) */
function flattenObject(
  obj: unknown,
  fieldSchema?: { key: string; label: string }[],
  prefix = "",
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (!obj || typeof obj !== "object") {
    result[prefix || "value"] = obj;
    return result;
  }
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const fullKey = prefix ? `${prefix}.${k}` : k;
    // 业务化 key(若有 schema)
    const displayKey = fieldSchema?.find((s) => s.key === fullKey)?.label ?? fullKey;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      Object.assign(result, flattenObject(v, fieldSchema, fullKey));
    } else if (Array.isArray(v)) {
      result[displayKey] = v.map((x) => JSON.stringify(x)).join("; ");
    } else {
      result[displayKey] = v;
    }
  }
  return result;
}

// ============================================================================
// 3. XmlRenderer
// ============================================================================

export class XmlRenderer implements ExportRenderer {
  format = "xml" as const;

  async render(
    content: ExportContent,
    meta: ExportMeta,
    options?: ExportRenderOptions,
  ): Promise<Blob> {
    const opts = mergeOptions(options);
    const lines: string[] = [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<evorule-export type="${content.type}" format="xml">`,
    ];

    if (opts.includeMeta) {
      lines.push(`  <export_meta>`);
      lines.push(`    <operator>${xmlEscape(meta.operator)}</operator>`);
      lines.push(`    <exported_at>${xmlEscape(meta.exportedAt)}</exported_at>`);
      lines.push(`    <session_id>${meta.sessionId}</session_id>`);
      lines.push(`    <ruleset_version>${meta.rulesetVersion}</ruleset_version>`);
      lines.push(
        `    <range>${xmlEscape(meta.rangeDescription)}</range>`,
      );
      if (meta.templateId) {
        lines.push(`    <template_id>${xmlEscape(meta.templateId)}</template_id>`);
      }
      lines.push(`    <console_version>${xmlEscape(meta.consoleVersion)}</console_version>`);
      lines.push(`  </export_meta>`);
    }

    if (opts.includeIntegrity && content.integrity) {
      const i = content.integrity;
      lines.push(
        `  <integrity algorithm="${i.algorithm}" contentHash="${i.contentHash}" chainRoot="${i.chainRoot ?? ""}" factCount="${i.factCount}" verified="${i.verified}"/>`,
      );
    }

    // data 段
    lines.push(`  <data>`);
    if (opts.includeRaw) {
      lines.push(`    <raw>`);
      lines.push(objectToXml(content.rawData, 6));
      lines.push(`    </raw>`);
    }
    if (opts.includeBusiness && content.businessData !== undefined) {
      lines.push(`    <business>`);
      lines.push(objectToXml(content.businessData, 6));
      lines.push(`    </business>`);
    }
    lines.push(`  </data>`);

    lines.push(`</evorule-export>`);

    const xmlStr = lines.join("\n");
    return new Blob([xmlStr], { type: "application/xml" });
  }
}

/** XML 转义 */
function xmlEscape(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** 对象 → XML 嵌套标签 */
function objectToXml(obj: unknown, indent: number): string {
  const pad = " ".repeat(indent);
  if (obj === null || obj === undefined) {
    return `${pad}<null/>`;
  }
  if (typeof obj !== "object") {
    return `${pad}${xmlEscape(String(obj))}`;
  }
  if (Array.isArray(obj)) {
    return obj
      .map((item) => `${pad}<item>\n${objectToXml(item, indent + 2)}\n${pad}</item>`)
      .join("\n");
  }
  const entries = Object.entries(obj as Record<string, unknown>);
  return entries
    .map(([k, v]) => {
      const tag = xmlTagName(k);
      if (v !== null && typeof v === "object") {
        return `${pad}<${tag}>\n${objectToXml(v, indent + 2)}\n${pad}</${tag}>`;
      }
      return `${pad}<${tag}>${xmlEscape(String(v ?? ""))}</${tag}>`;
    })
    .join("\n");
}

/** 把任意 key 转为合法 XML 标签名 */
function xmlTagName(key: string): string {
  // 非字母开头加下划线
  let name = key.replace(/[^a-zA-Z0-9_\-\.]/g, "_");
  if (!/^[a-zA-Z_]/.test(name)) name = `_${name}`;
  return name;
}

// ============================================================================
// 4. PdfRenderer
// ============================================================================

/**
 * PDF 渲染器。
 *
 * 策略(P0):
 *   1. 优先调服务端 POST /api/export/pdf(若 evorule-server 已支持)
 *   2. 服务端不支持时,降级为打印 HTML(在新窗口打开,用户用浏览器"另存为 PDF")
 *
 * 设计依据:P07 §3.2 PDF 渲染策略决策表
 */
export class PdfRenderer implements ExportRenderer {
  format = "pdf" as const;

  constructor(
    public readonly serverBaseUrl?: string,
    /** 执行域 server Bearer token(UV-084 W6:/api/export/pdf 在受保护路由组) */
    public readonly authToken?: string,
  ) {}

  async render(
    content: ExportContent,
    meta: ExportMeta,
    options?: ExportRenderOptions,
  ): Promise<Blob> {
    const opts = mergeOptions(options);

    // 优先尝试服务端渲染
    if (this.serverBaseUrl) {
      try {
        const blob = await this.tryServerPdf(content, meta, opts);
        if (blob) return blob;
      } catch (e) {
        // 降级到打印 HTML,但原因必须透出(不静默降级)
        console.warn(
          `[export] 服务端 PDF 请求失败: ${(e as Error).message},降级为打印 HTML`,
        );
      }
    }

    // 降级:生成打印 HTML(返回为 HTML blob,调用方需 window.open + print)
    // 注:返回 HTML blob,downloadFile 时扩展名 .html;UI 提示用户用浏览器另存为 PDF
    const html = this.renderPrintableHtml(content, meta, opts);
    return new Blob([html], { type: "text/html" });
  }

  /** 尝试调服务端 PDF 渲染端点 */
  private async tryServerPdf(
    content: ExportContent,
    meta: ExportMeta,
    opts: ExportRenderOptions,
  ): Promise<Blob | null> {
    if (!this.serverBaseUrl) return null;
    const url = `${this.serverBaseUrl.replace(/\/+$/, "")}/api/export/pdf`;
    const body = {
      content_type: content.type,
      session_id: content.sessionId,
      ruleset_version: content.rulesetVersion,
      range: content.range,
      raw_data: opts.includeRaw ? content.rawData : null,
      business_data: opts.includeBusiness ? content.businessData : null,
      integrity: opts.includeIntegrity ? content.integrity : null,
      meta: {
        operator: meta.operator,
        exported_at: meta.exportedAt,
        range_description: meta.rangeDescription,
        template_id: meta.templateId,
        console_version: meta.consoleVersion,
      },
      options: {
        pdf_title: opts.pdfTitle,
        pdf_organization: opts.pdfOrganization,
        include_integrity: opts.includeIntegrity,
        include_meta: opts.includeMeta,
      },
    };

    // Bearer 认证(UV-084 W6):端点挂载在受保护路由组,生产模式(启用 auth_token)
    // 无 token 会 401。认证禁用的 loopback 开发模式下带 token 亦无害。
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.authToken) {
      headers.Authorization = `Bearer ${this.authToken}`;
    }

    const r = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      // 失败原因透出(不静默降级);server 端 message 在 body 里,尽力读取
      let detail = "";
      try {
        detail = ((await r.json()) as { message?: string }).message ?? "";
      } catch {
        /* 非 JSON 错误体,只报状态码 */
      }
      console.warn(
        `[export] 服务端 PDF 渲染失败(HTTP ${r.status}${detail ? `: ${detail}` : ""}),降级为打印 HTML`,
      );
      return null;
    }
    const ct = r.headers.get("content-type") ?? "";
    if (!ct.includes("pdf")) {
      console.warn(`[export] 服务端 PDF 响应类型异常(${ct}),降级为打印 HTML`);
      return null;
    }
    return await r.blob();
  }

  /** 生成可打印 HTML(降级方案) */
  private renderPrintableHtml(
    content: ExportContent,
    meta: ExportMeta,
    opts: ExportRenderOptions,
  ): string {
    const title = opts.pdfTitle ?? "evorule 导出报告";
    const org = opts.pdfOrganization ?? "";
    const lines: string[] = [];

    lines.push(`<!DOCTYPE html>`);
    lines.push(`<html lang="zh-CN"><head><meta charset="UTF-8">`);
    lines.push(`<title>${escapeHtml(title)}</title>`);
    lines.push(`<style>`);
    lines.push(`body { font-family: "Microsoft YaHei", sans-serif; padding: 32px; color: #111827; }`);
    lines.push(`h1 { font-size: 22px; border-bottom: 2px solid #2563eb; padding-bottom: 8px; }`);
    lines.push(`h2 { font-size: 16px; margin-top: 24px; color: #374151; }`);
    lines.push(`table { width: 100%; border-collapse: collapse; margin: 8px 0; }`);
    lines.push(`th, td { border: 1px solid #e5e7eb; padding: 6px 10px; text-align: left; font-size: 12px; }`);
    lines.push(`th { background: #f9fafb; font-weight: 600; }`);
    lines.push(`.integrity { background: #f0fdf4; border: 1px solid #86efac; padding: 12px; border-radius: 6px; margin: 12px 0; font-size: 11px; }`);
    lines.push(`.meta { font-size: 11px; color: #6b7280; margin-bottom: 16px; }`);
    lines.push(`pre { background: #f9fafb; padding: 8px; border-radius: 4px; font-size: 10px; overflow-x: auto; }`);
    lines.push(`@media print { body { padding: 16px; } }`);
    lines.push(`</style></head><body>`);

    lines.push(`<h1>${escapeHtml(title)}</h1>`);

    if (org) {
      lines.push(`<div class="meta">机构: ${escapeHtml(org)}</div>`);
    }

    if (opts.includeMeta) {
      lines.push(`<div class="meta">`);
      lines.push(`<strong>操作人:</strong> ${escapeHtml(meta.operator)} &nbsp;|&nbsp;`);
      lines.push(`<strong>导出时间:</strong> ${escapeHtml(meta.exportedAt)} &nbsp;|&nbsp;`);
      lines.push(`<strong>Session:</strong> ${meta.sessionId} &nbsp;|&nbsp;`);
      lines.push(`<strong>Ruleset 版本:</strong> v${meta.rulesetVersion} &nbsp;|&nbsp;`);
      lines.push(`<strong>范围:</strong> ${escapeHtml(meta.rangeDescription)}`);
      lines.push(`</div>`);
    }

    if (opts.includeIntegrity && content.integrity) {
      const i = content.integrity;
      lines.push(`<div class="integrity">`);
      lines.push(`<strong>📋 BLAKE3 完整性证明</strong><br>`);
      lines.push(`算法: ${i.algorithm}<br>`);
      lines.push(`内容哈希: <code>${i.contentHash}</code><br>`);
      lines.push(`链根哈希: <code>${i.chainRoot ?? "N/A"}</code><br>`);
      lines.push(`Fact 总数: ${i.factCount}<br>`);
      lines.push(`链验证: ${i.verified ? "✅ 通过(不可篡改)" : "🔴 失败(可能被篡改)"}<br>`);
      lines.push(`<em>${escapeHtml(i.verificationNote)}</em>`);
      lines.push(`</div>`);
    }

    lines.push(`<h2>📊 导出数据(${content.type})</h2>`);

    if (opts.includeRaw) {
      lines.push(`<h3>Raw 数据</h3>`);
      lines.push(`<pre>${escapeHtml(JSON.stringify(content.rawData, null, 2))}</pre>`);
    }

    if (opts.includeBusiness && content.businessData !== undefined) {
      lines.push(`<h3>业务化数据</h3>`);
      const rows = flattenToRows(content.businessData, content.fieldSchema);
      if (rows.length > 0) {
        const headers = Object.keys(rows[0]);
        lines.push(`<table><thead><tr>`);
        headers.forEach((h) => lines.push(`<th>${escapeHtml(h)}</th>`));
        lines.push(`</tr></thead><tbody>`);
        rows.forEach((row) => {
          lines.push(`<tr>`);
          headers.forEach((h) =>
            lines.push(`<td>${escapeHtml(String(row[h] ?? ""))}</td>`),
          );
          lines.push(`</tr>`);
        });
        lines.push(`</tbody></table>`);
      } else {
        lines.push(`<pre>${escapeHtml(JSON.stringify(content.businessData, null, 2))}</pre>`);
      }
    }

    lines.push(`<script>window.onload = () => { setTimeout(() => window.print(), 500); };<\/script>`);
    lines.push(`</body></html>`);

    return lines.join("\n");
  }
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ============================================================================
// 5. 渲染器注册表
// ============================================================================

/** 渲染器映射(延迟构造,避免 SSR 时 fetch 不可用) */
let rendererCache: Partial<Record<string, ExportRenderer>> = {};

/** 获取渲染器(按格式) */
export function getRenderer(
  format: "json" | "csv" | "pdf" | "xml",
  serverBaseUrl?: string,
  authToken?: string,
): ExportRenderer {
  if (!rendererCache[format]) {
    switch (format) {
      case "json":
        rendererCache[format] = new JsonRenderer();
        break;
      case "csv":
        rendererCache[format] = new CsvRenderer();
        break;
      case "xml":
        rendererCache[format] = new XmlRenderer();
        break;
      case "pdf":
        rendererCache[format] = new PdfRenderer(serverBaseUrl, authToken);
        break;
    }
  }
  // PDF 渲染器需要 serverBaseUrl + authToken(UV-084 W6),任一变化需重建
  if (format === "pdf") {
    const pdf = rendererCache.pdf as PdfRenderer | undefined;
    if (
      pdf &&
      (pdf.serverBaseUrl !== serverBaseUrl || pdf.authToken !== authToken)
    ) {
      rendererCache.pdf = new PdfRenderer(serverBaseUrl, authToken);
    }
  }
  return rendererCache[format]!;
}

/** 重置渲染器缓存(测试用) */
export function resetRendererCache(): void {
  rendererCache = {};
}
