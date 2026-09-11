// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// evorule-console-cloud 轻量 i18n 核心 — Svelte store 反应式（模块级，避免 $state 重赋值限制）
//
// 红线（本项目）：本模块纯粹是「网页展示层」本地化。
// - 语言状态（locale）绝不注入会话事实（Command/PayloadUpdate）；
// - 不触碰机器协议标识符 / 哈希链 / 审计链；
// - t() 仅在浏览器渲染层求值。
import { browser } from "$app/environment";
import { writable } from "svelte/store";
import type { Dict, Locale, TParams } from "./types";
import { messagesZh } from "./messages.zh";

const STORAGE_KEY = "evorule.locale";
export const DEFAULT_LOCALE: Locale = "zh";

/** 当前语言 store（Svelte 5 兼容；组件内 `$locale` 订阅自动响应） */
export const locale = writable<Locale>(DEFAULT_LOCALE);

/** 中文默认字典（随包加载） */
const zhDict: Dict = messagesZh;

/** 英文字典的惰性加载缓存 */
let enDict: Dict | null = null;

async function loadEnDict(): Promise<Dict> {
  if (enDict) return enDict;
  const mod = await import("./messages.en");
  enDict = mod.messagesEn;
  return enDict;
}

/** 当前语言读取 helper（非组件上下文用） */
export function getLocale(): Locale {
  let l: Locale = "zh";
  locale.subscribe((v) => (l = v))();
  return l;
}

/**
 * 初始化：读取持久化语言（浏览器环境）。SSG/SSR 无 SSR，仅浏览器端生效。
 * 不抛错——读不到或非法一律回退默认 zh。
 */
export function initI18n(): Locale {
  let current = DEFAULT_LOCALE;
  if (browser) {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "zh" || saved === "en") current = saved;
    locale.set(current);
  }
  return current;
}

/** 切换语言：更新 store + <html lang> + 持久化。locale 为纯 UI 状态，不入会话事实。 */
export async function switchLocale(next: Locale): Promise<void> {
  if (next === "en") await loadEnDict(); // 确保英文字典可用
  locale.set(next);
  if (browser) {
    window.localStorage.setItem(STORAGE_KEY, next);
    document.documentElement.lang = next; // html lang 动态化
  }
}

/**
 * 翻译：在任意作用域按当前语言字典查 key，支持 {placeholder} 插值。
 * 组件内直接用 `$locale`（store 自动订阅响应）；非组件上下文可用此函数（取快照）。
 * 未命中 key 时回退英文→原 key（不静默、不丢信息），便于发现漏译。
 */
export function t(key: string, params?: TParams): string {
  const cur = getLocale();
  const dict = cur === "en" && enDict ? enDict : zhDict;
  let text = dict[key];
  if (text == null) {
    text = (enDict ?? {})[key] ?? key;
  }
  if (params && text.includes("{")) {
    for (const [k, v] of Object.entries(params)) {
      text = text.split(`{${k}}`).join(String(v));
    }
  }
  return text;
}

/**
 * 服务端错误本地化：优先按 server 返回的稳定 `code` 映射本地化文案；
 * 无 code / 未命中时回退原始 message（中文兜底，兼容老客户端）。
 * code 映射键约定 `err.{CODE}`（见 messages.{zh,en}）。
 */
export function translateServerError(message: string, code?: string | null): string {
  if (code) {
    const localized = t(`err.${code}`);
    // t 在未命中时返回 key 本身（"err.XXX"）；据此判断是否有真正译文
    if (localized !== `err.${code}`) return localized;
  }
  return message;
}