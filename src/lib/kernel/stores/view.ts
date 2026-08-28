// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// evorule-console 视图状态 store — 当前活动视图 + 持久化
//
// 依据: docs/IMPLEMENTATION_PLAN.md 阶段6
//
// 设计:
//   - evorule-console 用单页 + 顶部 tab 切换 5 视图(非多路由,因视图间共享 session 状态)
//   - 当前活动视图持久化到 localStorage,刷新后恢复
//   - VIEW_LIST 绑定每个视图对应的 evorule 本质属性,供导航栏展示
//
// 与 theme.ts 同风格:writable + 顶层 set 函数 + onMount 中 restore

import { writable } from 'svelte/store';

/** 5 个视图的 id(与导航 tab 一一对应) */
export type ViewId = 'rules' | 'execution' | 'state' | 'audit' | 'timetravel';

/** 视图元数据:id + 导航显示 + 对应的 evorule 本质属性 */
export interface ViewMeta {
  id: ViewId;
  /** 导航 tab 主标签 */
  label: string;
  /** 该视图展现的 evorule 本质(导航副标题/tooltip) */
  essence: string;
  /** 图标(emoji,无图标库依赖) */
  icon: string;
}

/**
 * 5 视图清单 — 顺序即导航排列顺序。
 * 每个视图至少对应 1 个 evorule 本质属性(SPEC §2 验收矩阵)。
 */
export const VIEW_LIST: ViewMeta[] = [
  { id: 'rules',      label: '规则库',   essence: '规则即数据',            icon: '📐' },
  { id: 'execution',  label: '执行台',   essence: '确定性执行',            icon: '▶' },
  { id: 'state',      label: '状态',     essence: 'JSON-in/out · 反应式', icon: '📦' },
  { id: 'audit',      label: '审计',     essence: '完整审计 · TCB 纯净',  icon: '🔍' },
  { id: 'timetravel', label: '时间旅行', essence: '可回放',                icon: '⏱' },
];

const STORAGE_KEY = 'evorule-console:current-view';
const DEFAULT_VIEW: ViewId = 'rules';

/** 按 id 查视图元数据(找不到返回 undefined) */
export function getViewMeta(id: ViewId): ViewMeta {
  const meta = VIEW_LIST.find(v => v.id === id);
  if (!meta) throw new Error(`getViewMeta: unknown view id "${id}"`);
  return meta;
}

/**
 * 当前活动视图 store。默认 'rules'(规则库作为首屏入口,体现"规则即数据")。
 *
 * 不在模块顶层读 localStorage(避免 SSR/prerender 与客户端 hydration 不一致),
 * 由 +layout.svelte onMount 调用 restoreView() 恢复。
 */
export const currentView = writable<ViewId>(DEFAULT_VIEW);

/**
 * 视图恢复完成标志 — 用于修复 +page.svelte 的 $effect 与 +layout.svelte 的 onMount 竞态。
 *
 * 问题:Svelte 5 中子组件 +page.svelte 的 $effect(检测 currentView==='rules' → goto /workspace)
 * 先于父组件 +layout.svelte 的 onMount(调用 restoreView 恢复真实视图)执行,
 * 导致全量加载到 / 时总是用默认值 'rules' 重定向,state/audit/timetravel/execution
 * 4 个分析视图无法通过直接导航到达(阶段 C.3.2 引入的回归)。
 *
 * 修复:+page.svelte 的 $effect 等待 restored=true 后再判断是否重定向。
 * restoreView() 末尾置 true。SSR 时 localStorage 不可用 → 提前返回,标志保持 false
 * (仅客户端 onMount 会真正恢复并置 true)。
 */
export const restored = writable<boolean>(false);

/** 切换视图 + 持久化 */
export function setView(view: ViewId): void {
  currentView.set(view);
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, view);
  }
}

/**
 * 从 localStorage 恢复上次视图(在 +layout.svelte onMount 中调用)。
 * 非法值(旧版本残留/手改)回退到默认视图。
 *
 * 恢复完成后置 restored=true,解锁 +page.svelte 的重定向 $effect。
 */
export function restoreView(): void {
  if (typeof localStorage === 'undefined') return;
  const saved = localStorage.getItem(STORAGE_KEY) as ViewId | null;
  if (saved && VIEW_LIST.some(v => v.id === saved)) {
    currentView.set(saved);
  } else {
    // 非法值清理
    localStorage.removeItem(STORAGE_KEY);
  }
  // 解锁 +page.svelte 的重定向 $effect(避免与默认值 'rules' 竞态)
  restored.set(true);
}
