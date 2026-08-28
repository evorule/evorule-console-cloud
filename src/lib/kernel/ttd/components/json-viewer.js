// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// JSON 树渲染器 — 可折叠 + 语法高亮
//
// 设计:
//   - 折叠时不构建子节点 DOM(延迟到展开),大对象首屏快
//   - 空容器([]/{})不可折叠,单行显示
//   - 默认展开深度 1 层(根对象的字段可见,值折叠)

import { h } from '../core/dom.js';
import { buildTree } from '../algorithms/json-tree.js';

const DEFAULT_EXPAND_DEPTH = 1;

/**
 * 渲染 JSON 值为可折叠树
 * @param {*} value - 任意 JSON 值
 * @param {{expandDepth?: number}} opts
 * @returns {HTMLElement}
 */
export function renderJson(value, opts = {}) {
  const expandDepth = opts.expandDepth ?? DEFAULT_EXPAND_DEPTH;
  const tree = buildTree(value);
  return h('div', { class: 'jt-root' }, renderNode(tree, expandDepth));
}

function renderNode(node, expandDepth) {
  if (node.kind === 'object' || node.kind === 'array') {
    return renderContainer(node, expandDepth);
  }
  // 叶子节点
  return h('div', { class: 'jt-row' }, [
    node.key !== null ? h('span', { class: 'jt-key' }, `${node.key}: `) : null,
    h('span', { class: `jt-val ${node.kind}` }, formatLeaf(node.value, node.kind))
  ]);
}

function renderContainer(node, expandDepth) {
  // 空容器:不可折叠
  if (node.size === 0) {
    return h('div', { class: 'jt-row' }, [
      h('span', { class: 'jt-icon' }, '·'),
      node.key !== null ? h('span', { class: 'jt-key' }, `${node.key}: `) : null,
      h('span', {}, node.kind === 'array' ? '[]' : '{}')
    ]);
  }

  const expanded = node.depth < expandDepth;
  const openMark = node.kind === 'array' ? '[' : '{';
  const closeMark = node.kind === 'array' ? ']' : '}';
  const unit = node.kind === 'array' ? 'items' : 'keys';

  const icon = h('span', { class: 'jt-icon' }, expanded ? '▼' : '▶');
  const keySpan = node.key !== null ? h('span', { class: 'jt-key' }, `${node.key}: `) : null;
  const openSpan = h('span', {}, openMark);
  const sizeSpan = h('span', { class: 'jt-size' }, ` ${node.size} ${unit} `);
  const closeInline = h('span', {}, closeMark);
  closeInline.style.display = expanded ? 'none' : 'inline';

  const childrenWrap = h('div', { class: 'jt-children' });
  childrenWrap.style.display = expanded ? 'block' : 'none';
  if (expanded) {
    node.children.forEach(c => childrenWrap.appendChild(renderNode(c, expandDepth)));
    childrenWrap.appendChild(h('div', { class: 'jt-row' }, closeMark));
  }

  const header = h('div', { class: 'jt-row', style: { cursor: 'pointer' } }, [
    icon, keySpan, openSpan, sizeSpan, closeInline
  ]);
  header.addEventListener('click', (e) => {
    e.stopPropagation();
    const isExp = childrenWrap.style.display !== 'none';
    if (isExp) {
      // 折叠:清空子节点 DOM(再次展开时重建)
      childrenWrap.style.display = 'none';
      icon.textContent = '▶';
      closeInline.style.display = 'inline';
    } else {
      // 展开:若未构建过子节点,则构建
      if (childrenWrap.children.length === 0) {
        node.children.forEach(c => childrenWrap.appendChild(renderNode(c, expandDepth)));
        childrenWrap.appendChild(h('div', { class: 'jt-row' }, closeMark));
      }
      childrenWrap.style.display = 'block';
      icon.textContent = '▼';
      closeInline.style.display = 'none';
    }
  });

  return h('div', {}, [header, childrenWrap]);
}

function formatLeaf(v, kind) {
  if (kind === 'null') return 'null';
  if (kind === 'string') return `"${v}"`;
  return String(v);
}
