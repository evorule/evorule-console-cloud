// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// JSON → 树结构(纯函数,无 DOM 依赖,可单测)
//
// 节点结构:
//   { kind, key, value, children, size, depth }
//   kind: 'object'|'array'|'string'|'number'|'boolean'|'null'
//   key:  string|number|null (根节点为 null)
//   value: 原始值(叶子节点;容器为 null)
//   children: TreeNode[]|null(容器;叶子为 null)
//   size: 子节点数(容器;叶子为 0)
//   depth: 深度(根=0)

const MAX_DEPTH = 12;
const MAX_CHILDREN = 1000;

/**
 * 将任意 JSON 值转为树结构
 * @param {*} value
 * @param {string|number|null} key - 字段名(递归用)
 * @param {number} depth - 当前深度(递归用)
 * @returns {TreeNode}
 */
export function buildTree(value, key = null, depth = 0) {
  const kind = classify(value);

  if (kind === 'object' || kind === 'array') {
    // 超过最大深度:渲染为占位字符串,避免无限递归
    if (depth >= MAX_DEPTH) {
      return { kind: 'string', key, value: '[深度截断]', children: null, size: 0, depth };
    }
    const entries = kind === 'array'
      ? value.map((v, i) => [i, v])
      : Object.entries(value);

    let truncated = false;
    let overflow = 0;
    if (entries.length > MAX_CHILDREN) {
      overflow = entries.length - MAX_CHILDREN;
      entries.length = MAX_CHILDREN;
      truncated = true;
    }

    const children = entries.map(([k, v]) => buildTree(v, k, depth + 1));
    if (truncated) {
      children.push({
        kind: 'string', key: '…',
        value: `[剩余 ${overflow} 项已截断]`,
        children: null, size: 0, depth: depth + 1
      });
    }

    return { kind, key, value: null, children, size: entries.length, depth };
  }

  return { kind, key, value, children: null, size: 0, depth };
}

function classify(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

/** 统计节点总数(性能预算用) */
export function countNodes(node) {
  if (!node.children) return 1;
  return 1 + node.children.reduce((s, c) => s + countNodes(c), 0);
}
