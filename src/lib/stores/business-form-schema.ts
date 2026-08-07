// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 业务表单 schema store(v0)。
// P0-1 基础:2 条 builtin + 字段类型 + evorulePath 映射
// v0 扩展:visibleWhen / enabledWhen / requiredWhen / ConditionGroup / businessObjects / validators
//
// 持久化:localStorage(key: evorule-console-cloud:business-form-schema:user)
//
// 关联设计:P02_BUSINESS_LANGUAGE_V0_DESIGN.md §4.2 + §3.2(字段联动)+ §3.3(复合条件)

import { writable, get } from "svelte/store";
import { browser } from "$app/environment";
import { BUILTIN_FORM_SCHEMAS } from "$lib/data/business-form-schemas-builtin";

export type FormFieldType = "number" | "string" | "date" | "enum" | "boolean";

/** v0 新增:字段条件(决策 §3.2) */
export interface FieldCondition {
  /** 依赖的字段 ID */
  fieldId: string;
  /** 操作符 */
  operator: "eq" | "ne" | "gt" | "lt" | "in" | "exists";
  /** 比较值(eq/ne/gt/lt/in 用) */
  value?: string | number | boolean | string[];
}

/** v0 新增:复合条件组(决策 §3.3) */
export interface ConditionGroup {
  combinator: "and" | "or" | "not";
  conditions: (FieldCondition | ConditionGroup)[];
}

/** v0 新增:业务层校验规则(独立于内核 RuleValidator) */
export interface FieldValidator {
  type: "required" | "min" | "max" | "pattern" | "custom";
  /** min/max 用,pattern 用正则字符串 */
  param?: string | number;
  /** 失败提示 */
  message: string;
}

export interface BusinessFormField {
  /** 字段 ID,如 'finance.amount_threshold' */
  id: string;
  /** 字段标签(中文) */
  label: string;
  /** 字段类型 */
  type: FormFieldType;
  /** 对应 evorule JSON 字段路径(如 'condition.value' / 'branch[0].condition.value') */
  evorulePath: string;
  /** 枚举值(type='enum' 时) */
  options?: string[];
  /** 默认值 */
  defaultValue?: string | number | boolean;
  /** 业务解释 */
  description: string;
  /** v0 新增:可见条件(全满足才显示) */
  visibleWhen?: FieldCondition[];
  /** v0 新增:启用条件(全满足才可编辑) */
  enabledWhen?: FieldCondition[];
  /** v0 新增:必填条件(全满足才必填) */
  requiredWhen?: FieldCondition[];
  /** v0 新增:业务层校验规则 */
  validators?: FieldValidator[];
  /** v0 新增:关联术语 ID(用于业务预览术语高亮) */
  termId?: string;
  /** v0 新增:字段分组(用于 UI 折叠"条件组" / "动作组") */
  group?: "condition" | "action" | "metadata";
}

export interface BusinessFormSchema {
  /** schema ID,如 'finance.expense_limit' */
  id: string;
  /** 行业 */
  industry: string;
  /** 业务场景(如"报销上限规则") */
  scenario: string;
  /** 字段列表 */
  fields: BusinessFormField[];
  /** v0 新增:适用的业务对象列表(空 = 全部适用,决策 §3.10) */
  businessObjects?: string[];
  /** v0 新增:复合条件组(用于 evorule JSON 的 branch 嵌套) */
  conditionGroups?: ConditionGroup[];
  /** v0 新增:版本号 */
  version: number;
}

const STORAGE_KEY = "evorule-console-cloud:business-form-schema:user";

function loadSchemas(): BusinessFormSchema[] {
  if (!browser) return BUILTIN_FORM_SCHEMAS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return BUILTIN_FORM_SCHEMAS;
    const userSchemas = JSON.parse(raw) as BusinessFormSchema[];
    return [...BUILTIN_FORM_SCHEMAS, ...userSchemas];
  } catch {
    return BUILTIN_FORM_SCHEMAS;
  }
}

export const businessFormSchemaStore =
  writable<BusinessFormSchema[]>(loadSchemas());

businessFormSchemaStore.subscribe((schemas) => {
  if (!browser) return;
  const userSchemas = schemas.filter(
    (s) => !BUILTIN_FORM_SCHEMAS.find((b) => b.id === s.id),
  );
  localStorage.setItem(STORAGE_KEY, JSON.stringify(userSchemas));
});

// === 便捷函数 ===

/** 按行业查询 schema */
export function getSchemasByIndustry(industry: string): BusinessFormSchema[] {
  return get(businessFormSchemaStore).filter((s) => s.industry === industry);
}

/** v0 新增:按行业 + 业务对象查询 schema(决策 §3.10) */
export function getSchemasByBusinessObject(
  businessObject: string,
  industry: string,
): BusinessFormSchema[] {
  if (!businessObject) return getSchemasByIndustry(industry);
  return get(businessFormSchemaStore).filter(
    (s) =>
      s.industry === industry &&
      (!s.businessObjects || s.businessObjects.includes(businessObject)),
  );
}

/** v0 新增:按 schema ID 查询 */
export function getSchemaById(id: string): BusinessFormSchema | null {
  return get(businessFormSchemaStore).find((s) => s.id === id) ?? null;
}

/** v0 新增:CRUD */
export function addBusinessFormSchema(
  schema: Omit<BusinessFormSchema, "version">,
): string {
  businessFormSchemaStore.update((list) => [
    ...list,
    { ...schema, version: 1 },
  ]);
  return schema.id;
}

export function updateBusinessFormSchema(
  id: string,
  patch: Partial<BusinessFormSchema>,
): void {
  businessFormSchemaStore.update((list) =>
    list.map((s) =>
      s.id === id ? { ...s, ...patch, version: s.version + 1 } : s,
    ),
  );
}
