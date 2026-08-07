// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 规则业务元数据扩展表(v0)。
// P0-1 基础:Map<ruleId, BusinessMeta>
// v0 扩展:schemaId(关联业务表单 schema)/ formValues(反向解析)/ 自动补全元数据
//
// 持久化:localStorage(key: evorule-console-cloud:rule-business-meta)
//
// 关联设计:P02_BUSINESS_LANGUAGE_V0_DESIGN.md §4.3 + P01 §4.5
//
// 与内核边界:
//   - 不修改内核 Rule 类型,在 console-cloud 层加扩展表
//   - Map<ruleId, BusinessMeta> 关联规则与业务元数据
//   - 业务元数据可选(不强制每条规则都有)

import { writable, get } from "svelte/store";
import { browser } from "$app/environment";

export interface RuleBusinessMeta {
  /** 关联的内核 Rule.id */
  ruleId: string;
  /** 行业 */
  industry: string;
  /** 业务对象类型(病人/案件/订单...) */
  businessObject: string;
  /** 关联的业务术语 ID 列表 */
  businessTermIds: string[];
  /** 业务场景说明(供 LLM explainRule 用作上下文) */
  scenarioContext: string;
  /** v0 新增:关联的业务表单 schema ID */
  schemaId?: string;
  /** v0 新增:业务表单值(用于反向解析回表单) */
  formValues?: Record<string, string | number | boolean>;
  /** v0 新增:创建时间(用于"最近活动"排序) */
  createdAt: string;
  /** v0 新增:最后更新时间 */
  updatedAt: string;
}

type RuleBusinessMetaMap = Record<string, RuleBusinessMeta>;

const STORAGE_KEY = "evorule-console-cloud:rule-business-meta";

function loadMeta(): RuleBusinessMetaMap {
  if (!browser) return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as RuleBusinessMetaMap;
  } catch {
    return {};
  }
}

export const ruleBusinessMetaStore = writable<RuleBusinessMetaMap>(loadMeta());

ruleBusinessMetaStore.subscribe((m) => {
  if (!browser) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(m));
});

// === 便捷函数 ===

export function getMeta(ruleId: string): RuleBusinessMeta | null {
  return get(ruleBusinessMetaStore)[ruleId] ?? null;
}

export function setMeta(meta: RuleBusinessMeta): void {
  const now = new Date().toISOString();
  ruleBusinessMetaStore.update((m) => ({
    ...m,
    [meta.ruleId]: { ...meta, updatedAt: now },
  }));
}

/** v0 新增:批量查询(用于规则库列表展示业务元数据) */
export function getMetaBulk(
  ruleIds: string[],
): Record<string, RuleBusinessMeta> {
  const m = get(ruleBusinessMetaStore);
  const result: Record<string, RuleBusinessMeta> = {};
  for (const id of ruleIds) {
    if (m[id]) result[id] = m[id];
  }
  return result;
}

export function removeMeta(ruleId: string): void {
  ruleBusinessMetaStore.update((m) => {
    const next = { ...m };
    delete next[ruleId];
    return next;
  });
}

/** v0 新增:批量取回元数据(派生 store 用,响应式) */
export function getMetaMap(): RuleBusinessMetaMap {
  return get(ruleBusinessMetaStore);
}
