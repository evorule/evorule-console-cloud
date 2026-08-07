// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// impact-preview 单测 — matchRule 规则匹配 + computeImpactPreview
//
// 运行: npx vitest run src/lib/stores/__tests__/impact-preview.test.ts
//
// 关联设计:P04_BUSINESS_EXECUTION_PAD_DESIGN.md §5.4 + §7.3(影响预览流)
//
// mock @evorule/console 的 getAllRules,控制内核规则库状态。

import { describe, test, expect, vi, beforeEach } from "vitest";

const { mockGetAllRules } = vi.hoisted(() => ({
  mockGetAllRules: vi.fn(),
}));
vi.mock("@evorule/console", () => ({
  getAllRules: mockGetAllRules,
}));

import {
  matchRule,
  computeImpactPreview,
  computeImpactPreviewForRules,
} from "../impact-preview";
import type { Rule } from "@evorule/console";

/** 构造测试规则 */
function makeRule(id: string, content: object, description = ""): Rule {
  return {
    id,
    version: 1,
    description,
    content: JSON.stringify(content),
    source: "user",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

beforeEach(() => {
  mockGetAllRules.mockReset();
});

// ============================================================================
// matchRule - 单条规则匹配
// ============================================================================

describe("matchRule - 字段名匹配", () => {
  test("payload 字段名与规则字段重叠 → matched=true", () => {
    const rule = makeRule("r1", { temperature: 38, threshold: 37.5 });
    const instruction = { payload: { temperature: 39.2, patientId: "P-1" } };

    const result = matchRule(rule, instruction);

    expect(result.matched).toBe(true);
    expect(result.matchedFields).toEqual(["temperature"]);
    expect(result.ruleId).toBe("r1");
  });

  test("多个字段重叠 → matchedFields 含全部重叠字段", () => {
    const rule = makeRule("r1", { temperature: 38, age: 65, threshold: 37.5 });
    const instruction = {
      payload: { temperature: 39.2, age: 70, drugName: "Aspirin" },
    };

    const result = matchRule(rule, instruction);

    expect(result.matched).toBe(true);
    expect(result.matchedFields).toEqual(["temperature", "age"]);
  });

  test("无字段重叠 → matched=false", () => {
    const rule = makeRule("r1", { threshold: 37.5, maxAge: 150 });
    const instruction = { payload: { patientId: "P-1", symptom: "fever" } };

    const result = matchRule(rule, instruction);

    expect(result.matched).toBe(false);
    expect(result.matchedFields).toEqual([]);
  });

  test("instruction 无 payload → matched=false", () => {
    const rule = makeRule("r1", { temperature: 38 });
    const instruction = { domain: "medical", action: "patient_visit" };

    const result = matchRule(rule, instruction);

    expect(result.matched).toBe(false);
  });

  test("规则 content 的 id 字段被排除(不参与匹配)", () => {
    const rule = makeRule("r1", { id: "fever_rule", temperature: 38 });
    const instruction = { payload: { id: "evt-1", temperature: 39 } };

    const result = matchRule(rule, instruction);

    // id 字段不参与匹配,只 temperature 重叠
    expect(result.matchedFields).toEqual(["temperature"]);
  });
});

describe("matchRule - expectedFactType", () => {
  test("规则 content 有 action 字段 → expectedFactType = action 值", () => {
    const rule = makeRule("r1", { action: "patient_visit", temperature: 38 });
    const instruction = { payload: { temperature: 39 } };

    const result = matchRule(rule, instruction);

    expect(result.expectedFactType).toBe("patient_visit");
  });

  test("规则 content 无 action 字段 → expectedFactType = 'unknown'", () => {
    const rule = makeRule("r1", { temperature: 38 });
    const instruction = { payload: { temperature: 39 } };

    const result = matchRule(rule, instruction);

    expect(result.expectedFactType).toBe("unknown");
  });

  test("规则 content action 非 string → expectedFactType = 'unknown'", () => {
    const rule = makeRule("r1", { action: 123, temperature: 38 });
    const instruction = { payload: { temperature: 39 } };

    const result = matchRule(rule, instruction);

    expect(result.expectedFactType).toBe("unknown");
  });
});

describe("matchRule - 容错", () => {
  test("规则 content 非法 JSON → matched=false,不抛错", () => {
    const rule: Rule = {
      ...makeRule("r1", {}),
      content: "{invalid json}",
    };
    const instruction = { payload: { temperature: 39 } };

    const result = matchRule(rule, instruction);

    expect(result.matched).toBe(false);
    expect(result.matchedFields).toEqual([]);
    expect(result.expectedFactType).toBe("unknown");
    expect(result.ruleId).toBe("r1");
  });

  test("规则描述透传到结果", () => {
    const rule = makeRule("r1", { temperature: 38 }, "发烧处理规则");
    const instruction = { payload: { temperature: 39 } };

    const result = matchRule(rule, instruction);

    expect(result.ruleDescription).toBe("发烧处理规则");
  });
});

// ============================================================================
// computeImpactPreview - 全库预览
// ============================================================================

describe("computeImpactPreview", () => {
  test("遍历全库,统计匹配/不匹配数", () => {
    mockGetAllRules.mockReturnValue([
      makeRule("r1", { temperature: 38 }, "发烧规则"),
      makeRule("r2", { age: 65 }, "老年规则"),
      makeRule("r3", { drugName: "x" }, "用药规则"),
    ]);

    const instruction = { payload: { temperature: 39.2, age: 70 } };
    const preview = computeImpactPreview(instruction);

    expect(preview.matches).toHaveLength(3);
    expect(preview.matchedCount).toBe(2); // r1, r2 匹配
    expect(preview.unmatchedCount).toBe(1); // r3 不匹配
    expect(preview.confidence).toBe("low");
    expect(preview.generatedAt).toBeTruthy();
  });

  test("空规则库 → 0 匹配", () => {
    mockGetAllRules.mockReturnValue([]);
    const preview = computeImpactPreview({ payload: { x: 1 } });
    expect(preview.matches).toEqual([]);
    expect(preview.matchedCount).toBe(0);
    expect(preview.unmatchedCount).toBe(0);
  });

  test("调用 getAllRules 获取规则", () => {
    mockGetAllRules.mockReturnValue([]);
    computeImpactPreview({ payload: {} });
    expect(mockGetAllRules).toHaveBeenCalledTimes(1);
  });
});

describe("computeImpactPreviewForRules - 指定规则子集", () => {
  test("只对传入的规则列表做匹配(数据集场景)", () => {
    const rules = [
      makeRule("r1", { temperature: 38 }),
      makeRule("r2", { amount: 100 }),
    ];

    const instruction = { payload: { temperature: 39 } };
    const preview = computeImpactPreviewForRules(instruction, rules);

    expect(preview.matches).toHaveLength(2);
    expect(preview.matchedCount).toBe(1); // 只 r1 匹配
    expect(preview.unmatchedCount).toBe(1);
  });

  test("空规则列表 → 0 匹配", () => {
    const preview = computeImpactPreviewForRules({ payload: {} }, []);
    expect(preview.matches).toEqual([]);
    expect(preview.matchedCount).toBe(0);
  });
});
