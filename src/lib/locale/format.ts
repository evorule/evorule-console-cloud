// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// 数字/日期本地化抽象（展示层） — 替换散落的 toLocaleString('zh-CN')
import { getLocale } from "./i18n.svelte";

function toLocaleTag(): string {
  return getLocale() === "zh" ? "zh-CN" : "en-US";
}

/** 数字格式化（如 1,234.56） */
export function fmtNumber(n: number | bigint, opts?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(toLocaleTag(), opts).format(n);
}

/** 日期格式化 */
export function fmtDate(date: Date | number | string, opts?: Intl.DateTimeFormatOptions): string {
  const d = typeof date === "string" || typeof date === "number" ? new Date(date) : date;
  return new Intl.DateTimeFormat(toLocaleTag(), opts).format(d);
}

/** 日期时间完整格式化 */
export function fmtDateTime(date: Date | number | string): string {
  return fmtDate(date, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** 时间格式化（仅时分秒，随语言 12/24 小时制） */
export function fmtTime(date: Date | number | string, opts?: Intl.DateTimeFormatOptions): string {
  const d = typeof date === "string" || typeof date === "number" ? new Date(date) : date;
  return new Intl.DateTimeFormat(toLocaleTag(), {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    ...opts,
  }).format(d);
}