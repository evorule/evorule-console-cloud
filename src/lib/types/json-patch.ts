// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// JSON Patch 类型(RFC 6902 子集)。
// P0 限制:只支持 replace / add / remove 3 个 op(不含 move/copy/test,P1+ 扩展)。
//
// 关联设计:P03_DATASET_DESIGN.md §4.7

/** JSON Patch 操作类型(RFC 6902 子集) */
export type JsonPatchOp = "replace" | "add" | "remove";

/** 单条 JSON Patch 操作 */
export interface JsonPatch {
  /** 操作类型 */
  op: JsonPatchOp;
  /** JSON Pointer 路径(如 "/params/threshold" 或 "/params/arr/0") */
  path: string;
  /** 新值(replace/add 用,remove 不需要) */
  value?: unknown;
}
