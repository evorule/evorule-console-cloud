// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// JSON Patch 应用工具(RFC 6902 子集实现)。
// 支持 replace / add / remove 3 个 op,支持嵌套路径 + 数组索引。
//
// 关联设计:P03_DATASET_DESIGN.md §4.7 + §8(json-patch.test.ts)
//
// 用途:数据集参数覆盖(DatasetParamOverride.patch)应用到规则 JSON。

import type { JsonPatch } from "$lib/types/json-patch";

/**
 * 对 JSON 字符串应用一组 JSON Patch,返回新 JSON 字符串。
 *
 * @param jsonStr 原始 JSON 字符串(如规则的 content)
 * @param patches JSON Patch 数组
 * @returns 应用 patch 后的 JSON 字符串;解析失败时返回原字符串(不抛错)
 *
 * @example
 * ```ts
 * const patched = applyJsonPatch(
 *   '{"params":{"threshold":100}}',
 *   [{ op: "replace", path: "/params/threshold", value: 200 }],
 * );
 * // → '{"params":{"threshold":200}}'
 * ```
 */
export function applyJsonPatch(jsonStr: string, patches: JsonPatch[]): string {
  if (!patches || patches.length === 0) return jsonStr;
  try {
    const obj = JSON.parse(jsonStr);
    const result = applyPatchesToObject(obj, patches);
    return JSON.stringify(result, null, 2);
  } catch {
    // JSON 解析失败:返回原字符串(不破坏规则)
    return jsonStr;
  }
}

/** 对已解析的对象应用 patches(原地修改的深拷贝) */
function applyPatchesToObject(obj: unknown, patches: JsonPatch[]): unknown {
  // 深拷贝避免修改原对象
  let result: unknown = structuredClone(obj);

  for (const patch of patches) {
    result = applySinglePatch(result, patch);
  }
  return result;
}

/** 应用单条 patch */
function applySinglePatch(root: unknown, patch: JsonPatch): unknown {
  const segments = parsePointer(patch.path);
  if (segments.length === 0) {
    // path = "/" → 替换整个根
    return patch.value;
  }

  // 确保根是可变对象(如果是原始类型,无法下钻)
  if (typeof root !== "object" || root === null) {
    return root;
  }

  // 深拷贝根对象(避免修改输入)
  const result = structuredClone(root) as Record<string, unknown> | unknown[];
  applyAtPath(result, segments, patch);
  return result;
}

/**
 * 解析 JSON Pointer 路径为段数组。
 * "/params/threshold" → ["params", "threshold"]
 * "/params/arr/0" → ["params", "arr", "0"]
 * "/" → []
 * "" → []
 */
function parsePointer(pointer: string): string[] {
  if (!pointer || pointer === "/") return [];
  // 去掉开头的 /
  const path = pointer.startsWith("/") ? pointer.slice(1) : pointer;
  return path.split("/").map(unescapeToken);
}

/** RFC 6902 转义还原:~1 → /, ~0 → ~ */
function unescapeToken(token: string): string {
  return token.replace(/~1/g, "/").replace(/~0/g, "~");
}

/**
 * 在 root 上沿 segments 路径应用 patch。
 * 原地修改 root 的深拷贝。
 */
function applyAtPath(
  root: Record<string, unknown> | unknown[],
  segments: string[],
  patch: JsonPatch,
): void {
  let current: unknown = root;

  // 导航到倒数第二层
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    current = navigate(current, seg);
    if (current === undefined || current === null) {
      return; // 路径不存在,跳过
    }
  }

  const lastSeg = segments[segments.length - 1];
  const parent = current;

  if (patch.op === "replace") {
    replaceAt(parent, lastSeg, patch.value);
  } else if (patch.op === "add") {
    addAt(parent, lastSeg, patch.value);
  } else if (patch.op === "remove") {
    removeAt(parent, lastSeg);
  }
}

/** 导航到子节点 */
function navigate(obj: unknown, seg: string): unknown {
  if (Array.isArray(obj)) {
    const idx = parseInt(seg, 10);
    if (isNaN(idx) || idx < 0 || idx >= obj.length) return undefined;
    return obj[idx];
  }
  if (typeof obj === "object" && obj !== null) {
    return (obj as Record<string, unknown>)[seg];
  }
  return undefined;
}

/** replace:替换已有值 */
function replaceAt(parent: unknown, seg: string, value: unknown): void {
  if (Array.isArray(parent)) {
    const idx = parseInt(seg, 10);
    if (!isNaN(idx) && idx >= 0 && idx < parent.length) {
      parent[idx] = value;
    }
  } else if (typeof parent === "object" && parent !== null) {
    (parent as Record<string, unknown>)[seg] = value;
  }
}

/** add:添加新值(对象:新增/覆盖 key;数组:在索引处插入) */
function addAt(parent: unknown, seg: string, value: unknown): void {
  if (Array.isArray(parent)) {
    const idx = parseInt(seg, 10);
    if (seg === "-") {
      // "-" 表示追加到末尾(RFC 6902)
      parent.push(value);
    } else if (!isNaN(idx) && idx >= 0 && idx <= parent.length) {
      parent.splice(idx, 0, value);
    }
  } else if (typeof parent === "object" && parent !== null) {
    (parent as Record<string, unknown>)[seg] = value;
  }
}

/** remove:删除值 */
function removeAt(parent: unknown, seg: string): void {
  if (Array.isArray(parent)) {
    const idx = parseInt(seg, 10);
    if (!isNaN(idx) && idx >= 0 && idx < parent.length) {
      parent.splice(idx, 1);
    }
  } else if (typeof parent === "object" && parent !== null) {
    delete (parent as Record<string, unknown>)[seg];
  }
}
