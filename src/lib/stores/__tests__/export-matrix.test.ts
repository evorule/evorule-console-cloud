// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// P07 导出矩阵测试 — 6 内容 × 4 格式 = 24 种组合全验证
//
// 运行: npx vitest run src/lib/stores/__tests__/export-matrix.test.ts
//
// 用医疗场景 mock 数据(呼吸科就诊完整链路)验证每种组合:
//   - executeExport 不抛错,返回 blob + filename
//   - blob.size > 0,blob.type 正确
//   - 格式特定结构(JSON 可解析 / CSV 含 BOM / XML 含根标签 / PDF 降级 HTML)
//   - 内容特定结构(audit_chain/comprehensive 含 BLAKE3 integrity,fact_stream 含 6 条 Fact)
//
// 关联设计:P07_RESULT_EXPORT_DESIGN.md §3.2 + §4 + §5

import { describe, test, expect, beforeEach } from "vitest";
import { get as storeGet } from "svelte/store";
import type { SessionId } from "$lib/kernel";
import {
  executeExport,
  exportExecutionStore,
  resetExportState,
} from "../export-store";
import { createBuiltinTemplates } from "../export-types";
import { exportTemplatesStore } from "../export-store";
import { businessTermsStore } from "../business-terms";
import { sessionStore } from "../session";
import { productionStateStore } from "../production-state";
import {
  makeMedicalMockBackend,
  MOCK_FACTS,
  MOCK_AUDIT,
} from "./export-mock-data";
import type { ExportContentType, ExportFormat } from "../export-types";

// ============================================================================
// 测试矩阵定义
// ============================================================================

const CONTENTS: ExportContentType[] = [
  "fact_stream",
  "decision_log",
  "audit_chain",
  "state_snapshot",
  "causal_chain",
  "comprehensive",
];

const FORMATS: ExportFormat[] = ["json", "csv", "pdf", "xml"];

// 每种格式期望的 blob.type(PDF 无 server 时降级为 HTML)
const EXPECTED_BLOB_TYPE: Record<ExportFormat, string> = {
  json: "application/json",
  csv: "text/csv;charset=utf-8",
  pdf: "text/html", // 无 serverBaseUrl,降级为可打印 HTML
  xml: "application/xml",
};

// 每种格式期望的文件扩展名(PDF 降级为 .html)
const EXPECTED_EXT: Record<ExportFormat, string> = {
  json: ".json",
  csv: ".csv",
  pdf: ".html", // blob.type === "text/html" 时 ext 改为 html
  xml: ".xml",
};

// ============================================================================
// 共享 setup
// ============================================================================

beforeEach(() => {
  resetExportState();
  exportTemplatesStore.set(createBuiltinTemplates());
  sessionStore.set({
    loggedIn: true,
    userId: "u1",
    username: "doctor_li",
    loginAt: Date.now(),
  });
  productionStateStore.set({
    status: "running",
    currentSessionId: 1,
    rulesetVersion: 6,
    rulesetHash: "hash_medical_v6",
    updatedAt: "2026-08-07T09:00:00Z",
  });
  businessTermsStore.set([
    {
      id: "medical.patient_id",
      industry: "medical",
      label: "病人ID",
      key: "patient_id",
      synonyms: ["病人"],
      description: "病人唯一标识",
      status: "active",
      version: 1,
    },
    {
      id: "medical.patient_name",
      industry: "medical",
      label: "病人姓名",
      key: "patient_name",
      synonyms: ["姓名"],
      description: "病人全名",
      status: "active",
      version: 1,
    },
    {
      id: "medical.rule_id",
      industry: "medical",
      label: "规则ID",
      key: "rule_id",
      synonyms: ["规则"],
      description: "触发的规则标识",
      status: "active",
      version: 1,
    },
    {
      id: "medical.drug_name",
      industry: "medical",
      label: "药品名称",
      key: "drug_name",
      synonyms: ["药品"],
      description: "开具的药品",
      status: "active",
      version: 1,
    },
    {
      id: "medical.temperature",
      industry: "medical",
      label: "体温",
      key: "temperature",
      synonyms: ["体温"],
      description: "病人体温(℃)",
      status: "active",
      version: 1,
    },
    {
      id: "medical.result",
      industry: "medical",
      label: "决策结果",
      key: "result",
      synonyms: ["结果"],
      description: "规则触发结果",
      status: "active",
      version: 1,
    },
  ]);
});

// ============================================================================
// 矩阵测试:6 内容 × 4 格式
// ============================================================================

describe("P07 导出矩阵 — 6 内容 × 4 格式(医疗场景)", () => {
  // 用表格形式生成 24 个测试,便于阅读
  for (const content of CONTENTS) {
    describe(`📂 内容类型: ${content}`, () => {
      for (const format of FORMATS) {
        test(`📤 ${format} 导出成功且结构正确`, async () => {
          const backend = makeMedicalMockBackend();
          const result = await executeExport(
            backend,
            1 as SessionId,
            content,
            format,
            { timeRange: { kind: "all" } },
            {
              includeRaw: true,
              includeBusiness: true,
              includeIntegrity: true,
              includeMeta: true,
            },
          );

          // === 通用断言:成功返回 ===
          expect(result).not.toBeNull();
          const { blob, filename } = result!;

          // blob 非空
          expect(blob.size).toBeGreaterThan(0);

          // blob.type 正确
          expect(blob.type).toBe(EXPECTED_BLOB_TYPE[format]);

          // filename 格式:evorule-{contentType}-{timestamp}.{ext}
          expect(filename).toMatch(
            new RegExp(`^evorule-${content}-.+\\${EXPECTED_EXT[format]}$`),
          );

          // 导出状态归位
          const state = storeGet(exportExecutionStore);
          expect(state.exporting).toBe(false);
          expect(state.error).toBeNull();
          expect(state.lastFilename).toBe(filename);

          // === 格式特定断言 ===
          const text = await blob.text();

          if (format === "json") {
            const parsed = JSON.parse(text);
            // JSON 必含 export_meta + data
            expect(parsed.export_meta).toBeDefined();
            expect(parsed.export_meta.operator).toBe("doctor_li");
            expect(parsed.data).toBeDefined();
          } else if (format === "csv") {
            // CSV 含 UTF-8 BOM
            const buf = new Uint8Array(await blob.arrayBuffer());
            expect(buf[0]).toBe(0xef);
            expect(buf[1]).toBe(0xbb);
            expect(buf[2]).toBe(0xbf);
            // CSV 含 meta 注释行
            expect(text.replace(/^\uFEFF/, "")).toContain("# meta: operator=doctor_li");
          } else if (format === "xml") {
            // XML 含声明 + 根标签
            expect(text).toContain('<?xml version="1.0"');
            expect(text).toContain(`<evorule-export type="${content}"`);
            expect(text).toContain("</evorule-export>");
          } else if (format === "pdf") {
            // PDF 降级为 HTML,含 print 脚本
            expect(text).toContain("<!DOCTYPE html>");
            expect(text).toContain("window.print()");
          }
        });
      }
    });
  }

  // === 内容特定断言(用 JSON 格式,易解析)===
  describe("📋 内容特定结构验证(JSON)", () => {
    test("fact_stream:含 6 条 Fact(完整就诊链路)", async () => {
      const backend = makeMedicalMockBackend();
      const result = await executeExport(
        backend,
        1 as SessionId,
        "fact_stream",
        "json",
        { timeRange: { kind: "all" } },
        { includeRaw: true, includeBusiness: true },
      );
      const parsed = JSON.parse(await result!.blob.text());
      // raw 是 Fact 数组
      expect(Array.isArray(parsed.data.raw)).toBe(true);
      expect(parsed.data.raw).toHaveLength(MOCK_FACTS.length);
      // 含 patient_visit / rule_triggered / drug_prescribe / decision 等类型
      const types = parsed.data.raw.map((f: { type: string }) => f.type);
      expect(types).toContain("patient_visit");
      expect(types).toContain("rule_triggered");
      expect(types).toContain("drug_prescribe");
      expect(types).toContain("decision");
    });

    test("decision_log:仅含 rule_triggered Fact(2 条)", async () => {
      const backend = makeMedicalMockBackend();
      const result = await executeExport(
        backend,
        1 as SessionId,
        "decision_log",
        "json",
        { timeRange: { kind: "all" } },
        { includeRaw: true, includeBusiness: true },
      );
      const parsed = JSON.parse(await result!.blob.text());
      expect(Array.isArray(parsed.data.raw)).toBe(true);
      // MOCK_FACTS 中 rule_triggered 有 2 条(fact 3 + fact 5)
      expect(parsed.data.raw).toHaveLength(2);
      expect(
        parsed.data.raw.every(
          (f: { type: string }) => f.type === "rule_triggered",
        ),
      ).toBe(true);
    });

    test("audit_chain:含 BLAKE3 integrity 段 + 6 条审计条目", async () => {
      const backend = makeMedicalMockBackend();
      const result = await executeExport(
        backend,
        1 as SessionId,
        "audit_chain",
        "json",
        { timeRange: { kind: "all" } },
        { includeRaw: true, includeBusiness: true, includeIntegrity: true },
      );
      const parsed = JSON.parse(await result!.blob.text());
      expect(parsed.integrity).toBeDefined();
      expect(parsed.integrity.algorithm).toBe("BLAKE3");
      expect(parsed.integrity.audit_chain_verified).toBe(true);
      expect(parsed.integrity.content_hash).toBe(MOCK_AUDIT.last_hash);
      expect(parsed.integrity.audit_chain_fact_count).toBe(MOCK_FACTS.length);
      // raw 是 SessionAudit
      expect(parsed.data.raw.fact_count).toBe(MOCK_FACTS.length);
      expect(parsed.data.raw.verified).toBe(true);
    });

    test("state_snapshot:含 session 版本 + reactor 运行态", async () => {
      const backend = makeMedicalMockBackend();
      const result = await executeExport(
        backend,
        1 as SessionId,
        "state_snapshot",
        "json",
        { timeRange: { kind: "all" } },
        { includeRaw: true, includeBusiness: true },
      );
      const parsed = JSON.parse(await result!.blob.text());
      expect(parsed.data.raw.version).toBe(6);
      // reactor 字段对齐 ReactorState 契约:phase / current_step 等
      expect(parsed.data.raw.reactor.phase).toBe("stable");
      expect(parsed.data.raw.reactor.current_step).toBe(6);
      expect(parsed.data.raw.reactor.pending_io_count).toBe(0);
    });

    test("causal_chain:含因果链节点(就诊→检验→规则触发)", async () => {
      const backend = makeMedicalMockBackend();
      const result = await executeExport(
        backend,
        1 as SessionId,
        "causal_chain",
        "json",
        { timeRange: { kind: "all" } },
        { includeRaw: true, includeBusiness: true },
      );
      const parsed = JSON.parse(await result!.blob.text());
      expect(parsed.data.raw.chain).toBeDefined();
      expect(Array.isArray(parsed.data.raw.chain)).toBe(true);
      expect(parsed.data.raw.chain.length).toBeGreaterThan(0);
    });

    test("comprehensive:聚合 audit + state + replay 三段", async () => {
      const backend = makeMedicalMockBackend();
      const result = await executeExport(
        backend,
        1 as SessionId,
        "comprehensive",
        "json",
        { timeRange: { kind: "all" } },
        { includeRaw: true, includeBusiness: true, includeIntegrity: true },
      );
      const parsed = JSON.parse(await result!.blob.text());
      expect(parsed.data.raw.audit_chain).toBeDefined();
      expect(parsed.data.raw.state_snapshot).toBeDefined();
      expect(parsed.data.raw.fact_stream).toBeDefined();
      // comprehensive 也含 integrity(因为含 audit_chain)
      expect(parsed.integrity).toBeDefined();
      expect(parsed.integrity.algorithm).toBe("BLAKE3");
    });
  });

  // === 渲染选项开关验证 ===
  describe("🎛 渲染选项开关", () => {
    test("includeIntegrity=false 时 JSON 不含 integrity 段", async () => {
      const backend = makeMedicalMockBackend();
      const result = await executeExport(
        backend,
        1 as SessionId,
        "audit_chain",
        "json",
        { timeRange: { kind: "all" } },
        {
          includeRaw: true,
          includeBusiness: true,
          includeIntegrity: false,
          includeMeta: true,
        },
      );
      const parsed = JSON.parse(await result!.blob.text());
      expect(parsed.integrity).toBeUndefined();
    });

    test("includeMeta=false 时 JSON 不含 export_meta", async () => {
      const backend = makeMedicalMockBackend();
      const result = await executeExport(
        backend,
        1 as SessionId,
        "audit_chain",
        "json",
        { timeRange: { kind: "all" } },
        {
          includeRaw: true,
          includeBusiness: true,
          includeIntegrity: true,
          includeMeta: false,
        },
      );
      const parsed = JSON.parse(await result!.blob.text());
      expect(parsed.export_meta).toBeUndefined();
    });

    test("includeBusiness=true 时 JSON data 段含 business 字段", async () => {
      const backend = makeMedicalMockBackend();
      const result = await executeExport(
        backend,
        1 as SessionId,
        "fact_stream",
        "json",
        { timeRange: { kind: "all" } },
        {
          includeRaw: false,
          includeBusiness: true,
          includeIntegrity: false,
          includeMeta: false,
        },
      );
      const parsed = JSON.parse(await result!.blob.text());
      // businessData 含业务化字段(如"病人ID"而非"patient_id")
      const businessStr = JSON.stringify(parsed.data.business);
      expect(businessStr).toContain("病人ID");
    });
  });

  // === 筛选条件验证 ===
  describe("🔍 筛选条件", () => {
    test("versionRange 传入 getReplay(from, to)", async () => {
      const backend = makeMedicalMockBackend();
      await executeExport(
        backend,
        1 as SessionId,
        "fact_stream",
        "json",
        {
          timeRange: { kind: "all" },
          versionRange: { from: 2, to: 5 },
        },
        { includeRaw: true, includeBusiness: true },
      );
      // getReplay 应被调用,参数含 from=2, to=5
      const replaySpy = (backend as unknown as { _spies: { getReplay: { mock: { calls: unknown[][] } } } })._spies.getReplay;
      expect(replaySpy.mock.calls.length).toBeGreaterThan(0);
      const lastCall = replaySpy.mock.calls[replaySpy.mock.calls.length - 1];
      // getReplay(sessionId, from, to)
      expect(lastCall[0]).toBe(1); // sessionId
      expect(lastCall[1]).toBe(2); // from
      expect(lastCall[2]).toBe(5); // to
    });

    test("factTypes 筛选:只保留指定类型", async () => {
      const backend = makeMedicalMockBackend();
      const result = await executeExport(
        backend,
        1 as SessionId,
        "fact_stream",
        "json",
        {
          timeRange: { kind: "all" },
          factTypes: ["rule_triggered"],
        },
        { includeRaw: true, includeBusiness: true },
      );
      const parsed = JSON.parse(await result!.blob.text());
      // factTypes 筛选只保留 rule_triggered(2 条)
      expect(parsed.data.raw).toHaveLength(2);
      expect(
        parsed.data.raw.every(
          (f: { type: string }) => f.type === "rule_triggered",
        ),
      ).toBe(true);
    });
  });

  // === 汇总:24 种组合全部成功 ===
  test("✅ 6 内容 × 4 格式 = 24 种组合全部导出成功", async () => {
    const results: { content: string; format: string; size: number; ok: boolean }[] = [];
    for (const content of CONTENTS) {
      for (const format of FORMATS) {
        const backend = makeMedicalMockBackend();
        const r = await executeExport(
          backend,
          1 as SessionId,
          content,
          format,
          { timeRange: { kind: "all" } },
          {
            includeRaw: true,
            includeBusiness: true,
            includeIntegrity: true,
            includeMeta: true,
          },
        );
        results.push({
          content,
          format,
          size: r?.blob.size ?? 0,
          ok: r !== null && r.blob.size > 0,
        });
      }
    }
    // 全部成功
    expect(results.every((r) => r.ok)).toBe(true);
    expect(results).toHaveLength(24);
    // 输出汇总表(用 console.log,vitest --reporter=verbose 可见)
    // eslint-disable-next-line no-console
    console.log(
      "\n=== P07 导出矩阵结果汇总 ===\n" +
        results
          .map(
            (r) =>
              `  ${r.content.padEnd(18)} × ${r.format.padEnd(4)} → ${r.size.toString().padStart(6)} bytes ${r.ok ? "✓" : "✗"}`,
          )
          .join("\n"),
    );
  });
});
