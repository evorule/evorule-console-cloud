// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// Diff 树渲染器 — 可折叠 + 状态着色(+/-/~/=)
//
// 设计:
//   - 容器折叠时不构建子节点 DOM(延迟到展开)
//   - 整体 added/removed 的容器:子节点全部继承颜色
//   - 叶子节点单行显示:+key:val / -key:val / ~key: old → new / =key:val

import { h } from '../core/dom.js';
import { countChanges } from '../algorithms/deep-diff.js';

const MARKER = { added: '+', removed: '-', changed: '~', unchanged: '=' };
const STATUS_CLASS = { added: 'added', removed: 'removed', changed: 'changed', unchanged: 'unchanged' };

/**
 * 渲染 diff 树
 * @param {DiffNode} rootNode - deepDiff 返回的根节点
 * @param {number} expandDepth - 默认展开深度
 * @returns {HTMLElement}
 */
export function renderDiffTree(rootNode, expandDepth = 1) {
  return h('div', { class: 'dt-root' }, renderNode(rootNode, expandDepth, 0));
}

function renderNode(node, expandDepth, depth) {
  if (node.kind === 'primitive') {
    return renderLeaf(node);
  }
  return renderContainer(node, expandDepth, depth);
}

function renderLeaf(node) {
  const { status, key, oldVal, newVal } = node;
  const marker = MARKER[status] || '?';
  const cls = STATUS_CLASS[status] || 'unchanged';

  let content;
  if (status === 'added') content = fmt(newVal);
  else if (status === 'removed') content = fmt(oldVal);
  else if (status === 'changed') content = `${fmt(oldVal)} → ${fmt(newVal)}`;
  else content = fmt(oldVal);

  return h('div', { class: `jt-row diff-line ${cls}` }, [
    h('span', { class: 'dt-mark' }, `${marker} `),
    key !== null ? h('span', { class: 'jt-key' }, `${key}: `) : null,
    h('span', {}, content)
  ]);
}

function renderContainer(node, expandDepth, depth) {
  const { kind, status, key, children } = node;

  // 空容器
  if (!children || children.length === 0) {
    return h('div', { class: `jt-row diff-line ${STATUS_CLASS[status]}` }, [
      h('span', { class: 'dt-mark' }, `${MARKER[status]} `),
      key !== null ? h('span', { class: 'jt-key' }, `${key}: `) : null,
      h('span', {}, kind === 'array' ? '[]' : '{}')
    ]);
  }

  const changes = countChanges(node);
  const total = children.length;
  const expanded = depth < expandDepth;
  const openMark = kind === 'array' ? '[' : '{';
  const closeMark = kind === 'array' ? ']' : '}';
  const unit = kind === 'array' ? 'items' : 'keys';

  const icon = h('span', { class: 'jt-icon' }, expanded ? '▼' : '▶');
  const keySpan = key !== null ? h('span', { class: 'jt-key' }, `${key}: `) : null;
  const openSpan = h('span', {}, openMark);
  const summary = h('span', { class: 'jt-size' },
    ` ${total} ${unit}` + (changes > 0 ? ` · ${changes} 变更` : ' · 无变更'));
  const closeInline = h('span', {}, closeMark);
  closeInline.style.display = expanded ? 'none' : 'inline';

  const childrenWrap = h('div', { class: 'jt-children' });
  childrenWrap.style.display = expanded ? 'block' : 'none';
  if (expanded) {
    children.forEach(c => childrenWrap.appendChild(renderNode(c, expandDepth, depth + 1)));
    childrenWrap.appendChild(h('div', { class: 'jt-row' }, closeMark));
  }

  const header = h('div', { class: 'jt-row', style: { cursor: 'pointer' } }, [
    icon, keySpan, openSpan, summary, closeInline
  ]);
  header.addEventListener('click', (e) => {
    e.stopPropagation();
    const isExp = childrenWrap.style.display !== 'none';
    if (isExp) {
      childrenWrap.style.display = 'none';
      icon.textContent = '▶';
      closeInline.style.display = 'inline';
    } else {
      // 首次展开:构建子节点 DOM
      if (childrenWrap.children.length === 0) {
        children.forEach(c => childrenWrap.appendChild(renderNode(c, expandDepth, depth + 1)));
        childrenWrap.appendChild(h('div', { class: 'jt-row' }, closeMark));
      }
      childrenWrap.style.display = 'block';
      icon.textContent = '▼';
      closeInline.style.display = 'none';
    }
  });

  return h('div', {}, [header, childrenWrap]);
}

function fmt(v) {
  if (v === undefined) return '∅';
  if (v === null) return 'null';
  if (typeof v === 'string') return `"${v}"`;
  if (typeof v === 'object') {
    try { return JSON.stringify(v); } catch { return String(v); }
  }
  return String(v);
}
