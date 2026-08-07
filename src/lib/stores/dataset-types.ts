// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 数据集类型定义(纯类型文件,避免 store 与 assemble-ruleset 循环依赖)。
//
// 关联设计:P03_DATASET_DESIGN.md §4.1

import type { JsonPatch } from "$lib/types/json-patch";

/** 数据集状态机:草稿 → 测试中 → 就绪 → 已发布 */
export type DatasetStatus = "draft" | "testing" | "ready" | "published";

/** 数据集内单条规则的参数覆盖(JSON Patch 格式) */
export interface DatasetParamOverride {
  /** 规则 ID(对应内核 rules store 的 Rule.id) */
  ruleId: string;
  /** JSON Patch 覆盖规则默认参数(op: replace/add/remove) */
  patch: JsonPatch[];
}

/** 数据集 = 规则的命名组合 + 参数配置(不复制规则内容,只存 ID 引用) */
export interface Dataset {
  /** 数据集 ID */
  id: string;
  /** 数据集名称(如"心内科核心规则集 v1") */
  name: string;
  /** 描述 */
  description: string;
  /** 规则 ID 列表(引用内核 rules store,不复制内容) */
  ruleIds: string[];
  /** 参数覆盖(按规则 ID) */
  paramOverrides: DatasetParamOverride[];
  /** 标签 ID 列表(多对多) */
  tagIds: string[];
  /** 分类 ID(一对一,null = 未分类) */
  categoryId: string | null;
  /** 状态 */
  status: DatasetStatus;
  /** 来源 workspace ID(三层架构 L2,P0 阶段固定 'default') */
  workspaceId: string;
  /** 创建时间(ISO 字符串) */
  createdAt: string;
  /** 最后更新时间 */
  updatedAt: string;
  /** 最后测试时间(L3 Sandbox 测试后更新) */
  lastTestedAt: string | null;
  /** 发布版本号(published 后有值,对应 production ruleset_version) */
  publishedVersion: number | null;
}
