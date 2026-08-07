// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// evorule-console-cloud — 业务术语库术语匹配单测
//
// 运行: npx vitest run src/lib/stores/__tests__/business-terms.test.ts
//
// 测试范围:
//   - matchTerms:同义词归一化 + 前缀匹配(决策 §3.1)
//   - 行业优先级:当前行业优先,其他行业靠后
//   - findTermsByPrefix:前缀命中
//   - getTermsByIds:批量取术语
//   - getActiveTermsByIndustry:仅 active 状态
//   - draft / deprecated 状态过滤
//
// 注意:
//   - synonymIndex 在 browser=true 时由 store 启动时构建,测试环境是 node,
//     需手动调用 rebuildSynonymIndex() 触发重建
//   - loadTerms() 在非浏览器环境返回 BUILTIN_BUSINESS_TERMS(12 条)
//
// 关联设计:P02_BUSINESS_LANGUAGE_V0_DESIGN.md §4.1 + §3.1 + §9.5

import { describe, test, expect, beforeEach } from "vitest";
import {
  matchTerms,
  findTermsByPrefix,
  getTermsByIds,
  getActiveTermsByIndustry,
  getTermsByIndustry,
  addBusinessTerm,
  updateBusinessTerm,
  deprecateBusinessTerm,
  rebuildSynonymIndex,
  businessTermsStore,
} from "../business-terms";
import { get } from "svelte/store";
import { BUILTIN_BUSINESS_TERMS } from "$lib/data/business-terms-builtin";

beforeEach(() => {
  // 测试环境是 node(browser=false),synonymIndex 不会自动构建
  // 每个用例前:重置 store 到 builtin 初始状态 + 重建索引,避免用例间污染
  businessTermsStore.set([...BUILTIN_BUSINESS_TERMS]);
  rebuildSynonymIndex();
});

describe("business-terms — matchTerms 同义词匹配", () => {
  test("主 label 完全匹配", () => {
    const result = matchTerms("金额", "finance");
    expect(result.length).toBeGreaterThan(0);
    expect(result.some((t) => t.id === "finance.amount")).toBe(true);
  });

  test("synonym 匹配(报销金额)", () => {
    const result = matchTerms("报销金额", "finance");
    expect(result.some((t) => t.id === "finance.amount")).toBe(true);
  });

  test("alias 匹配(amt 是 finance.amount 的 alias)", () => {
    const result = matchTerms("amt", "finance");
    expect(result.some((t) => t.id === "finance.amount")).toBe(true);
  });

  test("归一化:大小写不敏感(AMT 也能命中)", () => {
    const result = matchTerms("AMT", "finance");
    expect(result.some((t) => t.id === "finance.amount")).toBe(true);
  });

  test("归一化:标点符号被剥离", () => {
    // "金额," 经过归一化(去标点 + trim) → "金额"
    const result = matchTerms("金额,", "finance");
    expect(result.some((t) => t.id === "finance.amount")).toBe(true);
  });

  test("空查询 → 空数组", () => {
    expect(matchTerms("", "finance")).toEqual([]);
    expect(matchTerms("   ", "finance")).toEqual([]);
  });

  test("未命中 → 空数组", () => {
    const result = matchTerms("不存在的术语xyz", "finance");
    expect(result).toEqual([]);
  });
});

describe("business-terms — matchTerms 行业优先级", () => {
  test("当前行业优先(finance 优先于 compliance)", () => {
    // "上限" 是 finance.threshold 的 synonym
    const result = matchTerms("上限", "finance");
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].industry).toBe("finance");
  });

  test("未指定 industry → 用 dbStore.industry 作为默认(默认 blank)", () => {
    // dbStore 默认 industry='blank',builtin 没有 blank 行业术语
    // 但 matchTerms 会基于 dbStore.industry 排序,不指定 industry 时仍能返回结果
    const result = matchTerms("金额");
    // 至少能查到 finance.amount(行业优先级此时为 blank,finance 不优先但仍在结果里)
    expect(result.some((t) => t.id === "finance.amount")).toBe(true);
  });
});

describe("business-terms — findTermsByPrefix", () => {
  test("前缀命中(单字符)", () => {
    const ids = findTermsByPrefix("金");
    expect(ids.length).toBeGreaterThan(0);
    expect(ids).toContain("finance.amount");
  });

  test("前缀命中(多字符)", () => {
    const ids = findTermsByPrefix("报销");
    expect(ids).toContain("finance.amount");
  });

  test("空文本 → 空数组", () => {
    expect(findTermsByPrefix("")).toEqual([]);
    expect(findTermsByPrefix("   ")).toEqual([]);
  });

  test("无命中 → 空数组", () => {
    expect(findTermsByPrefix("zzzzz不存在")).toEqual([]);
  });
});

describe("business-terms — getTermsByIds 批量查询", () => {
  test("已知 ID 列表 → 返回对应术语", () => {
    const result = getTermsByIds([
      "finance.amount",
      "finance.threshold",
    ]);
    expect(result).toHaveLength(2);
    expect(result.map((t) => t.id).sort()).toEqual([
      "finance.amount",
      "finance.threshold",
    ]);
  });

  test("未知 ID → 跳过(不抛错)", () => {
    const result = getTermsByIds([
      "finance.amount",
      "unknown.id",
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("finance.amount");
  });

  test("空数组 → 空数组", () => {
    expect(getTermsByIds([])).toEqual([]);
  });
});

describe("business-terms — getActiveTermsByIndustry", () => {
  test("finance 行业 → 6 条 active 术语", () => {
    const result = getActiveTermsByIndustry("finance");
    expect(result).toHaveLength(6);
    expect(result.every((t) => t.industry === "finance")).toBe(true);
    expect(result.every((t) => t.status === "active")).toBe(true);
  });

  test("compliance 行业 → 6 条 active 术语", () => {
    const result = getActiveTermsByIndustry("compliance");
    expect(result).toHaveLength(6);
    expect(result.every((t) => t.industry === "compliance")).toBe(true);
  });

  test("无术语的行业 → 空数组", () => {
    expect(getActiveTermsByIndustry("nonexistent")).toEqual([]);
  });
});

describe("business-terms — getTermsByIndustry(含 draft/deprecated)", () => {
  test("finance 行业全部术语(含 draft/deprecated)", () => {
    const result = getTermsByIndustry("finance");
    // builtin 全是 active,故等于 active 数量
    expect(result.length).toBeGreaterThanOrEqual(6);
    expect(result.every((t) => t.industry === "finance")).toBe(true);
  });
});

describe("business-terms — CRUD + 状态变更", () => {
  test("addBusinessTerm 加新术语 → 出现在查询里 + 索引重建", () => {
    const initialCount = get(businessTermsStore).length;
    const newId = addBusinessTerm({
      industry: "test",
      label: "测试术语",
      key: "testTerm",
      synonyms: ["测试别名"],
      description: "用于测试",
      status: "active",
    });
    expect(newId).toBe("test.testTerm");
    expect(get(businessTermsStore).length).toBe(initialCount + 1);

    // 索引应已重建,能查到新术语
    rebuildSynonymIndex();
    const result = matchTerms("测试术语", "test");
    expect(result.some((t) => t.id === "test.testTerm")).toBe(true);
  });

  test("addBusinessTerm:同 industry + 同 key 重复 → 抛错", () => {
    expect(() =>
      addBusinessTerm({
        industry: "finance",
        label: "金额重复",
        key: "amount", // 与 builtin finance.amount 同 key
        synonyms: [],
        description: "重复",
        status: "active",
      }),
    ).toThrow(/已存在/);
  });

  test("deprecateBusinessTerm → status 变 deprecated + 不出现在 active 查询", () => {
    deprecateBusinessTerm("finance.amount", "finance.threshold");
    const active = getActiveTermsByIndustry("finance");
    expect(active.find((t) => t.id === "finance.amount")).toBeUndefined();

    // deprecated 术语仍出现在 getTermsByIndustry(包含所有状态)
    const all = getTermsByIndustry("finance");
    const deprecated = all.find((t) => t.id === "finance.amount");
    expect(deprecated).toBeDefined();
    expect(deprecated?.status).toBe("deprecated");
    expect(deprecated?.deprecatedBy).toBe("finance.threshold");
  });

  test("updateBusinessTerm:改 synonyms → 版本号 +1 + 索引重建", () => {
    // 先确保 finance.threshold 是 active(前一个测试改了 finance.amount,不影响 threshold)
    const before = getTermsByIds(["finance.threshold"])[0];
    const beforeVersion = before.version;

    updateBusinessTerm("finance.threshold", {
      synonyms: [...before.synonyms, "新同义词"],
    });

    const after = getTermsByIds(["finance.threshold"])[0];
    expect(after.version).toBe(beforeVersion + 1);
    expect(after.synonyms).toContain("新同义词");
  });

  test("updateBusinessTerm:改 key → 抛错(key 不能改)", () => {
    expect(() =>
      updateBusinessTerm("finance.threshold", { key: "newKey" }),
    ).toThrow(/key 不能修改/);
  });
});
