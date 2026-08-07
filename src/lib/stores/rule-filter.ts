// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 规则组合筛选(标签 + 分类 + 搜索 + 来源)。
// 派生自内核 rules store + rule-tag/rule-category 关联索引。
//
// 关联设计:P03_DATASET_DESIGN.md §5.7

import { derived } from "svelte/store";
import { rules } from "@evorule/console";
import type { Rule } from "@evorule/console";
import { getTagsOfRule } from "./rule-tag";
import { getCategoryOfRule } from "./rule-category";
import { getCategoryAndDescendants } from "./category";

/** 规则来源筛选 */
export type RuleSourceFilter = "all" | "builtin" | "user";

/** 组合筛选条件 */
export interface RuleFilter {
  /** 标签筛选(多选) */
  tagIds: string[];
  /** 标签组合模式:AND = 含全部标签;OR = 含任一标签 */
  tagMode: "AND" | "OR";
  /** 分类筛选(含子分类,null = 不限) */
  categoryId: string | null;
  /** 名称/描述/ID 搜索(大小写不敏感) */
  searchQuery: string;
  /** 来源筛选 */
  status: RuleSourceFilter;
}

/** 默认筛选(无任何限制) */
export const DEFAULT_RULE_FILTER: RuleFilter = {
  tagIds: [],
  tagMode: "OR",
  categoryId: null,
  searchQuery: "",
  status: "all",
};

/**
 * 组合筛选规则(标签 + 分类 + 搜索 + 来源)。
 *
 * 返回一个派生 store,当 rules / 关联索引变化时自动重算。
 *
 * @param filter 筛选条件
 * @returns Readable<Rule[]>
 */
export function filteredRules(filter: RuleFilter) {
  return derived(rules, ($rules) => applyFilter($rules, filter));
}

/**
 * 非响应式筛选(命令式调用,测试用)。
 * 直接对规则数组应用筛选条件。
 */
export function applyFilter(allRules: Rule[], filter: RuleFilter): Rule[] {
  let result = allRules;

  // 1. 来源筛选
  if (filter.status !== "all") {
    result = result.filter((r) => r.source === filter.status);
  }

  // 2. 搜索(名称/描述/ID,大小写不敏感)
  if (filter.searchQuery.trim()) {
    const q = filter.searchQuery.trim().toLowerCase();
    result = result.filter(
      (r) =>
        r.description.toLowerCase().includes(q) ||
        r.id.toLowerCase().includes(q),
    );
  }

  // 3. 分类筛选(含子分类)
  if (filter.categoryId) {
    const categoryIds = getCategoryAndDescendants(filter.categoryId);
    result = result.filter((r) => {
      const catId = getCategoryOfRule(r.id);
      return catId !== null && categoryIds.includes(catId);
    });
  }

  // 4. 标签筛选(AND/OR)
  if (filter.tagIds.length > 0) {
    result = result.filter((r) => {
      const ruleTags = getTagsOfRule(r.id);
      if (filter.tagMode === "AND") {
        return filter.tagIds.every((t) => ruleTags.includes(t));
      }
      return filter.tagIds.some((t) => ruleTags.includes(t));
    });
  }

  return result;
}
