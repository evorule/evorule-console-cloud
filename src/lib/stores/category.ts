// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 分类 store(树形结构,一对一)。
// 分类管"纵向归属"(诊疗 > 急诊 > 发热),一条规则归一个分类。
// 用 parentId 实现树形结构,不限制层级深度。
//
// 持久化:localStorage(key: evorule-console-cloud:categories)
//
// 关联设计:P03_DATASET_DESIGN.md §4.3 + §5.4 + §3.5(决策 5)+ §8.4(树构建)
//
// 级联:deleteCategory 时
//   1. 递归删除所有子孙分类
//   2. 清理 rule-category.ts(removeCategoryFromAllRules,含子孙)
//   3. 清理 dataset.ts(clearCategoryFromAllDatasets,含子孙)

import { writable, derived, get } from "svelte/store";
import { browser } from "$app/environment";
import { removeCategoryFromAllRules } from "./rule-category";
import { clearCategoryFromAllDatasets } from "./dataset";

/** 分类 */
export interface Category {
  /** 分类 ID */
  id: string;
  /** 分类名(如"诊疗规则"、"急诊") */
  name: string;
  /** 父分类 ID(null = 根分类) */
  parentId: string | null;
  /** 同级排序(从 0 开始) */
  order: number;
  /** 可选图标(emoji 或 icon name) */
  icon?: string;
  /** 创建时间 */
  createdAt: string;
}

/** 分类树节点(嵌套结构,UI 渲染用) */
export interface CategoryNode extends Category {
  children: CategoryNode[];
}

const STORAGE_KEY = "evorule-console-cloud:categories";

function loadCategories(): Category[] {
  if (!browser) return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Category[];
  } catch {
    return [];
  }
}

export const categoryStore = writable<Category[]>(loadCategories());

/** 持久化 */
categoryStore.subscribe((cats) => {
  if (!browser) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cats));
});

function genId(): string {
  return `cat_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

// === 读取 ===

/** 按 ID 获取分类 */
export function getCategory(id: string): Category | undefined {
  return get(categoryStore).find((c) => c.id === id);
}

// === 树形构建 ===

/** 构建分类树(从扁平列表,按 order 排序) */
export function buildTree(categories: Category[]): CategoryNode[] {
  const map = new Map<string, CategoryNode>();
  const roots: CategoryNode[] = [];

  // 第一遍:创建所有节点
  for (const cat of categories) {
    map.set(cat.id, { ...cat, children: [] });
  }

  // 第二遍:建立父子关系
  for (const cat of categories) {
    const node = map.get(cat.id);
    if (!node) continue;
    if (cat.parentId === null) {
      roots.push(node);
    } else {
      const parent = map.get(cat.parentId);
      if (parent) {
        parent.children.push(node);
      } else {
        // 父分类不存在,作为根节点(防止孤儿)
        roots.push(node);
      }
    }
  }

  // 递归排序
  const sortTree = (nodes: CategoryNode[]) => {
    nodes.sort((a, b) => a.order - b.order);
    nodes.forEach((n) => sortTree(n.children));
  };
  sortTree(roots);

  return roots;
}

/** 派生:分类树(UI 响应式渲染用) */
export const categoryTree = derived(categoryStore, ($cats) => buildTree($cats));

/** 获取父分类的直接子分类列表(非响应式) */
export function childrenOf(parentId: string | null): Category[] {
  const all = get(categoryStore);
  return all
    .filter((c) => c.parentId === parentId)
    .sort((a, b) => a.order - b.order);
}

/** 获取分类及其所有子孙分类 ID(筛选用,含自身) */
export function getCategoryAndDescendants(categoryId: string): string[] {
  const all = get(categoryStore);
  const result = [categoryId];
  const findChildren = (pid: string) => {
    all
      .filter((c) => c.parentId === pid)
      .forEach((c) => {
        result.push(c.id);
        findChildren(c.id);
      });
  };
  findChildren(categoryId);
  return result;
}

/** 祖先链(从根到自身,面包屑用) */
export function ancestorsOf(categoryId: string): Category[] {
  const all = get(categoryStore);
  const chain: Category[] = [];
  let current = all.find((c) => c.id === categoryId);
  // 防环:最多遍历 32 层
  let depth = 0;
  while (current && depth < 32) {
    chain.unshift(current);
    current = current.parentId ? all.find((c) => c.id === current!.parentId) : undefined;
    depth++;
  }
  return chain;
}

// === CRUD ===

/** 创建分类。@returns 新分类 ID */
export function createCategory(
  name: string,
  parentId: string | null = null,
  icon?: string,
): string {
  const id = genId();
  // 同级 order = 父下已有子分类数
  const siblings = childrenOf(parentId);
  const order = siblings.length;
  const cat: Category = {
    id,
    name,
    parentId,
    order,
    icon,
    createdAt: nowIso(),
  };
  categoryStore.update((all) => [...all, cat]);
  return id;
}

/** 更新分类(名称/父级/排序/图标) */
export function updateCategory(
  id: string,
  patch: Partial<Pick<Category, "name" | "parentId" | "order" | "icon">>,
): void {
  categoryStore.update((all) =>
    all.map((c) => (c.id === id ? { ...c, ...patch } : c)),
  );
}

/**
 * 删除分类(级联清理):
 * 1. 递归删除所有子孙分类
 * 2. 清理所有受影响分类的规则-分类关联(rule-category.ts)
 * 3. 清理所有受影响数据集的 categoryId(dataset.ts)
 */
export function deleteCategory(id: string): void {
  const toDelete = getCategoryAndDescendants(id);

  // 级联清理关联(含子孙)
  for (const catId of toDelete) {
    removeCategoryFromAllRules(catId);
    clearCategoryFromAllDatasets(catId);
  }

  // 删除分类(含子孙)
  const deleteSet = new Set(toDelete);
  categoryStore.update((all) => all.filter((c) => !deleteSet.has(c.id)));
}

/** 移动分类(改 parentId,重新计算 order) */
export function moveCategory(id: string, newParentId: string | null): void {
  // 防止将分类移动到自身或其子孙下(会成环)。
  // newParentId=null(移到根)时不可能成环,跳过检查。
  if (newParentId !== null) {
    const descendants = getCategoryAndDescendants(id);
    if (descendants.includes(newParentId)) {
      console.warn(
        `[moveCategory] 不能将分类 ${id} 移动到其子孙 ${newParentId} 下(会成环)`,
      );
      return;
    }
  }
  const siblings = childrenOf(newParentId).filter((c) => c.id !== id);
  const order = siblings.length;
  categoryStore.update((all) =>
    all.map((c) =>
      c.id === id ? { ...c, parentId: newParentId, order } : c,
    ),
  );
}
