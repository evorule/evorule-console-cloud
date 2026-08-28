// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// Causal 视图 — 因果链 DAG 可视化(SVG)
//
// 职责:
//   - FACT_SELECT(来自 timeline): 加载该 fact 的因果链,渲染 DAG
//   - 点击 DAG 节点: 重新加载该节点的因果链(交互式探索)
//
// SVG 渲染:
//   - 用 innerHTML 字符串构建(SVG 元素需要 createElementNS,h() 不适用)
//   - 事件委托:在容器上监听 click,通过 closest('.dag-node') 找到目标节点
//
// causal chain 响应:
//   {session_id, fact_id, chain_length, chain: [{fact_id, fact_type, logical_time, content_hash, prev_hash, cause}]}

import { api } from '../core/api.js';
import { store } from '../core/store.js';
import { eventbus, EVENTS } from '../core/eventbus.js';
import { h, clear, esc } from '../core/dom.js';
import { layoutDag, LAYOUT_CONST } from '../algorithms/dag-layout.js';

export const CausalView = {
  /** SESSION_SELECT → 重置 */
  onSessionChange(id) {
    if (!id) return;
    store.setView('causal', { focusFactId: null, chain: [] });
    const panel = document.getElementById('panel-causal');
    if (panel) {
      clear(panel);
      panel.appendChild(h('div', { class: 'empty' },
        '在「时间线」视图中点击一个 fact 查看其因果链'));
    }
  },

  /** 切到本 tab:若无 focus fact,提示用户 */
  onShow() {
    const state = store.getState();
    if (!state.views.causal.focusFactId) {
      const panel = document.getElementById('panel-causal');
      if (panel && panel.children.length === 0) {
        panel.appendChild(h('div', { class: 'empty' },
          '在「时间线」视图中点击一个 fact 查看其因果链'));
      }
    }
  },

  /** 加载指定 fact 的因果链 */
  async loadChain(factId) {
    const panel = document.getElementById('panel-causal');
    if (!panel) return;
    const id = store.getState().currentSessionId;
    if (id == null) return;

    clear(panel);
    panel.appendChild(h('div', { class: 'empty' },
      `⏳ 加载 fact #${factId} 的因果链...`));

    try {
      const data = await api.causal(id, factId);
      const chain = data.chain || [];
      store.setView('causal', { focusFactId: factId, chain });
      this.render();
    } catch (e) {
      clear(panel);
      panel.appendChild(h('div', { class: 'error' },
        `加载因果链失败: ${esc(e.message)}`));
    }
  },

  render() {
    const panel = document.getElementById('panel-causal');
    if (!panel) return;
    const { focusFactId, chain } = store.getState().views.causal;
    clear(panel);

    if (!focusFactId) {
      panel.appendChild(h('div', { class: 'empty' },
        '在「时间线」视图中点击一个 fact 查看其因果链'));
      return;
    }

    if (chain.length === 0) {
      panel.appendChild(h('div', { class: 'empty' },
        `fact #${focusFactId} 无因果链数据`));
      return;
    }

    const { nodes, edges, layerCount, width, height } = layoutDag(chain);
    const { NODE_W, NODE_H } = LAYOUT_CONST;
    const offsetX = width / 2;
    const offsetY = 20;

    panel.appendChild(h('div', { class: 'actions-row' }, [
      h('span', { class: 'ver', style: { color: 'var(--accent)', fontWeight: '600' } },
        `fact #${focusFactId}`),
      h('span', { class: 'tooltip' },
        `${chain.length} 节点 · ${layerCount} 层 · 点击节点切换焦点`)
    ]));

    // 构建 SVG 字符串
    const svgParts = [];

    // arrow marker 定义
    svgParts.push(
      `<defs>
        <marker id="dag-arrow" viewBox="0 0 10 10" refX="10" refY="5"
                markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#8b949e"/>
        </marker>
      </defs>`
    );

    // 边(贝塞尔曲线)
    edges.forEach(e => {
      const from = nodes.find(n => n.fact_id === e.from);
      const to = nodes.find(n => n.fact_id === e.to);
      if (!from || !to) return;
      const x1 = from.x + offsetX;
      const y1 = from.y + offsetY + NODE_H;
      const x2 = to.x + offsetX;
      const y2 = to.y + offsetY;
      const dy = (y2 - y1) / 2;
      const isHighlight = to.fact_id === focusFactId || from.fact_id === focusFactId;
      svgParts.push(
        `<path class="dag-edge${isHighlight ? ' highlight' : ''}"
          d="M ${x1} ${y1} C ${x1} ${y1 + dy}, ${x2} ${y2 - dy}, ${x2} ${y2}"
          marker-end="url(#dag-arrow)"/>`
      );
    });

    // 节点
    nodes.forEach(n => {
      const x = n.x + offsetX - NODE_W / 2;
      const y = n.y + offsetY;
      const selected = n.fact_id === focusFactId;
      const typeShort = (n.fact_type || '?').replace('StateTransition', 'ST').replace('PayloadUpdate', 'PU');
      svgParts.push(
        `<g class="dag-node${selected ? ' selected' : ''}"
           transform="translate(${x}, ${y})" data-fact-id="${n.fact_id}"
           style="cursor:pointer">
          <rect width="${NODE_W}" height="${NODE_H}" rx="6"/>
          <text x="${NODE_W / 2}" y="17" text-anchor="middle">${esc(typeShort)}</text>
          <text x="${NODE_W / 2}" y="34" text-anchor="middle" class="dag-node-id">
            #${esc(n.fact_id)} · t${esc(n.logical_time)}
          </text>
        </g>`
      );
    });

    const svg = `<svg class="dag-svg" width="${Math.max(width, 200)}" height="${Math.max(height, 100)}">${svgParts.join('')}</svg>`;

    const wrap = h('div', { class: 'dag-wrap' });
    wrap.innerHTML = svg;

    // 事件委托:点击节点 → 切换焦点
    wrap.addEventListener('click', (e) => {
      const g = e.target.closest('.dag-node');
      if (!g) return;
      const fid = parseInt(g.dataset.factId, 10);
      if (!Number.isNaN(fid)) this.loadChain(fid);
    });

    panel.appendChild(wrap);
  }
};

// === 事件订阅 ===

// FACT_SELECT(来自 timeline 卡片点击)→ 加载因果链
eventbus.on(EVENTS.FACT_SELECT, (factId) => {
  CausalView.loadChain(factId);
});
