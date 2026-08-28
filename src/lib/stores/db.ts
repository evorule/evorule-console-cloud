// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 库元数据 store(2026-08-06 同步 P01 §4.2 — 派生计算替代持久化字段)。
// 设计:
//   - 只管"库元数据"(库名、业务对象、行业、创建时间)
//   - 不管规则(规则在内核 rules store,见 P0-1 §3.1 决策 1)
//   - 空库判断 = 内核 rules store 是否为空(派生计算,不在 dbStore)
// 持久化:localStorage(key: evorule-console-cloud:db-meta)

import { writable, derived, get } from "svelte/store";
import { browser } from "$app/environment";
import { rules } from "$lib/kernel";

export type Industry = "blank" | "finance" | "compliance" | "medical";

export interface DbMeta {
  /** 库 ID(P0 阶段固定 'default',P1+ 多库时扩展) */
  dbId: string;
  /** 库名(用户在向导里填) */
  dbName: string;
  /** 业务对象类型(病人/案件/订单/自定义...) */
  businessObjects: string[];
  /** 行业模板来源(blank / finance / compliance) */
  industry: Industry;
  /** 创建时间(ISO 字符串,null = 未初始化) */
  createdAt: string | null;
}

const DEFAULT_DB: DbMeta = {
  dbId: "default",
  dbName: "",
  businessObjects: [],
  industry: "blank",
  createdAt: null,
};

const STORAGE_KEY = "evorule-console-cloud:db-meta";

function loadDbMeta(): DbMeta {
  if (!browser) return DEFAULT_DB;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_DB;
    const parsed = JSON.parse(raw) as Partial<DbMeta>;
    return {
      dbId: typeof parsed.dbId === "string" ? parsed.dbId : "default",
      dbName: typeof parsed.dbName === "string" ? parsed.dbName : "",
      businessObjects: Array.isArray(parsed.businessObjects)
        ? parsed.businessObjects
        : [],
      industry:
        parsed.industry === "finance" ||
        parsed.industry === "compliance" ||
        parsed.industry === "medical" ||
        parsed.industry === "blank"
          ? parsed.industry
          : "blank",
      createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : null,
    };
  } catch {
    return DEFAULT_DB;
  }
}

export const dbStore = writable<DbMeta>(loadDbMeta());

dbStore.subscribe((d) => {
  if (!browser) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(d));
});

// === 派生:空库判断(基于内核 rules store) ===

/** 是否空库(内核 rules store 为空) */
export const isEmptyDb = derived(rules, ($rules) => $rules.length === 0);

/** 当前规则数(派生,来自内核 rules store) */
export const ruleCount = derived(rules, ($rules) => $rules.length);

// === 便捷更新函数 ===

export function initDb(
  dbName: string,
  businessObjects: string[],
  industry: Industry,
): void {
  dbStore.set({
    dbId: "default",
    dbName,
    businessObjects,
    industry,
    createdAt: new Date().toISOString(),
  });
}

export function resetDb(): void {
  dbStore.set({ ...DEFAULT_DB });
}

/** 同步检查是否空库(非响应式,用于路由守卫) */
export function checkEmptyDb(): boolean {
  return get(rules).length === 0;
}
