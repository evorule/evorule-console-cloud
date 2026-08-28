// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// 深度 JSON diff(纯函数,无 DOM 依赖,可单测)
//
// DiffNode 结构:
//   { kind, status, key, oldVal, newVal, children }
//   kind:   'object'|'array'|'primitive'
//   status: 'added'|'removed'|'changed'|'unchanged'
//   key:    string|number|null(根节点为 null)
//   oldVal/newVal: 原始值(added 时 oldVal=undefined;removed 时 newVal=undefined)
//   children: DiffNode[]|null(容器;叶子为 null)
//
// 与 server 端 /api/diff 的区别:
//   server 只做顶层字段级 diff(added/removed/changed 三类扁平列表)
//   本算法递归到嵌套对象/数组,支持字段级以下细粒度对比

/**
 * 计算两个 JSON 值的深度 diff
 * @param {*} a - 旧值(可能为 undefined 表示"新增")
 * @param {*} b - 新值(可能为 undefined 表示"删除")
 * @param {string|number|null} key
 * @returns {DiffNode}
 */
export function deepDiff(a, b, key = null) {
  // 引用相等(含 null===null, undefined===undefined)
  if (a === b) return leaf('unchanged', key, a, b);

  // 单侧缺失 → 整体 added/removed(若是容器,递归保留结构)
  if (a === undefined) return diffOneSide('added', b, key);
  if (b === undefined) return diffOneSide('removed', a, key);

  // null 与非 null → changed
  if (a === null || b === null) return leaf('changed', key, a, b);

  const ta = typeOf(a), tb = typeOf(b);
  // 类型不同 → changed(整体替换)
  if (ta !== tb) return leaf('changed', key, a, b);

  // 同型容器:递归子节点
  if (ta === 'array') return diffArray(a, b, key);
  if (ta === 'object') return diffObject(a, b, key);

  // 原始类型值不同
  return leaf('changed', key, a, b);
}

function diffOneSide(status, v, key) {
  // v 是存在的那一侧;另一侧为 undefined
  if (v === null || typeof v !== 'object') {
    return {
      kind: 'primitive', status, key,
      oldVal: status === 'added' ? undefined : v,
      newVal: status === 'added' ? v : undefined,
      children: null
    };
  }
  // 容器:递归保留结构,所有子节点继承 status
  const children = Array.isArray(v)
    ? v.map((item, i) => diffOneSide(status, item, i))
    : Object.entries(v).map(([k, item]) => diffOneSide(status, item, k));
  return {
    kind: Array.isArray(v) ? 'array' : 'object', status, key,
    oldVal: status === 'added' ? undefined : v,
    newVal: status === 'added' ? v : undefined,
    children
  };
}

function diffArray(a, b, key) {
  // 元素级对齐(无 LCS;Phase 6 可加 Myers diff 优化数组重排)
  const maxLen = Math.max(a.length, b.length);
  const children = [];
  for (let i = 0; i < maxLen; i++) {
    const av = i < a.length ? a[i] : undefined;
    const bv = i < b.length ? b[i] : undefined;
    children.push(deepDiff(av, bv, i));
  }
  return { kind: 'array', status: 'changed', key, oldVal: a, newVal: b, children };
}

function diffObject(a, b, key) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const children = [...keys].sort().map(k => deepDiff(a[k], b[k], k));
  return { kind: 'object', status: 'changed', key, oldVal: a, newVal: b, children };
}

function leaf(status, key, a, b) {
  return { kind: 'primitive', status, key, oldVal: a, newVal: b, children: null };
}

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

/**
 * 统计树中发生变更的叶子节点数(用于容器摘要 "N changes")
 * 整体 added/removed 的容器按叶子数计(更直观)
 */
export function countChanges(node) {
  if (!node) return 0;
  if (node.kind === 'primitive') {
    return node.status !== 'unchanged' ? 1 : 0;
  }
  return (node.children || []).reduce((s, c) => s + countChanges(c), 0);
}
