// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 自动补全规则的业务术语关联(v0 新增)。
// 用法:BusinessForm 保存时,根据 schema 字段的 termId 自动补全 ruleBusinessMeta.businessTermIds
//
// 设计:
//   - 扫描 schema.fields 的 termId(每个字段关联一个术语)
//   - 扫描 formValues 中非空的字段(用户填了值 = 该术语被使用)
//   - 与 existingTermIds 合并去重
//
// 关联设计:P02_BUSINESS_LANGUAGE_V0_DESIGN.md §9.5

import type { BusinessFormSchema } from "$lib/stores/business-form-schema";
import type { FormValues } from "./business-form-to-json";

export function autoFillTermIds(
  schema: BusinessFormSchema,
  formValues: FormValues,
  existingTermIds: string[],
): string[] {
  const usedTermIds = new Set<string>(existingTermIds);

  for (const field of schema.fields) {
    if (!field.termId) continue;
    const v = formValues[field.id];
    if (v === undefined || v === "" || v === null) continue;
    usedTermIds.add(field.termId);
  }

  return Array.from(usedTermIds);
}
