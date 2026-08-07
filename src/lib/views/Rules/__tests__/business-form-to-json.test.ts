// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// evorule-console-cloud — 业务表单 ↔ evorule JSON 双向转换器单测
//
// 运行: npx vitest run src/lib/views/Rules/__tests__/business-form-to-json.test.ts
//
// 测试范围:
//   - formValuesToEvoruleJson 正向转换(简单路径 / 嵌套对象 / 数组索引)
//   - evoruleJsonToFormValues 反向解析(LLM 草案 → 表单,决策 §3.7)
//   - 双向对称性(form → JSON → form 应一致)
//   - 类型转换(number / boolean / enum / string / date)
//   - 空值跳过(undefined / "")
//   - getPath 单点路径解析
//
// 关联设计:P02_BUSINESS_LANGUAGE_V0_DESIGN.md §9.3

import { describe, test, expect } from "vitest";
import {
  formValuesToEvoruleJson,
  evoruleJsonToFormValues,
  getPath,
} from "../business-form-to-json";
import type { BusinessFormSchema } from "$lib/stores/business-form-schema";

// === 测试用 schema:覆盖简单/嵌套/数组三种路径 ===
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
      defaultValue: 10000,
      description: "金额阈值",
      group: "condition",
    },
    {
      id: "expenseType",
      label: "费用类型",
      type: "enum",
      evorulePath: "condition.params.expenseType",
      defaultValue: "差旅",
      description: "费用分类",
      group: "condition",
    },
    {
      id: "approver",
      label: "审批人",
      type: "string",
      evorulePath: "action.params.role",
      defaultValue: "CFO",
      description: "审批角色",
      group: "action",
    },
    {
      id: "channel",
      label: "通知渠道",
      type: "string",
      evorulePath: "action.params.channel",
      description: "通知方式",
      group: "action",
    },
    {
      id: "branchAmount",
      label: "分支金额",
      type: "number",
      evorulePath: "branch[0].condition.value",
      description: "分支 0 的金额",
      group: "condition",
    },
    {
      id: "branchAction",
      label: "分支动作",
      type: "string",
      evorulePath: "branch[0].action.params.role",
      description: "分支 0 的动作",
      group: "action",
    },
  ],
};

describe("business-form-to-json — 正向转换 formValuesToEvoruleJson", () => {
  test("简单路径 + 嵌套对象:condition.value + condition.params.expenseType", () => {
    const json = formValuesToEvoruleJson(TEST_SCHEMA, {
      amount: 5000,
      expenseType: "招待",
    });
    expect(json).toEqual({
      condition: {
        value: 5000,
        params: { expenseType: "招待" },
      },
    });
  });

  test("action.params 自动嵌套对象", () => {
    const json = formValuesToEvoruleJson(TEST_SCHEMA, {
      approver: "财务主管",
      channel: "IM",
    });
    expect(json).toEqual({
      action: {
        params: { role: "财务主管", channel: "IM" },
      },
    });
  });

  test("数组索引路径 branch[0].condition.value", () => {
    const json = formValuesToEvoruleJson(TEST_SCHEMA, {
      branchAmount: 8000,
      branchAction: "CFO",
    });
    expect(json).toEqual({
      branch: [
        {
          condition: { value: 8000 },
          action: { params: { role: "CFO" } },
        },
      ],
    });
  });

  test("空值跳过:undefined / 空字符串字段不写入 JSON", () => {
    const json = formValuesToEvoruleJson(TEST_SCHEMA, {
      amount: 5000,
      expenseType: "",
      approver: undefined,
      channel: "IM",
    } as unknown as Record<string, string | number | boolean>);
    // expenseType="" 和 approver=undefined 应被跳过
    expect(json).toEqual({
      condition: { value: 5000 },
      action: { params: { channel: "IM" } },
    });
  });

  test("类型转换:number 字段从字符串转 number", () => {
    const json = formValuesToEvoruleJson(TEST_SCHEMA, {
      amount: "12000",
      branchAmount: "3000",
    });
    expect((json as { condition: { value: number } }).condition.value).toBe(12000);
    expect(
      (json as { branch: Array<{ condition: { value: number } }> }).branch[0]
        .condition.value,
    ).toBe(3000);
  });

  test("空 formValues → 空对象", () => {
    const json = formValuesToEvoruleJson(TEST_SCHEMA, {});
    expect(json).toEqual({});
  });
});

describe("business-form-to-json — 反向解析 evoruleJsonToFormValues", () => {
  test("反向解析简单路径 + 嵌套对象", () => {
    const ruleJson = {
      condition: {
        value: 5000,
        params: { expenseType: "招待" },
      },
      action: {
        params: { role: "财务主管", channel: "IM" },
      },
    };
    const values = evoruleJsonToFormValues(TEST_SCHEMA, ruleJson);
    expect(values).toEqual({
      amount: 5000,
      expenseType: "招待",
      approver: "财务主管",
      channel: "IM",
    });
  });

  test("反向解析数组索引路径", () => {
    const ruleJson = {
      branch: [
        {
          condition: { value: 8000 },
          action: { params: { role: "CFO" } },
        },
      ],
    };
    const values = evoruleJsonToFormValues(TEST_SCHEMA, ruleJson);
    expect(values).toEqual({
      branchAmount: 8000,
      branchAction: "CFO",
    });
  });

  test("反向解析:number 类型保持 number", () => {
    const ruleJson = { condition: { value: 9999 } };
    const values = evoruleJsonToFormValues(TEST_SCHEMA, ruleJson);
    expect(values.amount).toBe(9999);
    expect(typeof values.amount).toBe("number");
  });

  test("schema 未定义的字段被忽略(不丢失也不报错)", () => {
    const ruleJson = {
      condition: { value: 5000, unknownField: "ignore me" },
      unknownRoot: { foo: "bar" },
    };
    const values = evoruleJsonToFormValues(TEST_SCHEMA, ruleJson);
    // amount 正常解析,unknownField/unknownRoot 不在 schema 里 → 忽略
    expect(values).toEqual({ amount: 5000 });
  });

  test("ruleJson 缺字段 → values 中不出现", () => {
    const values = evoruleJsonToFormValues(TEST_SCHEMA, {});
    expect(values).toEqual({});
  });
});

describe("business-form-to-json — 双向对称性", () => {
  test("form → JSON → form 应还原原值(简单 schema 子集)", () => {
    const originalValues = {
      amount: 7500,
      expenseType: "办公",
      approver: "CFO",
      channel: "邮件",
    };
    const json = formValuesToEvoruleJson(TEST_SCHEMA, originalValues);
    const roundTrip = evoruleJsonToFormValues(TEST_SCHEMA, json);
    expect(roundTrip).toEqual(originalValues);
  });

  test("form → JSON → form 应还原原值(含数组索引)", () => {
    const originalValues = {
      branchAmount: 4500,
      branchAction: "财务主管",
    };
    const json = formValuesToEvoruleJson(TEST_SCHEMA, originalValues);
    const roundTrip = evoruleJsonToFormValues(TEST_SCHEMA, json);
    expect(roundTrip).toEqual(originalValues);
  });
});

describe("business-form-to-json — getPath", () => {
  test("简单点分路径", () => {
    const obj = { a: { b: { c: 42 } } };
    expect(getPath(obj, "a.b.c")).toBe(42);
  });

  test("数组索引路径", () => {
    const obj = { list: [{ x: 1 }, { x: 2 }] };
    expect(getPath(obj, "list[1].x")).toBe(2);
  });

  test("不存在的路径返回 undefined", () => {
    const obj = { a: { b: 1 } };
    expect(getPath(obj, "a.c")).toBeUndefined();
    expect(getPath(obj, "x.y.z")).toBeUndefined();
  });

  test("中间为 null/undefined 不抛错", () => {
    const obj = { a: null };
    expect(getPath(obj, "a.b")).toBeUndefined();
  });
});
