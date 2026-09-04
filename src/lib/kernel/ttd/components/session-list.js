// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// 会话列表组件 — 左侧栏 session 选择

import { api } from '../core/api.js';
import { store } from '../core/store.js';
import { eventbus, EVENTS } from '../core/eventbus.js';
import { h, clear, esc } from '../core/dom.js';

export const SessionList = {
  /** 刷新会话列表 */
  async refresh() {
    const listEl = document.getElementById('sessionList');
    if (!listEl) return;
    try {
      const data = await api.listSessions();
      const sessions = data.sessions || data || [];
      store.dispatch({ sessions });
      clear(listEl);

      if (sessions.length === 0) {
        listEl.appendChild(
          h('li', { class: 'session-item' }, '无 session · 通过 POST /api/sessions 创建')
        );
        return;
      }

      const currentId = store.getState().currentSessionId;
      sessions.forEach(s => {
        // UV-055:/api/sessions 响应为纯 id 数组(u64),非对象 —— 直接按 id 渲染;
        // 归一化兼容对象形态(带 version/phase 的富元数据)以备未来扩展
        const isObj = typeof s === 'object' && s !== null;
        const sid = isObj ? s.id : s;
        const meta = isObj ? s : {};
        const isActive = currentId === sid;
        const ver = meta.version !== undefined ? `v${meta.version}` : '';
        const phase = meta.phase || '';
        const li = h('li', {
          class: `session-item${isActive ? ' active' : ''}`,
          onclick: () => this.select(sid)
        }, [
          h('div', { class: 'id' }, `#${sid}`),
          h('div', { class: 'meta' }, `${ver} ${esc(phase)}`.trim())
        ]);
        listEl.appendChild(li);
      });
    } catch (e) {
      clear(listEl);
      listEl.appendChild(
        h('li', { class: 'session-item' }, `加载失败: ${esc(e.message)}`)
      );
    }
  },

  /** 选择会话 */
  select(id) {
    store.dispatch({ currentSessionId: id, selectedVersion: 0 });
    eventbus.emit(EVENTS.SESSION_SELECT, id);
    this.refresh();
  }
};
