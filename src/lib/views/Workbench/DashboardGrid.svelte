<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  总览页 widget 渲染器(UV-021 W1)。
  职责:按表面 + 权限 + 角色 过滤注册表 → 确定性排序 → 3 列网格渲染。
  不感知具体 widget——注册即接入(widgets/registry.ts)。
  错误契约:各 widget 数据加载失败在卡内如实显示错误态(不静默降级)。
-->

<script lang="ts">
  import { currentUser } from "$lib/stores/auth";
  import { WIDGET_REGISTRY } from "./widgets/registry";
  import { selectWidgets } from "./widgets/widget-registry-logic";
  import type { WidgetSurface } from "./widgets/types";

  interface Props {
    surface?: WidgetSurface;
  }

  let { surface = 'workbench' as WidgetSurface }: Props = $props();

  const visibleWidgets = $derived(selectWidgets(WIDGET_REGISTRY, surface, $currentUser));
</script>

<div class="dashboard-grid">
  {#each visibleWidgets as w (w.id)}
    <div class="cell" style="grid-column: span {w.span};">
      <w.component />
    </div>
  {/each}
</div>

<style>
  .dashboard-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 14px;
    align-items: start;
  }
  .cell {
    min-width: 0;
  }
  @media (max-width: 900px) {
    .dashboard-grid {
      grid-template-columns: 1fr;
    }
    .cell {
      grid-column: auto !important;
    }
  }
</style>
