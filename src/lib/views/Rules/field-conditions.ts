// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 字段联动条件求值器(v0 新增,决策 §3.2)。
//
// 设计动机:
//   - BusinessForm.svelte 原本把 evalCondition 内联在组件里,无法直接单测
//   - 抽到纯函数模块后,字段联动逻辑可独立测试(决策 §3.2 + §3.3)
//   - 组件保持薄壳:只负责把 formValues 喂给求值器 + 渲染结果
//
// 求值规则:
//   - evalConditions 是 AND 关系(全满足才 true)
//   - 空数组 / undefined → true(无约束)
//   - 操作符:eq / ne / gt / lt / in / exists
//
// 关联设计:P02_BUSINESS_LANGUAGE_V0_DESIGN.md §3.2 + §9.6

import type { FieldCondition } from "$lib/stores/business-form-schema";

/** 表单值类型(与 BusinessForm.svelte 的 formValues 一致) */
export type FormValueMap = Record<string, string | number | boolean | undefined>;

/**
 * 求值单个字段条件。
 *
 * @param cond 条件定义
 * @param formValues 当前表单值
 * @returns 是否满足
 */
export function evalCondition(
  cond: FieldCondition,
  formValues: FormValueMap,
): boolean {
  const v = formValues[cond.fieldId];
  switch (cond.operator) {
    case "eq":
      return v === cond.value;
    case "ne":
      return v !== cond.value;
    case "gt":
      return Number(v) > Number(cond.value);
    case "lt":
      return Number(v) < Number(cond.value);
    case "in":
      return Array.isArray(cond.value) && cond.value.includes(String(v));
    case "exists":
      return v !== undefined && v !== "" && v !== null;
    default:
      return false;
  }
}

/**
 * 求值条件数组(AND 关系:全满足才 true)。
 *
 * - 空数组 / undefined → true(无约束)
 * - 任一不满足 → false
 */
export function evalConditions(
  conds: FieldCondition[] | undefined,
  formValues: FormValueMap,
): boolean {
  if (!conds || conds.length === 0) return true;
  return conds.every((c) => evalCondition(c, formValues));
}
