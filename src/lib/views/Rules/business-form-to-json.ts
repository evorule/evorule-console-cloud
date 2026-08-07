// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 业务表单值 ↔ evorule JSON 双向转换(v0)。
// P0-1 基础:formValuesToEvoruleJson(单向,schema → JSON)
// v0 扩展:
//   - evoruleJsonToFormValues(反向,LLM 草案 → 表单,决策 §3.7)
//   - 支持 branch / io_request 等 evorule 复杂结构
//   - setPath / getPath 对称实现
//
// 与内核边界:
//   - 内核 RuleValidator 是 JSON 合法性的最终权威
//   - 本转换器只做"表单值 ↔ JSON 字段"映射,产出的是"业务视图"简化形状
//     (condition / action / branch),不直接是内核 transform 数组
//   - 业务视图 → 内核 transform 数组的转换由 kernel-rule-adapter.ts 负责
//     (确保 G1-G7 门禁通过,尤其 G6 兜底规则)
//
// 关联设计:P02_BUSINESS_LANGUAGE_V0_DESIGN.md §9.3

import type {
  BusinessFormField,
  BusinessFormSchema,
} from "$lib/stores/business-form-schema";

export interface FormValues {
  [fieldId: string]: string | number | boolean;
}

/**
 * 把业务表单值转换为 evorule JSON 对象(正向,业务视图)。
 *
 * v0 增强:支持点分路径 + 数组索引(如 "branch[0].condition.value")
 *
 * 注意:产出的是"业务视图"形状({condition, action, branch}),
 *      保存到内核前需用 kernel-rule-adapter.wrapAsKernelTransform 包装为 transform 数组。
 */
export function formValuesToEvoruleJson(
  schema: BusinessFormSchema,
  values: FormValues,
): object {
  const result: Record<string, unknown> = {};

  for (const field of schema.fields) {
    const value = values[field.id];
    if (value === undefined || value === "") continue;

    const converted = convertValue(value, field);
    setPath(result, field.evorulePath, converted);
  }

  return result;
}

/**
 * v0 新增:把 evorule JSON 反向解析为业务表单值。
 *
 * 用法:LLM 草案生成后,反向填入表单让业务专家编辑(决策 §3.7)。
 * 也用于从内核 rules store 加载规则时(先 unwrapKernelTransform 再反向解析)。
 *
 * 注意:
 *   - 只解析 schema 中定义的字段(未定义的字段丢失,提示用户切到 raw JSON)
 *   - 类型反向转换:number → string(若 field.type='string')等
 */
export function evoruleJsonToFormValues(
  schema: BusinessFormSchema,
  ruleJson: object,
): FormValues {
  const values: FormValues = {};

  for (const field of schema.fields) {
    const v = getPath(ruleJson, field.evorulePath);
    if (v === undefined) continue;

    values[field.id] = reverseConvertValue(v, field);
  }

  return values;
}

// === 类型转换 ===

function convertValue(
  value: string | number | boolean,
  field: BusinessFormField,
): unknown {
  switch (field.type) {
    case "number":
      return typeof value === "string" ? Number(value) : value;
    case "boolean":
      return value === true || value === "true";
    case "enum":
    case "string":
    case "date":
    default:
      return String(value);
  }
}

function reverseConvertValue(
  value: unknown,
  field: BusinessFormField,
): string | number | boolean {
  switch (field.type) {
    case "number":
      return typeof value === "number" ? value : Number(value);
    case "boolean":
      return typeof value === "boolean" ? value : value === "true";
    case "enum":
    case "string":
    case "date":
    default:
      return String(value);
  }
}

/**
 * v0 增强:setPath 支持点分 + 数组索引。
 *
 * 示例:
 *   setPath(result, "branch[0].condition.value", 10000)
 *   → result.branch[0].condition.value = 10000
 */
function setPath(
  obj: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  const parts = parsePath(path);
  let current: unknown = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    const nextK = parts[i + 1];
    if (typeof current !== "object" || current === null) return;

    if (typeof k === "number") {
      const arr = current as unknown[];
      if (arr[k] === undefined) {
        arr[k] = typeof nextK === "number" ? [] : {};
      } else if (typeof arr[k] !== "object" || arr[k] === null) {
        return; // 已有非对象值,不覆盖丢失
      }
      current = arr[k];
    } else {
      const record = current as Record<string, unknown>;
      if (record[k] === undefined) {
        record[k] = typeof nextK === "number" ? [] : {};
      } else if (typeof record[k] !== "object" || record[k] === null) {
        return; // 已有非对象值,不覆盖丢失
      }
      current = record[k];
    }
  }

  const lastK = parts[parts.length - 1];
  if (typeof current !== "object" || current === null) return;
  if (typeof lastK === "number") {
    (current as unknown[])[lastK] = value;
  } else {
    (current as Record<string, unknown>)[lastK] = value;
  }
}

/**
 * v0 新增:getPath(对称 setPath,支持点分 + 数组索引)。
 */
export function getPath(obj: object, path: string): unknown {
  const parts = parsePath(path);
  let current: unknown = obj;
  for (const k of parts) {
    if (current === undefined || current === null) return undefined;
    if (typeof k === "number") {
      current = (current as unknown[])[k];
    } else {
      current = (current as Record<string, unknown>)[k];
    }
  }
  return current;
}

/** 解析路径字符串为 parts 数组(字符串键 + 数字索引混合) */
function parsePath(path: string): Array<string | number> {
  const parts: Array<string | number> = [];
  const segments = path.split(".");
  for (const seg of segments) {
    const match = seg.match(/^([a-zA-Z_$][\w$]*)(\[\d+\])*$/);
    if (match) {
      parts.push(match[1]);
      const indexMatches = seg.match(/\[(\d+)\]/g);
      if (indexMatches) {
        for (const im of indexMatches) {
          parts.push(Number(im.match(/\d+/)![0]));
        }
      }
    } else {
      parts.push(seg);
    }
  }
  return parts;
}
