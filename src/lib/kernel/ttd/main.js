// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// Time-Travel Debugger v1.0 — 应用入口
//
// 适配说明(evorule-console 内嵌副本,见 ./VERSION.md):
//   - 原 ttd main.js 末尾自动执行 `init()`,在浏览器 <script> 标签加载时跑
//   - 在 SvelteKit/vite 环境下,顶层副作用会在 import 时立刻执行,但 DOM 未就绪
//   - 适配:把 `init()` 改为 `export function initTtd(opts)`,由 Svelte 包装组件触发
//   - 新增 opts.skipAutoSelect:evorule-console 自己管理 session 选择时不让 ttd 自动选
//
// 职责:初始化 + tab 路由 + 全局快捷键 + API URL 绑定 + 全局事件订阅
//
// 事件流约定:
//   - VERSION_SELECT 是 canonical signal
//   - emitters(slider/keyboard)只 emit,不更新 store
//   - 本文件的 subscriber 统一更新 store.selectedVersion
//   - 各视图的 subscriber 做 UI 更新 / fetch

import { store } from './core/store.js';
import { eventbus, EVENTS } from './core/eventbus.js';
import { SessionList } from './components/session-list.js';
import { TimelineView } from './views/timeline.js';
import { StateView } from './views/state.js';
import { DiffView } from './views/diff.js';
import { CausalView } from './views/causal.js';
import { WhatIfView } from './views/whatif.js';

const VIEWS = {};

/** 注册视图 */
export function registerView(name, view) {
  VIEWS[name] = view;
}

// 注册全部 5 个视图
registerView('timeline', TimelineView);
registerView('state', StateView);
registerView('diff', DiffView);
registerView('causal', CausalView);
registerView('whatif', WhatIfView);

/** 切换 tab */
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t =>
    t.classList.toggle('active', t.dataset.tab === name)
  );
  document.querySelectorAll('.panel').forEach(p =>
    p.classList.toggle('active', p.id === `panel-${name}`)
  );
  eventbus.emit(EVENTS.TAB_SWITCH, name);

  // 视图懒加载:切到 tab 时才初始化
  if (VIEWS[name]?.onShow) {
    const state = store.getState();
    if (state.currentSessionId) VIEWS[name].onShow(state);
  }
}

/** 初始化 tab 点击 */
function initTabs() {
  document.querySelectorAll('.tab').forEach(t => {
    t.addEventListener('click', () => switchTab(t.dataset.tab));
  });
}

/** 初始化全局快捷键 */
function initKeyboard() {
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    const state = store.getState();
    const maxV = state.views.timeline.maxVersion || 0;

    switch (e.key) {
      case '/':
        e.preventDefault();
        document.getElementById('searchBox')?.focus();
        break;
      case 'F5':
        e.preventDefault();
        location.reload();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        eventbus.emit(EVENTS.VERSION_SELECT, Math.max(0, state.selectedVersion - 1));
        break;
      case 'ArrowRight':
        e.preventDefault();
        eventbus.emit(EVENTS.VERSION_SELECT, Math.min(maxV, state.selectedVersion + 1));
        break;
      case 'Home':
        e.preventDefault();
        eventbus.emit(EVENTS.VERSION_SELECT, 0);
        break;
      case 'End':
        e.preventDefault();
        eventbus.emit(EVENTS.VERSION_SELECT, maxV);
        break;
    }
  });
}

/** 初始化 API URL 输入 */
function initApiUrl() {
  const input = document.getElementById('apiUrl');
  if (!input) return;
  input.value = store.getState().apiUrl;
  input.addEventListener('change', () => {
    store.dispatch({ apiUrl: input.value });
    eventbus.emit(EVENTS.API_URL_CHANGE, input.value);
    SessionList.refresh();
  });
}

/** 初始化搜索框 */
function initSearch() {
  const input = document.getElementById('searchBox');
  if (!input) return;
  input.addEventListener('input', () => {
    store.dispatch({ searchTerm: input.value });
    eventbus.emit('search:change', input.value);
  });
}

/**
 * evorule-console 适配入口。
 *
 * @param {{ skipAutoSelect?: boolean, skipApiUrl?: boolean, skipKeyboard?: boolean }} opts
 *   - skipAutoSelect: evorule-console 自己管理 session 选择(走 ExecutionPad 创建/切换),不让 ttd 自动选第一个
 *   - skipApiUrl: evorule-console 通过 console-adapter 注入 backend,ttd 不需要 apiUrl 输入框
 *   - skipKeyboard: 若 console 已有全局快捷键处理,避免重复绑定
 * @returns {Promise<void>}
 */
export async function initTtd(opts = {}) {
  const { skipAutoSelect = false, skipApiUrl = false, skipKeyboard = false } = opts;

  initTabs();
  if (!skipKeyboard) initKeyboard();
  if (!skipApiUrl) initApiUrl();
  initSearch();

  // === 全局事件订阅 ===

  // VERSION_SELECT → 统一更新 store(emitters 不更新 store,只在这里更新)
  eventbus.on(EVENTS.VERSION_SELECT, (v) => {
    store.dispatch({ selectedVersion: v });
  });

  // SESSION_SELECT → 通知所有视图
  eventbus.on(EVENTS.SESSION_SELECT, (id) => {
    Object.values(VIEWS).forEach(v => v.onSessionChange?.(id));
  });

  await SessionList.refresh();

  // 自动选第一个 session(可由 opts.skipAutoSelect 关闭)
  if (!skipAutoSelect) {
    const first = document.querySelector('.session-item .id');
    if (first) {
      const id = parseInt(first.textContent.replace('#', ''), 10);
      if (!Number.isNaN(id)) SessionList.select(id);
    }
  }
}

/**
 * 清理 ttd(组件卸载时调用)。
 * 当前实现只重置 store;eventbus listeners 是 module-level 持久化的,
 * 多次挂载/卸载不会泄漏(重复 on 同一 handler 会被 Set 去重?需检查)。
 * TODO(P6):完整 listeners 清理需要 views 暴露 cleanup 接口。
 */
export function cleanupTtd() {
  store.reset();
}

// 适配说明:不再自动执行 init()。由 Svelte 包装组件在 onMount 中调用 initTtd()。

