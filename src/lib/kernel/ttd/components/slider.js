// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// 时间滑块 — 点状事实标记 + 拖拽 + 点击跳转
//
// 设计:
//   - 全量渲染 dots(每个 fact 一个,CSS 定位,1000+ 仍流畅)
//   - handle 用 CSS transform 定位(60fps,不触发 layout)
//   - pointer events 统一鼠标 + 触摸
//   - 外部可通过 setSelected(v) 更新 handle 位置(键盘导航用)

import { h } from '../core/dom.js';

// fact.type → dot CSS class(对应 main.css 中 .dot.cmd 等)
const DOT_CLASS = {
  Command: 'cmd',
  Error: 'error',
  Stable: 'stable',
  // 其他类型用默认灰色(不加 class)
};

/**
 * 创建滑块
 * @param {{facts: Array, maxVersion: number, selected: number, onSelect: (v: number) => void}} opts
 * @returns {{el: HTMLElement, setSelected: (v: number) => void}}
 */
export function createSlider({ facts, maxVersion, selected, onSelect }) {
  const handle = h('div', { class: 'handle' });

  const dotsLayer = h('div', { class: 'dots' },
    facts.map(f => {
      const cls = DOT_CLASS[f.type] || '';
      const pct = maxVersion > 0 ? (f.version / maxVersion) * 100 : 0;
      return h('div', {
        class: `dot ${cls}`.trim(),
        style: { left: `${pct}%` },
        title: `v${f.version} · ${f.type} · #${f.id}`
      });
    })
  );

  const track = h('div', { class: 'slider-track' }, [dotsLayer, handle]);

  // 点击/拖拽:统一用 pointer events
  let dragging = false;

  function updateFromEvent(e) {
    const rect = track.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const v = Math.round(pct * maxVersion);
    onSelect(Math.max(0, Math.min(maxVersion, v)));
  }

  track.addEventListener('pointerdown', (e) => {
    dragging = true;
    track.setPointerCapture(e.pointerId);
    updateFromEvent(e);
  });
  track.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    updateFromEvent(e);
  });
  track.addEventListener('pointerup', (e) => {
    dragging = false;
    try { track.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  });
  track.addEventListener('pointercancel', () => { dragging = false; });

  function setSelected(v) {
    const pct = maxVersion > 0 ? (v / maxVersion) * 100 : 0;
    handle.style.left = `${pct}%`;
  }
  setSelected(selected);

  const header = h('div', { class: 'slider-header' }, [
    h('span', {}, `版本`),
    h('span', { class: 'ver' }, `${selected} / ${maxVersion}`),
    h('span', { class: 'tooltip' }, `点击/拖拽跳转 · ←/→ 单步 · Home/End 跳首尾`)
  ]);

  const ticks = h('div', { class: 'slider-ticks' }, [
    h('span', {}, '0'),
    h('span', {}, `${Math.floor(maxVersion / 2)}`),
    h('span', {}, `${maxVersion}`)
  ]);

  const wrap = h('div', { class: 'slider-wrap' }, [header, track, ticks]);

  // header.ver 需要随 selected 更新,暴露更新函数
  const verSpan = header.querySelector('.ver');
  const setSelectedFull = (v) => {
    setSelected(v);
    if (verSpan) verSpan.textContent = `${v} / ${maxVersion}`;
  };

  return { el: wrap, setSelected: setSelectedFull };
}
