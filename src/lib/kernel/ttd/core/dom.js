// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// DOM 工具函数 — h() hyperscript + esc + debounce + 格式化

/** HTML 转义 */
export function esc(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

/** 防抖 */
export function debounce(fn, ms = 200) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/**
 * hyperscript: 创建 DOM 元素
 * h('div', { class: 'foo', onclick: fn }, [child1, 'text', child2])
 */
export function h(tag, props = {}, children = []) {
  const el = document.createElement(tag);
  for (const [key, val] of Object.entries(props)) {
    if (val == null || val === false) continue;
    if (key === 'class') el.className = val;
    else if (key === 'style' && typeof val === 'object') Object.assign(el.style, val);
    else if (key.startsWith('on') && typeof val === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), val);
    }
    else if (key === 'dataset' && typeof val === 'object') Object.assign(el.dataset, val);
    else el.setAttribute(key, val);
  }
  for (const child of [].concat(children)) {
    if (child == null || child === false) continue;
    el.appendChild(typeof child === 'string' || typeof child === 'number'
      ? document.createTextNode(String(child))
      : child);
  }
  return el;
}

/** 清空元素 */
export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

/** 格式化 JSON */
export function fmtJson(obj) {
  try { return JSON.stringify(obj, null, 2); }
  catch { return String(obj); }
}

/** 截断字符串 */
export function truncate(s, n = 100) {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

/** 短显示值 */
export function shortVal(v, n = 80) {
  if (v === null || v === undefined) return 'null';
  const s = typeof v === 'string' ? `"${v}"` : (typeof v === 'object' ? JSON.stringify(v) : String(v));
  return s.length > n ? s.slice(0, n) + '…' : s;
}
