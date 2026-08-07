// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// evorule-console-cloud — 自动补全规则业务术语关联单测
//
// 运行: npx vitest run src/lib/views/Rules/__tests__/auto-fill-terms.test.ts
//
// 测试范围:
//   - 字段有 termId + 用户填值 → 加入结果
//   - 字段有 termId + 用户未填值 → 不加入
//   - 字段无 termId → 跳过
//   - existingTermIds 合并去重
//   - 空字符串 / null / undefined 视为未填
//
// 关联设计:P02_BUSINESS_LANGUAGE_V0_DESIGN.md §9.5

import { describe, test, expect } from "vitest";
import { autoFillTermIds } from "../auto-fill-terms";
import type { BusinessFormSchema } from "$lib/stores/business-form-schema";

const TEST_SCHEMA: BusinessFormSchema = {
  id: "test.schema",
  industry: "test",
  scenario: "测试 schema",
  version: 1,
  fields: [
    {
      id: "amount",
      label: "金额",
      type: "number",
      evorulePath: "condition.value",
      description: "金额",
      group: "condition",
      termId: "finance.amount",
    },
    {
      id: "approver",
      label: "审批人",
      type: "string",
      evorulePath: "action.params.role",
      description: "审批人",
      group: "action",
      termId: "finance.approver",
    },
    {
      id: "noTermField",
      label: "无术语字段",
      type: "string",
      evorulePath: "action.params.note",
      description: "无 termId",
      group: "action",
      // 故意不设 termId
    },
  ],
};

describe("auto-fill-terms — autoFillTermIds", () => {
  test("用户填了值的字段 → 对应 termId 加入结果", () => {
    const result = autoFillTermIds(
      TEST_SCHEMA,
      { amount: 10000, approver: "CFO" },
      [],
    );
    expect(result.sort()).toEqual(["finance.amount", "finance.approver"]);
  });

  test("字段无 termId → 跳过(即使填了值)", () => {
    const result = autoFillTermIds(
      TEST_SCHEMA,
      { amount: 10000, noTermField: "some note" },
      [],
    );
    expect(result).toEqual(["finance.amount"]);
  });

  test("用户未填值的字段 → termId 不加入", () => {
    const result = autoFillTermIds(
      TEST_SCHEMA,
      { amount: 10000 }, // approver 未填
      [],
    );
    expect(result).toEqual(["finance.amount"]);
  });

  test("空字符串视为未填 → 不加入", () => {
    const result = autoFillTermIds(
      TEST_SCHEMA,
      { amount: 10000, approver: "" },
      [],
    );
    expect(result).toEqual(["finance.amount"]);
  });

  test("null/undefined 视为未填 → 不加入", () => {
    const result = autoFillTermIds(
      TEST_SCHEMA,
      {
        amount: null as unknown as number,
        approver: undefined,
      } as unknown as Record<string, string | number | boolean>,
      [],
    );
    expect(result).toEqual([]);
  });

  test("existingTermIds 合并去重", () => {
    const result = autoFillTermIds(
      TEST_SCHEMA,
      { amount: 10000, approver: "CFO" },
      ["finance.amount", "finance.threshold"], // 已含 amount,补全应去重
    );
    expect(result.sort()).toEqual([
      "finance.amount",
      "finance.approver",
      "finance.threshold",
    ]);
  });

  test("空 formValues + 空 existingTermIds → 空数组", () => {
    const result = autoFillTermIds(TEST_SCHEMA, {}, []);
    expect(result).toEqual([]);
  });

  test("boolean false 视为已填(业务语义:主动选 false)", () => {
    // 测试 schema 没有 boolean 字段,临时构造
    const schema: BusinessFormSchema = {
      id: "test.bool",
      industry: "test",
      scenario: "bool 测试",
      version: 1,
      fields: [
        {
          id: "flag",
          label: "标记",
          type: "boolean",
          evorulePath: "condition.value",
          description: "bool 标记",
          group: "condition",
          termId: "test.flag",
        },
      ],
    };
    // false 是有效业务值,应被加入
    const result = autoFillTermIds(schema, { flag: false }, []);
    expect(result).toEqual(["test.flag"]);
  });
});
