<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  后端不可达警示条(运维诚实性):数据面板必须让操作员分清「没数据」与
  「连不上」。挂载页 onMount 自探 http 后端健康;不可达时页面顶部出示
  引导条。mock/wasm 模式无后端语义,静默不渲染(不造假警告)。
-->

<script lang="ts">
  import { onMount } from "svelte";
  import { useBackend } from "$lib/kernel";
  import { CloudHttpBackend } from "$lib/backend/cloud-http-backend";
  import { IS_MOCK, IS_WASM } from "$lib/config/backend-kind";
  import { goto } from "$app/navigation";
  import { base } from "$app/paths";

  const cloud = useBackend() instanceof CloudHttpBackend ? (useBackend() as CloudHttpBackend) : null;
  let unreachable = $state(false);

  onMount(async () => {
    if (IS_MOCK || IS_WASM || !cloud) return;
    try {
      unreachable = !(await cloud.health());
    } catch {
      unreachable = true;
    }
  });
</script>

{#if unreachable}
  <div class="bub" role="alert" data-testid="backend-unreachable">
    <span class="bub-icon">⚠</span>
    <span class="bub-text">
      <strong>无法连接 evorule-server</strong> — 下方数据可能不完整或为空,这不是"没有数据"。
    </span>
    <button class="bub-btn" onclick={() => goto(`${base}/`)}>检查连接 →</button>
  </div>
{/if}

<style>
  .bub {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
    padding: 10px 16px;
    border: 1px solid var(--warning);
    border-radius: var(--r-sm);
    background: var(--warning-bg);
    color: var(--text-primary);
    font-size: 13px;
    margin-bottom: 12px;
  }
  .bub-icon {
    font-size: 16px;
  }
  .bub-text strong {
    color: var(--warning);
  }
  .bub-btn {
    margin-left: auto;
    padding: 5px 12px;
    border-radius: var(--r-sm);
    border: 1px solid var(--warning);
    background: transparent;
    color: var(--warning);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
  }
  .bub-btn:hover {
    background: var(--bg-hover);
  }
</style>
