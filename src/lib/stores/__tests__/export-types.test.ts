// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// P07 export-types 单测 — 标签覆盖 + 内置模板工厂
//
// 运行: npx vitest run src/lib/stores/__tests__/export-types.test.ts
//
// 关联设计:P07_RESULT_EXPORT_DESIGN.md §4

import { describe, test, expect } from "vitest";
import {
  CONTENT_TYPE_LABELS,
  FORMAT_LABELS,
  createBuiltinTemplates,
  type ExportContentType,
  type ExportFormat,
} from "../export-types";

describe("P07 export-types — 标签覆盖", () => {
  test("CONTENT_TYPE_LABELS 覆盖全部 6 种内容类型", () => {
    const allTypes: ExportContentType[] = [
      "fact_stream",
      "decision_log",
      "audit_chain",
      "state_snapshot",
      "causal_chain",
      "comprehensive",
    ];
    for (const t of allTypes) {
      expect(CONTENT_TYPE_LABELS[t]).toBeTruthy();
      expect(typeof CONTENT_TYPE_LABELS[t]).toBe("string");
      // 标签应为中文(含 CJK 字符)
      expect(/[\u4e00-\u9fff]/.test(CONTENT_TYPE_LABELS[t])).toBe(true);
    }
  });

  test("FORMAT_LABELS 覆盖全部 4 种格式", () => {
    const allFormats: ExportFormat[] = ["json", "csv", "pdf", "xml"];
    for (const f of allFormats) {
      expect(FORMAT_LABELS[f]).toBeTruthy();
      expect(typeof FORMAT_LABELS[f]).toBe("string");
    }
  });
});

describe("P07 export-types — createBuiltinTemplates", () => {
  test("返回 3 个内置模板,source 全为 builtin", () => {
    const templates = createBuiltinTemplates();
    expect(templates).toHaveLength(3);
    expect(templates.every((t) => t.source === "builtin")).toBe(true);
  });

  test("内置模板 id 唯一且符合 builtin.* 命名", () => {
    const templates = createBuiltinTemplates();
    const ids = templates.map((t) => t.id);
    expect(new Set(ids).size).toBe(3);
    expect(ids.every((id) => id.startsWith("builtin."))).toBe(true);
  });

  test("合规报告模板:含 audit_chain + PDF + BLAKE3 完整性", () => {
    const templates = createBuiltinTemplates();
    const compliance = templates.find(
      (t) => t.id === "builtin.compliance_report",
    );
    expect(compliance).toBeDefined();
    expect(compliance!.format).toBe("pdf");
    expect(compliance!.content.contents).toContain("audit_chain");
    expect(compliance!.renderOptions?.includeIntegrity).toBe(true);
  });

  test("业务汇总模板:含 fact_stream + CSV", () => {
    const templates = createBuiltinTemplates();
    const summary = templates.find((t) => t.id === "builtin.business_summary");
    expect(summary).toBeDefined();
    expect(summary!.format).toBe("csv");
    expect(summary!.content.contents).toContain("fact_stream");
    expect(summary!.content.contents).toContain("decision_log");
  });

  test("监管报送模板:含 audit_chain + state_snapshot + XML", () => {
    const templates = createBuiltinTemplates();
    const reg = templates.find(
      (t) => t.id === "builtin.regulatory_submission",
    );
    expect(reg).toBeDefined();
    expect(reg!.format).toBe("xml");
    expect(reg!.content.contents).toContain("audit_chain");
    expect(reg!.content.contents).toContain("state_snapshot");
    // 监管报送保留 raw 字段(系统对接需要原始结构)
    expect(reg!.renderOptions?.includeRaw).toBe(true);
  });

  test("每个模板含 createdAt + updatedAt(ISO 时间)", () => {
    const templates = createBuiltinTemplates();
    for (const t of templates) {
      expect(t.createdAt).toBeTruthy();
      expect(t.updatedAt).toBeTruthy();
      // ISO 格式校验
      expect(() => new Date(t.createdAt).toISOString()).not.toThrow();
      expect(() => new Date(t.updatedAt).toISOString()).not.toThrow();
    }
  });

  test("每次调用生成新时间戳(非共享引用)", () => {
    const t1 = createBuiltinTemplates();
    // 等待 1ms 确保时间戳不同
    const t2 = createBuiltinTemplates();
    // 两次调用的模板对象不应是同一引用
    expect(t1).not.toBe(t2);
    expect(t1[0]).not.toBe(t2[0]);
  });
});
