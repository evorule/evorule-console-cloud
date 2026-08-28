// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// Timeline 视图 — 时间滑块 + fact 列表
//
// 职责:
//   - SESSION_SELECT: 通过 api.replay 加载 facts,渲染滑块 + 卡片列表
//   - VERSION_SELECT(外部触发,如键盘/其他视图): 只移动 handle + 更新卡片高亮(不重渲染)
//   - search:change: 重新过滤 + 渲染卡片列表
//   - FACT_SELECT(本视图触发): 选中卡片 → emit VERSION_SELECT + FACT_SELECT

import { api } from '../core/api.js';
import { store } from '../core/store.js';
import { eventbus, EVENTS } from '../core/eventbus.js';
import { h, clear, esc } from '../core/dom.js';
import { createSlider } from '../components/slider.js';
import { renderFactCard } from '../components/fact-card.js';

// 单次渲染卡片上限(防止万级 session 拖死浏览器;Phase 6 做虚拟列表)
const MAX_CARDS = 500;

let sliderCtrl = null;
let selectedCardEl = null;

export const TimelineView = {
  /** SESSION_SELECT → 加载 facts */
  async onSessionChange(id) {
    if (!id) return;
    await this.loadFacts(id);
  },

  /** 切到本 tab 时,若未加载则触发加载 */
  onShow() {
    const state = store.getState();
    if (state.currentSessionId && state.views.timeline.facts.length === 0) {
      this.loadFacts(state.currentSessionId);
    }
  },

  async loadFacts(id) {
    const panel = document.getElementById('panel-timeline');
    if (!panel) return;
    clear(panel);
    store.setView('timeline', { loading: true });
    panel.appendChild(h('div', { class: 'empty' }, '⏳ 加载 facts...'));

    try {
      const data = await api.replay(id);
      const arr = Array.isArray(data) ? data : (data.facts || []);
      const maxVersion = arr.length > 0
        ? arr.reduce((m, f) => Math.max(m, f.version || 0), 0)
        : 0;
      store.setView('timeline', { facts: arr, maxVersion, loading: false });
      this.render();
    } catch (e) {
      clear(panel);
      panel.appendChild(h('div', { class: 'error' },
        `加载失败: ${esc(e.message)}`));
    }
  },

  render() {
    const panel = document.getElementById('panel-timeline');
    if (!panel) return;
    const state = store.getState();
    const { facts, maxVersion } = state.views.timeline;
    const { selectedVersion, searchTerm } = state;

    clear(panel);
    selectedCardEl = null;

    if (facts.length === 0) {
      panel.appendChild(h('div', { class: 'empty' }, '该 session 无 facts'));
      return;
    }

    // 滑块
    const slider = createSlider({
      facts, maxVersion,
      selected: selectedVersion,
      onSelect: (v) => eventbus.emit(EVENTS.VERSION_SELECT, v)
    });
    sliderCtrl = slider;
    panel.appendChild(slider.el);

    // 过滤 + 截断
    const filtered = filterFacts(facts, searchTerm);
    const shown = filtered.slice(0, MAX_CARDS);

    // 卡片列表
    const list = h('div', { class: 'fact-list' },
      shown.map(f => renderFactCard(f, {
        selected: f.version === selectedVersion,
        onSelect: (fact) => {
          // 点击卡片 → 选中该 version
          eventbus.emit(EVENTS.VERSION_SELECT, fact.version);
          eventbus.emit(EVENTS.FACT_SELECT, fact.id);
        }
      }))
    );
    panel.appendChild(list);

    // 截断提示
    if (filtered.length > MAX_CARDS) {
      panel.appendChild(h('div', { class: 'tooltip', style: { textAlign: 'center', padding: '8px' } },
        `显示前 ${MAX_CARDS} 条,共 ${filtered.length} 条。请用搜索框过滤。`));
    } else if (filtered.length === 0) {
      panel.appendChild(h('div', { class: 'empty' },
        `无匹配 "${esc(searchTerm)}" 的 fact`));
    }

    // 同步 selectedCardEl:render 重建了卡片 DOM,旧引用已失效。
    // 若不重置,下次 VERSION_SELECT 时无法清除旧卡片的 selected 类,会出现双高亮。
    selectedCardEl = panel.querySelector(`.fact-card[data-version="${selectedVersion}"]`) || null;
  }
};

function filterFacts(facts, term) {
  if (!term) return facts;
  const t = term.toLowerCase();
  return facts.filter(f => {
    try { return JSON.stringify(f).toLowerCase().includes(t); }
    catch { return false; }
  });
}

// === 事件订阅 ===

// VERSION_SELECT(外部触发):只移动 handle + 更新卡片高亮,不重渲染列表
eventbus.on(EVENTS.VERSION_SELECT, (v) => {
  sliderCtrl?.setSelected(v);
  // O(1) 卡片高亮更新:清旧 + 找新
  if (selectedCardEl) selectedCardEl.classList.remove('selected');
  const card = document.querySelector(`.fact-card[data-version="${v}"]`);
  if (card) {
    card.classList.add('selected');
    selectedCardEl = card;
  } else {
    selectedCardEl = null;
  }
});

// 搜索:重新渲染列表
eventbus.on('search:change', () => {
  TimelineView.render();
});
