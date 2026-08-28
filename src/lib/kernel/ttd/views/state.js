// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// State 视图 — 显示指定 version 的 payload 快照
//
// 职责:
//   - SESSION_SELECT: 重置,加载 v0
//   - VERSION_SELECT: 防抖加载该 version 的 payload(rewind API)
//   - 用 json-viewer 渲染 payload(可折叠树)
//
// rewind 响应(console-adapter 注入 backend.getStateAtVersion):
//   HistoricalState { payload, queue, version }
//   其中 version 已由 console HttpBackend 映射自 server 的 actual_version。
//   兼容:若直接调 server(未注入 backend),响应含 actual_version,也兜底读取。

import { api } from '../core/api.js';
import { store } from '../core/store.js';
import { eventbus, EVENTS } from '../core/eventbus.js';
import { h, clear, esc, debounce } from '../core/dom.js';
import { renderJson } from '../components/json-viewer.js';

export const StateView = {
  /** SESSION_SELECT → 重置 + 加载 v0 */
  async onSessionChange(id) {
    if (!id) return;
    store.setView('state', { version: null, payload: null });
    await this.loadVersion(id, 0);
  },

  /** 切到本 tab 时,若未加载则触发加载 */
  onShow() {
    const state = store.getState();
    if (state.currentSessionId && state.views.state.payload === null) {
      this.loadVersion(state.currentSessionId, state.selectedVersion || 0);
    }
  },

  async loadVersion(id, version) {
    const panel = document.getElementById('panel-state');
    if (!panel) return;
    clear(panel);
    panel.appendChild(h('div', { class: 'empty' }, `⏳ 加载 v${version} 状态...`));

    try {
      const data = await api.rewind(id, version);
      const payload = data.payload ?? data;
      // D2-A 修复(2026-08-03):HistoricalState.version 已映射 actual_version;
      //   兼容直接调 server 的场景(actual_version 字段)。
      const actualV = data.version ?? data.actual_version ?? version;
      store.setView('state', { version: actualV, payload });
      this.render();
    } catch (e) {
      clear(panel);
      panel.appendChild(h('div', { class: 'error' },
        `加载 v${version} 失败: ${esc(e.message)}`));
    }
  },

  render() {
    const panel = document.getElementById('panel-state');
    if (!panel) return;
    const { version, payload } = store.getState().views.state;
    clear(panel);

    if (payload === null || payload === undefined) {
      panel.appendChild(h('div', { class: 'empty' }, '从左侧选择一个 session'));
      return;
    }

    panel.appendChild(h('div', { class: 'actions-row' }, [
      h('span', { class: 'ver', style: { color: 'var(--accent)', fontWeight: '600' } },
        `version: ${version}`)
    ]));

    panel.appendChild(h('h3', {
      style: { fontSize: '12px', color: 'var(--text-dim)', marginBottom: '6px', textTransform: 'uppercase' }
    }, 'Payload'));

    panel.appendChild(renderJson(payload, { expandDepth: 2 }));
  }
};

// === 事件订阅 ===

// VERSION_SELECT → 防抖加载(拖拽滑块时不会请求风暴)
const debouncedLoad = debounce((id, v) => StateView.loadVersion(id, v), 300);
eventbus.on(EVENTS.VERSION_SELECT, (v) => {
  const state = store.getState();
  if (state.currentSessionId != null) {
    debouncedLoad(state.currentSessionId, v);
  }
});
