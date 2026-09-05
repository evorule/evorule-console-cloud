// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// P07 export-renderers 单测 — 4 种格式渲染器 + getRenderer 缓存
//
// 运行: npx vitest run src/lib/stores/__tests__/export-renderers.test.ts
//
// 关联设计:P07_RESULT_EXPORT_DESIGN.md §3.2 + §5

import { describe, test, expect, beforeEach } from "vitest";
import {
  JsonRenderer,
  CsvRenderer,
  XmlRenderer,
  PdfRenderer,
  getRenderer,
  resetRendererCache,
} from "../export-renderers";
import type {
  ExportContent,
  ExportMeta,
  ExportIntegrity,
} from "../export-types";

// ============================================================================
// 测试夹具
// ============================================================================

function makeIntegrity(): ExportIntegrity {
  return {
    algorithm: "BLAKE3",
    contentHash: "abc123def456",
    chainRoot: "root789",
    factCount: 42,
    verified: true,
    verificationNote: "运行 evorule verify-audit-export 验证",
  };
}

function makeContent(overrides: Partial<ExportContent> = {}): ExportContent {
  return {
    type: "audit_chain",
    sessionId: 1,
    rulesetVersion: 5,
    range: { fromVersion: 0, toVersion: 5 },
    rawData: [
      { fact_id: 1, type: "patient_visit", payload: { patient_id: "P001" } },
      { fact_id: 2, type: "rule_triggered", rule_id: "r1", result: "allowed" },
    ],
    businessData: [
      { 病人ID: "P001", 事件类型: "就诊" },
      { 规则ID: "r1", 决策结果: "允许" },
    ],
    integrity: makeIntegrity(),
    ...overrides,
  };
}

function makeMeta(overrides: Partial<ExportMeta> = {}): ExportMeta {
  return {
    operator: "doctor_wang",
    exportedAt: "2026-08-07T10:00:00.000Z",
    sessionId: 1,
    rulesetVersion: 5,
    rangeDescription: "全部范围",
    templateId: undefined,
    consoleVersion: "0.5.0",
    ...overrides,
  };
}

async function blobToText(blob: Blob): Promise<string> {
  return await blob.text();
}

// ============================================================================
// 1. JsonRenderer
// ============================================================================

describe("P07 JsonRenderer", () => {
  const renderer = new JsonRenderer();

  test("format 标识为 json", () => {
    expect(renderer.format).toBe("json");
  });

  test("输出 application/json 类型 Blob", async () => {
    const blob = await renderer.render(makeContent(), makeMeta(), {});
    expect(blob.type).toBe("application/json");
  });

  test("默认包含 export_meta + integrity + data(raw+business)", async () => {
    const text = await blobToText(
      await renderer.render(makeContent(), makeMeta(), {}),
    );
    const parsed = JSON.parse(text);
    expect(parsed.export_meta).toBeDefined();
    expect(parsed.export_meta.operator).toBe("doctor_wang");
    expect(parsed.integrity).toBeDefined();
    expect(parsed.integrity.algorithm).toBe("BLAKE3");
    expect(parsed.integrity.content_hash).toBe("abc123def456");
    expect(parsed.integrity.audit_chain_verified).toBe(true);
    expect(parsed.data.raw).toBeDefined();
    expect(parsed.data.business).toBeDefined();
  });

  test("includeMeta=false 时不含 export_meta", async () => {
    const text = await blobToText(
      await renderer.render(makeContent(), makeMeta(), {
        includeMeta: false,
        includeRaw: true,
        includeBusiness: true,
        includeIntegrity: true,
      }),
    );
    const parsed = JSON.parse(text);
    expect(parsed.export_meta).toBeUndefined();
  });

  test("includeIntegrity=false 时不含 integrity 段", async () => {
    const text = await blobToText(
      await renderer.render(makeContent(), makeMeta(), {
        includeMeta: true,
        includeRaw: true,
        includeBusiness: true,
        includeIntegrity: false,
      }),
    );
    const parsed = JSON.parse(text);
    expect(parsed.integrity).toBeUndefined();
  });

  test("includeRaw=false + includeBusiness=false 时 data 段为空对象", async () => {
    const text = await blobToText(
      await renderer.render(makeContent(), makeMeta(), {
        includeMeta: false,
        includeRaw: false,
        includeBusiness: false,
        includeIntegrity: false,
      }),
    );
    const parsed = JSON.parse(text);
    expect(parsed.data).toEqual({});
  });

  test("无 integrity 时即使 includeIntegrity=true 也不报错", async () => {
    const content = makeContent({ integrity: undefined });
    const text = await blobToText(
      await renderer.render(content, makeMeta(), {
        includeIntegrity: true,
        includeRaw: true,
        includeBusiness: true,
        includeMeta: true,
      }),
    );
    const parsed = JSON.parse(text);
    expect(parsed.integrity).toBeUndefined();
  });
});

// ============================================================================
// 2. CsvRenderer
// ============================================================================

describe("P07 CsvRenderer", () => {
  const renderer = new CsvRenderer();

  test("format 标识为 csv", () => {
    expect(renderer.format).toBe("csv");
  });

  test("输出 text/csv 类型 Blob(含 UTF-8 BOM)", async () => {
    const blob = await renderer.render(makeContent(), makeMeta(), {});
    expect(blob.type).toBe("text/csv;charset=utf-8");
    // 检查 UTF-8 BOM 字节(EF BB BF)
    const buf = new Uint8Array(await blob.arrayBuffer());
    expect(buf[0]).toBe(0xef);
    expect(buf[1]).toBe(0xbb);
    expect(buf[2]).toBe(0xbf);
  });

  test("默认含 integrity 注释行 + meta 注释行 + 表头 + 数据", async () => {
    const text = (
      await blobToText(await renderer.render(makeContent(), makeMeta(), {}))
    ).replace(/^\uFEFF/, "");
    const lines = text.split("\n");
    // 第一行:integrity 注释
    expect(lines[0]).toMatch(/^# integrity: algorithm=BLAKE3/);
    expect(lines[0]).toContain("content_hash=abc123def456");
    expect(lines[0]).toContain("verified=true");
    // 第二行:meta 注释
    expect(lines[1]).toMatch(/^# meta: operator=doctor_wang/);
    expect(lines[1]).toContain("session_id=1");
    // 后续:表头(从 businessData 取,因为是默认 includeBusiness)
    const headerLine = lines[2];
    expect(headerLine).toContain("病人ID");
    // 数据行
    expect(lines[3]).toContain("P001");
  });

  test("includeBusiness=false 时从 rawData 取数据", async () => {
    const text = (
      await blobToText(
        await renderer.render(makeContent(), makeMeta(), {
          includeRaw: true,
          includeBusiness: false,
          includeIntegrity: false,
          includeMeta: false,
        }),
      )
    ).replace(/^\uFEFF/, "");
    const lines = text.split("\n");
    // 表头应含 raw 字段(fact_id, type, payload.patient_id 等)
    expect(lines[0]).toContain("fact_id");
    expect(lines[0]).toContain("type");
  });

  test("空数据时输出 # 无数据", async () => {
    const content = makeContent({ rawData: [], businessData: [] });
    const text = (
      await blobToText(
        await renderer.render(content, makeMeta(), {
          includeIntegrity: false,
          includeMeta: false,
          includeRaw: true,
          includeBusiness: true,
        }),
      )
    ).replace(/^\uFEFF/, "");
    expect(text).toContain("# 无数据");
  });

  test("CSV 转义:含逗号的值用双引号包裹", async () => {
    const content = makeContent({
      rawData: [{ note: "hello, world" }],
      businessData: [{ 备注: "hello, world" }],
      integrity: undefined,
    });
    const text = (
      await blobToText(
        await renderer.render(content, makeMeta(), {
          includeIntegrity: false,
          includeMeta: false,
          includeRaw: false,
          includeBusiness: true,
        }),
      )
    ).replace(/^\uFEFF/, "");
    const lines = text.split("\n");
    // 数据行应含 "hello, world"(双引号包裹)
    expect(lines[1]).toContain('"hello, world"');
  });
});

// ============================================================================
// 3. XmlRenderer
// ============================================================================

describe("P07 XmlRenderer", () => {
  const renderer = new XmlRenderer();

  test("format 标识为 xml", () => {
    expect(renderer.format).toBe("xml");
  });

  test("输出 application/xml 类型 Blob", async () => {
    const blob = await renderer.render(makeContent(), makeMeta(), {});
    expect(blob.type).toBe("application/xml");
  });

  test("含 XML 声明 + evorule-export 根标签", async () => {
    const text = await blobToText(
      await renderer.render(makeContent(), makeMeta(), {}),
    );
    expect(text.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(text).toContain('<evorule-export type="audit_chain" format="xml">');
    expect(text.trim().endsWith("</evorule-export>")).toBe(true);
  });

  test("默认含 export_meta 标签(含 operator/exported_at 等)", async () => {
    const text = await blobToText(
      await renderer.render(makeContent(), makeMeta(), {}),
    );
    expect(text).toContain("<export_meta>");
    expect(text).toContain("<operator>doctor_wang</operator>");
    expect(text).toContain("<session_id>1</session_id>");
    expect(text).toContain("<ruleset_version>5</ruleset_version>");
    expect(text).toContain("<console_version>0.5.0</console_version>");
  });

  test("integrity 标签含 BLAKE3 属性", async () => {
    const text = await blobToText(
      await renderer.render(makeContent(), makeMeta(), {}),
    );
    expect(text).toContain('<integrity algorithm="BLAKE3"');
    expect(text).toContain('contentHash="abc123def456"');
    expect(text).toContain('chainRoot="root789"');
    expect(text).toContain('factCount="42"');
    expect(text).toContain('verified="true"');
  });

  test("XML 转义:特殊字符 < > & 被转义", async () => {
    const content = makeContent({
      rawData: [{ note: "<script>alert('x')</script>" }],
      businessData: [{ 备注: "a & b < c > d" }],
      integrity: undefined,
    });
    const text = await blobToText(
      await renderer.render(content, makeMeta(), {
        includeIntegrity: false,
        includeMeta: false,
        includeRaw: true,
        includeBusiness: false,
      }),
    );
    // raw 段中 < 应被转义为 &lt;(标签结构除外)
    expect(text).toContain("&lt;script&gt;");
    expect(text).not.toContain("<script>alert");
  });

  test("includeMeta=false 时不输出 export_meta 段", async () => {
    const text = await blobToText(
      await renderer.render(makeContent(), makeMeta(), {
        includeMeta: false,
        includeRaw: true,
        includeBusiness: true,
        includeIntegrity: true,
      }),
    );
    expect(text).not.toContain("<export_meta>");
  });
});

// ============================================================================
// 4. PdfRenderer
// ============================================================================

describe("P07 PdfRenderer", () => {
  test("format 标识为 pdf", () => {
    const r = new PdfRenderer();
    expect(r.format).toBe("pdf");
  });

  test("无 serverBaseUrl 时降级为 text/html(可打印 HTML)", async () => {
    const r = new PdfRenderer();
    const blob = await r.render(makeContent(), makeMeta(), {});
    expect(blob.type).toBe("text/html");
    const text = await blobToText(blob);
    expect(text).toContain("<!DOCTYPE html>");
    expect(text).toContain("window.print()");
  });

  test("降级 HTML 含标题 + meta + integrity 段", async () => {
    const r = new PdfRenderer();
    const text = await blobToText(
      await r.render(
        makeContent(),
        makeMeta({ operator: "test_user" }),
        {
          pdfTitle: "测试报告",
          includeMeta: true,
          includeIntegrity: true,
          includeRaw: true,
          includeBusiness: true,
        },
      ),
    );
    expect(text).toContain("<title>测试报告</title>");
    expect(text).toContain("<h1>测试报告</h1>");
    expect(text).toContain("test_user");
    expect(text).toContain("BLAKE3 完整性证明");
    expect(text).toContain("abc123def456");
  });

  test("降级 HTML 中特殊字符被转义(防 XSS)", async () => {
    const r = new PdfRenderer();
    const text = await blobToText(
      await r.render(
        makeContent({
          rawData: { x: "<img src=x onerror=alert(1)>" },
          integrity: undefined,
        }),
        makeMeta({ operator: "<script>" }),
        {
          includeIntegrity: false,
          includeMeta: true,
          includeRaw: true,
          includeBusiness: false,
        },
      ),
    );
    // operator 中的 <script> 应被转义
    expect(text).not.toContain("<script>alert");
    expect(text).toContain("&lt;script&gt;");
  });

  test("有 serverBaseUrl 时尝试 fetch,失败降级为 HTML", async () => {
    // mock fetch 返回 404
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response("Not Found", { status: 404 })) as typeof fetch;
    try {
      const r = new PdfRenderer("http://localhost:18080");
      const blob = await r.render(makeContent(), makeMeta(), {});
      // 服务端失败,降级为 HTML
      expect(blob.type).toBe("text/html");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("有 serverBaseUrl 且服务端返回 PDF 时返回 PDF Blob", async () => {
    const originalFetch = globalThis.fetch;
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF
    globalThis.fetch = (async () =>
      new Response(pdfBytes, {
        status: 200,
        headers: { "content-type": "application/pdf" },
      })) as typeof fetch;
    try {
      const r = new PdfRenderer("http://localhost:18080");
      const blob = await r.render(makeContent(), makeMeta(), {});
      expect(blob.type).toBe("application/pdf");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // === UV-084 W6:Bearer 认证 + 降级不静默 ===

  test("W6:传入 authToken 时请求携带 Authorization: Bearer 头", async () => {
    const originalFetch = globalThis.fetch;
    let capturedAuth: string | null = null;
    let capturedUrl = "";
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedAuth =
        (init?.headers as Record<string, string>)?.Authorization ?? null;
      return new Response(pdfBytes, {
        status: 200,
        headers: { "content-type": "application/pdf" },
      });
    }) as typeof fetch;
    try {
      const r = new PdfRenderer("http://localhost:18080", "secret-token-123");
      const blob = await r.render(makeContent(), makeMeta(), {});
      expect(blob.type).toBe("application/pdf");
      expect(capturedUrl).toBe("http://localhost:18080/api/export/pdf");
      expect(capturedAuth).toBe("Bearer secret-token-123");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("W6:无 authToken 时请求不带 Authorization 头", async () => {
    const originalFetch = globalThis.fetch;
    let capturedAuth: string | null = "SENTINEL";
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedAuth =
        (init?.headers as Record<string, string>)?.Authorization ?? null;
      return new Response(pdfBytes, {
        status: 200,
        headers: { "content-type": "application/pdf" },
      });
    }) as typeof fetch;
    try {
      const r = new PdfRenderer("http://localhost:18080");
      await r.render(makeContent(), makeMeta(), {});
      expect(capturedAuth).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("W6:服务端失败时 console.warn 透出状态码与 message(不静默降级)", async () => {
    const originalFetch = globalThis.fetch;
    const originalWarn = console.warn;
    const warns: string[] = [];
    console.warn = (...args: unknown[]) => {
      warns.push(args.map(String).join(" "));
    };
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          success: false,
          message: "渲染字体缺少以下字符的字形",
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      )) as typeof fetch;
    try {
      const r = new PdfRenderer("http://localhost:18080");
      const blob = await r.render(makeContent(), makeMeta(), {});
      expect(blob.type).toBe("text/html");
      expect(warns.length).toBeGreaterThan(0);
      expect(warns[0]).toContain("HTTP 400");
      expect(warns[0]).toContain("渲染字体缺少");
      expect(warns[0]).toContain("降级");
    } finally {
      globalThis.fetch = originalFetch;
      console.warn = originalWarn;
    }
  });
});

// ============================================================================
// 5. getRenderer 缓存
// ============================================================================

describe("P07 getRenderer 缓存", () => {
  beforeEach(() => {
    resetRendererCache();
  });

  test("同格式返回缓存实例(不含 pdf)", () => {
    const r1 = getRenderer("json");
    const r2 = getRenderer("json");
    expect(r1).toBe(r2);
    expect(r1.format).toBe("json");
  });

  test("不同格式返回不同渲染器", () => {
    const j = getRenderer("json");
    const c = getRenderer("csv");
    const x = getRenderer("xml");
    expect(j).not.toBe(c);
    expect(j).not.toBe(x);
    expect(c).not.toBe(x);
  });

  test("resetRendererCache 后重建实例", () => {
    const r1 = getRenderer("json");
    resetRendererCache();
    const r2 = getRenderer("json");
    expect(r1).not.toBe(r2);
  });

  test("PdfRenderer 的 serverBaseUrl 变化时重建", () => {
    const p1 = getRenderer("pdf", "http://a:18080");
    const p2 = getRenderer("pdf", "http://b:18080");
    expect(p1).not.toBe(p2);
  });
});
