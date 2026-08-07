// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 业务术语库 store(v0)。
// P0-1 基础:6 条 builtin + CRUD + synonyms 数组
// v0 扩展:status / aliases / relatedTermIds / evorulePaths / deprecatedBy
//
// 持久化:localStorage(key: evorule-console-cloud:business-terms:user)
//   - builtin(代码内置,12 条起步)+ user(用户自定义)
//
// 关联设计:P02_BUSINESS_LANGUAGE_V0_DESIGN.md §4.1 + §3.1(同义词归一化 + 前缀索引)

import { writable, derived, get } from "svelte/store";
import { browser } from "$app/environment";
import { BUILTIN_BUSINESS_TERMS } from "$lib/data/business-terms-builtin";
import { dbStore } from "$lib/stores/db";

export type TermStatus = "draft" | "active" | "deprecated";

export interface BusinessTerm {
  /** 术语 ID,如 'finance.amount' */
  id: string;
  /** 行业:finance / compliance / medical / legal / ... */
  industry: string;
  /** 中文标签 */
  label: string;
  /** 英文 key(对应 evorule JSON 字段) */
  key: string;
  /** 主同义词数组(用于业务语言筛选 + 匹配) */
  synonyms: string[];
  /** 别名(更广的匹配范围,如缩写 / 旧名) */
  aliases?: string[];
  /** 业务解释(LLM 解释时用作上下文) */
  description: string;
  /** v0 新增:状态 */
  status: TermStatus;
  /** v0 新增:关联术语 ID(同义词跨行业时关联) */
  relatedTermIds?: string[];
  /** v0 新增:对应 evorule JSON 路径列表 */
  evorulePaths?: string[];
  /** v0 新增:弃用时指向替代术语 ID */
  deprecatedBy?: string;
  /** v0 新增:版本号(从 1 开始,改 key 时 +1) */
  version: number;
  /** v0 新增:创建时间(用户术语用) */
  createdAt?: string;
}

const STORAGE_KEY = "evorule-console-cloud:business-terms:user";

function loadTerms(): BusinessTerm[] {
  if (!browser) return BUILTIN_BUSINESS_TERMS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return BUILTIN_BUSINESS_TERMS;
    const userTerms = JSON.parse(raw) as BusinessTerm[];
    return [...BUILTIN_BUSINESS_TERMS, ...userTerms];
  } catch {
    return BUILTIN_BUSINESS_TERMS;
  }
}

export const businessTermsStore = writable<BusinessTerm[]>(loadTerms());

// 持久化(只存 user 术语,builtin 不存)
businessTermsStore.subscribe((terms) => {
  if (!browser) return;
  const userTerms = terms.filter(
    (t) => !BUILTIN_BUSINESS_TERMS.find((b) => b.id === t.id),
  );
  localStorage.setItem(STORAGE_KEY, JSON.stringify(userTerms));
});

// === v0 新增:派生 store ===

/** 当前行业激活术语(过滤 draft / deprecated) */
export const activeTermsByIndustry = derived(
  [businessTermsStore, dbStore],
  ([$terms, $db]) =>
    $terms.filter((t) => t.industry === $db.industry && t.status === "active"),
);

// === v0 新增:同义词归一化 + 前缀索引(决策 §3.1) ===

const normalize = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, "")
    .replace(/\s+/g, " ")
    .trim();

// normalizedSynonym/prefix -> termId[]
let synonymIndex: Map<string, string[]> = new Map();

function rebuildIndex(): void {
  synonymIndex = new Map();
  const all = get(businessTermsStore);
  for (const term of all) {
    if (term.status === "draft") continue;
    const candidates = [term.label, ...term.synonyms, ...(term.aliases ?? [])];
    for (const cand of candidates) {
      const norm = normalize(cand);
      if (!norm) continue;
      // 前缀索引:存前 1/2/3/... 字符,支持输入时实时匹配
      for (let i = 1; i <= norm.length; i++) {
        const prefix = norm.slice(0, i);
        const e = synonymIndex.get(prefix) ?? [];
        if (!e.includes(term.id)) e.push(term.id);
        synonymIndex.set(prefix, e);
      }
      const full = synonymIndex.get(norm) ?? [];
      if (!full.includes(term.id)) full.push(term.id);
      synonymIndex.set(norm, full);
    }
  }
}

// 启动时构建索引(浏览器侧)
if (browser) rebuildIndex();

// === 便捷函数 ===

/** 按行业查询激活术语 */
export function getActiveTermsByIndustry(industry: string): BusinessTerm[] {
  return get(businessTermsStore).filter(
    (t) => t.industry === industry && t.status === "active",
  );
}

/** 按行业查询全部术语(含 draft / deprecated,术语管理器用) */
export function getTermsByIndustry(industry: string): BusinessTerm[] {
  return get(businessTermsStore).filter((t) => t.industry === industry);
}

/** 同义词前缀匹配(返回 termId 列表,带行业优先级) */
export function matchTerms(
  query: string,
  industry?: string,
  limit = 10,
): BusinessTerm[] {
  if (!query.trim()) return [];
  const norm = normalize(query);
  const termIds = synonymIndex.get(norm) ?? [];
  const all = get(businessTermsStore);
  const terms = termIds
    .map((id) => all.find((t) => t.id === id))
    .filter((t): t is BusinessTerm => t !== undefined && t.status !== "draft");

  // 行业优先级:当前行业优先,其他行业靠后
  const targetIndustry = industry ?? get(dbStore).industry;
  const sorted = terms.sort((a, b) => {
    const aMatch = a.industry === targetIndustry ? 0 : 1;
    const bMatch = b.industry === targetIndustry ? 0 : 1;
    return aMatch - bMatch;
  });

  return sorted.slice(0, limit);
}

/** 按前缀查术语 ID 列表(FactStreamView 术语高亮用,§4.5.2) */
export function findTermsByPrefix(text: string): string[] {
  if (!text || !text.trim()) return [];
  const norm = normalize(text);
  // 取最长前缀命中
  for (let i = norm.length; i >= 1; i--) {
    const hit = synonymIndex.get(norm.slice(0, i));
    if (hit && hit.length > 0) return hit;
  }
  return [];
}

/** 按 ID 批量取术语 */
export function getTermsByIds(ids: string[]): BusinessTerm[] {
  const all = get(businessTermsStore);
  return ids
    .map((id) => all.find((t) => t.id === id))
    .filter((t): t is BusinessTerm => t !== undefined);
}

/** v0 新增:CRUD */
export function addBusinessTerm(
  term: Omit<BusinessTerm, "id" | "version">,
): string {
  // 校验:同 industry + 同 key 不能重复
  const existing = get(businessTermsStore).find(
    (t) => t.industry === term.industry && t.key === term.key,
  );
  if (existing) {
    throw new Error(`术语已存在: ${term.industry}.${term.key}`);
  }
  const id = `${term.industry}.${term.key}`;
  businessTermsStore.update((list) => [
    ...list,
    { ...term, id, version: 1, createdAt: new Date().toISOString() },
  ]);
  rebuildIndex();
  return id;
}

export function updateBusinessTerm(
  id: string,
  patch: Partial<BusinessTerm>,
): void {
  businessTermsStore.update((list) =>
    list.map((t) => {
      if (t.id !== id) return t;
      // key 不能改(被规则引用会破坏关联)
      if (patch.key && patch.key !== t.key) {
        throw new Error("术语 key 不能修改,请新建术语并弃用旧的");
      }
      return { ...t, ...patch, version: t.version + 1 };
    }),
  );
  rebuildIndex();
}

/** v0 新增:弃用术语(不删除,标记 status + deprecatedBy) */
export function deprecateBusinessTerm(
  id: string,
  deprecatedBy?: string,
): void {
  businessTermsStore.update((list) =>
    list.map((t) =>
      t.id === id
        ? { ...t, status: "deprecated", deprecatedBy, version: t.version + 1 }
        : t,
    ),
  );
  rebuildIndex();
}

/** 重建索引(批量导入术语后调用) */
export function rebuildSynonymIndex(): void {
  rebuildIndex();
}
