// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 统一空态类型定义。
// 4 类空态覆盖所有视图的"无内容"场景:
//   - no_data:       还没有数据(刚建库,还没有规则/数据集/审计记录)
//   - no_permission: 无权限(角色不允许查看此内容)
//   - load_failed:   加载失败(网络错误 / 后端未响应)
//   - not_configured:未配置(LLM 未配置 / 后端未连接 / 数据源未设置)

export type EmptyStateType =
  | "no_data"
  | "no_permission"
  | "load_failed"
  | "not_configured";
