// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// locale 模块统一出口（展示层）— 红线：语言状态绝不注入会话事实/机器协议
export type { Locale, Dict, TParams } from "./types";
export { locale, initI18n, switchLocale, getLocale, t, translateServerError } from "./i18n.svelte";
export { fmtNumber, fmtDate, fmtDateTime, fmtTime } from "./format";