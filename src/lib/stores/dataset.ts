// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 数据集 store(CRUD + 4 状态机 + 派生筛选 + 级联清理)。
//
// 数据集 = 规则的命名组合 + 参数配置(只存 ruleIds,不复制规则内容)。
// 状态机: draft → testing → ready → published(非法转换被拒绝)。
//
// 持久化:localStorage(key: evorule-console-cloud:datasets)
//
// 关联设计:P03_DATASET_DESIGN.md §4.1 + §5.2 + §8.1 + §7.5(级联清理)

import { writable, derived, get } from "svelte/store";
import { browser } from "$app/environment";
import type { Dataset, DatasetStatus } from "./dataset-types";

const STORAGE_KEY = "evorule-console-cloud:datasets";

function loadDatasets(): Dataset[] {
  if (!browser) return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Dataset[];
  } catch {
    return [];
  }
}

export const datasetStore = writable<Dataset[]>(loadDatasets());

/** 持久化 */
datasetStore.subscribe((datasets) => {
  if (!browser) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(datasets));
});

function genId(): string {
  return `dataset_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

// === 读取 ===

/** 按 ID 获取数据集(非响应式) */
export function getDataset(id: string): Dataset | undefined {
  return get(datasetStore).find((ds) => ds.id === id);
}

// === CRUD ===

/**
 * 创建数据集。
 * @returns 新数据集 ID
 */
export function createDataset(
  name: string,
  description: string,
  ruleIds: string[],
  tagIds: string[] = [],
  categoryId: string | null = null,
): string {
  const id = genId();
  const now = nowIso();
  const dataset: Dataset = {
    id,
    name,
    description,
    ruleIds,
    paramOverrides: [],
    tagIds,
    categoryId,
    status: "draft",
    workspaceId: "default",
    createdAt: now,
    updatedAt: now,
    lastTestedAt: null,
    publishedVersion: null,
  };
  datasetStore.update((all) => [...all, dataset]);
  return id;
}

/** 更新数据集(名称/描述/规则列表/参数覆盖/标签/分类) */
export function updateDataset(
  id: string,
  patch: Partial<
    Pick<
      Dataset,
      | "name"
      | "description"
      | "ruleIds"
      | "paramOverrides"
      | "tagIds"
      | "categoryId"
    >
  >,
): void {
  datasetStore.update((all) =>
    all.map((ds) =>
      ds.id === id ? { ...ds, ...patch, updatedAt: nowIso() } : ds,
    ),
  );
}

/** 删除数据集 */
export function deleteDataset(id: string): void {
  datasetStore.update((all) => all.filter((ds) => ds.id !== id));
}

/**
 * 复制数据集(深拷贝,新 ID,状态回 draft,清空测试/发布信息)。
 * @returns 新数据集 ID
 */
export function duplicateDataset(sourceId: string): string {
  const source = get(datasetStore).find((ds) => ds.id === sourceId);
  if (!source) throw new Error(`Dataset ${sourceId} not found`);

  const newId = genId();
  const now = nowIso();
  const copy: Dataset = {
    ...source,
    id: newId,
    name: `${source.name} (副本)`,
    status: "draft",
    createdAt: now,
    updatedAt: now,
    lastTestedAt: null,
    publishedVersion: null,
  };
  datasetStore.update((all) => [...all, copy]);
  return newId;
}

// === 状态机(draft → testing → ready → published) ===

/** draft → testing(开始 L3 沙盒测试) */
export function startTesting(id: string): void {
  datasetStore.update((all) =>
    all.map((ds) =>
      ds.id === id && ds.status === "draft"
        ? { ...ds, status: "testing" as DatasetStatus, updatedAt: nowIso() }
        : ds,
    ),
  );
}

/** testing → ready(测试通过)。lastTestedAt 缺省为当前时间。 */
export function markReady(id: string, lastTestedAt?: string): void {
  const ts = lastTestedAt ?? nowIso();
  datasetStore.update((all) =>
    all.map((ds) =>
      ds.id === id && ds.status === "testing"
        ? {
            ...ds,
            status: "ready" as DatasetStatus,
            lastTestedAt: ts,
            updatedAt: ts,
          }
        : ds,
    ),
  );
}

/** ready → published(发布到 L1,需权限校验在调用方完成) */
export function publishDataset(id: string, publishedVersion: number): void {
  datasetStore.update((all) =>
    all.map((ds) =>
      ds.id === id && ds.status === "ready"
        ? {
            ...ds,
            status: "published" as DatasetStatus,
            publishedVersion,
            updatedAt: nowIso(),
          }
        : ds,
    ),
  );
}

/** 任意状态 → draft(回退到草稿,保留 publishedVersion 供追溯?设计未明确,这里清空) */
export function revertToDraft(id: string): void {
  datasetStore.update((all) =>
    all.map((ds) =>
      ds.id === id
        ? { ...ds, status: "draft" as DatasetStatus, updatedAt: nowIso() }
        : ds,
    ),
  );
}

// === 级联清理(规则/标签/分类删除时调用) ===

/**
 * 规则删除时:从所有数据集移除该规则 ID + 对应参数覆盖。
 * published 的数据集自动回退到 draft(已发布规则变了,需重新测试)。
 * @returns 受影响的数据集 ID 列表
 */
export function removeRuleFromAllDatasets(ruleId: string): string[] {
  const affectedIds: string[] = [];
  datasetStore.update((all) =>
    all.map((ds) => {
      if (!ds.ruleIds.includes(ruleId)) return ds;
      affectedIds.push(ds.id);
      return {
        ...ds,
        ruleIds: ds.ruleIds.filter((r) => r !== ruleId),
        paramOverrides: ds.paramOverrides.filter((p) => p.ruleId !== ruleId),
        // published 的数据集规则变了,回退到草稿
        status: ds.status === "published" ? ("draft" as DatasetStatus) : ds.status,
        updatedAt: nowIso(),
      };
    }),
  );
  return affectedIds;
}

/**
 * 标签删除时:从所有数据集的 tagIds 中移除该标签 ID。
 * 不改变数据集状态(标签删除不影响规则集内容)。
 */
export function removeTagFromAllDatasets(tagId: string): void {
  datasetStore.update((all) =>
    all.map((ds) =>
      ds.tagIds.includes(tagId)
        ? {
            ...ds,
            tagIds: ds.tagIds.filter((t) => t !== tagId),
            updatedAt: nowIso(),
          }
        : ds,
    ),
  );
}

/**
 * 分类删除时:将所有引用该分类的数据集的 categoryId 置为 null(变为未分类)。
 * 不改变数据集状态。
 */
export function clearCategoryFromAllDatasets(categoryId: string): void {
  datasetStore.update((all) =>
    all.map((ds) =>
      ds.categoryId === categoryId
        ? { ...ds, categoryId: null, updatedAt: nowIso() }
        : ds,
    ),
  );
}

// === 派生筛选 ===

/** 按 status 筛选 */
export function datasetsByStatus(status: DatasetStatus) {
  return derived(datasetStore, ($d) => $d.filter((ds) => ds.status === status));
}

/** 按标签筛选 */
export function datasetsByTag(tagId: string) {
  return derived(datasetStore, ($d) =>
    $d.filter((ds) => ds.tagIds.includes(tagId)),
  );
}

/** 按分类筛选 */
export function datasetsByCategory(categoryId: string) {
  return derived(datasetStore, ($d) =>
    $d.filter((ds) => ds.categoryId === categoryId),
  );
}
