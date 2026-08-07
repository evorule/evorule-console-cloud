// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 规则-分类关联 store(一对一)。
// 单向索引:Map<ruleId, categoryId>,O(1) 查询。
// 一条规则只能归一个分类,设置新分类会覆盖旧分类。
//
// 持久化:localStorage(key: evorule-console-cloud:rule-category-associations)
//   存储格式:[{ruleId, categoryId, associatedAt}, ...] 扁平数组
//
// 关联设计:P03_DATASET_DESIGN.md §4.5 + §5.6

import { writable, derived, get } from "svelte/store";
import { browser } from "$app/environment";

/** 规则-分类关联记录(持久化用) */
export interface RuleCategoryAssociation {
  ruleId: string;
  categoryId: string;
  associatedAt: string;
}

const STORAGE_KEY = "evorule-console-cloud:rule-category-associations";

function loadAssociations(): RuleCategoryAssociation[] {
  if (!browser) return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as RuleCategoryAssociation[];
  } catch {
    return [];
  }
}

const associationsStore = writable<RuleCategoryAssociation[]>(loadAssociations());

/** 持久化 */
associationsStore.subscribe((all) => {
  if (!browser) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
});

/** 派生:ruleId → categoryId 映射(供 UI 响应式读取) */
export const ruleCategoryIndex = derived(associationsStore, ($all) => {
  const map = new Map<string, string>();
  for (const a of $all) map.set(a.ruleId, a.categoryId);
  return map;
});

// === 写操作 ===

/**
 * 设置规则的分类(一对一,覆盖之前的分类)。
 * 若规则已有分类,更新为新分类;否则新增关联。
 */
export function setRuleCategory(ruleId: string, categoryId: string): void {
  const now = new Date().toISOString();
  associationsStore.update((list) => {
    const existing = list.find((a) => a.ruleId === ruleId);
    if (existing) {
      existing.categoryId = categoryId;
      existing.associatedAt = now;
      return [...list];
    }
    return [...list, { ruleId, categoryId, associatedAt: now }];
  });
}

/** 移除规则的分类(变为未分类) */
export function removeRuleCategory(ruleId: string): void {
  associationsStore.update((list) => list.filter((a) => a.ruleId !== ruleId));
}

/** 级联:分类删除时,移除该分类的所有规则关联(规则变为未分类) */
export function removeCategoryFromAllRules(categoryId: string): void {
  associationsStore.update((list) =>
    list.filter((a) => a.categoryId !== categoryId),
  );
}

// === 读操作(非响应式,命令式调用用) ===

/** 获取规则的分类 ID(null = 未分类) */
export function getCategoryOfRule(ruleId: string): string | null {
  const all = get(associationsStore);
  const found = all.find((a) => a.ruleId === ruleId);
  return found ? found.categoryId : null;
}

/** 获取分类下的所有规则 ID */
export function getRulesOfCategory(categoryId: string): string[] {
  const all = get(associationsStore);
  return all.filter((a) => a.categoryId === categoryId).map((a) => a.ruleId);
}

/** 获取所有关联(原始数组) */
export function getAllRuleCategoryAssociations(): RuleCategoryAssociation[] {
  return get(associationsStore);
}
