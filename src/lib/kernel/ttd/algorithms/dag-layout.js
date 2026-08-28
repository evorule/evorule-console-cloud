// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// DAG 层次布局(简化版 Sugiyama)— 纯函数,无 DOM 依赖
//
// 输入: causal chain entries [{fact_id, fact_type, logical_time, cause, ...}, ...]
// 输出: { nodes: [{fact_id, fact_type, logical_time, x, y, layer, cause, content_hash}],
//         edges: [{from, to}], layerCount }
//
// 算法:
//   1. 层次分配:BFS 从 root(cause=null)出发,子节点 layer = 父节点 layer + 1
//   2. X 定位:同层节点均匀分布,居中
//   3. Y 定位:layer * (NODE_H + LAYER_GAP)
//
// 适用于:
//   - 线性因果链(每层 1 节点,垂直堆叠)
//   - 分支 DAG(同层多节点,水平展开)

const NODE_W = 140;
const NODE_H = 44;
const LAYER_GAP = 60;
const NODE_GAP = 30;

/**
 * @param {Array} chain - causal chain entries
 * @returns {{nodes: Array, edges: Array, layerCount: number, width: number, height: number}}
 */
export function layoutDag(chain) {
  if (!chain || chain.length === 0) {
    return { nodes: [], edges: [], layerCount: 0, width: 0, height: 0 };
  }

  // 1. 构建节点表 + 边表 + 子节点索引
  const nodeMap = new Map();
  const childrenOf = new Map();
  const edges = [];

  chain.forEach(e => {
    nodeMap.set(e.fact_id, e);
    if (e.cause != null) {
      edges.push({ from: e.cause, to: e.fact_id });
      if (!childrenOf.has(e.cause)) childrenOf.set(e.cause, []);
      childrenOf.get(e.cause).push(e.fact_id);
    }
  });

  // 2. 层次分配(BFS from roots)
  const layer = new Map();
  const roots = chain.filter(e => e.cause == null).map(e => e.fact_id);
  // 无 root(理论上是环):用第一条 entry 当 root
  if (roots.length === 0) roots.push(chain[0].fact_id);

  const queue = roots.map(id => ({ id, l: 0 }));
  while (queue.length > 0) {
    const { id, l } = queue.shift();
    // 取最大 layer(保证子节点始终在父节点下方)
    if (layer.has(id) && layer.get(id) >= l) continue;
    layer.set(id, l);
    const kids = childrenOf.get(id) || [];
    kids.forEach(kidId => queue.push({ id: kidId, l: l + 1 }));
  }
  // 未分配的孤立节点 → layer 0
  chain.forEach(e => {
    if (!layer.has(e.fact_id)) layer.set(e.fact_id, 0);
  });

  // 3. 按 layer 分组
  const maxLayer = Math.max(...layer.values(), 0);
  const layers = Array.from({ length: maxLayer + 1 }, () => []);
  chain.forEach(e => layers[layer.get(e.fact_id)].push(e));

  // 4. X/Y 定位(同层均匀分布,居中于 x=0)
  const positioned = [];
  let maxX = 0;
  layers.forEach((nodes, l) => {
    const totalW = nodes.length * NODE_W + (nodes.length - 1) * NODE_GAP;
    const startX = -totalW / 2;
    nodes.forEach((n, i) => {
      const x = startX + i * (NODE_W + NODE_GAP) + NODE_W / 2;
      maxX = Math.max(maxX, Math.abs(x) + NODE_W / 2);
      positioned.push({
        fact_id: n.fact_id,
        fact_type: n.fact_type,
        logical_time: n.logical_time,
        content_hash: n.content_hash,
        cause: n.cause,
        x,
        y: l * (NODE_H + LAYER_GAP),
        layer: l
      });
    });
  });

  const width = maxX * 2 + 40;
  const height = (maxLayer + 1) * (NODE_H + LAYER_GAP) - LAYER_GAP + 40;

  return { nodes: positioned, edges, layerCount: maxLayer + 1, width, height };
}

export const LAYOUT_CONST = { NODE_W, NODE_H, LAYER_GAP, NODE_GAP };
