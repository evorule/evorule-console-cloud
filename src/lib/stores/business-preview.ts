// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 业务预览 store(v0 新增)。
// 设计:
//   - 结构化解释(本地计算,无需 LLM)
//   - LLM 自然语言解释(可选,带缓存)
//   - 缓存失效:ruleId + contentHash
//
// 持久化:localStorage(key: evorule-console-cloud:rule-explain:${ruleId}:${contentHash})
//
// 关联设计:P02_BUSINESS_LANGUAGE_V0_DESIGN.md §4.4 + §3.5(结构化)+ §3.6(缓存)

import { browser } from "$app/environment";

/** v0 新增:结构化解释(决策 §3.5) */
export interface StructuredExplanation {
  /** "如果"部分,如 "金额 > 10000 元" */
  ifPart: string;
  /** "则"部分,如 "通知 CFO 审批" */
  thenPart: string;
  /** "否则"部分(若有 else 分支) */
  elsePart?: string;
  /** 涉及的业务术语(用于高亮) */
  terms: Array<{
    termId: string;
    label: string;
    matchedText: string;
  }>;
  /** 使用的模板 ID(用于"为什么这么解释"追溯) */
  templateId: string;
}

/** v0 新增:规则 diff(决策 §3.9) */
export interface RuleDiff {
  changedFields: Array<{
    field: string;
    oldValue: unknown;
    newValue: unknown;
    businessImpact: string;
  }>;
  addedFields: string[];
  removedFields: string[];
}

/** v0 新增:预览缓存条目 */
export interface PreviewCacheEntry {
  ruleId: string;
  contentHash: string;
  structured: StructuredExplanation;
  llmExplanation?: string;
  cachedAt: string;
}

const CACHE_PREFIX = "evorule-console-cloud:rule-explain:";

/**
 * 内容 hash(FNV-1a 32-bit,截取前 8 字符)。
 *
 * 简化实现避免引入 crypto.subtle(异步 + 兼容性问题)。
 * 用于缓存失效,非密码学用途,碰撞概率可接受。
 */
export function hashContent(content: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < content.length; i++) {
    hash ^= content.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** v0 新增:读缓存 */
export function getCachedExplanation(
  ruleId: string,
  content: string,
): PreviewCacheEntry | null {
  if (!browser) return null;
  const hash = hashContent(content);
  const key = `${CACHE_PREFIX}${ruleId}:${hash}`;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as PreviewCacheEntry) : null;
  } catch {
    return null;
  }
}

/** v0 新增:写缓存 */
export function setCachedExplanation(entry: PreviewCacheEntry): void {
  if (!browser) return;
  const key = `${CACHE_PREFIX}${entry.ruleId}:${entry.contentHash}`;
  try {
    localStorage.setItem(key, JSON.stringify(entry));
  } catch (e) {
    // localStorage 满(可能 5MB 用尽),静默失败
    console.warn("[business-preview] 缓存写入失败:", e);
  }
}

/**
 * 计算 BusinessPreview 在 UI 使用的 key(响应式缓存命中判断)。
 * 不持久化,组件内 $derived 派生。
 */
export function previewCacheKey(ruleId: string, content: string): string {
  return `${CACHE_PREFIX}${ruleId}:${hashContent(content)}`;
}
