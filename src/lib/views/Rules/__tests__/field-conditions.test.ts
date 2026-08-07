// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// evorule-console-cloud — 字段联动条件求值器单测
//
// 运行: npx vitest run src/lib/views/Rules/__tests__/field-conditions.test.ts
//
// 测试范围:
//   - evalCondition:6 种操作符(eq/ne/gt/lt/in/exists)
//   - evalConditions:AND 关系(全满足才 true)
//   - 边界:空数组 / undefined → true
//   - 类型转换(number vs string)
//   - 实际联动场景:visibleWhen / requiredWhen
//
// 关联设计:P02_BUSINESS_LANGUAGE_V0_DESIGN.md §3.2 + §9.6

import { describe, test, expect } from "vitest";
import {
  evalCondition,
  evalConditions,
  type FormValueMap,
} from "../field-conditions";
import type { FieldCondition } from "$lib/stores/business-form-schema";

describe("field-conditions — evalCondition 操作符覆盖", () => {
  test("eq:值严格相等 → true", () => {
    const cond: FieldCondition = {
      fieldId: "expenseType",
      operator: "eq",
      value: "差旅",
    };
    const values: FormValueMap = { expenseType: "差旅" };
    expect(evalCondition(cond, values)).toBe(true);
  });

  test("eq:值不等 → false", () => {
    const cond: FieldCondition = {
      fieldId: "expenseType",
      operator: "eq",
      value: "差旅",
    };
    const values: FormValueMap = { expenseType: "招待" };
    expect(evalCondition(cond, values)).toBe(false);
  });

  test("ne:值不等 → true", () => {
    const cond: FieldCondition = {
      fieldId: "expenseType",
      operator: "ne",
      value: "福利",
    };
    const values: FormValueMap = { expenseType: "差旅" };
    expect(evalCondition(cond, values)).toBe(true);
  });

  test("ne:值相等 → false", () => {
    const cond: FieldCondition = {
      fieldId: "expenseType",
      operator: "ne",
      value: "福利",
    };
    const values: FormValueMap = { expenseType: "福利" };
    expect(evalCondition(cond, values)).toBe(false);
  });

  test("gt:Number(v) > Number(value) → true", () => {
    const cond: FieldCondition = {
      fieldId: "amount",
      operator: "gt",
      value: 5000,
    };
    expect(evalCondition(cond, { amount: 10000 })).toBe(true);
    expect(evalCondition(cond, { amount: 5000 })).toBe(false);
    expect(evalCondition(cond, { amount: 4999 })).toBe(false);
  });

  test("gt:字符串数字也能比较(隐式 Number 转换)", () => {
    const cond: FieldCondition = {
      fieldId: "amount",
      operator: "gt",
      value: "5000", // 字符串
    };
    expect(evalCondition(cond, { amount: "6000" })).toBe(true);
    expect(evalCondition(cond, { amount: "4000" })).toBe(false);
  });

  test("lt:Number(v) < Number(value) → true", () => {
    const cond: FieldCondition = {
      fieldId: "amount",
      operator: "lt",
      value: 5000,
    };
    expect(evalCondition(cond, { amount: 4000 })).toBe(true);
    expect(evalCondition(cond, { amount: 5000 })).toBe(false);
    expect(evalCondition(cond, { amount: 6000 })).toBe(false);
  });

  test("in:v 在 value 数组中 → true", () => {
    const cond: FieldCondition = {
      fieldId: "controlPointId",
      operator: "in",
      value: ["SOX-404", "SOX-302"],
    };
    expect(evalCondition(cond, { controlPointId: "SOX-404" })).toBe(true);
    expect(evalCondition(cond, { controlPointId: "SOX-302" })).toBe(true);
    expect(evalCondition(cond, { controlPointId: "ISO-27001" })).toBe(false);
  });

  test("exists:有非空值 → true", () => {
    const cond: FieldCondition = {
      fieldId: "signature",
      operator: "exists",
    };
    expect(evalCondition(cond, { signature: "alice" })).toBe(true);
    expect(evalCondition(cond, { signature: 123 })).toBe(true);
  });

  test("exists:undefined / 空串 / null → false", () => {
    const cond: FieldCondition = {
      fieldId: "signature",
      operator: "exists",
    };
    expect(evalCondition(cond, { signature: undefined })).toBe(false);
    expect(evalCondition(cond, { signature: "" })).toBe(false);
    expect(evalCondition(cond, {})).toBe(false);
  });

  test("未知 operator → false(安全兜底)", () => {
    const cond: FieldCondition = {
      fieldId: "x",
      operator: "weird_op" as FieldCondition["operator"],
      value: 1,
    };
    expect(evalCondition(cond, { x: 1 })).toBe(false);
  });
});

describe("field-conditions — evalConditions AND 关系", () => {
  test("全满足 → true", () => {
    const conds: FieldCondition[] = [
      { fieldId: "a", operator: "eq", value: "x" },
      { fieldId: "b", operator: "gt", value: 5 },
    ];
    const values: FormValueMap = { a: "x", b: 10 };
    expect(evalConditions(conds, values)).toBe(true);
  });

  test("任一不满足 → false", () => {
    const conds: FieldCondition[] = [
      { fieldId: "a", operator: "eq", value: "x" },
      { fieldId: "b", operator: "gt", value: 5 },
    ];
    // b=3 不满足 > 5
    expect(evalConditions(conds, { a: "x", b: 3 })).toBe(false);
    // a=y 不满足 eq x
    expect(evalConditions(conds, { a: "y", b: 10 })).toBe(false);
  });

  test("空数组 → true(无约束)", () => {
    expect(evalConditions([], {})).toBe(true);
  });

  test("undefined → true(无约束)", () => {
    expect(evalConditions(undefined, {})).toBe(true);
  });

  test("单条件:满足 → true", () => {
    const conds: FieldCondition[] = [
      { fieldId: "a", operator: "eq", value: "x" },
    ];
    expect(evalConditions(conds, { a: "x" })).toBe(true);
  });
});

describe("field-conditions — 实际联动场景(builtin schema 例子)", () => {
  // 场景 1:finance.expense_limit schema 的 visibleWhen
  // finance.approver_role 字段:非福利类型才显示
  test("财务审批:expenseType=福利 → approverRole 不显示(条件不满足)", () => {
    const visibleWhenApprover: FieldCondition[] = [
      { fieldId: "finance.expense_type", operator: "ne", value: "福利" },
    ];
    // 福利类型 → ne 福利 = false → approverRole 隐藏
    expect(
      evalConditions(visibleWhenApprover, { "finance.expense_type": "福利" }),
    ).toBe(false);
  });

  test("财务审批:expenseType=差旅 → approverRole 显示", () => {
    const visibleWhenApprover: FieldCondition[] = [
      { fieldId: "finance.expense_type", operator: "ne", value: "福利" },
    ];
    expect(
      evalConditions(visibleWhenApprover, { "finance.expense_type": "差旅" }),
    ).toBe(true);
  });

  // 场景 2:finance.expense_limit schema 的 requiredWhen
  // finance.notify_channel 字段:CFO 审批时强制必填通知渠道
  test("财务审批:approver=CFO → notifyChannel 必填", () => {
    const requiredWhenChannel: FieldCondition[] = [
      { fieldId: "finance.approver_role", operator: "eq", value: "CFO" },
    ];
    expect(
      evalConditions(requiredWhenChannel, { "finance.approver_role": "CFO" }),
    ).toBe(true);
  });

  test("财务审批:approver=财务主管 → notifyChannel 不强制必填", () => {
    const requiredWhenChannel: FieldCondition[] = [
      { fieldId: "finance.approver_role", operator: "eq", value: "CFO" },
    ];
    expect(
      evalConditions(requiredWhenChannel, {
        "finance.approver_role": "财务主管",
      }),
    ).toBe(false);
  });

  // 场景 3:compliance.control_check schema 的 requiredWhen
  // compliance.regulatory_body 字段:SOX-404 / SOX-302 控制点强制必填监管机构
  test("合规审计:SOX-404 → regulatoryBody 必填", () => {
    const requiredWhenRegulator: FieldCondition[] = [
      {
        fieldId: "compliance.control_point_id",
        operator: "in",
        value: ["SOX-404", "SOX-302"],
      },
    ];
    expect(
      evalConditions(requiredWhenRegulator, {
        "compliance.control_point_id": "SOX-404",
      }),
    ).toBe(true);
  });

  test("合规审计:ISO-27001 → regulatoryBody 不强制必填", () => {
    const requiredWhenRegulator: FieldCondition[] = [
      {
        fieldId: "compliance.control_point_id",
        operator: "in",
        value: ["SOX-404", "SOX-302"],
      },
    ];
    expect(
      evalConditions(requiredWhenRegulator, {
        "compliance.control_point_id": "ISO-27001",
      }),
    ).toBe(false);
  });
});
