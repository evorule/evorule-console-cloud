<!--
  SPDX-License-Identifier: AGPL-3.0-or-later
  Copyright (C) 2026 EvoRule Project
  通用流程画布外壳（自研轻量 SVG,Plugin Contract v1.1 §5 / 第二期决策 C2）
-->
<!--
  职责:节点拖动 / 选中 / 连线展示 / 边点击 / 空白取消——纯交互外壳。
  红线对齐:
    - R4:节点显示名/提示全部来自 metas（node_types 资产投影）,本组件零领域词;
    - R5:坐标是纯展示态,不进 flow JSON。
  模型约定:nodes/edges 由父页面持有（Svelte 5 深响应,本组件直接改坐标）;
    连线动作由页面发起（connectFrom 状态）,画布只回报 onconnect(目标节点)。
-->

<script lang="ts">
  import type { CanvasEdge, CanvasNode } from "./flow-model";
  import { NODE_H, NODE_W, bezierPath } from "./flow-model";

  interface NodeMeta {
    label: string;
    hint?: string;
  }

  let {
    nodes,
    edges,
    metas,
    selectedId = $bindable(null),
    connectFrom = $bindable(null),
    onconnect,
    onedgeclick
  }: {
    nodes: CanvasNode[];
    edges: CanvasEdge[];
    metas: Record<string, NodeMeta>;
    selectedId?: string | null;
    connectFrom?: string | null;
    onconnect?: (toId: string) => void;
    onedgeclick?: (edge: CanvasEdge) => void;
  } = $props();

  let canvasEl = $state<HTMLElement | null>(null);
  let dragging = $state<{ id: string; dx: number; dy: number } | null>(null);

  const edgePaths = $derived(
    edges
      .map((e) => {
        const from = nodes.find((n) => n.node_id === e.from);
        const to = nodes.find((n) => n.node_id === e.to);
        if (!from || !to) return null; // 悬空边不渲染（数据缺陷由 server 装载校验兜底）
        return { edge: e, d: bezierPath(from, to) };
      })
      .filter((p): p is { edge: CanvasEdge; d: string } => p !== null)
  );

  function nodeLabel(nodeType: string): string {
    return metas[nodeType]?.label ?? nodeType;
  }

  function nodeHint(node: CanvasNode): string {
    const meta = metas[node.node_type];
    return meta?.hint ?? node.node_id;
  }

  function isConnecting(): boolean {
    return connectFrom !== null;
  }

  function handleNodePointerDown(e: PointerEvent, node: CanvasNode) {
    if (isConnecting()) return; // 连线模式下点击=连线目标,不拖动
    const el = e.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    dragging = { id: node.node_id, dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    selectedId = node.node_id;
    el.setPointerCapture(e.pointerId);
  }

  function handleNodePointerMove(e: PointerEvent) {
    if (!dragging || !canvasEl) return;
    const n = nodes.find((x) => x.node_id === dragging?.id);
    if (!n) return;
    const cRect = canvasEl.getBoundingClientRect();
    n.x = Math.max(0, Math.round(e.clientX - cRect.left - dragging.dx));
    n.y = Math.max(0, Math.round(e.clientY - cRect.top - dragging.dy));
  }

  function handleNodePointerUp() {
    dragging = null;
  }

  function handleNodeClick(e: MouseEvent, node: CanvasNode) {
    e.stopPropagation();
    if (isConnecting() && connectFrom !== node.node_id) {
      onconnect?.(node.node_id); // 页面负责创建边并退出连线模式
      return;
    }
    selectedId = node.node_id;
  }

  function handleCanvasClick() {
    selectedId = null;
    connectFrom = null;
  }
</script>

<!-- 画布是应用工作区容器(role=application): 点击空白=取消选中/退出连线,Escape 同效(键盘可达) -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="canvas"
  bind:this={canvasEl}
  role="application"
  aria-label="流程画布"
  tabindex="-1"
  onclick={handleCanvasClick}
  onkeydown={(e) => {
    if (e.key === "Escape") handleCanvasClick();
  }}
>
  <svg class="edge-layer" aria-hidden="true">
    {#each edgePaths as { edge, d } (edge.from + "->" + edge.to)}
      <!-- 边点击删除是鼠标便利操作;键盘替代路径=重建连线（工具条按钮可达） -->
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <path class="edge-hit" d={d} onclick={(e) => { e.stopPropagation(); onedgeclick?.(edge); }} />
      <path class="edge-line" class:connecting={isConnecting()} d={d} />
      {#if edge.guard}
        <text class="edge-guard" x="0" y="0">
          <textPath href="#p-{edge.from}-{edge.to}" startOffset="50%" text-anchor="middle">
            {edge.guard}
          </textPath>
        </text>
        <path id="p-{edge.from}-{edge.to}" class="edge-id-path" d={d} />
      {/if}
    {/each}
  </svg>

  {#each nodes as node (node.node_id)}
    <div
      class="node"
      class:selected={node.node_id === selectedId}
      class:connect-source={node.node_id === connectFrom}
      class:connect-target={isConnecting() && node.node_id !== connectFrom}
      style="left:{node.x}px; top:{node.y}px; width:{NODE_W}px; height:{NODE_H}px"
      role="button"
      tabindex="0"
      aria-label="节点 {node.node_id}（{nodeLabel(node.node_type)}）"
      onpointerdown={(e) => handleNodePointerDown(e, node)}
      onpointermove={handleNodePointerMove}
      onpointerup={handleNodePointerUp}
      onclick={(e) => handleNodeClick(e, node)}
      onkeydown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && isConnecting()) onconnect?.(node.node_id);
      }}
    >
      <span class="node-type">{nodeLabel(node.node_type)}</span>
      <span class="node-id">{node.node_id}</span>
      {#if nodeHint(node) !== node.node_id}
        <span class="node-hint">{nodeHint(node)}</span>
      {/if}
    </div>
  {/each}

  {#if nodes.length === 0}
    <div class="canvas-empty">从左侧节点面板添加节点开始设计流程</div>
  {/if}
</div>

<style>
  .canvas {
    position: relative;
    width: 100%;
    height: 460px;
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    overflow: hidden;
    user-select: none;
  }

  .edge-layer {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }

  .edge-hit {
    pointer-events: stroke;
    fill: none;
    stroke: transparent;
    stroke-width: 16;
    cursor: pointer;
  }

  .edge-line {
    fill: none;
    stroke: var(--text-secondary);
    stroke-width: 1.5;
  }

  .edge-line.connecting {
    opacity: 0.4;
  }

  .edge-id-path {
    fill: none;
    stroke: none;
  }

  .edge-guard {
    font-family: var(--font-mono);
    font-size: 10px;
    fill: var(--text-secondary);
    pointer-events: none;
  }

  .node {
    position: absolute;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 0 var(--spacing-sm);
    background: var(--bg-card);
    border: 1.5px solid var(--border);
    border-radius: var(--radius-md);
    box-shadow: 0 1px 3px rgb(0 0 0 / 0.08);
    cursor: grab;
    touch-action: none;
  }

  .node:active {
    cursor: grabbing;
  }

  .node.selected {
    border-color: var(--brand);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--brand) 25%, transparent);
  }

  .node.connect-source {
    border-color: var(--brand);
    border-style: dashed;
  }

  .node.connect-target {
    border-color: color-mix(in srgb, var(--brand) 55%, var(--border));
    cursor: crosshair;
  }

  .node-type {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--text-primary);
    line-height: 1.2;
  }

  .node-id {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-secondary);
    line-height: 1.2;
  }

  .node-hint {
    font-size: 10px;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 1.2;
  }

  .canvas-empty {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-secondary);
    font-size: var(--text-sm);
    pointer-events: none;
  }
</style>
