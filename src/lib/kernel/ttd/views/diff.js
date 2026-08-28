// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// Diff 视图 — 双模式版本对比
//
// 两种模式:
//   1. 字段级(server):调 /api/diff?a=&b=,返回顶层字段 added/removed/changed 扁平列表
//   2. 深度(client):调 /api/rewind?a + /api/rewind?b,前端 deepDiff 递归对比
//
// UX:
//   - SESSION_SELECT: 重置(不自动跑,等用户切到本 tab)
//   - onShow: 首次打开时,用 selectedVersion 设默认 vA/vB,自动跑一次
//   - 修改 vA/vB/mode → 自动重跑

import { api } from '../core/api.js';
import { store } from '../core/store.js';
import { eventbus, EVENTS } from '../core/eventbus.js';
import { h, clear, esc } from '../core/dom.js';
import { deepDiff } from '../algorithms/deep-diff.js';
import { renderDiffTree } from '../components/diff-tree.js';

export const DiffView = {
  /** SESSION_SELECT → 重置(不自动跑,避免 timeline 还没加载完) */
  onSessionChange(id) {
    if (!id) return;
    store.setView('diff', { vA: null, vB: null, mode: 'server', result: null });
    // 若 diff 面板当前可见,清空显示
    const panel = document.getElementById('panel-diff');
    if (panel) {
      clear(panel);
      panel.appendChild(h('div', { class: 'empty' }, '点击"对比"计算差异'));
    }
  },

  /** 切到本 tab:首次打开时设默认 vA/vB 并自动跑 */
  onShow() {
    const state = store.getState();
    if (state.currentSessionId == null) return;
    const dv = state.views.diff;
    if (dv.vA === null) {
      const maxV = state.views.timeline.maxVersion || 0;
      const sel = state.selectedVersion || 0;
      const b = Math.min(sel, maxV);
      const a = Math.max(0, b - 1);
      store.setView('diff', { vA: a, vB: b });
    }
    if (dv.result === null) this.run();
  },

  async run() {
    const panel = document.getElementById('panel-diff');
    if (!panel) return;
    const state = store.getState();
    const { vA, vB, mode } = state.views.diff;
    const id = state.currentSessionId;
    if (id == null || vA == null || vB == null) {
      clear(panel);
      panel.appendChild(h('div', { class: 'empty' }, '请先选择 session 并设置 vA/vB'));
      return;
    }

    clear(panel);
    panel.appendChild(this.renderControls(state));
    panel.appendChild(h('div', { class: 'empty' }, '⏳ 计算差异...'));

    try {
      let result;
      if (mode === 'server') {
        result = await api.diff(id, vA, vB);
      } else {
        const [a, b] = await Promise.all([
          api.rewind(id, vA), api.rewind(id, vB)
        ]);
        result = { kind: 'deep', tree: deepDiff(a.payload, b.payload) };
      }
      store.setView('diff', { result });
      this.render();
    } catch (e) {
      clear(panel);
      panel.appendChild(this.renderControls(state));
      panel.appendChild(h('div', { class: 'error' }, `diff 失败: ${esc(e.message)}`));
    }
  },

  renderControls(state) {
    const { vA, vB, mode } = state.views.diff;
    return h('div', { class: 'actions-row' }, [
      h('label', {}, ['vA: ', h('input', {
        type: 'number', value: String(vA ?? 0), min: '0',
        style: { width: '70px' },
        onchange: (e) => {
          store.setView('diff', { vA: parseInt(e.target.value, 10) || 0 });
          this.run();
        }
      })]),
      h('label', {}, ['vB: ', h('input', {
        type: 'number', value: String(vB ?? 0), min: '0',
        style: { width: '70px' },
        onchange: (e) => {
          store.setView('diff', { vB: parseInt(e.target.value, 10) || 0 });
          this.run();
        }
      })]),
      h('label', {}, [
        h('select', {
          onchange: (e) => {
            store.setView('diff', { mode: e.target.value });
            this.run();
          }
        }, [
          h('option', { value: 'server', selected: mode === 'server' }, '字段级 (server)'),
          h('option', { value: 'client', selected: mode === 'client' }, '深度 (client)')
        ])
      ]),
      h('button', { onclick: () => this.run() }, '对比')
    ]);
  },

  render() {
    const panel = document.getElementById('panel-diff');
    if (!panel) return;
    const state = store.getState();
    const { result, mode } = state.views.diff;
    clear(panel);
    panel.appendChild(this.renderControls(state));

    if (!result) {
      panel.appendChild(h('div', { class: 'empty' }, '点击"对比"计算差异'));
      return;
    }

    if (mode === 'server') {
      panel.appendChild(renderServerDiff(result));
    } else {
      panel.appendChild(renderClientDiff(result));
    }
  }
};

// === server 模式:扁平字段级 ===
// D1-B 修复(2026-08-03):server /diff 返回 { items, removed, summary }
//   items 元素为元组:added → [key, value](2元组), changed → [key, old, new](3元组)
//   removed 单独返回:[[key, value], ...]
//   旧字段 added/changed 不再由 server 返回,从 items 中按元组长度分离。
function renderServerDiff(d) {
  const wrap = h('div', {});
  if (d.summary) {
    wrap.appendChild(h('div', { class: 'tooltip', style: { marginBottom: '8px' } }, esc(d.summary)));
  }

  // 兼容:优先用新契约 items;若旧后端仍返回 added/changed,也兜底(过渡期不崩)。
  const items = Array.isArray(d.items) ? d.items : [];
  const removed = Array.isArray(d.removed) ? d.removed : [];
  const added = items.length > 0
    ? items.filter((it) => Array.isArray(it) && it.length === 2)
    : (Array.isArray(d.added) ? d.added : []);
  const changed = items.length > 0
    ? items.filter((it) => Array.isArray(it) && it.length === 3)
    : (Array.isArray(d.changed) ? d.changed : []);

  if (added.length === 0 && removed.length === 0 && changed.length === 0) {
    wrap.appendChild(h('div', { class: 'empty' }, '两个版本完全相同(无字段级差异)'));
    return wrap;
  }

  if (added.length) {
    wrap.appendChild(h('div', { class: 'diff-section-head' }, `+ Added (${added.length})`));
    added.forEach(([k, v]) => wrap.appendChild(diffLine('added', k, undefined, v)));
  }
  if (removed.length) {
    wrap.appendChild(h('div', { class: 'diff-section-head' }, `- Removed (${removed.length})`));
    removed.forEach(([k, v]) => wrap.appendChild(diffLine('removed', k, v, undefined)));
  }
  if (changed.length) {
    wrap.appendChild(h('div', { class: 'diff-section-head' }, `~ Changed (${changed.length})`));
    changed.forEach(([k, old, nw]) => wrap.appendChild(diffLine('changed', k, old, nw)));
  }
  return wrap;
}

function diffLine(status, key, oldVal, newVal) {
  const marker = MARKER[status];
  let content;
  if (status === 'added') content = fmtVal(newVal);
  else if (status === 'removed') content = fmtVal(oldVal);
  else content = `${fmtVal(oldVal)} → ${fmtVal(newVal)}`;
  return h('div', { class: `diff-line ${status}` }, [
    h('span', {}, `${marker} `),
    h('span', { class: 'jt-key' }, `${key}: `),
    h('span', {}, content)
  ]);
}

const MARKER = { added: '+', removed: '-', changed: '~' };

function fmtVal(v) {
  if (v === undefined) return '∅';
  if (v === null) return 'null';
  if (typeof v === 'string') return `"${v}"`;
  if (typeof v === 'object') {
    try { return JSON.stringify(v); } catch { return String(v); }
  }
  return String(v);
}

// === client 模式:深度递归树 ===
function renderClientDiff(d) {
  return renderDiffTree(d.tree, 2);
}
