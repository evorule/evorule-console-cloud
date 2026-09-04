// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// 简单事件总线 — 跨视图通信

const listeners = new Map();

export const eventbus = {
  on(event, handler) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(handler);
    return () => this.off(event, handler);
  },

  off(event, handler) {
    listeners.get(event)?.delete(handler);
  },

  emit(event, data) {
    listeners.get(event)?.forEach(h => h(data));
  }
};

// 事件常量
export const EVENTS = {
  TAB_SWITCH: 'tab:switch',
  FACT_SELECT: 'fact:select',
  VERSION_SELECT: 'version:select',
  SESSION_SELECT: 'session:select',
  SESSION_DELETED: 'session:deleted', // UV-078 W1-A2:会话删除(当前会话被删时 id=null)
  API_URL_CHANGE: 'api:url-change',
  STATE_UPDATE: 'state:update'
};
