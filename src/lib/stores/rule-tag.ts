// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 规则-标签关联 store(多对多)。
// 双向索引:Map<ruleId, Set<tagId>> + Map<tagId, Set<ruleId>>,O(1) 查询。
//
// 持久化:localStorage(key: evorule-console-cloud:rule-tag-associations)
//   存储格式:[{ruleId, tagId, associatedAt}, ...] 扁平数组
//
// 关联设计:P03_DATASET_DESIGN.md §4.4 + §5.5

import { writable, derived, get } from "svelte/store";
import { browser } from "$app/environment";

/** 规则-标签关联记录(持久化用) */
export interface RuleTagAssociation {
  ruleId: string;
  tagId: string;
  associatedAt: string;
}

const STORAGE_KEY = "evorule-console-cloud:rule-tag-associations";

/** 扁平关联数组(持久化载体) */
function loadAssociations(): RuleTagAssociation[] {
  if (!browser) return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as RuleTagAssociation[];
  } catch {
    return [];
  }
}

/** 双向索引(内存) */
function buildIndex(associations: RuleTagAssociation[]): {
  ruleToTags: Map<string, Set<string>>;
  tagToRules: Map<string, Set<string>>;
} {
  const ruleToTags = new Map<string, Set<string>>();
  const tagToRules = new Map<string, Set<string>>();
  for (const a of associations) {
    if (!ruleToTags.has(a.ruleId)) ruleToTags.set(a.ruleId, new Set());
    if (!tagToRules.has(a.tagId)) tagToRules.set(a.tagId, new Set());
    ruleToTags.get(a.ruleId)!.add(a.tagId);
    tagToRules.get(a.tagId)!.add(a.ruleId);
  }
  return { ruleToTags, tagToRules };
}

const associationsStore = writable<RuleTagAssociation[]>(loadAssociations());

/** 持久化 */
associationsStore.subscribe((all) => {
  if (!browser) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
});

/** 派生:双向索引(供 UI 响应式读取) */
export const ruleTagIndex = derived(associationsStore, ($all) => buildIndex($all));

// === 写操作 ===

/** 给规则加标签(幂等:已存在则跳过) */
export function addTagToRule(ruleId: string, tagId: string): void {
  const all = get(associationsStore);
  if (all.some((a) => a.ruleId === ruleId && a.tagId === tagId)) return;
  associationsStore.update((list) => [
    ...list,
    { ruleId, tagId, associatedAt: new Date().toISOString() },
  ]);
}

/** 移除规则的某个标签 */
export function removeTagFromRule(ruleId: string, tagId: string): void {
  associationsStore.update((list) =>
    list.filter((a) => !(a.ruleId === ruleId && a.tagId === tagId)),
  );
}

/** 级联:规则删除时,移除其所有标签关联 */
export function removeRuleFromAllTags(ruleId: string): void {
  associationsStore.update((list) => list.filter((a) => a.ruleId !== ruleId));
}

/** 级联:标签删除时,移除该标签的所有规则关联 */
export function removeTagFromAllRules(tagId: string): void {
  associationsStore.update((list) => list.filter((a) => a.tagId !== tagId));
}

// === 读操作(非响应式,命令式调用用) ===

/** 获取规则的所有标签 ID */
export function getTagsOfRule(ruleId: string): string[] {
  const { ruleToTags } = buildIndex(get(associationsStore));
  return Array.from(ruleToTags.get(ruleId) ?? []);
}

/** 获取标签下的所有规则 ID */
export function getRulesOfTag(tagId: string): string[] {
  const { tagToRules } = buildIndex(get(associationsStore));
  return Array.from(tagToRules.get(tagId) ?? []);
}

/** 获取所有关联(原始数组) */
export function getAllRuleTagAssociations(): RuleTagAssociation[] {
  return get(associationsStore);
}

/**
 * 按标签筛选规则 ID(多选 AND/OR)。
 * @param tagIds 标签 ID 列表
 * @param mode "AND" = 规则需含全部标签;"OR" = 含任一标签
 * @returns 命中的规则 ID 数组
 */
export function filterRuleIdsByTags(
  tagIds: string[],
  mode: "AND" | "OR" = "OR",
): string[] {
  if (!tagIds || tagIds.length === 0) return [];
  const { ruleToTags } = buildIndex(get(associationsStore));
  const result: string[] = [];
  for (const [ruleId, tags] of ruleToTags) {
    if (mode === "AND") {
      if (tagIds.every((t) => tags.has(t))) result.push(ruleId);
    } else {
      if (tagIds.some((t) => tags.has(t))) result.push(ruleId);
    }
  }
  return result;
}
