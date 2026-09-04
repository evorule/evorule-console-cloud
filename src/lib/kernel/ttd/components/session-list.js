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
          h('div', { class: 'meta' }, `${ver} ${esc(phase)}`.trim()),
          // UV-084 W1-A2:会话派生按钮(从父会话派生变体,记录跨会话因果)
          h('button', {
            class: 'session-derive',
            title: '从此会话派生新会话(记录跨会话因果)',
            'aria-label': `派生会话 ${sid}`,
            onclick: (e) => {
              e.stopPropagation();
              this.derive(sid);
            }
          }, '⎇'),
          // UV-078 W1-A2:会话删除按钮(悬停显示,阻止冒泡避免触发选中)
          h('button', {
            class: 'session-del',
            title: '删除此会话',
            'aria-label': `删除会话 ${sid}`,
            onclick: (e) => {
              e.stopPropagation();
              this.remove(sid);
            }
          }, '×')
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
  },

  /**
   * 删除会话(UV-078 W1-A2)。
   * 二次确认 → DELETE /api/sessions/{id} → 刷新列表;
   * 若删除的是当前选中会话,清空选中态并广播 SESSION_DELETED(null) 通知视图退出会话上下文。
   * 删除失败如实呈现(err item),不静默。
   */
  async remove(id) {
    if (!window.confirm(`确认删除会话 #${id}?其审计链与 WAL 将一并移除,不可恢复。`)) return;
    try {
      await api.closeSession(id);
      const state = store.getState();
      if (state.currentSessionId === id) {
        store.dispatch({ currentSessionId: null, selectedVersion: 0 });
        eventbus.emit(EVENTS.SESSION_DELETED, null);
      }
      await this.refresh();
    } catch (e) {
      const listEl = document.getElementById('sessionList');
      if (listEl) {
        listEl.appendChild(
          h('li', { class: 'session-item session-del-error' }, `删除 #${id} 失败: ${esc(e.message)}`)
        );
      }
    }
  },

  /**
   * 派生会话(UV-084 W1-A2)。
   * POST /api/sessions/from/{id} → 从父会话(当前最新版本)派生新会话,
   * 记录跨会话因果(父会话 ID + 初始内容哈希)。派生后刷新列表并选中新会话。
   * 失败如实呈现(err item),不静默。
   */
  async derive(id) {
    try {
      const r = await api.createSessionFrom(id);
      const newId = (r && typeof r.session_id === 'number') ? r.session_id : r;
      await this.refresh();
      if (typeof newId === 'number') {
        this.select(newId);
      }
    } catch (e) {
      const listEl = document.getElementById('sessionList');
      if (listEl) {
        listEl.appendChild(
          h('li', { class: 'session-item session-del-error' }, `派生 #${id} 失败: ${esc(e.message)}`)
        );
      }
    }
  },

  /**
   * 回收已结束/已过期会话(UV-084 W1-A3)。
   * POST /api/sessions/reap → 与后台 reaper 走同一 reap_once(生产会话
   * 保活不受影响,UV-079)。结果计数临时显示在列表底部,3s 后自动消失。
   * 失败如实呈现(err item),不静默。
   */
  async reap() {
    if (!window.confirm('确认回收已结束/已过期的会话?(活跃会话与生产会话不受影响)')) return;
    try {
      const r = await api.reap();
      await this.refresh();
      const listEl = document.getElementById('sessionList');
      if (listEl) {
        const msg = `已回收 ${r.total} 个会话(已结束 ${r.finished} / 已过期 ${r.expired})`;
        const item = h('li', { class: 'session-item session-reap-info' }, esc(msg));
        listEl.appendChild(item);
        setTimeout(() => item.remove(), 3000);
      }
    } catch (e) {
      const listEl = document.getElementById('sessionList');
      if (listEl) {
        listEl.appendChild(
          h('li', { class: 'session-item session-del-error' }, `回收失败: ${esc(e.message)}`)
        );
      }
    }
  }
};
