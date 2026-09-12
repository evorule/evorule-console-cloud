// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// 通用流程画布模型层 — 画布节点/边状态 ↔ flow JSON（契约 v1.1 §4.6）双向投影
//
// 红线对齐:
//   - R4:本层只持有 flow 协议 schema（契约钉死的 node_id/node_type/params/
//     form_ref/threshold 结构）与布局坐标,零领域知识——节点语义全部来自
//     pack 的 node_types 资产声明;
//   - R3:buildFlowJson 产物是草稿（draft-only）,编译后仍不落库。
// 布局:线性自动布局（x 水平等距）;坐标是纯展示态,不进 flow JSON。

import type { FlowAssetRaw, FlowEdgeRaw, FlowNodeRaw } from "$lib/backend/plugin-packs";

/** 画布节点 = flow 协议字段 + 展示坐标 */
export interface CanvasNode {
  node_id: string;
  node_type: string;
  x: number;
  y: number;
  params?: Record<string, unknown>;
  form_ref?: { scene: string; field: string };
  threshold?: number;
}

/** 画布边 */
export interface CanvasEdge {
  from: string;
  to: string;
  guard?: string;
}

/** 节点卡片尺寸（拖动命中/连线锚点计算共用） */
export const NODE_W = 168;
export const NODE_H = 52;

/** 新建节点初始坐标步进（避免完全重叠） */
export function defaultPosition(index: number): { x: number; y: number } {
  return { x: 48 + (index % 5) * (NODE_W + 56), y: 48 + Math.floor(index / 5) * (NODE_H + 48) };
}

/** 下一个可用 node_id（n1/n2/…;跳过画布已有 id） */
export function nextNodeId(nodes: CanvasNode[]): string {
  let i = nodes.length + 1;
  while (nodes.some((n) => n.node_id === `n${i}`)) i += 1;
  return `n${i}`;
}

/** 画布态 → flow JSON 草稿（R3 draft-only;坐标不进产物） */
export function buildFlowJson(
  flowId: string,
  nodes: CanvasNode[],
  edges: CanvasEdge[]
): FlowAssetRaw {
  const flowNodes: FlowNodeRaw[] = nodes.map((n) => {
    const out: FlowNodeRaw = { node_id: n.node_id, node_type: n.node_type };
    if (n.params && Object.keys(n.params).length > 0) out.params = { ...n.params };
    if (n.form_ref) out.form_ref = { ...n.form_ref };
    if (n.threshold !== undefined) out.threshold = n.threshold;
    return out;
  });
  const flowEdges: FlowEdgeRaw[] = edges.map((e) =>
    e.guard ? { from: e.from, to: e.to, guard: e.guard } : { from: e.from, to: e.to }
  );
  return { flow_id: flowId, version: 1, nodes: flowNodes, edges: flowEdges };
}

/** flow JSON → 画布态（线性链水平自动布局;协议外字段原样丢弃） */
export function loadFlowAsset(flow: FlowAssetRaw): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const nodes: CanvasNode[] = flow.nodes.map((n, i) => ({
    node_id: n.node_id,
    node_type: n.node_type,
    x: defaultPosition(i).x,
    y: defaultPosition(i).y,
    ...(n.params ? { params: { ...n.params } } : {}),
    ...(n.form_ref ? { form_ref: { ...n.form_ref } } : {}),
    ...(n.threshold !== undefined ? { threshold: n.threshold } : {})
  }));
  const edges: CanvasEdge[] = flow.edges.map((e) =>
    e.guard ? { from: e.from, to: e.to, guard: e.guard } : { from: e.from, to: e.to }
  );
  return { nodes, edges };
}

/** 贝塞尔连线控制点（水平流向;源右缘 → 目标左缘） */
export function bezierPath(
  from: { x: number; y: number },
  to: { x: number; y: number }
): string {
  const x1 = from.x + NODE_W;
  const y1 = from.y + NODE_H / 2;
  const x2 = to.x;
  const y2 = to.y + NODE_H / 2;
  const dx = Math.max(48, Math.abs(x2 - x1) / 2);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

// ---- NL 草稿展示层校验（纯提示不阻断,不替代引擎 fail-fast） ----

/** 校验上下文 = 资产取值域投影（R4:零领域硬编码,全部由调用方注入） */
export interface FlowDraftCheckContext {
  nodeTypes: ReadonlySet<string>;
  /** form_ref.field 取值域（场景已注册 path 字段;R2） */
  sceneFieldIds: ReadonlySet<string>;
  /**
   * 出边 guard 取值域（契约 v1.2 §4.4 out_guards 声明投影:node_type → 允许
   * guard 集;未声明类型 = 禁 guard）。缺省 = 不做 guard 校验（旧调用方兼容）。
   * 镜像自 evorule-console src/lib/views/FlowCanvas/flow-model.ts。
   */
  outGuards?: ReadonlyMap<string, ReadonlySet<string>>;
}

export interface FlowDraftCheckResult {
  /** JSON.parse 通过（填入画布的硬前提——画布只吃对象） */
  parseOk: boolean;
  /** 顶层形状符合 flow 资产（flow_id/nodes/edges 存在且为数组） */
  shapeOk: boolean;
  /** node_type 不在资产白名单的节点（提示,可仍填入人工修正） */
  unknownNodeTypes: string[];
  /** form_ref.field 不在场景字段取值域的节点（R2 提示） */
  unknownFormRefs: string[];
  /** 出边 guard 不在 from 节点类型 out_guards 声明取值域的边（v1.2 提示;记 from 节点 id） */
  badGuards: string[];
}

/**
 * NL→flow 草稿的展示层静态校验:帮人提前发现笔误,**不修改产物、
 * 不进协议路径**;引擎 fail-fast（compileFlow server 校验）仍是权威。
 * 校验知识全部来自 ctx（资产投影）,本函数零领域词（R4）。
 */
export function validateFlowDraft(
  jsonStr: string,
  ctx: FlowDraftCheckContext
): FlowDraftCheckResult {
  const result: FlowDraftCheckResult = {
    parseOk: false,
    shapeOk: false,
    unknownNodeTypes: [],
    unknownFormRefs: [],
    badGuards: []
  };
  let flow: unknown;
  try {
    flow = JSON.parse(jsonStr);
  } catch {
    return result; // parseOk=false:非合法 JSON,无法继续形状校验
  }
  result.parseOk = true;

  if (
    typeof flow !== "object" ||
    flow === null ||
    !Array.isArray((flow as { nodes?: unknown }).nodes) ||
    !Array.isArray((flow as { edges?: unknown }).edges) ||
    typeof (flow as { flow_id?: unknown }).flow_id !== "string"
  ) {
    return result; // shapeOk=false:缺 flow_id/nodes/edges 骨架
  }
  result.shapeOk = true;

  const nodeTypeById = new Map<string, string>();
  for (const n of (flow as { nodes: Array<Record<string, unknown>> }).nodes) {
    if (typeof n !== "object" || n === null) continue;
    const nodeType = n.node_type;
    if (typeof nodeType === "string" && !ctx.nodeTypes.has(nodeType)) {
      result.unknownNodeTypes.push(String(n.node_id ?? "?"));
    }
    const ref = n.form_ref as { field?: unknown } | undefined;
    if (
      ref &&
      typeof ref === "object" &&
      typeof ref.field === "string" &&
      !ctx.sceneFieldIds.has(ref.field)
    ) {
      result.unknownFormRefs.push(String(n.node_id ?? "?"));
    }
    if (typeof n.node_id === "string" && typeof nodeType === "string") {
      nodeTypeById.set(n.node_id, nodeType);
    }
  }

  // guard 取值域提示（v1.2;ctx.outGuards 缺省时跳过,不虚构取值域）
  if (ctx.outGuards) {
    for (const e of (flow as { edges: Array<Record<string, unknown>> }).edges) {
      if (typeof e !== "object" || e === null) continue;
      const guard = e.guard;
      if (typeof guard !== "string") continue; // 无 guard 的边不在声明面语义内
      const fromType = typeof e.from === "string" ? nodeTypeById.get(e.from) : undefined;
      const allowed = fromType ? ctx.outGuards.get(fromType) : undefined;
      if (!allowed || !allowed.has(guard)) {
        result.badGuards.push(String(e.from ?? "?"));
      }
    }
  }
  return result;
}
