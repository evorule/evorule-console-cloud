// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// i18n 类型定义 — evorule-console-cloud 轻量自研多语言（展示层，红线：不注入会话事实）

/** 支持的界面语言 */
export type Locale = "zh" | "en";

/** 翻译字典：扁平 key → 文本（支持 {placeholder} 插值） */
export type Dict = Record<string, string>;

/** t() 插值参数 */
export type TParams = Record<string, string | number>;