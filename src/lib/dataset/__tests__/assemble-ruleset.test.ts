// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// assemble-ruleset 单测 — 规则集组装 + 参数覆盖 + 缺失规则跳过
//
// 运行: npx vitest run src/lib/dataset/__tests__/assemble-ruleset.test.ts
//
// 关联设计:P03_DATASET_DESIGN.md §8.2 + §9.1(assembleRuleset 测试)
//
// mock @evorule/console 的 getAllRules,控制内核规则库状态。

import { describe, test, expect, vi, beforeEach } from "vitest";

// mock 内核 getAllRules(用 vi.hoisted 保证 mock 变量在工厂执行前已初始化)
const { mockGetAllRules } = vi.hoisted(() => ({
  mockGetAllRules: vi.fn(),
}));
vi.mock("@evorule/console", () => ({
  getAllRules: mockGetAllRules,
}));

import { assembleRuleset, assembleSingleRule } from "../assemble-ruleset";
import type { Dataset } from "$lib/stores/dataset-types";
import type { Rule } from "@evorule/console";

/** 构造测试规则 */
function makeRule(
  id: string,
  content: object,
  source: "builtin" | "user" = "user",
): Rule {
  return {
    id,
    version: 1,
    description: `规则 ${id}`,
    content: JSON.stringify(content, null, 2),
    source,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

/** 构造测试数据集 */
function makeDataset(
  ruleIds: string[],
  paramOverrides: Dataset["paramOverrides"] = [],
): Dataset {
  return {
    id: "ds_test",
    name: "测试数据集",
    description: "",
    ruleIds,
    paramOverrides,
    tagIds: [],
    categoryId: null,
    status: "draft",
    workspaceId: "default",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    lastTestedAt: null,
    publishedVersion: null,
  };
}

beforeEach(() => {
  mockGetAllRules.mockReset();
});

describe("assembleRuleset - 基本组装", () => {
  test("无参数覆盖 → 返回原始 content 数组", () => {
    mockGetAllRules.mockReturnValue([
      makeRule("r1", { threshold: 100 }),
      makeRule("r2", { threshold: 200 }),
    ]);

    const ds = makeDataset(["r1", "r2"]);
    const result = assembleRuleset(ds);

    expect(result.ruleset).toHaveLength(2);
    expect(JSON.parse(result.ruleset[0])).toEqual({ threshold: 100 });
    expect(JSON.parse(result.ruleset[1])).toEqual({ threshold: 200 });
    expect(result.skippedRuleIds).toEqual([]);
    expect(result.overriddenRuleIds).toEqual([]);
  });

  test("空 ruleIds → 空 ruleset", () => {
    mockGetAllRules.mockReturnValue([]);
    const ds = makeDataset([]);
    const result = assembleRuleset(ds);
    expect(result.ruleset).toEqual([]);
    expect(result.skippedRuleIds).toEqual([]);
  });

  test("保留 ruleIds 顺序", () => {
    mockGetAllRules.mockReturnValue([
      makeRule("r1", { n: 1 }),
      makeRule("r2", { n: 2 }),
      makeRule("r3", { n: 3 }),
    ]);
    const ds = makeDataset(["r3", "r1", "r2"]);
    const result = assembleRuleset(ds);
    expect(result.ruleset.map((r) => JSON.parse(r).n)).toEqual([3, 1, 2]);
  });
});

describe("assembleRuleset - 参数覆盖", () => {
  test("应用 JSON Patch 覆盖参数", () => {
    mockGetAllRules.mockReturnValue([
      makeRule("r1", { params: { threshold: 37.5 } }),
    ]);

    const ds = makeDataset(["r1"], [
      {
        ruleId: "r1",
        patch: [{ op: "replace", path: "/params/threshold", value: 38 }],
      },
    ]);

    const result = assembleRuleset(ds);

    expect(result.overriddenRuleIds).toEqual(["r1"]);
    expect(JSON.parse(result.ruleset[0]).params.threshold).toBe(38);
  });

  test("仅对有覆盖的规则应用 patch,其他规则保持原样", () => {
    mockGetAllRules.mockReturnValue([
      makeRule("r1", { params: { threshold: 100 } }),
      makeRule("r2", { params: { threshold: 200 } }),
    ]);

    const ds = makeDataset(["r1", "r2"], [
      {
        ruleId: "r1",
        patch: [{ op: "replace", path: "/params/threshold", value: 999 }],
      },
    ]);

    const result = assembleRuleset(ds);

    expect(result.overriddenRuleIds).toEqual(["r1"]);
    expect(JSON.parse(result.ruleset[0]).params.threshold).toBe(999);
    expect(JSON.parse(result.ruleset[1]).params.threshold).toBe(200); // 原样
  });

  test("空 patch 数组 → 不应用覆盖(视为无覆盖)", () => {
    mockGetAllRules.mockReturnValue([
      makeRule("r1", { threshold: 100 }),
    ]);

    const ds = makeDataset(["r1"], [
      { ruleId: "r1", patch: [] },
    ]);

    const result = assembleRuleset(ds);
    expect(result.overriddenRuleIds).toEqual([]);
    expect(JSON.parse(result.ruleset[0]).threshold).toBe(100);
  });

  test("覆盖 ruleId 不在 ruleIds 中 → 忽略(不报错)", () => {
    mockGetAllRules.mockReturnValue([
      makeRule("r1", { threshold: 100 }),
    ]);

    const ds = makeDataset(["r1"], [
      {
        ruleId: "r_orphan",
        patch: [{ op: "replace", path: "/threshold", value: 999 }],
      },
    ]);

    const result = assembleRuleset(ds);
    expect(result.overriddenRuleIds).toEqual([]);
    expect(JSON.parse(result.ruleset[0]).threshold).toBe(100);
  });
});

describe("assembleRuleset - 缺失规则跳过", () => {
  test("规则库中不存在的 ruleId → 跳过并记录", () => {
    mockGetAllRules.mockReturnValue([makeRule("r1", { n: 1 })]);

    const ds = makeDataset(["r1", "r_missing", "r2"]);
    const result = assembleRuleset(ds);

    expect(result.ruleset).toHaveLength(1); // 只组装到 r1
    expect(result.skippedRuleIds).toEqual(["r_missing", "r2"]);
  });

  test("全部规则缺失 → 空 ruleset + 全部记录", () => {
    mockGetAllRules.mockReturnValue([]);

    const ds = makeDataset(["r1", "r2"]);
    const result = assembleRuleset(ds);

    expect(result.ruleset).toEqual([]);
    expect(result.skippedRuleIds).toEqual(["r1", "r2"]);
  });
});

describe("assembleSingleRule", () => {
  test("返回单条规则(无覆盖)", () => {
    mockGetAllRules.mockReturnValue([makeRule("r1", { threshold: 100 })]);

    const ds = makeDataset(["r1"]);
    const content = assembleSingleRule(ds, "r1");

    expect(content).not.toBeNull();
    expect(JSON.parse(content!).threshold).toBe(100);
  });

  test("返回单条规则(应用覆盖)", () => {
    mockGetAllRules.mockReturnValue([makeRule("r1", { threshold: 100 })]);

    const ds = makeDataset(["r1"], [
      {
        ruleId: "r1",
        patch: [{ op: "replace", path: "/threshold", value: 200 }],
      },
    ]);
    const content = assembleSingleRule(ds, "r1");

    expect(JSON.parse(content!).threshold).toBe(200);
  });

  test("规则不存在 → 返回 null", () => {
    mockGetAllRules.mockReturnValue([]);
    const ds = makeDataset(["r1"]);
    expect(assembleSingleRule(ds, "r1")).toBeNull();
  });
});
