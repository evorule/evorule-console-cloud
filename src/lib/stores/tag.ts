// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 标签 store(多对多,扁平结构)。
// 标签管"横向特征"(紧急/高风险/需审批),一条规则可多个标签。
//
// 持久化:localStorage(key: evorule-console-cloud:tags)
//
// 关联设计:P03_DATASET_DESIGN.md §4.2 + §5.3 + §3.2(决策 2)
//
// 级联:deleteTag 时同步清理 rule-tag.ts(removeTagFromAllRules)
//   + dataset.ts(removeTagFromAllDatasets)

import { writable, derived, get } from "svelte/store";
import { browser } from "$app/environment";
import { removeTagFromAllRules } from "./rule-tag";
import { removeTagFromAllDatasets } from "./dataset";

/** 标签 */
export interface Tag {
  /** 标签 ID */
  id: string;
  /** 标签名(如"紧急"、"高风险") */
  name: string;
  /** 颜色(hex,如 "#ff0000") */
  color: string;
  /** 创建时间 */
  createdAt: string;
}

const STORAGE_KEY = "evorule-console-cloud:tags";

function loadTags(): Tag[] {
  if (!browser) return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Tag[];
  } catch {
    return [];
  }
}

export const tagStore = writable<Tag[]>(loadTags());

/** 持久化 */
tagStore.subscribe((tags) => {
  if (!browser) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tags));
});

function genId(): string {
  return `tag_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// === 读取 ===

/** 按 ID 获取标签 */
export function getTag(id: string): Tag | undefined {
  return get(tagStore).find((t) => t.id === id);
}

// === CRUD ===

/** 创建标签。@returns 新标签 ID */
export function createTag(name: string, color: string = "#6b7280"): string {
  const id = genId();
  const tag: Tag = { id, name, color, createdAt: new Date().toISOString() };
  tagStore.update((all) => [...all, tag]);
  return id;
}

/** 更新标签(名称/颜色) */
export function updateTag(
  id: string,
  patch: Partial<Pick<Tag, "name" | "color">>,
): void {
  tagStore.update((all) =>
    all.map((t) => (t.id === id ? { ...t, ...patch } : t)),
  );
}

/**
 * 删除标签(级联清理):
 * 1. 移除所有规则-标签关联(rule-tag.ts)
 * 2. 从所有数据集的 tagIds 中移除(dataset.ts)
 */
export function deleteTag(id: string): void {
  // 级联清理(先清理关联,再删标签)
  removeTagFromAllRules(id);
  removeTagFromAllDatasets(id);
  tagStore.update((all) => all.filter((t) => t.id !== id));
}

// === 派生 ===

/** 按名称搜索(模糊匹配) */
export function tagsByName(query: string) {
  const q = query.toLowerCase();
  return derived(tagStore, ($t) =>
    q ? $t.filter((t) => t.name.toLowerCase().includes(q)) : $t,
  );
}
