// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// P07 export-store 单测 — executeExport 主流程 + 模板 CRUD + 后台任务 + 工具函数
//
// 运行: npx vitest run src/lib/stores/__tests__/export-store.test.ts
//
// 关联设计:P07_RESULT_EXPORT_DESIGN.md §3 + §5

import { describe, test, expect, beforeEach, vi } from "vitest";
import { get as storeGet } from "svelte/store";
import type { ExecutionBackend, SessionId } from "$lib/kernel";

// 注:测试在 node 环境运行,$app/environment 的 browser=false。
// exportTemplatesStore 只返回 builtin 模板,downloadBlob 静默返回(不触发 DOM)。
// executeExport 主流程不依赖 browser,可正常测试。

import {
  exportExecutionStore,
  exportTemplatesStore,
  exportJobsStore,
  executeExport,
  executeExportAndDownload,
  addUserTemplate,
  deleteUserTemplate,
  createExportJob,
  updateExportJob,
  shouldUseBackgroundJob,
  downloadBlob,
  resetExportState,
} from "../export-store";
import { createBuiltinTemplates } from "../export-types";
import { businessTermsStore } from "../business-terms";
import { sessionStore } from "../session";
import { productionStateStore } from "../production-state";

// ============================================================================
// Mock backend
// ============================================================================

interface MockAudit {
  entries: Array<{ fact_id: number; type: string; payload: unknown }>;
  fact_count: number;
  last_hash: string;
  verified: boolean;
}

function makeMockBackend(overrides: Partial<MockBackend> = {}): MockBackend {
  const audit: MockAudit = {
    entries: [
      { fact_id: 1, type: "patient_visit", payload: { patient_id: "P001" } },
      { fact_id: 2, type: "rule_triggered", payload: { rule_id: "r1" } },
    ],
    fact_count: 2,
    last_hash: "hash_root_abc",
    verified: true,
  };
  return {
    getReplay: vi.fn(async () => [
      { fact_id: 1, type: "patient_visit", payload: { patient_id: "P001" } },
      { fact_id: 2, type: "rule_triggered", payload: { rule_id: "r1" } },
    ]),
    getAudit: vi.fn(async () => audit),
    // SessionState 必须符合 $lib/kernel 契约:{ payload, queue, reactor, version }
    // reactor 字段对齐 ReactorState:phase/causal_depth/current_step/pending_io_count/
    // structural_invariant_violations(2 条 Fact → current_step=2, phase=stable)。
    // 旧实现返回 { status:"running", version:5 } —— 形状错误且 status 是 stale reactor 字段。
    getSessionState: vi.fn(async () => ({
      payload: { active_rules: ["r1"] },
      queue: [],
      reactor: {
        phase: "stable",
        causal_depth: 1,
        current_step: 2,
        pending_io_count: 0,
        structural_invariant_violations: 0,
      },
      version: 5,
    })),
    getCausalChain: vi.fn(async () => ({
      chain: [{ fact_id: 1, parent_ids: [], type: "patient_visit" }],
    })),
    verifyAudit: vi.fn(async () => ({ verified: true, detail: "ok" })),
    ...overrides,
  };
}

interface MockBackend {
  getReplay: ReturnType<typeof vi.fn>;
  getAudit: ReturnType<typeof vi.fn>;
  getSessionState: ReturnType<typeof vi.fn>;
  getCausalChain: ReturnType<typeof vi.fn>;
  verifyAudit: ReturnType<typeof vi.fn>;
}

function asBackend(m: MockBackend): ExecutionBackend {
  return m as unknown as ExecutionBackend;
}

// ============================================================================
// 共享 setup
// ============================================================================

beforeEach(() => {
  // 重置 store
  resetExportState();
  exportJobsStore.set([]);
  // 重置模板为 builtin(避免测试间状态污染 + id 冲突)
  exportTemplatesStore.set(createBuiltinTemplates());
  // 重置依赖 store
  sessionStore.set({
    loggedIn: true,
    userId: "u1",
    username: "tester",
    loginAt: Date.now(),
  });
  productionStateStore.set({
    status: "running",
    currentSessionId: 1,
    rulesetVersion: 5,
    rulesetHash: "hash123",
    updatedAt: "2026-08-07T10:00:00Z",
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
      id: "medical.rule_id",
      industry: "medical",
      label: "规则ID",
      key: "rule_id",
      synonyms: ["规则"],
      description: "触发的规则标识",
      status: "active",
      version: 1,
    },
  ]);
});

// ============================================================================
// 1. executeExport 主流程
// ============================================================================

describe("P07 executeExport — 主流程", () => {
  test("audit_chain + json:成功导出并返回 blob + filename", async () => {
    const backend = asBackend(makeMockBackend());
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
        includeMeta: true,
      },
    );
    expect(result).not.toBeNull();
    expect(result!.blob.type).toBe("application/json");
    expect(result!.filename).toMatch(/^evorule-audit_chain-.+\.json$/);
    // 解析 JSON 校验内容
    const text = await result!.blob.text();
    const parsed = JSON.parse(text);
    expect(parsed.export_meta.operator).toBe("tester");
    expect(parsed.integrity.algorithm).toBe("BLAKE3");
    expect(parsed.integrity.content_hash).toBe("hash_root_abc");
    expect(parsed.integrity.audit_chain_verified).toBe(true);
  });

  test("fact_stream + csv:从 getReplay 拉取数据", async () => {
    const backend = asBackend(makeMockBackend());
    const result = await executeExport(
      backend,
      1 as SessionId,
      "fact_stream",
      "csv",
      { timeRange: { kind: "all" } },
      { includeRaw: true, includeBusiness: true },
    );
    expect(result).not.toBeNull();
    expect(result!.blob.type).toBe("text/csv;charset=utf-8");
    expect(backend.getReplay).toHaveBeenCalledWith(1, undefined, null);
    const text = (await result!.blob.text()).replace(/^\uFEFF/, "");
    // CSV 含业务化字段(病人ID)
    expect(text).toContain("病人ID");
  });

  test("comprehensive:并行调用 getAudit + getSessionState + getReplay", async () => {
    const backend = asBackend(makeMockBackend());
    const result = await executeExport(
      backend,
      1 as SessionId,
      "comprehensive",
      "json",
      { timeRange: { kind: "all" } },
      { includeRaw: true, includeBusiness: true, includeIntegrity: true },
    );
    expect(result).not.toBeNull();
    expect(backend.getAudit).toHaveBeenCalledWith(1);
    expect(backend.getSessionState).toHaveBeenCalledWith(1);
    expect(backend.getReplay).toHaveBeenCalled();
    const parsed = JSON.parse(await result!.blob.text());
    expect(parsed.data.raw.audit_chain).toBeDefined();
    expect(parsed.data.raw.state_snapshot).toBeDefined();
    expect(parsed.data.raw.fact_stream).toBeDefined();
  });

  test("causal_chain:从 getAudit 取首条 fact_id 再查因果", async () => {
    const backend = asBackend(makeMockBackend());
    const result = await executeExport(
      backend,
      1 as SessionId,
      "causal_chain",
      "json",
      { timeRange: { kind: "all" } },
      { includeRaw: true, includeBusiness: true },
    );
    expect(result).not.toBeNull();
    // 应先调 getAudit 取 firstFactId=1,再调 getCausalChain(1, 1)
    expect(backend.getCausalChain).toHaveBeenCalledWith(1, 1);
  });

  test("backend 抛错时返回 null + 设置 error 状态", async () => {
    const backend = asBackend(
      makeMockBackend({
        getAudit: vi.fn(async () => {
          throw new Error("network error");
        }),
      }),
    );
    const result = await executeExport(
      backend,
      1 as SessionId,
      "audit_chain",
      "json",
      { timeRange: { kind: "all" } },
      {},
    );
    expect(result).toBeNull();
    const state = storeGet(exportExecutionStore);
    expect(state.error).toContain("network error");
    expect(state.exporting).toBe(false);
  });

  test("导出完成后 exporting 状态归位 + lastFilename 记录", async () => {
    const backend = asBackend(makeMockBackend());
    await executeExport(
      backend,
      1 as SessionId,
      "audit_chain",
      "json",
      { timeRange: { kind: "all" } },
      {},
    );
    const state = storeGet(exportExecutionStore);
    expect(state.exporting).toBe(false);
    expect(state.lastFilename).toMatch(/\.json$/);
  });
});

// ============================================================================
// 2. executeExportAndDownload
// ============================================================================

describe("P07 executeExportAndDownload", () => {
  test("成功时记录 lastFilename(node 环境 browser=false 不触发 DOM 下载)", async () => {
    const backend = asBackend(makeMockBackend());
    await executeExportAndDownload(
      backend,
      1 as SessionId,
      "audit_chain",
      "json",
      { timeRange: { kind: "all" } },
      {},
    );
    const state = storeGet(exportExecutionStore);
    expect(state.exporting).toBe(false);
    expect(state.lastFilename).toMatch(/\.json$/);
    expect(state.error).toBeNull();
  });

  test("失败时设置 error 状态 + lastFilename 不更新", async () => {
    const backend = asBackend(
      makeMockBackend({
        getAudit: vi.fn(async () => {
          throw new Error("fail");
        }),
      }),
    );
    await executeExportAndDownload(
      backend,
      1 as SessionId,
      "audit_chain",
      "json",
      { timeRange: { kind: "all" } },
      {},
    );
    const state = storeGet(exportExecutionStore);
    expect(state.error).toContain("fail");
  });
});

// ============================================================================
// 3. 模板 CRUD
// ============================================================================

describe("P07 模板 CRUD", () => {
  test("初始模板列表含 3 个 builtin", () => {
    const templates = storeGet(exportTemplatesStore);
    expect(templates.length).toBeGreaterThanOrEqual(3);
    expect(templates.filter((t) => t.source === "builtin")).toHaveLength(3);
  });

  test("addUserTemplate 添加自定义模板(source=user)", () => {
    const before = storeGet(exportTemplatesStore).length;
    const id = addUserTemplate({
      name: "测试模板",
      description: "单测用",
      content: { contents: ["audit_chain"], filters: {} },
      format: "json",
      renderOptions: { includeRaw: true },
    });
    expect(id).toMatch(/^user\./);
    const after = storeGet(exportTemplatesStore);
    expect(after.length).toBe(before + 1);
    const added = after.find((t) => t.id === id);
    expect(added).toBeDefined();
    expect(added!.source).toBe("user");
    expect(added!.name).toBe("测试模板");
  });

  test("deleteUserTemplate 删除 user 模板", () => {
    const id = addUserTemplate({
      name: "待删除",
      description: "",
      content: { contents: ["fact_stream"], filters: {} },
      format: "csv",
    });
    const before = storeGet(exportTemplatesStore).length;
    deleteUserTemplate(id);
    const after = storeGet(exportTemplatesStore);
    expect(after.length).toBe(before - 1);
    expect(after.find((t) => t.id === id)).toBeUndefined();
  });

  test("deleteUserTemplate 拒绝删除 builtin 模板", () => {
    expect(() => deleteUserTemplate("builtin.compliance_report")).toThrow();
  });
});

// ============================================================================
// 4. 后台任务 + 工具函数
// ============================================================================

describe("P07 后台任务工具", () => {
  test("createExportJob 创建 queued 任务并返回 jobId", () => {
    const jobId = createExportJob("audit_chain", "json");
    expect(jobId).toMatch(/^job-/);
    const jobs = storeGet(exportJobsStore);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].status).toBe("queued");
    expect(jobs[0].contentType).toBe("audit_chain");
    expect(jobs[0].format).toBe("json");
  });

  test("updateExportJob 更新任务状态", () => {
    const jobId = createExportJob("fact_stream", "csv");
    updateExportJob(jobId, { status: "running", progress: 50, message: "处理中" });
    const job = storeGet(exportJobsStore).find((j) => j.jobId === jobId);
    expect(job?.status).toBe("running");
    expect(job?.progress).toBe(50);
    expect(job?.message).toBe("处理中");
  });

  test("shouldUseBackgroundJob:Fact 数超阈值返回 true", () => {
    expect(shouldUseBackgroundJob(5000, 0)).toBe(true);
    expect(shouldUseBackgroundJob(4999, 0)).toBe(false);
  });

  test("shouldUseBackgroundJob:字节数超阈值返回 true", () => {
    expect(shouldUseBackgroundJob(0, 10 * 1024 * 1024)).toBe(true);
    expect(shouldUseBackgroundJob(0, 10 * 1024 * 1024 - 1)).toBe(false);
  });
});

// ============================================================================
// 5. downloadBlob(浏览器侧)
// ============================================================================

describe("P07 downloadBlob", () => {
  test("node 环境(browser=false)静默返回不抛错", () => {
    // browser=false 时 downloadBlob 直接 return,不访问 document/URL
    expect(() => downloadBlob(new Blob(["x"]), "test.json")).not.toThrow();
  });
});
